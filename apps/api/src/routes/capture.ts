import {
  ActionConflict,
  captureIdSchema,
  captureSchema,
  claimTodoFiles,
  createReminder,
  deleteTodoFile,
  getReminder,
  getSlot,
  listTodoFiles,
  MAX_FILE_BYTES,
  moveSlot,
  placeSlot,
  pruneStagedFiles,
  readTodoFile,
  setReminderStatus,
  setSlotStatus,
  storeTodoFile,
  todoDetailsSchema,
  type UserDatabase,
  userTransaction,
} from "@wiseroutine/db";
import { canPostponeSlot } from "@wiseroutine/scheduler";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type App, type Ctx, newId } from "../context";
import { requireFeature } from "../features";
import { scheduleGrace } from "../planning/commands";
import { validatePlacement } from "../planning/placement";

export const captureRoutes = new Hono<App>();
const parsed = <T>(
  result: { success: true; data: T } | { success: false },
): T => {
  if (!result.success)
    throw new HTTPException(400, {
      message: "Check the title, links, duration and capture ID.",
    });
  return result.data;
};
async function json(c: Ctx) {
  const text = new TextDecoder().decode(await boundedBody(c, 100_000));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON" });
  }
}
async function boundedBody(c: Ctx, limit: number): Promise<Uint8Array> {
  const reader = c.req.raw.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new HTTPException(413, {
          message: "File is too large (5 MiB maximum).",
        });
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** A stable client intent commits its todo, files and placement together.
 * Duplicate delivery returns the original identity; edited retries conflict. */
captureRoutes.post("/capture", async (c) => {
  const input = parsed(captureSchema.safeParse(await json(c)));
  if (input.fileIds.length) requireFeature(c, "capture_files");
  const fingerprint = JSON.stringify(input);
  const now = c.get("now");
  if (input.startsAt !== undefined || input.activityId) await scheduleGrace(c);
  const result = await userTransaction(c.get("db"), async (db) => {
    const prior = (
      await db.$queryRawUnsafe<{ fingerprint: string; response: string }[]>(
        "SELECT fingerprint,response FROM _captures WHERE id = ?",
        input.id,
      )
    )[0];
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new ActionConflict(
          "This capture was already saved with different contents. Check your inbox before retrying.",
        );
      return JSON.parse(prior.response) as {
        todoId: string;
        slotId: string | null;
      };
    }
    await pruneStagedFiles(db, now);
    if (input.activityId && input.todoId) throw new HTTPException(400);
    const existing = input.todoId ? await getReminder(db, input.todoId) : null;
    if (input.todoId && existing?.status !== "open")
      throw new HTTPException(409, {
        message:
          "This todo is already planned or finished. Open it from the inbox.",
      });
    let activity = null;
    const activityId = input.activityId ?? existing?.activityId;
    if (activityId) {
      activity = await db.activity.findUnique({
        where: { id: activityId },
      });
      if (
        (input.startsAt !== undefined || !existing) &&
        (!activity?.isActive || activity.archivedAt)
      )
        throw new HTTPException(409, {
          message: "This activity is not active.",
        });
    }
    const endsAt = (input.startsAt ?? now) + input.minutes * 60_000;
    if (input.startsAt !== undefined)
      await validatePlacement(db, input.startsAt, endsAt, now);
    const todo =
      existing ??
      (await createReminder(
        db,
        {
          title: input.title,
          activityId: activity?.id ?? null,
          notes: input.notes,
          links: input.links,
          estimatedMinutes: input.minutes,
        },
        now,
        newId,
      ));
    await claimTodoFiles(db, input.id, todo.id, input.fileIds);
    let slotId: string | null = null;
    if (input.startsAt !== undefined || (activity && !existing)) {
      const previous = existing?.slotId
        ? await getSlot(db, existing.slotId)
        : null;
      let slot = previous?.status === "bucketed" ? previous : null;
      if (slot && input.startsAt !== undefined)
        await moveSlot(
          db,
          {
            slotId: slot.id,
            startsAt: input.startsAt,
            endsAt,
            actor: "user",
            reasonCode: "planned_from_inbox",
          },
          now,
          newId,
        );
      else
        slot = await placeSlot(
          db,
          {
            activityId: activity?.id ?? null,
            reminderId: todo.id,
            title: todo.title,
            kind: activity?.kind ?? "task",
            startsAt: input.startsAt ?? now,
            endsAt,
            timeZone: c.get("user").timeZone,
          },
          now,
          newId,
        );
      slotId = slot.id;
      await setReminderStatus(db, todo.id, "slotted", slot.id, input.minutes);
      if (input.startsAt === undefined)
        await setSlotStatus(
          db,
          {
            slotId: slot.id,
            status: "bucketed",
            actor: "user",
            reasonCode: "saved_for_later",
          },
          now,
          newId,
        );
    }
    if (existing && input.startsAt === undefined) {
      await db.reminder.update({
        where: { id: existing.id },
        data: { estimatedMinutes: input.minutes },
      });
      const previous = existing.slotId
        ? await getSlot(db, existing.slotId)
        : null;
      if (previous?.status === "bucketed")
        await db.slot.update({
          where: { id: previous.id },
          data: {
            endsAt: new Date(previous.startsAt + input.minutes * 60_000),
          },
        });
    }
    const response = { todoId: todo.id, slotId };
    await db.$executeRawUnsafe(
      "INSERT INTO _captures(id,fingerprint,response) VALUES (?,?,?)",
      input.id,
      fingerprint,
      JSON.stringify(response),
    );
    return response;
  });
  return c.json(result, 201);
});

captureRoutes.put("/captures/:captureId/files/:id", async (c) => {
  const id = parsed(captureIdSchema.safeParse(c.req.param("id")));
  const captureId = parsed(captureIdSchema.safeParse(c.req.param("captureId")));
  let name: string;
  try {
    name = decodeURIComponent(c.req.header("x-file-name") ?? "");
  } catch {
    throw new HTTPException(400, { message: "Invalid file name" });
  }
  const bytes = await boundedBody(c, MAX_FILE_BYTES);
  return c.json(
    await storeTodoFile(
      c.get("db"),
      { id, captureId, name, bytes },
      c.get("now"),
    ),
    201,
  );
});

captureRoutes.delete("/captures/:id/files", async (c) => {
  const id = parsed(captureIdSchema.safeParse(c.req.param("id")));
  await userTransaction(c.get("db"), async (db) => {
    await db.$executeRawUnsafe(
      "DELETE FROM _todo_file_chunks WHERE file_id IN (SELECT id FROM _todo_files WHERE capture_id = ? AND todo_id IS NULL)",
      id,
    );
    await db.$executeRawUnsafe(
      "DELETE FROM _todo_files WHERE capture_id = ? AND todo_id IS NULL",
      id,
    );
  });
  return c.body(null, 204);
});

async function details(db: UserDatabase, id: string) {
  const todo = await getReminder(db, id);
  if (!todo) throw new HTTPException(404, { message: "No such todo" });
  const slot = todo.slotId ? await getSlot(db, todo.slotId) : null;
  return {
    ...todo,
    minutes:
      todo.status === "slotted" && slot
        ? Math.ceil((slot.endsAt - slot.startsAt) / 60_000)
        : todo.estimatedMinutes,
    files: await listTodoFiles(db, id),
    slot: slot ?? null,
  };
}
captureRoutes.get("/inbox", async (c) => {
  const db = c.get("db");
  const cursor = c.req.query("cursor");
  if (cursor && !(await db.reminder.findUnique({ where: { id: cursor } })))
    throw new HTTPException(400, { message: "Refresh the inbox to continue" });
  await userTransaction(db, (tx) => pruneStagedFiles(tx, c.get("now")));
  const q = (c.req.query("q") ?? "").trim();
  if (q.length > 200) throw new HTTPException(400);
  const fileMatches = q
    ? await db.$queryRawUnsafe<{ todo_id: string }[]>(
        "SELECT DISTINCT todo_id FROM _todo_files WHERE todo_id IS NOT NULL AND instr(lower(name), lower(?)) > 0",
        q,
      )
    : [];
  const rows = await db.reminder.findMany({
    where: {
      status: {
        in:
          c.req.query("done") === "1"
            ? ["done", "dropped"]
            : ["open", "slotted"],
      },
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { notes: { contains: q } },
              { linksJson: { contains: q } },
              { id: { in: fileMatches.map((f) => f.todo_id) } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  // One batched slot query; file bytes never participate in inbox reads.
  const slots = await db.slot.findMany({
    where: {
      id: { in: rows.flatMap((row) => (row.slotId ? [row.slotId] : [])) },
    },
    select: { id: true, startsAt: true, endsAt: true, status: true },
  });
  return c.json({
    items: rows.slice(0, 50).map((row) => {
      const slot = slots.find((s) => s.id === row.slotId);
      return {
        id: row.id,
        title: row.title,
        minutes:
          row.status === "slotted" && slot
            ? Math.ceil(
                (slot.endsAt.getTime() - slot.startsAt.getTime()) / 60_000,
              )
            : row.estimatedMinutes,
        needsFocus: row.needsFocus,
        status: row.status,
        slotId: row.slotId,
        startsAt:
          slot?.status !== "bucketed"
            ? (slot?.startsAt.getTime() ?? null)
            : null,
        endsAt: slot?.endsAt.getTime() ?? null,
        createdAt: row.createdAt.getTime(),
      };
    }),
    nextCursor: rows.length > 50 ? rows[49]?.id : null,
  });
});
captureRoutes.get("/todos/:id/details", async (c) =>
  c.json(await details(c.get("db"), c.req.param("id"))),
);
captureRoutes.put("/todos/:id/details", async (c) => {
  const input = parsed(todoDetailsSchema.strict().safeParse(await json(c)));
  await userTransaction(c.get("db"), async (db) => {
    const todo = await getReminder(db, c.req.param("id"));
    if (!todo) throw new HTTPException(404);
    await db.reminder.update({
      where: { id: todo.id },
      data: {
        title: input.title,
        notes: input.notes,
        linksJson: JSON.stringify(input.links),
        estimatedMinutes: input.minutes,
      },
    });
    const current = todo.slotId ? await getSlot(db, todo.slotId) : null;
    if (current?.status === "bucketed")
      await db.slot.update({
        where: { id: current.id },
        data: { endsAt: new Date(current.startsAt + input.minutes * 60_000) },
      });
    if (todo.slotId)
      await db.slot.updateMany({
        where: {
          id: todo.slotId,
          status: { in: ["planned", "live", "bucketed"] },
        },
        data: { title: input.title },
      });
  });
  return c.body(null, 204);
});
captureRoutes.put("/todos/:todoId/files/:id", async (c) => {
  const id = parsed(captureIdSchema.safeParse(c.req.param("id")));
  let name: string;
  try {
    name = decodeURIComponent(c.req.header("x-file-name") ?? "");
  } catch {
    throw new HTTPException(400);
  }
  const bytes = await boundedBody(c, MAX_FILE_BYTES);
  const file = await userTransaction(c.get("db"), async (db) => {
    const todo = await getReminder(db, c.req.param("todoId"));
    if (!todo) throw new HTTPException(404);
    const existing = await listTodoFiles(db, todo.id);
    if (existing.length >= 10 && !existing.some((f) => f.id === id))
      throw new HTTPException(409, { message: "At most ten files per todo" });
    if (
      existing.reduce((sum, f) => sum + Number(f.size), 0) + bytes.length >
        20 * 1024 * 1024 &&
      !existing.some((f) => f.id === id)
    )
      throw new HTTPException(409, { message: "At most 20 MiB per todo" });
    const file = await storeTodoFile(
      db,
      { id, captureId: id, name, bytes },
      c.get("now"),
    );
    if (!existing.some((f) => f.id === id))
      await claimTodoFiles(db, id, todo.id, [id]);
    return file;
  });
  return c.json(file, 201);
});
captureRoutes.get("/todos/:todoId/files/:id", async (c) => {
  const result = await readTodoFile(
    c.get("db"),
    c.req.param("todoId"),
    c.req.param("id"),
  );
  if (!result) throw new HTTPException(404);
  return new Response(result.bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(result.file.name).replace(/'/g, "%27")}`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
});
captureRoutes.delete("/todos/:todoId/files/:id", async (c) => {
  await deleteTodoFile(c.get("db"), c.req.param("todoId"), c.req.param("id"));
  return c.body(null, 204);
});

export async function updateTodoStatus(
  db: UserDatabase,
  id: string,
  status: "done" | "dropped",
  now: number,
  actor: "user" | "addon" = "user",
): Promise<void> {
  await userTransaction(db, async (tx) => {
    const todo = await getReminder(tx, id);
    if (!todo) throw new HTTPException(404, { message: "No such todo" });
    if (todo.slotId) {
      const slot = await getSlot(tx, todo.slotId);
      if (slot && !["completed", "cancelled"].includes(slot.status))
        await setSlotStatus(
          tx,
          {
            slotId: slot.id,
            status: status === "done" ? "completed" : "cancelled",
            actor,
            reasonCode: "todo_status",
          },
          now,
          newId,
        );
    }
    await setReminderStatus(tx, id, status, todo.slotId);
  });
}

captureRoutes.get("/slots/:id/details", async (c) => {
  const slot = await getSlot(c.get("db"), c.req.param("id"));
  if (!slot) throw new HTTPException(404);
  return c.json(slot);
});
captureRoutes.post("/slots/:id/reschedule", async (c) => {
  const input = (await json(c)) as {
    startsAt?: unknown;
    endsAt?: unknown;
    bucket?: unknown;
  };
  if (!input || typeof input !== "object") throw new HTTPException(400);
  const bucket = input.bucket === true;
  if (bucket) requireFeature(c, "inbox");
  const actionId = c.req.header("idempotency-key");
  if (actionId) parsed(captureIdSchema.safeParse(actionId));
  const fingerprint = JSON.stringify(["reschedule", c.req.param("id"), input]);
  if (
    !bucket &&
    (typeof input.startsAt !== "number" || typeof input.endsAt !== "number")
  )
    throw new HTTPException(400, { message: "Choose a date and time" });
  await scheduleGrace(c);
  const result = await userTransaction(c.get("db"), async (db) => {
    if (actionId) {
      const previous = (
        await db.$queryRawUnsafe<{ fingerprint: string; response: string }[]>(
          "SELECT fingerprint,response FROM _captures WHERE id = ?",
          actionId,
        )
      )[0];
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new ActionConflict(
            "This move was already saved with different details",
          );
        return JSON.parse(previous.response) as { slotId: string };
      }
    }
    const slot = await getSlot(db, c.req.param("id"));
    if (!slot) throw new HTTPException(404);
    if (!canPostponeSlot(slot, c.get("now")))
      throw new HTTPException(409, {
        message:
          "This slot can no longer be moved. You can still mark it done.",
      });
    // Prevent an old appointment from taking a todo away from its new one.
    if (slot.reminderId) {
      const todo = await getReminder(db, slot.reminderId);
      if (todo?.status === "done" || (todo?.slotId && todo.slotId !== slot.id))
        throw new HTTPException(409, {
          message: "This todo has a newer appointment. Open it from the inbox.",
        });
    }
    const startsAt = bucket ? c.get("now") : (input.startsAt as number);
    const endsAt = bucket
      ? startsAt + slot.endsAt - slot.startsAt
      : (input.endsAt as number);
    if (!bucket && slot.activityId) {
      const activity = await db.activity.findUnique({
        where: { id: slot.activityId },
      });
      if (!activity?.isActive || activity.archivedAt)
        throw new HTTPException(409, {
          message: "Enable this activity before rescheduling it.",
        });
    }
    if (!bucket)
      await validatePlacement(db, startsAt, endsAt, c.get("now"), slot.id);
    if (!bucket)
      await moveSlot(
        db,
        {
          slotId: slot.id,
          startsAt,
          endsAt,
          actor: "user",
          reasonCode: "postponed",
        },
        c.get("now"),
        newId,
      );
    if (slot.reminderId)
      await setReminderStatus(
        db,
        slot.reminderId,
        "slotted",
        slot.id,
        Math.ceil((endsAt - startsAt) / 60_000),
      );
    if (bucket)
      await setSlotStatus(
        db,
        {
          slotId: slot.id,
          status: "bucketed",
          actor: "user",
          reasonCode: "saved_for_later",
        },
        c.get("now"),
        newId,
      );
    const response = { slotId: slot.id };
    if (actionId)
      await db.$executeRawUnsafe(
        "INSERT INTO _captures(id,fingerprint,response) VALUES (?,?,?)",
        actionId,
        fingerprint,
        JSON.stringify(response),
      );
    return response;
  });
  return c.json(result);
});
