import { placeSlot, setSlotStatus } from "@wiseroutine/db";
import { resolveFeatures } from "@wiseroutine/plans/features";
import { beforeEach, expect, test } from "vitest";
import type { ServerEnv } from "./env";
import { sweepGrace } from "./index";
import {
  resetDatabases,
  seedActivity,
  seedUser,
  tomorrowNoon,
  userDb,
} from "./test-support";

beforeEach(resetDatabases);
const config = {
  TURSO_DIRECTORY_URL: "http://127.0.0.1:41090",
  TURSO_USER_HOST: "http://127.0.0.1:41091",
} as ServerEnv;
const id = () => crypto.randomUUID();
async function fixture() {
  const user = await seedUser({ timeZone: "UTC" });
  const activityId = await seedActivity({ minimumValue: 1 });
  await userDb().activity.update({
    where: { id: activityId },
    data: { startPolicy: "auto" },
  });
  const at = tomorrowNoon();
  const slot = await placeSlot(
    userDb(),
    {
      activityId,
      title: "Stretch",
      kind: "recovery",
      startsAt: at,
      endsAt: at + 600_000,
      timeZone: "UTC",
    },
    at,
    id,
  );
  return {
    at,
    slot,
    job: {
      userId: user.userId,
      databaseName: user.databaseName,
      type: "grace-sweep" as const,
      workId: "",
    },
  };
}

test("M1-off background processing cannot auto-start an old guided activity", async () => {
  const { at, slot, job } = await fixture();
  await sweepGrace(job, config, at);
  expect(
    (await userDb().slot.findUnique({ where: { id: slot.id } }))?.status,
  ).toBe("planned");
  await sweepGrace(job, config, at, resolveFeatures({ guided_sessions: true }));
  expect(
    (await userDb().slot.findUnique({ where: { id: slot.id } }))?.status,
  ).toBe("started");
  // A rollback does not strand an automatic session that already began.
  await sweepGrace(job, config, at + 600_001);
  expect(
    (await userDb().slot.findUnique({ where: { id: slot.id } }))?.status,
  ).toBe("completed");
});

test("a plain session started by its user is not auto-completed by an old hidden policy", async () => {
  const { at, slot, job } = await fixture();
  await setSlotStatus(
    userDb(),
    { slotId: slot.id, status: "started", actor: "user" },
    at,
    id,
  );
  await sweepGrace(job, config, at + 600_001);
  expect(
    (await userDb().slot.findUnique({ where: { id: slot.id } }))?.status,
  ).toBe("started");
  await sweepGrace(job, config, at + 86_400_000);
  expect((await userDb().slot.findUnique({ where: { id: slot.id } }))?.status).toBe("started");
});

test.each([false, true])("manual slot stays put after the cutoff, across repeated sweeps and sleep (pinned=%s)", async (isLocked) => {
  const { at, slot, job } = await fixture();
  await userDb().activity.update({ where: { id: slot.activityId! }, data: { startPolicy: "manual", graceMinutes: 0 } });
  await userDb().slot.update({ where: { id: slot.id }, data: { isLocked, autoMoveCount: 99 } });
  const events = await userDb().slotEvent.count();
  for (const now of [at + 120_000, at + 180_000, at + 599_999, at + 600_000, at + 86_400_000]) {
    await sweepGrace(job, config, now, resolveFeatures({ guided_sessions: true }));
    expect(await userDb().slot.findUnique({ where: { id: slot.id } })).toMatchObject({ status: "planned", startsAt: new Date(at), endsAt: new Date(at + 600_000) });
  }
  expect(await userDb().slotEvent.count()).toBe(events);
  expect(await userDb().slot.count()).toBe(1);
  // An offline Start recorded before the end survives delivery after sleep.
  await setSlotStatus(userDb(), { slotId: slot.id, status: "started", actor: "user" }, at + 599_999, id);
  await sweepGrace(job, config, at + 86_400_001);
  expect((await userDb().slot.findUnique({ where: { id: slot.id } }))?.status).toBe("started");
});

test("sleeping through a guided slot never fabricates a Start or a completion", async () => {
  const { at, slot, job } = await fixture();
  await sweepGrace(job, config, at + 600_000, resolveFeatures({ guided_sessions: true }));
  await sweepGrace(job, config, at + 86_400_000, resolveFeatures({ guided_sessions: true }));
  expect((await userDb().slot.findUnique({ where: { id: slot.id } }))?.status).toBe("planned");
  expect(await userDb().slotEvent.count()).toBe(1);
});

test("a late guided sweep starts only while time remains and preserves the original end", async () => {
  const { at, slot, job } = await fixture();
  await sweepGrace(job, config, at + 180_000, resolveFeatures({ guided_sessions: true }));
  expect(await userDb().slot.findUnique({ where: { id: slot.id } })).toMatchObject({ status: "started", endsAt: new Date(at + 600_000) });
  // Editing the current policy or disabling guided sessions cannot strand an
  // actual auto-start, nor cause a new background Start.
  await userDb().activity.update({ where: { id: slot.activityId! }, data: { startPolicy: "manual" } });
  await sweepGrace(job, config, at + 600_000);
  expect((await userDb().slot.findUnique({ where: { id: slot.id } }))?.status).toBe("completed");
});
