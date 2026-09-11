import { scheduleWork } from "@wiseroutine/db";
import { type Ctx, newId } from "../context";
import { planDay } from "./planDay";

/** Write-ahead coordination. An extra sweep of an empty database is harmless;
 * slots with no durable wake-up are not. Never create slots before this write
 * succeeds. The marker persists and the consumer reconciles its next deadline. */
export async function scheduleGrace(c: Ctx): Promise<void> {
  await scheduleWork(
    c.get("directory"),
    {
      userId: c.get("user").userId,
      kind: "grace_sweep",
      dueAt: c.get("now") + 60_000,
    },
    c.get("now"),
    newId,
  );
}

export async function planAndSchedule(
  c: Ctx,
  params: Parameters<typeof planDay>[1],
) {
  await scheduleGrace(c);
  return planDay(c.get("db"), params, c.get("now"), newId);
}
