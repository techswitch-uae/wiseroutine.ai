import { isGrantable } from "@wiseroutine/addons";
import {
  archiveActivity,
  cancelWork,
  connectedSince,
  countActiveActivities,
  createActivity,
  deleteConnection,
  forgetStoredTitles,
  getAddon,
  getCalendarForSync,
  installAddon,
  lastSyncedAt,
  listActivities,
  listAddons,
  listCalendars,
  listConnections,
  listEventsInRange,
  listMissed,
  listSlotEvents,
  listSlotsForRange,
  moveSlot,
  placeSlot,
  progressForRange,
  removeAddon,
  scheduledForRange,
  scheduleWork,
  setActivityActive,
  setActivityWindows,
  setAddonEnabled,
  setCalendarSelected,
  setSlotStatus,
  toSchedulerActivity,
  touchLastSeen,
  updateActivity,
  updateUserSettings,
  upsertCalendars,
} from "@wiseroutine/db";
import { can, visibleWidgets } from "@wiseroutine/plans";
import {
  googleListCalendars,
  microsoftListCalendars,
} from "@wiseroutine/providers";
import {
  dayBounds,
  isBusy,
  type LocalDate,
  localDateOf,
  localWeekday,
  replayedAt,
  runsOn,
  shouldSyncOnForeground,
  shouldTouchLastSeen,
  toBusyBlocks,
} from "@wiseroutine/scheduler";
import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { entryFor, registry } from "../addons/registry";
import {
  type App,
  type Ctx,
  enforce,
  newId,
  requireUser,
  rootKey,
} from "../context";
import {
  type DayRangeKey,
  dayRanges,
  FULL_DAY_MINUTES,
  resolveRange,
} from "../dayRanges";
import { detectConflicts, planDay } from "../planning/planDay";
import { accessTokenFor, type SyncDeps } from "../sync/engine";
import { ensureWatch, stopWatch, type WatchDeps } from "../sync/watch";

export const app = new Hono<App>();
/**
 * Every authenticated request is a sign of life.
 *
 * This is middleware rather than something each view calls, so a week view or
 * a month view gets it by existing - there is no per-route line to forget, and
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

/* ── Addons ──────────────────────────────────────────────────────────────── */

/**
 * What may be installed.
 *
 * Served by us rather than fetched from wherever the bundles live, so that an
 * addon approved last month can stop being installable today - see the note in
 * `addons/registry`. Not gated on a plan: `packages/plans` has the hook for it
 * and it is deliberately left open, so the policy is a one-line change on the
 * day it is decided rather than a thing to unpick.
 */
app.get("/addons/available", (c) =>
  c.json({
    addons: registry()
      .filter((entry) => !entry.revoked)
      .map((entry) => ({
        id: entry.id,
        version: entry.version,
        author: entry.author,
        bundleUrl: entry.bundleUrl,
        manifest: entry.manifest,
      })),
  }),
);

/**
 * What this user has installed.
 *
 * `revoked` is carried on each one rather than filtered out. An addon
 * withdrawn after it was installed is exactly the case the user has to be told
 * about - dropping it from the list would take it off their screen while it
 * was still on their disk.
 */
app.get("/addons", async (c) => {
  const installed = await listAddons(c.get("db"));
  return c.json({
    addons: installed.map((row) => ({
      id: row.id,
      version: row.version,
      isEnabled: row.isEnabled,
      installedAt: row.installedAt,
      granted: JSON.parse(row.grantedJson) as unknown,
      manifest: JSON.parse(row.manifestJson) as unknown,
      revoked: entryFor(row.id)?.revoked === true,
    })),
  });
});

/**
 * Install, or re-install something removed earlier.
 *
 * The manifest is taken from the registry and never from the request. A client
 * that could name its own capabilities would be a client that could grant
 * itself any of them - the body says which addon, and the server says what
 * that addon is.
 *
 * Every capability is checked against `isGrantable` before anything is
 * written. That is the policy gate rather than the user\'s: a scope nobody may
 * have yet - a read wider than today - is refused here whatever the install
 * screen offered.
 */
app.post("/addons/:id/install", async (c) => {
  const entry = entryFor(c.req.param("id"));
  if (!entry || entry.revoked) {
    throw new HTTPException(404, { message: "No such addon" });
  }

  for (const capability of entry.manifest.capabilities) {
    const decision = isGrantable(capability);
    if (!decision.ok) {
      throw new HTTPException(400, { message: decision.reason });
    }
  }

  const row = await installAddon(
    c.get("db"),
    {
      id: entry.id,
      version: entry.version,
      manifestJson: JSON.stringify(entry.manifest),
      // Everything it asked for, because every one of them was grantable and
      // the install screen showed them. A partial grant is a real thing to
      // want and there is nowhere to express it yet; `canAddon` already reads
      // this list rather than the manifest, so adding it later changes this
      // line and nothing else.
      grantedJson: JSON.stringify(entry.manifest.capabilities),
      bundleHash: entry.bundleHash,
    },
    c.get("now"),
  );

  return c.json({ id: row.id, version: row.version }, 201);
});

/** Switched off, still installed. Its settings and its activities stay. */
app.patch("/addons/:id", async (c) => {
  const body = await c.req
    .json<{ isEnabled?: boolean }>()
    .catch(() => ({}) as { isEnabled?: boolean });
  if (typeof body.isEnabled !== "boolean") {
    throw new HTTPException(400, { message: "isEnabled must be a boolean" });
  }

  const existing = await getAddon(c.get("db"), c.req.param("id"));
  if (!existing) throw new HTTPException(404, { message: "Not installed" });

  await setAddonEnabled(c.get("db"), existing.id, body.isEnabled);
  return c.body(null, 204);
});

/** Take the future it claimed, leave the past. See `removeAddon`. */
app.delete("/addons/:id", async (c) => {
  const existing = await getAddon(c.get("db"), c.req.param("id"));
  if (!existing) throw new HTTPException(404, { message: "Not installed" });

  const result = await removeAddon(
    c.get("db"),
    existing.id,
    c.get("now"),
    newId,
  );
  return c.json(result);
});

/**
 * Sync now, whatever the debounce thinks.
 *
 * `foreground` deliberately refuses to sync for someone actively using the app
 * - sixty provider passes an hour is worse than the poll it replaces. That is
 * right as a default and wrong as the only option: when someone has just
 * changed something at the provider, or is watching a calendar that has not
 * appeared yet, they need a way to say "now". This is that way, and being an
 * explicit press is what makes bypassing the debounce defensible.
 *
 * Awaited rather than `waitUntil`, unlike the middleware: the caller pressed a
 * button and is waiting to be told it was heard.
 */
/**
 * Re-read the calendar *list* for every live connection.
 *
 * Calendars were only ever discovered once, at connect. Nothing looked again,
 * so two things could not heal on their own: a connection whose first listing
 * failed stayed permanently empty - tokens, no calendars, nothing to sync and
 * no sign of it - and a calendar created at the provider after connecting
 * never appeared at all.
 *
 * `upsertCalendars` keeps the user's `isSelected` choice, so rediscovery adds
 * without ever silently re-enabling something they turned off.
 *
 * One connection's failure must not sink the others: an expired grant on a
 * second account is exactly the case where the first account still needs to
 * sync.
 */
async function rediscoverCalendars(c: Ctx): Promise<void> {
  const env = c.get("env");
  const db = c.get("db");
  const now = c.get("now");

  const deps: SyncDeps = {
    db,
    userId: c.get("user").userId,
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
  };

  for (const connection of await listConnections(db)) {
    if (connection.status !== "active") continue;
    try {
      const accessToken = await accessTokenFor(
        deps,
        connection.id,
        connection.provider as "google" | "microsoft",
        now,
      );
      const calendars =
        connection.provider === "google"
          ? await googleListCalendars(accessToken)
          : await microsoftListCalendars(accessToken);

      await upsertCalendars(
        db,
        calendars.map((cal) => ({ connectionId: connection.id, ...cal })),
        now,
        newId,
      );
    } catch (error) {
      console.error("rediscovering calendars", connection.email, error);
    }
  }
}

/**
 * Sync now, whatever the debounce thinks.
 *
 * `foreground` deliberately refuses to sync for someone actively using the app
 * - sixty provider passes an hour is worse than the poll it replaces. That is
 * right as a default and wrong as the only option: when someone has just
 * changed something at the provider, or is watching a calendar that has not
 * appeared yet, they need a way to say "now". This is that way, and being an
 * explicit press is what makes bypassing the debounce defensible.
 *
 * Rediscovery runs first so that a calendar which did not exist last time is
 * already known by the time the syncs are scheduled.
 *
 * Awaited rather than `waitUntil`, unlike the middleware: the caller pressed a
 * button and is waiting to be told it was heard.
 */
app.post("/sync", async (c) => {
  await rediscoverCalendars(c);
  await markForeground(c, true);
  return c.json({ ok: true });
});

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
      // The UI turns this into "reconnect your calendar" - a connection that
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

/**
 * Forget a connected account.
 *
 * Deselecting every calendar under it would stop the reading, but it would not
 * stop us holding a token for an account the user has finished with - so this
 * removes the connection, its calendars, its events and its token together.
 *
 * The scheduled work lives in the directory rather than the user database, so
 * it cannot be dropped in the same transaction and is cancelled per calendar
 * here instead. A leftover job would find nothing and give up, but leaving one
 * behind to fail quietly every tick is not a state worth shipping.
 */
app.delete("/connections/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.get("db");

  const connection = await db.calendarConnection.findUnique({ where: { id } });
  // A repeat press, or an id from a stale page. Both should read as done
  // rather than as an error, because the account is gone either way.
  if (!connection) return c.body(null, 204);

  const calendarIds = await deleteConnection(db, id);

  const directory = c.get("directory");
  const userId = c.get("user").userId;
  await Promise.all(
    calendarIds.flatMap((calendarId) => [
      cancelWork(directory, userId, "sync_calendar", calendarId),
      cancelWork(directory, userId, "renew_watch", calendarId),
    ]),
  );

  return c.body(null, 204);
});

/* ── Activities ──────────────────────────────────────────────────────────── */

/**
 * A seven-bit day mask, or a refusal.
 *
 * Zero is the one that matters: an activity that runs on no day is one the
 * planner will silently never place, and a screen showing it beside six that
 * work is the worst kind of quiet failure. The client disables its own save
 * for it, which is a courtesy - this is the rule.
 */
function daysOfWeek(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const mask = Number(value);
  if (!Number.isInteger(mask) || mask < 1 || mask > 0b1111111) {
    throw new HTTPException(400, {
      message: "daysOfWeek must pick at least one day of the week",
    });
  }
  return mask;
}

/** "manual" | "auto" | "prompt", and nothing else. A column is a string, and
 *  this is the boundary where it stops being one. */
const START_POLICIES = new Set(["manual", "auto", "prompt"]);

/**
 * The three module fields, taken from a request body.
 *
 * `configJson` is stored verbatim and never parsed here - it belongs to
 * whichever module reads it, and a server that validated its shape would have
 * to be redeployed every time a module gained a setting. It is length-capped,
 * because "opaque" is not the same as "unbounded".
 *
 * Undefined means "not mentioned" and is left alone; null clears. The two are
 * different answers, and collapsing them would wipe a module's settings on
 * every unrelated edit.
 */
const MAX_CONFIG_BYTES = 8_192;

function modulePatch(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (body.presetKey !== undefined) {
    patch.presetKey = body.presetKey === null ? null : String(body.presetKey);
  }

  if (body.sessionEnabled !== undefined) {
    patch.sessionEnabled = Boolean(body.sessionEnabled);
  }

  if (body.startPolicy !== undefined) {
    const policy = String(body.startPolicy);
    if (!START_POLICIES.has(policy)) {
      throw new HTTPException(400, {
        message: `startPolicy must be one of ${[...START_POLICIES].join(", ")}`,
      });
    }
    patch.startPolicy = policy;
  }

  if (body.configJson !== undefined) {
    if (body.configJson === null) {
      patch.configJson = null;
    } else {
      const text = String(body.configJson);
      if (text.length > MAX_CONFIG_BYTES) {
        throw new HTTPException(400, {
          message: "That module's settings are too large to store",
        });
      }
      // Not inspected, but it does have to *be* JSON: storing a string that
      // cannot be parsed would hand every reader a crash instead of settings.
      try {
        JSON.parse(text);
      } catch {
        throw new HTTPException(400, { message: "configJson must be JSON" });
      }
      patch.configJson = text;
    }
  }

  return patch;
}

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
      presetKey: row.presetKey,
      sessionEnabled: row.sessionEnabled,
      startPolicy: row.startPolicy,
      // Sent as written. The server never parses it: it belongs to whichever
      // module reads it, and a shape this side does not know is not a shape
      // this side should be validating.
      configJson: row.configJson,
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
      daysOfWeek: daysOfWeek(body.daysOfWeek, 0b1111111),
      importance: String(body.importance ?? "normal"),
      graceMinutes: Number(body.graceMinutes ?? 3),
      bufferBeforeMeetingMinutes: Number(body.bufferBeforeMeetingMinutes ?? 0),
      anchorMinutes: (body.preferredWindows as number[] | undefined) ?? [],
      ...modulePatch(body),
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
    "kind",
    "minimumType",
    "minimumValue",
    "sessionMinutes",
    "importance",
    "graceMinutes",
    "bufferBeforeMeetingMinutes",
  ]) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  Object.assign(patch, modulePatch(body));
  // Checked rather than copied through: the same rule the create path applies.
  if (body.daysOfWeek !== undefined) {
    patch.daysOfWeek = daysOfWeek(body.daysOfWeek, 0b1111111);
  }
  if (Object.keys(patch).length > 0) {
    await updateActivity(db, c.req.param("id"), patch);
  }

  // Absent leaves the windows alone; an empty array clears them. The two are
  // different answers - "I did not say" and "nowhere in particular" - and
  // collapsing them would wipe a preference on every unrelated edit.
  if (Array.isArray(body.preferredWindows)) {
    await setActivityWindows(
      db,
      c.req.param("id"),
      body.preferredWindows as number[],
      newId,
    );
  }

  return c.body(null, 204);
});

/**
 * Archived, not deleted - see `archiveActivity`. The slots it already produced
 * are the history every past day and the missed list are drawn from.
 */
app.delete("/activities/:id", async (c) => {
  const { cancelled } = await archiveActivity(
    c.get("db"),
    c.req.param("id"),
    c.get("now"),
    newId,
  );
  // Said back, so the screen can tell the user what left the day with it
  // rather than leaving them to notice two slots missing.
  return c.json({ cancelled });
});

/* ── Settings ────────────────────────────────────────────────────────────── */

/**
 * Data minimisation is a first-class setting, not a hidden flag.
 *
 * With titles off we keep only busy intervals - the timeline still works, it
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
    /** All three together, or all three null to clear the range. */
    customRangeLabel?: string | null;
    customRangeStartMinutes?: number | null;
    customRangeEndMinutes?: number | null;
    dayOpensOn?: DayRangeKey;
    showOutsideRange?: boolean;
    storeEventTitles?: boolean;
  };
  const body: SettingsBody = await c.req.json<SettingsBody>();

  /**
   * A zone the platform actually knows.
   *
   * This column is not decoration: every preferred window is evaluated in it
   * and the planner formats against it. An unchecked string here is stored
   * happily and then throws a `RangeError` somewhere far away, on a request
   * that has nothing to do with settings. `Intl` is the authority on what is a
   * real IANA zone, so ask it rather than keeping a list to fall out of date.
   */
  if (body.timeZone !== undefined) {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: body.timeZone });
    } catch {
      throw new HTTPException(400, { message: "Unknown time zone" });
    }
  }

  const user = c.get("user");

  /**
   * Minutes from local midnight, and a window that is actually a window.
   *
   * Checked against what the row will hold after this patch rather than
   * against the patch alone: someone moving only the end of their day past a
   * start they set last week would otherwise slip through, and an inverted
   * window is not a cosmetic problem - it makes `dayBounds` return a range
   * nothing can be placed in and the day comes back empty.
   */
  const window = (
    name: string,
    start: number | null | undefined,
    end: number | null | undefined,
  ) => {
    for (const value of [start, end]) {
      if (value === undefined || value === null) continue;
      if (!Number.isInteger(value) || value < 0 || value > FULL_DAY_MINUTES) {
        throw new HTTPException(400, {
          message: `${name} must be a time of day`,
        });
      }
    }
    if (start != null && end != null && end <= start) {
      throw new HTTPException(400, {
        message: `${name} must end after it starts`,
      });
    }
  };

  window(
    "The day",
    body.dayStartMinutes ?? user.dayStartMinutes,
    body.dayEndMinutes ?? user.dayEndMinutes,
  );

  /**
   * The custom range is one value in three columns.
   *
   * Sending a label without hours - or hours without a label - would store
   * half a range, which `dayRanges` then refuses to offer: the setting would
   * appear to save and then not exist. Rejecting it here is what makes that
   * impossible rather than merely unlikely.
   */
  const custom = [
    body.customRangeLabel,
    body.customRangeStartMinutes,
    body.customRangeEndMinutes,
  ];
  if (custom.some((value) => value !== undefined)) {
    if (custom.some((value) => value === undefined)) {
      throw new HTTPException(400, {
        message: "A custom range needs a name and both its hours",
      });
    }
    const cleared = custom.every((value) => value === null);
    if (!cleared && custom.some((value) => value === null)) {
      throw new HTTPException(400, {
        message: "A custom range needs a name and both its hours",
      });
    }
    if (!cleared) {
      if (String(body.customRangeLabel).trim() === "") {
        throw new HTTPException(400, {
          message: "Give the custom range a name",
        });
      }
      window(
        "The custom range",
        body.customRangeStartMinutes,
        body.customRangeEndMinutes,
      );
    }
  }

  if (
    body.dayOpensOn !== undefined &&
    !["working", "full", "custom"].includes(body.dayOpensOn)
  ) {
    throw new HTTPException(400, { message: "Unknown range" });
  }

  await updateUserSettings(c.get("directory"), c.get("user").userId, {
    ...body,
    // Store the name the user sees, without the whitespace they did not mean
    // to type - it is rendered in a picker row, where a leading space shows.
    ...(typeof body.customRangeLabel === "string"
      ? { customRangeLabel: body.customRangeLabel.trim() }
      : {}),
  });

  if (body.storeEventTitles === false) {
    await forgetStoredTitles(c.get("db"));
  }

  return c.body(null, 204);
});

/* ── Today ───────────────────────────────────────────────────────────────── */

/** The whole local day `at` falls in - what "this day" means everywhere below. */
const localDay = (c: Ctx, at: number): { start: number; end: number } => {
  const zone = c.get("user").timeZone;
  return dayBounds(localDateOf(at, zone), zone, 0, FULL_DAY_MINUTES);
};

/**
 * A day wholly behind us. History is never replanned - not on open, and not
 * on request either.
 *
 * The one exception to "the whole working day is fair game whatever the clock
 * says". Today at nine in the evening is still today and still worth showing
 * the shape of; yesterday is not.
 */
const isOver = (c: Ctx, day: { end: number }): boolean =>
  day.end <= c.get("now");

/**
 * Put on the day whatever the day is missing.
 *
 * Activities repeat - "three times a day, every weekday" - and the obvious way
 * to honour that is to write slots for every day ahead. That is a table
 * growing forever with a plan nobody has seen, every row of it already wrong
 * the moment a meeting moves. So nothing is written ahead: a day is filled in
 * when it is opened.
 *
 * The trigger is the plain one, and it is the rule a user would state: an
 * activity that should run today and has no slot on today is missing, and a
 * day with anything missing gets planned. That is why adding an activity and
 * walking back to Today places it, with nobody having pressed anything - and
 * why opening the same day twice does not move what is already on it, so a
 * slot dragged somewhere by hand stays there.
 *
 * The whole working day is fair game, not just what is left of it. Someone
 * opening the app at nine in the evening still wants to see the shape their
 * day was meant to have, and a screen that answers an empty ruler reads as the
 * app being broken rather than as the day being over.
 *
 * ponytail: which means slots can land in the past, and an activity that does
 * not fit stays missing so every load re-solves it. Both are the "for now"
 * shape - one in-memory solve over one day. Plan from `now` and say what
 * happened to the rest once there is a mid-day story to tell.
 */
async function fillDay(
  c: Ctx,
  /** The whole local day. `end` is the midnight after it. */
  wholeDay: { start: number; end: number },
): Promise<void> {
  const db = c.get("db");
  const now = c.get("now");
  const user = c.get("user");

  if (isOver(c, wholeDay)) return;

  /**
   * Only Pro has its day filled in without being asked.
   *
   * This used to run for everyone on every load, which quietly undercut the
   * whole pricing line: if the day is already placed by the time you look at
   * it, "Pro does the placing for you" is selling something you already have.
   * On Free the day stays as the user left it and a rail module offers to fill
   * it - one press, when they want it, not before they have seen the day.
   *
   * It also answers the week/month/year question by not asking it. Nothing is
   * materialised ahead of today, so opening a month cannot write a month of
   * rows.
   */
  if (!can(user.plan, { kind: "plan.adaptive" }).ok) return;

  const [activities, slots] = await Promise.all([
    listActivities(db),
    listSlotsForRange(db, wholeDay.start, wholeDay.end),
  ]);

  const weekday = localWeekday(wholeDay.start, user.timeZone);
  const due = activities.filter(
    ({ row }) => row.isActive && runsOn(toSchedulerActivity(row), weekday),
  );
  if (due.length === 0) return;

  /**
   * Once a day, at the start of it.
   *
   * This used to fill in any activity that had no slot yet, which meant an
   * activity added at eleven in the morning was already on the day by the
   * time you walked back to Today - the day rearranging itself behind you,
   * which is the opposite of what filling it is for. A day with anything on
   * it has already been filled; whatever is added after that is owed, and the
   * "To place today" module offers it with a button.
   */
  if (slots.length > 0) return;

  await planDay(
    db,
    {
      user,
      // Midnight of the day itself. Its `end` is the first instant of the day
      // *after* it, and passing that planned tomorrow while filing the run
      // under today - so every open planned again, one day out.
      onDay: wholeDay.start,
      trigger: "morning",
    },
    now,
    newId,
  );
}

app.get("/today", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const at = Number(c.req.query("at") ?? c.get("now"));

  const date = localDateOf(at, user.timeZone);
  // The client may ask for a range; if it asks for one that no longer exists
  // it gets the working hours rather than an error - see `resolveRange`.
  const range = resolveRange(user, c.req.query("range"));
  const bounds = dayBounds(
    date,
    user.timeZone,
    range.startMinutes,
    range.endMinutes,
  );

  /**
   * Meetings are read across the whole local day, not just the visible range.
   *
   * Narrowing the query to the range would make "show meetings outside it"
   * unanswerable - the events that are outside are exactly the ones the query
   * would have dropped. Reading the day and partitioning it here costs one
   * indexed scan of at most a day's events and keeps the two answers
   * consistent, which two queries against different windows would not.
   */
  const wholeDay = dayBounds(date, user.timeZone, 0, FULL_DAY_MINUTES);

  // Before the read, not after: the whole point is that the slots this answer
  // carries are the ones this call just decided on.
  await fillDay(c, wholeDay);

  const [slots, events, syncedAt, activities, done, scheduled] =
    await Promise.all([
      listSlotsForRange(db, bounds.start, bounds.end),
      listEventsInRange(db, wholeDay.start, wholeDay.end),
      lastSyncedAt(db),
      listActivities(db),
      progressForRange(db, wholeDay.start, wholeDay.end),
      scheduledForRange(db, wholeDay.start, wholeDay.end),
    ]);

  const busy = toBusyBlocks(events);

  // Only what the timeline needs to draw meetings; nothing extra leaves here.
  const meetings = events
    .filter((e) => busy.some((b) => e.start < b.end && b.start < e.end))
    .map((e) => ({
      id: e.id,
      title: e.title ?? null,
      startsAt: e.start,
      endsAt: e.end,
      isAllDay: e.isAllDay,
      // The one thing a block on the day could not answer: where the call is.
      // Null for the many meetings that are in a room.
      joinUrl: e.joinUrl,
      description: e.description,
    }));

  // Half-open against the visible window: a meeting that ends exactly as the
  // range opens belongs above it, not inside it as a zero-height block.
  const inside = meetings.filter(
    (m) => m.startsAt < bounds.end && m.endsAt > bounds.start,
  );

  return c.json({
    date,
    timeZone: user.timeZone,
    dayStart: bounds.start,
    dayEnd: bounds.end,
    range: range.key,
    ranges: dayRanges(user),
    slots: slots.map((s) => {
      // The module a slot runs under, carried on the slot rather than looked
      // up by the client. A session opens the moment a slot starts, and a
      // second request to find out *what* to open would put a round trip in
      // the middle of pressing Start.
      const activity = s.activityId
        ? activities.find((a) => a.row.id === s.activityId)
        : undefined;
      return {
        id: s.id,
        title: s.title,
        kind: s.kind,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        status: s.status,
        isLocked: s.isLocked,
        conflictEventId: s.conflictEventId,
        // Null when the activity has no module, and also when its session is
        // switched off - the slot then behaves like any other timed slot, and
        // the client needs no second field to work that out.
        presetKey:
          activity?.row.sessionEnabled === false
            ? null
            : (activity?.row.presetKey ?? null),
        startPolicy: activity?.row.startPolicy ?? "manual",
        configJson: activity?.row.configJson ?? null,
      };
    }),
    meetings: inside,
    // The one thing the refresh button could never say for itself: whether
    // what is on screen is current. Null until a calendar has been read once.
    syncedAt,
    // Empty rather than absent when the setting is off, so the client has one
    // shape to render and no "is this feature on?" branch of its own.
    outside: user.showOutsideRange
      ? {
          before: meetings.filter((m) => m.endsAt <= bounds.start),
          after: meetings.filter((m) => m.startsAt >= bounds.end),
        }
      : { before: [], after: [] },
    widgets: visibleWidgets(user.plan, []),
    /**
     * Progress against today's minimums, for the "Today so far" module.
     *
     * Counted over the whole local day rather than the visible range: someone
     * looking at their evening has still done the stretch they did at nine,
     * and a progress bar that emptied when the hours picker moved would be
     * reporting the window, not the day.
     *
     * Only what runs today. A Sunday-only walk owes nothing on a Tuesday, and
     * "To place today" reads this - so without the weekday it would offer to
     * place something the planner would then correctly refuse to place.
     *
     * ponytail: per-day minimums only. A `countPerWeek` activity - a walk
     * three times a week - has no honest reading against a single day, and
     * belongs in the week view when that is built.
     */
    progress: activities
      .filter(
        (a) =>
          a.row.isActive &&
          runsOn(
            toSchedulerActivity(a.row),
            localWeekday(bounds.start, user.timeZone),
          ) &&
          (a.row.minimumType === "countPerDay" ||
            a.row.minimumType === "durationPerDay"),
      )
      .map((a) => ({
        id: a.row.id,
        name: a.row.name,
        kind: a.row.kind,
        minimumType: a.row.minimumType,
        minimumValue: a.row.minimumValue,
        sessionMinutes: a.row.sessionMinutes,
        count: done.get(a.row.id)?.count ?? 0,
        minutes: done.get(a.row.id)?.minutes ?? 0,
        // Placed but not yet done. What separates "two stretches left" from
        // "two stretches left, and both are already on your afternoon".
        scheduled: scheduled.get(a.row.id) ?? 0,
      })),
  });
});

/** A month grid is six weeks. Nothing asks for more, and an unbounded window
 *  is an unbounded query. */
const MAX_SCOPE_DAYS = 42;

/** `YYYY-MM-DD` as the local date it names, or undefined for anything else -
 *  a junk query string should fall back to today, not to 1970. */
function parseLocalDate(iso: string | undefined): LocalDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Rejected rather than rolled over: "2026-02-31" is a typo, and answering
  // for the 3rd of March would hide it.
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year &&
    at.getUTCMonth() + 1 === month &&
    at.getUTCDate() === day
    ? { year, month, day }
    : undefined;
}

/** Calendar-day arithmetic, done through UTC so it never has to know what the
 *  zone did overnight - only which date comes next. */
function addLocalDays(date: LocalDate, days: number): LocalDate {
  const at = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: at.getUTCFullYear(),
    month: at.getUTCMonth() + 1,
    day: at.getUTCDate(),
  };
}

const isoOfLocalDate = (date: LocalDate): string =>
  `${date.year}-${String(date.month).padStart(2, "0")}-${String(
    date.day,
  ).padStart(2, "0")}`;

/** How many days the caller may have. A week by default, a month at most. */
const scopeDays = (asked: string | undefined): number => {
  const days = Number(asked ?? 7);
  return Number.isFinite(days)
    ? Math.min(Math.max(Math.trunc(days), 1), MAX_SCOPE_DAYS)
    : 7;
};

/**
 * One window of the calendar, bucketed into local days.
 *
 * Week, month and year all ask the same question - "what is on these days?" -
 * and differ only in how many days they ask about, so they share one route.
 * Three routes would be three places for the meeting filter to drift apart,
 * and the filter is the part that has to match `/today` exactly or the same
 * meeting appears on the day and not on the week.
 *
 * Bucketed here rather than on the client because only the server knows the
 * account's zone. Each day carries its own bounds, so the client turns an
 * instant into a position with a subtraction and never has to do zone
 * arithmetic of its own - which also means a day that gained or lost an hour
 * to DST still lands its blocks on the right hour line.
 */
app.get("/scope", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const now = c.get("now");

  const first =
    parseLocalDate(c.req.query("from")) ?? localDateOf(now, user.timeZone);
  const count = scopeDays(c.req.query("days"));
  // The same picker the day has, answering for a week at a time. Falls back
  // rather than failing on a range deleted since - see `resolveRange`.
  const range = resolveRange(user, c.req.query("range"));

  const days = Array.from({ length: count }, (_, index) => {
    const date = addLocalDays(first, index);
    return {
      date,
      // The whole local day, not the visible range. Which meetings the hours
      // hide is the client's question to answer - it is the one drawing the
      // window - and a query narrowed to the range could not answer it,
      // because the events outside are exactly the ones it dropped. Same
      // reasoning as `/today`.
      ...dayBounds(date, user.timeZone, 0, FULL_DAY_MINUTES),
    };
  });

  // The span, from the dates rather than from the ends of the array: the
  // midnight after the last day is the exclusive end, and taking it this way
  // needs no bounds check for a list that cannot be empty anyway.
  const midnightOf = (date: LocalDate) =>
    dayBounds(date, user.timeZone, 0, 0).start;
  const from = midnightOf(first);
  const to = midnightOf(addLocalDays(first, count));

  const [slots, events, syncedAt, connectedAt] = await Promise.all([
    listSlotsForRange(db, from, to),
    listEventsInRange(db, from, to),
    lastSyncedAt(db),
    connectedSince(db),
  ]);

  /**
   * The meetings worth drawing.
   *
   * `isBusy` rather than an overlap against `toBusyBlocks`, which is how
   * `/today` does it: the two agree on every timed event, and differ exactly
   * where this view needs them to. Merged blocks lose the boundary between two
   * back-to-back meetings, and a week wants one rectangle per meeting.
   *
   * `allDayIsBusy` is the other difference. All-day events are correctly *not*
   * busy time - that is what keeps the planner from blanking out a week for a
   * birthday - but they are still on the calendar, and the strip above the
   * week grid is the place the day timeline never had for them.
   */
  const seenUids = new Set<string>();
  const meetings = events.filter((event) => {
    if (!isBusy(event, { allDayIsBusy: true })) return false;
    // The same meeting on a work and a personal calendar is one meeting; two
    // identical rectangles side by side would read as two commitments.
    if (event.icalUid === undefined || event.icalUid === null) return true;
    if (seenUids.has(event.icalUid)) return false;
    seenUids.add(event.icalUid);
    return true;
  });

  return c.json({
    timeZone: user.timeZone,
    // The same field `/today` sends, so every scope can draw the same "synced
    // 2 min ago" status from the same answer.
    syncedAt,
    // The same shape `/today` sends, so the hours picker is one component
    // fed by one answer whichever scope is on screen.
    range: range.key,
    ranges: dayRanges(user),
    /**
     * The first day meetings could be known from.
     *
     * Nothing before a calendar was connected is ever fetched, so the week and
     * month have to be able to say why an earlier day is empty. Null when no
     * calendar is connected at all, which is the one case where saying it
     * would raise a question rather than answer one.
     */
    meetingsFrom: connectedAt,
    days: days.map((day) => ({
      iso: isoOfLocalDate(day.date),
      dayStart: day.start,
      dayEnd: day.end,
      // Cancelled slots are history, and history belongs to the day view. An
      // overview that drew them would report decisions already undone.
      slots: slots
        .filter(
          (slot) =>
            slot.status !== "cancelled" &&
            slot.startsAt < day.end &&
            slot.endsAt > day.start,
        )
        .map((slot) => ({
          id: slot.id,
          title: slot.title,
          kind: slot.kind,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          status: slot.status,
        })),
      // Listed under every day it touches, and clamped to the column by the
      // client. A meeting running past midnight belongs to both days; dropping
      // it from the second is the more surprising answer of the two.
      meetings: meetings
        .filter((event) => event.start < day.end && event.end > day.start)
        .map((event) => ({
          id: event.id,
          // Null when the account stores busy intervals without titles. The
          // client says "Busy"; nothing here invents a name for it.
          title: event.title ?? null,
          startsAt: event.start,
          endsAt: event.end,
          isAllDay: event.isAllDay,
        })),
    })),
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

  const onDay = body.at ?? now;
  if (isOver(c, localDay(c, onDay))) {
    return c.json({ planRunId: null, placed: 0, removed: 0, unplaced: [] });
  }

  const result = await planDay(
    c.get("db"),
    // No `from`: the whole working day, the same rule `fillDay` uses. Two
    // different answers to "where does this go" depending on which door the
    // request came through is the kind of difference nobody can debug.
    { user, onDay, trigger },
    now,
    newId,
  );

  // Newly planned slots have grace periods, and the sweep is driven from the
  // directory - so a plan has to leave a marker there or nothing will fire.
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

/**
 * When the user says it happened, within reason.
 *
 * Someone following their routine on a plane records four actions offline and
 * sends them on landing. Without `at`, all four land in the same minute hours
 * later, and the day's history - which is what progress and streaks are
 * computed from - becomes fiction. `replayedAt` is what keeps that claim
 * inside something a genuine offline stretch could produce.
 */
async function actionAt(c: Ctx): Promise<number> {
  const body = await c.req
    .json<{ at?: number }>()
    .catch(() => ({}) as { at?: number });
  return replayedAt(c.get("now"), body.at);
}

app.post("/slots/:id/start", async (c) => {
  await setSlotStatus(
    c.get("db"),
    { slotId: c.req.param("id"), status: "started", actor: "user" },
    await actionAt(c),
    newId,
  );
  return c.body(null, 204);
});

app.post("/slots/:id/complete", async (c) => {
  await setSlotStatus(
    c.get("db"),
    { slotId: c.req.param("id"), status: "completed", actor: "user" },
    await actionAt(c),
    newId,
  );
  return c.body(null, 204);
});

app.post("/slots/:id/skip", async (c) => {
  type SkipBody = { reason?: string; at?: number };
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
    replayedAt(c.get("now"), body.at),
    newId,
  );
  return c.body(null, 204);
});

/**
 * 5c - put an activity on the day yourself.
 *
 * The free plan's placement, and the one route that creates a slot from a
 * choice rather than from a plan run. Everything it refuses, it refuses
 * because accepting would produce a day the user did not mean: a slot on top
 * of a meeting, a slot for an activity that is paused, a slot outside the day
 * being looked at.
 *
 * The overlap check is not a convenience the client could have done. The
 * client picks from gaps it computed a moment ago, and a meeting can land in
 * one between the picking and the pressing - so the answer has to be worked
 * out here, against the events as they are now.
 */
app.post("/slots", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const now = c.get("now");

  const body = await c.req.json<{
    activityId: string;
    startsAt: number;
    endsAt?: number;
  }>();

  if (!body.activityId || !Number.isFinite(body.startsAt)) {
    throw new HTTPException(400, {
      message: "activityId and startsAt are required",
    });
  }

  const activities = await listActivities(db);
  const activity = activities.find((a) => a.row.id === body.activityId);
  if (!activity) {
    throw new HTTPException(404, { message: "No such activity" });
  }
  if (!activity.row.isActive) {
    throw new HTTPException(409, {
      message: `${activity.row.name} is paused. Turn it back on to place it.`,
    });
  }

  // The activity's own session length unless the caller says otherwise, so a
  // plain "put this here" needs one number rather than two.
  const endsAt =
    body.endsAt ?? body.startsAt + activity.row.sessionMinutes * 60_000;
  if (endsAt <= body.startsAt) {
    throw new HTTPException(400, { message: "endsAt must be after startsAt" });
  }

  const date = localDateOf(body.startsAt, user.timeZone);
  const wholeDay = dayBounds(date, user.timeZone, 0, FULL_DAY_MINUTES);
  const events = await listEventsInRange(db, wholeDay.start, wholeDay.end);
  const clash = toBusyBlocks(events).find(
    (b) => body.startsAt < b.end && b.start < endsAt,
  );
  if (clash) {
    throw new HTTPException(409, {
      message: "Something is already booked then. Pick another gap.",
    });
  }

  const slot = await placeSlot(
    db,
    {
      activityId: activity.row.id,
      title: activity.row.name,
      kind: activity.row.kind,
      startsAt: body.startsAt,
      endsAt,
      timeZone: user.timeZone,
    },
    now,
    newId,
  );

  // A placed slot has a grace period like any other, and the sweep is driven
  // from the directory - without this marker nothing would ever move it on.
  await scheduleWork(
    c.get("directory"),
    { userId: user.userId, kind: "grace_sweep", dueAt: now + 60_000 },
    now,
    newId,
  );

  return c.json(
    {
      id: slot.id,
      title: slot.title,
      kind: slot.kind,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      status: slot.status,
      isLocked: slot.isLocked,
      conflictEventId: slot.conflictEventId,
    },
    201,
  );
});

/**
 * Take a slot off today, and put it back.
 *
 * Cancelled rather than deleted, and deliberately not the same thing as
 * skipped: skipping is a decision the missed list reports on, and this is "not
 * today, thanks". The row survives, which is what makes both the undo below
 * and "today only" work - `fillDay` re-plans an activity that has no slot on
 * the day, and a cancelled slot is still a slot, so the activity stays gone
 * until tomorrow rather than reappearing on the next page load.
 */
app.post("/slots/:id/cancel", async (c) => {
  await setSlotStatus(
    c.get("db"),
    {
      slotId: c.req.param("id"),
      status: "cancelled",
      actor: "user",
      reasonCode: "user_choice",
    },
    c.get("now"),
    newId,
  );
  return c.body(null, 204);
});

/** The way back from the above, for as long as the toast offering it is up. */
app.post("/slots/:id/restore", async (c) => {
  await setSlotStatus(
    c.get("db"),
    { slotId: c.req.param("id"), status: "planned", actor: "user" },
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
 * 3d - the honest list, with the recorded reason each item did not happen.
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
