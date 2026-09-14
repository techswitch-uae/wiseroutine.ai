import { at, listEventsInRange, type UserDatabase } from "@wiseroutine/db";
import { toBusyBlocks } from "@wiseroutine/scheduler";
import { HTTPException } from "hono/http-exception";

/** Use inside the same writer transaction as the mutation. A cached gap is
 * only a suggestion; reservations, including ones crossing midnight, win. */
export async function validatePlacement(
  db: UserDatabase,
  startsAt: number,
  endsAt: number,
  now: number,
  except?: string,
): Promise<void> {
  if (
    !Number.isSafeInteger(startsAt) ||
    !Number.isSafeInteger(endsAt) ||
    startsAt < now ||
    startsAt > now + 366 * 24 * 60 * 60_000 ||
    endsAt - startsAt < 60_000 ||
    endsAt - startsAt > 480 * 60_000
  ) {
    throw new HTTPException(400, {
      message:
        "Choose a future time within a year and a duration of 1–480 minutes.",
    });
  }
  const events = await listEventsInRange(db, startsAt, endsAt);
  const slot = await db.slot.findFirst({
    where: {
      ...(except ? { id: { not: except } } : {}),
      startsAt: { lt: at(endsAt) },
      endsAt: { gt: at(startsAt) },
      status: { in: ["planned", "live", "started", "completed"] },
    },
  });
  if (
    slot ||
    toBusyBlocks(events).some((b) => startsAt < b.end && b.start < endsAt)
  )
    throw new HTTPException(409, {
      message: "Something is already booked then. Choose another time.",
    });
}
