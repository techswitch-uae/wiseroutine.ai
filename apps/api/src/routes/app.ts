import {
  cancelWork,
  countActiveActivities,
  createActivity,
  forgetStoredTitles,
  getCalendarForSync,
  listActivities,
  listCalendars,
  listConnections,
  listEventsInRange,
  listMissed,
  listSlotEvents,
  listSlotsForRange,
  moveSlot,
  scheduleWork,
  setActivityActive,
  setCalendarSelected,
  setSlotStatus,
  touchLastSeen,
  updateActivity,
  updateUserSettings,
} from "@wiseroutine/db";
import { visibleModules } from "@wiseroutine/plans";
import {
  dayBounds,
  localDateOf,
  shouldSyncOnForeground,
  shouldTouchLastSeen,
  toBusyBlocks,
} from "@wiseroutine/scheduler";
import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  type App,
  type Ctx,
  enforce,
  newId,
  requireUser,
  rootKey,
} from "../context";
import { detectConflicts, planDay } from "../planning/planDay";
import { ensureWatch, stopWatch, type WatchDeps } from "../sync/watch";

export const app = new Hono<App>();
/**
 * Every authenticated request is a sign of life.
 *
 * This is middleware rather than something each view calls, so a week view or
 * a month view gets it by existing — there is no per-route line to forget, and
 * nothing to keep in step across handlers.
 *
 * Both effects run behind the response. The view is built from what is already
 * stored either way; a sync started here lands in time for the next poll of
 * the UI, not this request. Making someone wait on Google to see their own day
 * would be the wrong trade.
 */
async function markForeground(c: Ctx, alsoSync: boolean): Promise<void> {
  const now = c.get("now");
  const user = c.get("user");

  await touchLastSeen(c.get("directory"), user.userId, now);
  if (!alsoSync) return;

  // Only calendars the user actually chose. An unselected one contributes
  // nothing to the day, so syncing it is pure provider load.
  const calendars = (await listCalendars(c.get("db"))).filter(
    (cal) => cal.isSelected,
  );

  for (const calendar of calendars) {
    await scheduleWork(
      c.get("directory"),
      {
        userId: user.userId,
        kind: "sync_calendar",
        targetId: calendar.id,
        dueAt: now,
      },
      now,
      newId,
    );

    // The directory row is the durable "this is owed"; the message is only the
    // nudge that gets it done now rather than at the next tick. Same pairing
    // the push webhooks use.
    await c.env.SYNC_QUEUE.send({
      type: "sync-calendar",
      workId: "",
      userId: user.userId,
      databaseName: user.databaseName,
      targetId: calendar.id,
      reason: "foreground",
    });
  }
}

/**
 * Bring a calendar's push channel in line with whether it is selected.
 *
 * Failures are logged and swallowed: the selection itself has already been
 * saved, and a channel that failed to open is picked up by the renewal tick
 * while one that failed to close expires on its own.
 */
async function syncWatchToSelection(
  c: Ctx,
  calendarId: string,
  selected: boolean,
): Promise<void> {
  const now = c.get("now");
  const user = c.get("user");
  const env = c.get("env");

  const target = await getCalendarForSync(c.get("db"), calendarId);
  if (target?.connectionStatus !== "active") return;

  const deps: WatchDeps = {
    db: c.get("db"),
    userId: user.userId,
    rootKey: rootKey(c),
    clientIds: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
      },
      microsoft: {
        clientId: env.MICROSOFT_CLIENT_ID ?? "",
        clientSecret: env.MICROSOFT_CLIENT_SECRET ?? "",
      },
    },
    directory: c.get("directory"),
    apiUrl: env.API_URL,
  };

  const spec = {
    calendarId: target.calendarId,
    connectionId: target.connectionId,
    provider: target.provider,
    providerCalendarId: target.providerCalendarId,
    storeTitles: user.storeEventTitles,
  };

  try {
    if (selected) await ensureWatch(deps, spec, now, newId);
    else await stopWatch(deps, spec, now);
  } catch (error) {
    console.error("watch selection", calendarId, selected, error);
  }
}

const foreground: MiddlewareHandler<App> = async (c, next) => {
  const now = c.get("now");
  const { lastSeenAt } = c.get("user");

  // The sync threshold is always the longer of the two, so nothing is missed
  // by only asking it when the touch threshold has already passed.
  if (shouldTouchLastSeen(lastSeenAt, now)) {
    c.executionCtx.waitUntil(
      markForeground(c, shouldSyncOnForeground(lastSeenAt, now)),
    );
  }

  await next();
};

app.use("*", requireUser);
app.use("*", foreground);

/* ── Calendars ───────────────────────────────────────────────────────────── */

app.get("/calendars", async (c) => {
  const db = c.get("db");
  const [connections, calendars] = await Promise.all([
    listConnections(db),
    listCalendars(db),
  ]);

  return c.json({
    connections: connections.map((conn) => ({
      id: conn.id,
      provider: conn.provider,
      email: conn.email,
      // The UI turns this into "reconnect your calendar" — a connection that
      // dies silently is fatal to trust.
      status: conn.status,
    })),
    calendars: calendars.map((cal) => ({
      id: cal.id,
      connectionId: cal.connectionId,
      name: cal.name,
      isPrimary: cal.isPrimary,
      isSelected: cal.isSelected,
      accessRole: cal.accessRole,
    })),
  });
});

app.patch("/calendars/:id", async (c) => {
  const body = await c.req.json<{ isSelected: boolean }>();
  await setCalendarSelected(c.get("db"), c.req.param("id"), body.isSelected);

  // Selecting a calendar means it now needs syncing; deselecting means it does
  // not. The directory is what the cron ticker reads, so it has to be told.
  if (body.isSelected) {
    await scheduleWork(
      c.get("directory"),
      {
        userId: c.get("user").userId,
        kind: "sync_calendar",
        targetId: c.req.param("id"),
        dueAt: c.get("now"),
      },
      c.get("now"),
      newId,
    );
  } else {
    await cancelWork(
      c.get("directory"),
      c.get("user").userId,
      "sync_calendar",
      c.req.param("id"),
    );
    await cancelWork(
      c.get("directory"),
      c.get("user").userId,
      "renew_watch",
      c.req.param("id"),
    );
  }

  // A push channel is per calendar, so selection decides whether one should
  // exist. Behind the response: opening one is two provider calls, and the
  // toggle should not sit there while they happen.
  c.executionCtx.waitUntil(
    syncWatchToSelection(c, c.req.param("id"), body.isSelected),
  );

  return c.body(null, 204);
});

/* ── Activities ──────────────────────────────────────────────────────────── */

app.get("/activities", async (c) => {
  const rows = await listActivities(c.get("db"));
  return c.json(
    rows.map(({ row, anchorMinutes }) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      isActive: row.isActive,
      minimum: { type: row.minimumType, value: row.minimumValue },
      sessionMinutes: row.sessionMinutes,
      daysOfWeek: row.daysOfWeek,
      importance: row.importance,
      graceMinutes: row.graceMinutes,
      bufferBeforeMeetingMinutes: row.bufferBeforeMeetingMinutes,
      preferredWindows: anchorMinutes,
    })),
  );
});

app.post("/activities", async (c) => {
  const db = c.get("db");

  // The free limit counts ACTIVE activities, so pausing one frees a slot.
  const activeCount = await countActiveActivities(db);
  enforce(c, { kind: "activity.create", activeCount });

  const body = await c.req.json<Record<string, unknown>>();
  const id = await createActivity(
    db,
    {
      name: String(body.name ?? "Activity"),
      kind: String(body.kind ?? "recovery"),
      minimumType: String(body.minimumType ?? "countPerDay"),
      minimumValue: Number(body.minimumValue ?? 1),
      sessionMinutes: Number(body.sessionMinutes ?? 10),
      daysOfWeek: Number(body.daysOfWeek ?? 0b1111111),
      importance: String(body.importance ?? "normal"),
      graceMinutes: Number(body.graceMinutes ?? 3),
      bufferBeforeMeetingMinutes: Number(body.bufferBeforeMeetingMinutes ?? 0),
      anchorMinutes: (body.preferredWindows as number[] | undefined) ?? [],
    },
    c.get("now"),
    newId,
  );

  return c.json({ id }, 201);
});

app.patch("/activities/:id", async (c) => {
  const db = c.get("db");
  const body = await c.req.json<Record<string, unknown>>();

  // Re-activating counts against the plan limit; pausing never does.
  if (body.isActive === true) {
    const activeCount = await countActiveActivities(db);
    enforce(c, { kind: "activity.create", activeCount });
  }

  if (typeof body.isActive === "boolean") {
    await setActivityActive(db, c.req.param("id"), body.isActive);
  }

  const patch: Record<string, unknown> = {};
  for (const key of [
    "name",
    "minimumValue",
    "sessionMinutes",
    "daysOfWeek",
    "importance",
    "graceMinutes",
    "bufferBeforeMeetingMinutes",
  ]) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (Object.keys(patch).length > 0) {
    await updateActivity(db, c.req.param("id"), patch);
  }

  return c.body(null, 204);
});

/* ── Settings ────────────────────────────────────────────────────────────── */

/**
 * Data minimisation is a first-class setting, not a hidden flag.
 *
 * With titles off we keep only busy intervals — the timeline still works, it
 * just says "Busy" instead of naming the meeting. Turning it off also erases
 * the titles already stored, so the promise holds backwards as well as forwards.
 *
 * The flag lives in the directory (auth reads it on every request) while the
 * titles live in the user's database, so this writes to both.
 */
app.patch("/settings", async (c) => {
  type SettingsBody = {
    timeZone?: string;
    dayStartMinutes?: number;
    dayEndMinutes?: number;
    storeEventTitles?: boolean;
  };
  const body: SettingsBody = await c.req.json<SettingsBody>();

  if (
    body.dayStartMinutes !== undefined &&
    body.dayEndMinutes !== undefined &&
    body.dayEndMinutes <= body.dayStartMinutes
  ) {
    throw new HTTPException(400, {
      message: "The day must end after it starts",
    });
  }

  await updateUserSettings(c.get("directory"), c.get("user").userId, body);

  if (body.storeEventTitles === false) {
    await forgetStoredTitles(c.get("db"));
  }

  return c.body(null, 204);
});

/* ── Today ───────────────────────────────────────────────────────────────── */

app.get("/today", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const at = Number(c.req.query("at") ?? c.get("now"));

  const date = localDateOf(at, user.timeZone);
  const bounds = dayBounds(
    date,
    user.timeZone,
    user.dayStartMinutes,
    user.dayEndMinutes,
  );

  const [slots, events] = await Promise.all([
    listSlotsForRange(db, bounds.start, bounds.end),
    listEventsInRange(db, bounds.start, bounds.end),
  ]);

  const busy = toBusyBlocks(events);

  return c.json({
    date,
    timeZone: user.timeZone,
    dayStart: bounds.start,
    dayEnd: bounds.end,
    slots: slots.map((s) => ({
      id: s.id,
      title: s.title,
      kind: s.kind,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      status: s.status,
      isLocked: s.isLocked,
      conflictEventId: s.conflictEventId,
    })),
    // Only what the timeline needs to draw meetings; nothing extra leaves here.
    meetings: events
      .filter((e) => busy.some((b) => e.start < b.end && b.start < e.end))
      .map((e) => ({
        id: e.id,
        title: e.title ?? null,
        startsAt: e.start,
        endsAt: e.end,
        isAllDay: e.isAllDay,
      })),
    modules: visibleModules(user.plan, []),
  });
});

app.post("/plan", async (c) => {
  const now = c.get("now");
  const user = c.get("user");
  type PlanBody = { at?: number; trigger?: string };
  const body: PlanBody = await c.req
    .json<PlanBody>()
    .catch(() => ({}) as PlanBody);

  // Free users get one placement each morning; live re-adaptation is pro.
  const trigger = (body.trigger ?? "user_request") as
    | "morning"
    | "calendar_change"
    | "user_request"
    | "missed_replan";
  if (trigger === "calendar_change" || trigger === "missed_replan") {
    enforce(c, { kind: "plan.adaptive" });
  }

  const result = await planDay(
    c.get("db"),
    { user, onDay: body.at ?? now, trigger, from: now },
    now,
    newId,
  );

  // Newly planned slots have grace periods, and the sweep is driven from the
  // directory — so a plan has to leave a marker there or nothing will fire.
  if (result.created > 0) {
    await scheduleWork(
      c.get("directory"),
      { userId: user.userId, kind: "grace_sweep", dueAt: now + 60_000 },
      now,
      newId,
    );
  }

  return c.json({
    planRunId: result.planRunId,
    placed: result.created,
    removed: result.removed,
    unplaced: result.unplaced,
  });
});

/* ── Slots ───────────────────────────────────────────────────────────────── */

app.post("/slots/:id/start", async (c) => {
  await setSlotStatus(
    c.get("db"),
    { slotId: c.req.param("id"), status: "started", actor: "user" },
    c.get("now"),
    newId,
  );
  return c.body(null, 204);
});

app.post("/slots/:id/complete", async (c) => {
  await setSlotStatus(
    c.get("db"),
    { slotId: c.req.param("id"), status: "completed", actor: "user" },
    c.get("now"),
    newId,
  );
  return c.body(null, 204);
});

app.post("/slots/:id/skip", async (c) => {
  type SkipBody = { reason?: string };
  const body: SkipBody = await c.req
    .json<SkipBody>()
    .catch(() => ({}) as SkipBody);
  await setSlotStatus(
    c.get("db"),
    {
      slotId: c.req.param("id"),
      status: "skipped",
      actor: "user",
      reasonCode: "dismissed",
      ...(body.reason !== undefined ? { reasonText: body.reason } : {}),
    },
    c.get("now"),
    newId,
  );
  return c.body(null, 204);
});

app.post("/slots/:id/move", async (c) => {
  const body = await c.req.json<{ startsAt: number; endsAt: number }>();
  if (!Number.isFinite(body.startsAt) || !Number.isFinite(body.endsAt)) {
    throw new HTTPException(400, {
      message: "startsAt and endsAt are required",
    });
  }
  if (body.endsAt <= body.startsAt) {
    throw new HTTPException(400, { message: "endsAt must be after startsAt" });
  }

  await moveSlot(
    c.get("db"),
    {
      slotId: c.req.param("id"),
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      actor: "user",
      reasonCode: "user_choice",
    },
    c.get("now"),
    newId,
  );
  return c.body(null, 204);
});

/**
 * 3d — the honest list, with the recorded reason each item did not happen.
 * The reasons come from the lifecycle log, not from a status column.
 */
app.get("/missed", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const at = Number(c.req.query("at") ?? c.get("now"));
  const date = localDateOf(at, user.timeZone);
  const bounds = dayBounds(date, user.timeZone, 0, 24 * 60);

  const slots = await listMissed(db, bounds.start, bounds.end);
  const events = await listSlotEvents(
    db,
    slots.map((s) => s.id),
  );

  const bySlot = new Map<string, typeof events>();
  for (const event of events) {
    bySlot.set(event.slotId, [...(bySlot.get(event.slotId) ?? []), event]);
  }

  return c.json(
    slots.map((slot) => {
      const history = bySlot.get(slot.id) ?? [];
      const moves = history.filter(
        (h) => h.type === "auto_moved" || h.type === "user_moved",
      );
      const final = history.at(-1);
      return {
        id: slot.id,
        title: slot.title,
        status: slot.status,
        dueAt: slot.startsAt,
        moveCount: moves.length,
        reasonCode: final?.reasonCode ?? null,
        reasonText: final?.reasonText ?? null,
      };
    }),
  );
});

app.get("/conflicts", async (c) => {
  const user = c.get("user");
  const at = Number(c.req.query("at") ?? c.get("now"));
  const date = localDateOf(at, user.timeZone);
  const bounds = dayBounds(date, user.timeZone, 0, 24 * 60);

  const conflicts = await detectConflicts(
    c.get("db"),
    bounds.start,
    bounds.end,
  );
  // Edge overlaps are suppressed here rather than at detection so the data
  // stays complete and only the surfacing is opinionated.
  return c.json(conflicts.filter((x) => x.severity !== "edge"));
});
