import { z } from "zod";
import { type UserDatabase, userTransaction } from "../client";
import { ActionConflict } from "./slots";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_CAPTURE_BYTES = 20 * 1024 * 1024;
export const MAX_ACCOUNT_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_FILES = 10;
export const MAX_ACCOUNT_FILES = 2000;
export const captureIdSchema = z.string().uuid();
export const safeLinkSchema = z
  .string()
  .max(4096)
  .refine((value) => {
    try {
      const u = new URL(value);
      return (
        ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
      );
    } catch {
      return false;
    }
  }, "Use an http(s) link without embedded credentials");
export const todoDetailsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(10000).default(""),
  links: z.array(safeLinkSchema).max(20).default([]),
  minutes: z.number().int().min(1).max(480).default(15),
});
export const captureSchema = todoDetailsSchema
  .extend({
    id: captureIdSchema,
    activityId: z.string().min(1).max(128).optional(),
    todoId: z.string().min(1).max(128).optional(),
    startsAt: z.number().int().optional(),
    fileIds: z.array(captureIdSchema).max(MAX_FILES).default([]),
  })
  .strict();

export interface TodoFile {
  id: string;
  name: string;
  size: number;
}
interface StoredFile extends TodoFile {
  capture_id: string;
  todo_id: string | null;
  digest: string;
  created_at: number;
}

export async function listTodoFiles(
  db: UserDatabase,
  todoId: string,
): Promise<TodoFile[]> {
  const files = await db.$queryRawUnsafe<TodoFile[]>(
    "SELECT id, name, size FROM _todo_files WHERE todo_id = ? ORDER BY created_at, id",
    todoId,
  );
  return files.map((file) => ({ ...file, size: Number(file.size) }));
}

/** No cross-service orphan problem: metadata and all chunks commit together.
 * Base64 chunks stay below libSQL's request limits; never load file bytes in
 * inbox/calendar queries. Quotas include staged bytes, not only claimed files. */
export async function storeTodoFile(
  db: UserDatabase,
  input: { id: string; captureId: string; name: string; bytes: Uint8Array },
  now: number,
): Promise<TodoFile> {
  captureIdSchema.parse(input.id);
  captureIdSchema.parse(input.captureId);
  // A name is presentation, never a path; strip controls and bidi formatting.
  const name = input.name.replace(/[\p{Cc}\p{Cf}/\\]/gu, "_").trim();
  if (!name || name.length > 200 || input.bytes.length > MAX_FILE_BYTES)
    throw new ActionConflict("File name or size exceeds the upload limit");
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(input.bytes)),
  );
  const digest = Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return userTransaction(db, async (tx) => {
    await pruneStagedFiles(tx, now);
    const previous = (
      await tx.$queryRawUnsafe<StoredFile[]>(
        "SELECT * FROM _todo_files WHERE id = ?",
        input.id,
      )
    )[0];
    if (previous) {
      if (
        previous.capture_id !== input.captureId ||
        previous.name !== name ||
        previous.digest !== digest
      )
        throw new ActionConflict(
          "File ID already belongs to different contents",
        );
      return {
        id: previous.id,
        name: previous.name,
        size: Number(previous.size),
      };
    }
    if (
      (
        await tx.$queryRawUnsafe<{ id: string }[]>(
          "SELECT id FROM _captures WHERE id = ?",
          input.captureId,
        )
      ).length
    )
      throw new ActionConflict("This capture is already saved");
    const quota = await tx.$queryRawUnsafe<
      { total: number; capture: number; count: number; files: number }[]
    >(
      "SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS total, COALESCE(SUM(CASE WHEN capture_id = ? THEN size ELSE 0 END),0) AS capture, SUM(CASE WHEN capture_id = ? THEN 1 ELSE 0 END) AS count FROM _todo_files",
      input.captureId,
      input.captureId,
    );
    const q = quota[0];
    if (
      q &&
      (Number(q.total) + input.bytes.length > MAX_ACCOUNT_FILE_BYTES ||
        Number(q.capture) + input.bytes.length > MAX_CAPTURE_BYTES ||
        Number(q.count) >= MAX_FILES ||
        Number(q.files) >= MAX_ACCOUNT_FILES)
    )
      throw new ActionConflict(
        "Attachment storage limit reached. Remove files before adding more.",
      );
    await tx.$executeRawUnsafe(
      "INSERT INTO _todo_files(id,capture_id,name,size,digest,created_at) VALUES (?,?,?,?,?,?)",
      input.id,
      input.captureId,
      name,
      input.bytes.length,
      digest,
      now,
    );
    const CHUNK = 256 * 1024;
    for (let offset = 0; offset < input.bytes.length; offset += CHUNK) {
      const bytes = input.bytes.subarray(offset, offset + CHUNK);
      let binary = "";
      for (let p = 0; p < bytes.length; p += 4096)
        binary += String.fromCharCode(...bytes.subarray(p, p + 4096));
      await tx.$executeRawUnsafe(
        "INSERT INTO _todo_file_chunks(file_id,position,data) VALUES (?,?,?)",
        input.id,
        offset / CHUNK,
        btoa(binary),
      );
    }
    return { id: input.id, name, size: input.bytes.length };
  });
}

export async function pruneStagedFiles(
  db: UserDatabase,
  now: number,
): Promise<void> {
  // Called within a writer transaction. Both queries use the same boundary.
  const before = now - 24 * 60 * 60_000;
  await db.$executeRawUnsafe(
    "DELETE FROM _todo_file_chunks WHERE file_id IN (SELECT id FROM _todo_files WHERE todo_id IS NULL AND created_at < ?)",
    before,
  );
  await db.$executeRawUnsafe(
    "DELETE FROM _todo_files WHERE todo_id IS NULL AND created_at < ?",
    before,
  );
}

export async function claimTodoFiles(
  db: UserDatabase,
  captureId: string,
  todoId: string,
  ids: string[],
): Promise<void> {
  if (new Set(ids).size !== ids.length)
    throw new ActionConflict("Duplicate attachment IDs");
  for (const id of ids) {
    const changed = await db.$executeRawUnsafe(
      "UPDATE _todo_files SET todo_id = ? WHERE id = ? AND capture_id = ? AND todo_id IS NULL",
      todoId,
      id,
      captureId,
    );
    if (changed !== 1)
      throw new ActionConflict(
        "An attachment is missing or expired. Attach it again.",
      );
  }
  const files = await listTodoFiles(db, todoId);
  if (
    files.length > MAX_FILES ||
    files.reduce((sum, file) => sum + file.size, 0) > MAX_CAPTURE_BYTES
  )
    throw new ActionConflict("At most ten files and 20 MiB per todo");
  // Removed selections and abandoned uploads are discarded with this capture.
  await db.$executeRawUnsafe(
    "DELETE FROM _todo_file_chunks WHERE file_id IN (SELECT id FROM _todo_files WHERE capture_id = ? AND todo_id IS NULL)",
    captureId,
  );
  await db.$executeRawUnsafe(
    "DELETE FROM _todo_files WHERE capture_id = ? AND todo_id IS NULL",
    captureId,
  );
}

export async function readTodoFile(
  db: UserDatabase,
  todoId: string,
  id: string,
): Promise<{ file: TodoFile; bytes: Uint8Array } | null> {
  const file = (
    await db.$queryRawUnsafe<StoredFile[]>(
      "SELECT * FROM _todo_files WHERE id = ? AND todo_id = ?",
      id,
      todoId,
    )
  )[0];
  if (!file) return null;
  const bytes = new Uint8Array(Number(file.size));
  const chunks = await db.$queryRawUnsafe<{ data: string }[]>(
    "SELECT data FROM _todo_file_chunks WHERE file_id = ? ORDER BY position",
    id,
  );
  let offset = 0;
  for (const chunk of chunks) {
    const binary = atob(chunk.data);
    for (let i = 0; i < binary.length; i++)
      bytes[offset++] = binary.charCodeAt(i);
  }
  if (offset !== Number(file.size))
    throw new Error("Attachment integrity failure");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  if (
    Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("") !==
    file.digest
  )
    throw new Error("Attachment integrity failure");
  return {
    file: { id: file.id, name: file.name, size: Number(file.size) },
    bytes,
  };
}

export async function deleteTodoFile(
  db: UserDatabase,
  todoId: string,
  id: string,
): Promise<void> {
  await userTransaction(db, async (tx) => {
    await tx.$executeRawUnsafe(
      "DELETE FROM _todo_file_chunks WHERE file_id IN (SELECT id FROM _todo_files WHERE id = ? AND todo_id = ?)",
      id,
      todoId,
    );
    await tx.$executeRawUnsafe(
      "DELETE FROM _todo_files WHERE id = ? AND todo_id = ?",
      id,
      todoId,
    );
  });
}
