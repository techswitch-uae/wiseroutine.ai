import { exports as worker } from "cloudflare:workers";
import { MAX_FILE_BYTES, placeSlot } from "@wiseroutine/db";
import { beforeEach, expect, test } from "vitest";
import {
  resetDatabases,
  seedActivity,
  seedUser,
  type TestUser,
  testFeatures,
  tomorrowNoon,
  userDb,
} from "./test-support";

beforeEach(async () => {
  await resetDatabases();
  await testFeatures("all");
});
const uuid = () => crypto.randomUUID();
const input = (extra: Record<string, unknown> = {}) => ({
  id: uuid(),
  title: "Read this later",
  notes: "Context",
  links: ["https://example.com/read"],
  minutes: 20,
  fileIds: [],
  ...extra,
});
const post = (
  user: TestUser,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  worker.default.fetch(`http://api${path}`, {
    method: "POST",
    headers: {
      ...user.headers,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
const get = (user: TestUser, path: string) =>
  worker.default.fetch(`http://api${path}`, { headers: user.headers });
const upload = (
  user: TestUser,
  capture: string,
  id: string,
  body: Uint8Array,
  name = "paper.pdf",
) =>
  worker.default.fetch(`http://api/captures/${capture}/files/${id}`, {
    method: "PUT",
    headers: {
      ...user.headers,
      "content-type": "application/octet-stream",
      "x-file-name": encodeURIComponent(name),
    },
    body: body as Uint8Array<ArrayBuffer>,
  });

test("concurrent capture delivery commits once and competing bookings cannot overlap", async () => {
  const user = await seedUser();
  const body = input({ startsAt: tomorrowNoon() });
  const same = await Promise.all([
    post(user, "/capture", body),
    post(user, "/capture", body),
  ]);
  expect(same.map((r) => r.status)).toEqual([201, 201]);
  expect(await same[0]?.json()).toEqual(await same[1]?.json());
  expect(await userDb().reminder.count()).toBe(1);
  const next = tomorrowNoon() + 3600000;
  const competing = await Promise.all([
    post(user, "/capture", input({ startsAt: next })),
    post(user, "/capture", input({ startsAt: next })),
  ]);
  expect(competing.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(await userDb().reminder.count()).toBe(2);
});

test("guided activity identity survives a skipped appointment and legacy placement reuses its bucket", async () => {
  const user = await seedUser();
  const activityId = await seedActivity();
  const captured = await post(user, "/capture", input({ activityId }));
  const { todoId, slotId } = (await captured.json()) as {
    todoId: string;
    slotId: string;
  };
  const planned = await post(user, "/slots", {
    todoId,
    startsAt: tomorrowNoon(),
  });
  expect(planned.status).toBe(201);
  expect(((await planned.json()) as { id: string }).id).toBe(slotId);
  expect(await (await get(user, "/bucket")).json()).toEqual([]);
  await post(user, `/slots/${slotId}/skip`, {});
  const resaved = await post(
    user,
    "/capture",
    input({ todoId, startsAt: tomorrowNoon() + 3600000 }),
  );
  expect(resaved.status).toBe(201);
  const next = (await resaved.json()) as { slotId: string };
  expect(
    (await userDb().slot.findUnique({ where: { id: next.slotId } }))
      ?.activityId,
  ).toBe(activityId);
});

test("cross-midnight slots remain visible on the following calendar day", async () => {
  const user = await seedUser({ timeZone: "UTC" });
  const date = new Date(tomorrowNoon());
  date.setUTCHours(23, 45, 0, 0);
  const startsAt = date.getTime();
  const result = await post(user, "/capture", input({ startsAt, minutes: 30 }));
  expect(result.status).toBe(201);
  const { slotId } = (await result.json()) as { slotId: string };
  const following = await get(
    user,
    `/today?range=full&at=${startsAt + 30 * 60000}`,
  );
  expect(following.status).toBe(200);
  const plan = (await following.json()) as { slots: { id: string }[] };
  expect(plan.slots.some((s) => s.id === slotId)).toBe(true);
});

test("editing bucket duration and changing appointment duration stay consistent", async () => {
  const user = await seedUser();
  const activityId = await seedActivity();
  const created = await post(user, "/capture", input({ activityId }));
  const { todoId, slotId } = (await created.json()) as {
    todoId: string;
    slotId: string;
  };
  const edit = await worker.default.fetch(
    `http://api/todos/${todoId}/details`,
    {
      method: "PUT",
      headers: user.headers,
      body: JSON.stringify({
        title: "Read with context",
        notes: "Kept",
        links: [],
        minutes: 45,
      }),
    },
  );
  expect(edit.status).toBe(204);
  const bucket = await userDb().slot.findUniqueOrThrow({
    where: { id: slotId },
  });
  expect(bucket.endsAt.getTime() - bucket.startsAt.getTime()).toBe(45 * 60000);
  expect(
    (
      await post(user, `/slots/${slotId}/reschedule`, {
        startsAt: tomorrowNoon(),
        endsAt: tomorrowNoon() + 30 * 60000,
      })
    ).status,
  ).toBe(200);
  const detail = (await (
    await get(user, `/todos/${todoId}/details`)
  ).json()) as { minutes: number; notes: string };
  expect(detail).toMatchObject({ minutes: 30, notes: "Kept" });
  expect(
    (await userDb().reminder.findUniqueOrThrow({ where: { id: todoId } }))
      .estimatedMinutes,
  ).toBe(30);
});

test("aggregate attachment quotas bound captures, accounts and even zero-byte files", async () => {
  const user = await seedUser(),
    db = userDb();
  for (const [count, size, sameCapture] of [
    [4, 5 * 1024 * 1024, true],
    [20, 5 * 1024 * 1024, false],
    [2000, 0, false],
  ] as const) {
    await db.$executeRawUnsafe("DELETE FROM _todo_files");
    const capture = uuid();
    await db.$executeRawUnsafe(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?) INSERT INTO _todo_files(id,capture_id,name,size,digest,created_at) SELECT printf('%08x-0000-4000-8000-%012x',i,i), CASE WHEN ? THEN ? ELSE printf('%08x-1111-4000-8000-%012x',i,i) END, 'file.bin', ?, ?, ? FROM n",
      count,
      sameCapture ? 1 : 0,
      capture,
      size,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      Date.now(),
    );
    expect(
      (await upload(user, capture, uuid(), new Uint8Array([1]))).status,
    ).toBe(409);
    expect(
      await db.$queryRawUnsafe("SELECT file_id FROM _todo_file_chunks"),
    ).toEqual([]);
  }
});

test("resetting a draft releases removed uploads but never deletes already claimed files", async () => {
  const user = await seedUser(),
    body = input(),
    removed = uuid(),
    kept = uuid();
  expect(
    (await upload(user, body.id, removed, new Uint8Array([1]))).status,
  ).toBe(201);
  const reset = () =>
    worker.default.fetch(`http://api/captures/${body.id}/files`, {
      method: "DELETE",
      headers: user.headers,
    });
  expect((await reset()).status).toBe(204);
  expect(await userDb().$queryRawUnsafe("SELECT id FROM _todo_files")).toEqual(
    [],
  );
  expect(
    await userDb().$queryRawUnsafe("SELECT file_id FROM _todo_file_chunks"),
  ).toEqual([]);
  expect((await upload(user, body.id, kept, new Uint8Array([2]))).status).toBe(
    201,
  );
  const result = (await (
    await post(user, "/capture", { ...body, fileIds: [kept] })
  ).json()) as { todoId: string };
  expect((await reset()).status).toBe(204);
  const downloaded = await get(user, `/todos/${result.todoId}/files/${kept}`);
  expect(downloaded.status).toBe(200);
  expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(
    new Uint8Array([2]),
  );
});

test("expired staged files cannot be committed, but a retry can re-upload them", async () => {
  const user = await seedUser(),
    body = input(),
    file = uuid();
  expect((await upload(user, body.id, file, new Uint8Array([1]))).status).toBe(
    201,
  );
  await userDb().$executeRawUnsafe(
    "UPDATE _todo_files SET created_at=?",
    Date.now() - 2 * 86400000,
  );
  expect(
    (await post(user, "/capture", { ...body, fileIds: [file] })).status,
  ).toBe(409);
  expect(await userDb().reminder.count()).toBe(0);
  expect((await upload(user, body.id, file, new Uint8Array([1]))).status).toBe(
    201,
  );
  expect(
    (await post(user, "/capture", { ...body, fileIds: [file] })).status,
  ).toBe(201);
});

test("core bucket capture needs no addon; retries keep one identity and details", async () => {
  const user = await seedUser();
  const body = input();
  const first = await post(user, "/capture", body);
  expect(first.status).toBe(201);
  const result = (await first.json()) as { todoId: string; slotId: null };
  expect(result.slotId).toBeNull();
  expect(await (await post(user, "/capture", body)).json()).toEqual(result);
  expect(
    (await post(user, "/capture", { ...body, title: "Different intent" }))
      .status,
  ).toBe(409);
  expect(await userDb().reminder.count()).toBe(1);
  const detail = (await (
    await get(user, `/todos/${result.todoId}/details`)
  ).json()) as { notes: string; links: string[] };
  expect(detail.notes).toBe("Context");
  expect(detail.links).toEqual(body.links);
  const publicTodo = (await (await get(user, "/todos")).json()) as Record<
    string,
    unknown
  >[];
  expect(publicTodo[0]).not.toHaveProperty("files");
  expect(publicTodo[0]).not.toHaveProperty("notes");
});

test("planned capture is atomic, rejects occupied time, and can retry after a definite conflict", async () => {
  const user = await seedUser();
  const startsAt = tomorrowNoon();
  await placeSlot(
    userDb(),
    {
      activityId: null,
      title: "Busy",
      kind: "task",
      startsAt,
      endsAt: startsAt + 3600000,
      timeZone: "UTC",
    },
    Date.now(),
    uuid,
  );
  const body = input({ startsAt });
  expect((await post(user, "/capture", body)).status).toBe(409);
  expect(await userDb().reminder.count()).toBe(0);
  expect(
    (await post(user, "/capture", { ...body, startsAt: startsAt + 3600000 }))
      .status,
  ).toBe(201);
  expect(await userDb().reminder.count()).toBe(1);
  expect(await userDb().slot.count()).toBe(2);
  const rows = await userDb().reminder.findMany();
  expect(rows[0]?.status).toBe("slotted");
});

test("files are transactional, private downloads with safe headers, and preserve exact binary bytes", async () => {
  const user = await seedUser();
  const body = input();
  const a = uuid(),
    b = uuid();
  const bytes = new Uint8Array([37, 80, 68, 70, 0, 255, 128]);
  expect((await upload(user, body.id, a, bytes, "../paper.pdf")).status).toBe(
    201,
  );
  expect(
    (await upload(user, body.id, b, new Uint8Array([1, 2]), "paper.pdf"))
      .status,
  ).toBe(201);
  expect(
    (await upload(user, body.id, a, new Uint8Array([7]), "../paper.pdf"))
      .status,
  ).toBe(409);
  const captured = await post(user, "/capture", { ...body, fileIds: [a, b] });
  expect(captured.status).toBe(201);
  const { todoId } = (await captured.json()) as { todoId: string };
  const response = await get(user, `/todos/${todoId}/files/${a}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/octet-stream");
  expect(response.headers.get("content-disposition")).toContain("attachment;");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  expect((await get(user, `/todos/wrong/files/${a}`)).status).toBe(404);
  expect(
    (await worker.default.fetch(`http://api/todos/${todoId}/files/${a}`))
      .status,
  ).toBe(401);
  expect(
    (
      await worker.default.fetch(`http://api/todos/${todoId}/details`, {
        headers: { ...user.headers, "x-wr-addon": "wiseroutine.todos" },
      })
    ).status,
  ).toBe(403);
  const details = (await (
    await get(user, `/todos/${todoId}/details`)
  ).json()) as { files: unknown[] };
  expect(details.files).toHaveLength(2);
  expect(
    (
      await worker.default.fetch(`http://api/todos/${todoId}/files/${a}`, {
        method: "DELETE",
        headers: user.headers,
      })
    ).status,
  ).toBe(204);
  expect((await get(user, `/todos/${todoId}/files/${a}`)).status).toBe(404);
});

test("partial chunk failure rolls the file and all its bytes back", async () => {
  const user = await seedUser();
  const db = userDb();
  await db.$executeRawUnsafe(
    "CREATE TRIGGER fail_file_chunk BEFORE INSERT ON _todo_file_chunks WHEN NEW.position = 1 BEGIN SELECT RAISE(ABORT, 'injected file failure'); END",
  );
  try {
    const response = await upload(user, uuid(), uuid(), new Uint8Array(300000));
    expect(response.status).toBe(500);
    expect(await db.$queryRawUnsafe("SELECT id FROM _todo_files")).toEqual([]);
    expect(
      await db.$queryRawUnsafe("SELECT file_id FROM _todo_file_chunks"),
    ).toEqual([]);
  } finally {
    await db.$executeRawUnsafe("DROP TRIGGER fail_file_chunk");
  }
});

test("oversize and missing/duplicate files cannot leave a half-created todo", async () => {
  const user = await seedUser();
  const body = input();
  expect(
    (await upload(user, body.id, uuid(), new Uint8Array(MAX_FILE_BYTES + 1)))
      .status,
  ).toBe(413);
  expect(
    (await post(user, "/capture", { ...body, fileIds: [uuid()] })).status,
  ).toBe(409);
  const file = uuid();
  expect((await upload(user, body.id, file, new Uint8Array([1]))).status).toBe(
    201,
  );
  expect(
    (await post(user, "/capture", { ...body, fileIds: [file, file] })).status,
  ).toBe(409);
  expect(await userDb().reminder.count()).toBe(0);
});

test("completing, cancelling and restoring synchronize the current todo appointment", async () => {
  const user = await seedUser();
  const response = await post(
    user,
    "/capture",
    input({ startsAt: tomorrowNoon() }),
  );
  const { todoId, slotId } = (await response.json()) as {
    todoId: string;
    slotId: string;
  };
  expect((await post(user, `/slots/${slotId}/cancel`, {})).status).toBe(204);
  expect(
    (await userDb().reminder.findUnique({ where: { id: todoId } }))?.status,
  ).toBe("open");
  expect((await post(user, `/slots/${slotId}/restore`, {})).status).toBe(204);
  expect(
    (await userDb().reminder.findUnique({ where: { id: todoId } }))?.status,
  ).toBe("slotted");
  expect((await post(user, `/slots/${slotId}/complete`, {})).status).toBe(204);
  expect(
    (await userDb().reminder.findUnique({ where: { id: todoId } }))?.status,
  ).toBe("done");
  expect(
    (
      await post(user, `/slots/${slotId}/move`, {
        startsAt: tomorrowNoon() + 3600000,
        endsAt: tomorrowNoon() + 4800000,
      })
    ).status,
  ).toBe(409);
});

test("postponing a running session keeps history and files; retry and old completion cannot duplicate or finish the new appointment", async () => {
  const user = await seedUser();
  const startsAt = tomorrowNoon();
  const { todoId, slotId } = (await (
    await post(user, "/capture", input({ startsAt }))
  ).json()) as { todoId: string; slotId: string };
  await post(user, `/slots/${slotId}/start`, {});
  const body = {
    startsAt: startsAt + 86400000,
    endsAt: startsAt + 86400000 + 1200000,
  };
  const headers = { "idempotency-key": uuid() };
  const moved = await post(user, `/slots/${slotId}/reschedule`, body, headers);
  expect(moved.status).toBe(200);
  const next = (await moved.json()) as { slotId: string };
  expect(next.slotId).not.toBe(slotId);
  expect(
    await (
      await post(user, `/slots/${slotId}/reschedule`, body, headers)
    ).json(),
  ).toEqual(next);
  expect(await userDb().slot.count()).toBe(2);
  expect(
    (await userDb().slot.findUnique({ where: { id: slotId } }))?.status,
  ).toBe("skipped");
  await post(user, `/slots/${slotId}/complete`, {});
  const todo = await userDb().reminder.findUnique({ where: { id: todoId } });
  expect(todo?.status).toBe("slotted");
  expect(todo?.slotId).toBe(next.slotId);
  expect(
    (await userDb().slot.findUnique({ where: { id: next.slotId } }))?.status,
  ).toBe("planned");
});

test("bucket is a durable queue across days and re-planning keeps the same unstarted slot", async () => {
  const user = await seedUser();
  const activityId = await seedActivity();
  const captured = await post(user, "/capture", input({ activityId }));
  expect(captured.status).toBe(201);
  const { todoId, slotId } = (await captured.json()) as {
    todoId: string;
    slotId: string;
  };
  await userDb().slot.update({
    where: { id: slotId },
    data: {
      startsAt: new Date(Date.now() - 2 * 86400000),
      endsAt: new Date(Date.now() - 2 * 86400000 + 1200000),
    },
  });
  const bucket = (await (await get(user, "/bucket")).json()) as {
    id: string;
  }[];
  expect(bucket.map((s) => s.id)).toContain(slotId);
  const moved = await post(user, `/slots/${slotId}/reschedule`, {
    startsAt: tomorrowNoon(),
    endsAt: tomorrowNoon() + 1200000,
  });
  expect(moved.status).toBe(200);
  expect(await moved.json()).toEqual({ slotId });
  expect(
    (await userDb().reminder.findUnique({ where: { id: todoId } }))?.status,
  ).toBe("slotted");
  expect(
    (await post(user, `/slots/${slotId}/reschedule`, { bucket: true })).status,
  ).toBe(200);
  expect(
    (await userDb().reminder.findUnique({ where: { id: todoId } }))?.status,
  ).toBe("open");
});

test("legacy moves reject overlaps and completing a todo also completes its linked slot", async () => {
  const user = await seedUser();
  const at = tomorrowNoon();
  const a = (await (
    await post(user, "/capture", input({ startsAt: at }))
  ).json()) as { todoId: string; slotId: string };
  await post(user, "/capture", input({ startsAt: at + 3600000 }));
  expect(
    (
      await post(user, `/slots/${a.slotId}/move`, {
        startsAt: at + 3600000,
        endsAt: at + 4800000,
      })
    ).status,
  ).toBe(409);
  const response = await worker.default.fetch(`http://api/todos/${a.todoId}`, {
    method: "PATCH",
    headers: { ...user.headers, "content-type": "application/json" },
    body: JSON.stringify({ status: "done" }),
  });
  expect(response.status).toBe(204);
  expect(
    (await userDb().slot.findUnique({ where: { id: a.slotId } }))?.status,
  ).toBe("completed");
});

test("inbox searches notes and file names without loading bytes and paginates", async () => {
  const user = await seedUser();
  const now = new Date();
  await userDb().reminder.createMany({
    data: Array.from({ length: 52 }, (_, i) => ({
      id: uuid(),
      title: `Todo ${i}`,
      notes: i === 0 ? "needle in notes" : "",
      dueWindow: "none",
      createdAt: now,
    })),
  });
  const first = (await (await get(user, "/inbox")).json()) as {
    items: { id: string }[];
    nextCursor: string;
  };
  expect(first.items).toHaveLength(50);
  const second = (await (
    await get(user, `/inbox?cursor=${first.nextCursor}`)
  ).json()) as { items: { id: string }[]; nextCursor: null };
  expect(second.items).toHaveLength(2);
  expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items, ...second.items].map((t) => t.id)).size).toBe(
    52,
  );
  const search = (await (await get(user, "/inbox?q=needle")).json()) as {
    items: unknown[];
  };
  expect(search.items).toHaveLength(1);
  const body = input();
  const file = uuid();
  await upload(user, body.id, file, new Uint8Array([7]), "unique-reading.pdf");
  await post(user, "/capture", { ...body, fileIds: [file] });
  const files = (await (await get(user, "/inbox?q=unique-reading")).json()) as {
    items: unknown[];
  };
  expect(files.items).toHaveLength(1);
});

test.each([
  { title: "" },
  { links: ["javascript:alert(1)"] },
  { links: ["https://user:secret@example.com"] },
  { minutes: 0 },
  { minutes: 481 },
  { startsAt: 1 },
  { startsAt: Date.now() + 400 * 86400000 },
])("capture validates inputs %j", async (patch) => {
  const user = await seedUser();
  expect((await post(user, "/capture", input(patch))).status).toBe(400);
  expect(await userDb().reminder.count()).toBe(0);
});
