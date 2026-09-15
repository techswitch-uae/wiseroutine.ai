import { exports as worker } from "cloudflare:workers";
import { getSyncState, listEventsInRange } from "@wiseroutine/db";
import type { SyncPage } from "@wiseroutine/providers";
import { beforeEach, expect, test } from "vitest";
import { type SyncDeps, syncCalendar } from "./sync/engine";
import {
  directory,
  resetDatabases,
  seedCalendar,
  seedUser,
  testFeatures,
  tomorrowNoon,
  userDb,
} from "./test-support";

beforeEach(async () => {
  await resetDatabases();
  await testFeatures("all");
});
const id = () => crypto.randomUUID();
const DAY = 86_400_000;
async function fixture(provider: "google" | "microsoft") {
  const user = await seedUser();
  await directory().user.update({
    where: { id: user.userId },
    data: { lastSeenAt: new Date() },
  });
  const calendar = await seedCalendar();
  const db = userDb();
  await db.calendarConnection.update({
    where: { id: calendar.connectionId },
    data: { provider },
  });
  const events = [0, 20].map((days) => ({
    providerEventId: `meeting-${days}`,
    changeTag: "unchanged-tag",
    icalUid: null,
    seriesMasterId: null,
    timeZone: "UTC",
    providerUpdatedAt: null,
    title: `Meeting ${days}`,
    joinUrl: `https://meet.example/room-${days}`,
    description: `Notes ${days}`,
    startsAt: tomorrowNoon() + days * DAY,
    endsAt: tomorrowNoon() + days * DAY + 3_600_000,
    isAllDay: false,
    kind: "default" as const,
    busyStatus: "busy" as const,
    responseStatus: "accepted" as const,
    isCancelled: false,
  }));
  const target = {
    ...calendar,
    provider,
    providerCalendarId: "primary",
    storeTitles: true,
  };
  const deps = {
    db,
    userId: user.userId,
    rootKey: "unused-controlled-provider",
    clientIds: {
      google: { clientId: "test", clientSecret: "test" },
      microsoft: { clientId: "test", clientSecret: "test" },
    },
  };
  const sync = (
    readPage: NonNullable<SyncDeps["readPage"]>,
    storeTitles = true,
    syncGeneration?: number,
  ) =>
    syncCalendar(
      { ...deps, readPage },
      { ...target, storeTitles, syncGeneration },
      Date.now(),
      id,
    );
  const privacy = async (enabled: boolean) => {
    const response = await worker.default.fetch("http://api/settings", {
      method: "PATCH",
      headers: user.headers,
      body: JSON.stringify({ storeEventTitles: enabled }),
    });
    expect(response.status).toBe(204);
  };
  return { user, db, calendar, events, sync, privacy };
}

test("opt-in invalidates deselected calendars for when they are selected again", async () => {
  const f = await fixture("google");
  await f.sync(async () => ({
    events: f.events,
    deletedIds: [],
    nextSyncToken: "old-cursor",
  }));
  await f.db.calendar.update({
    where: { id: f.calendar.calendarId },
    data: { isSelected: false },
  });
  await f.privacy(false);
  await f.privacy(true);
  expect(await getSyncState(f.db, f.calendar.calendarId)).toMatchObject({
    syncToken: null,
    deltaLink: null,
  });
  expect(
    await f.db.calendar.findUnique({ where: { id: f.calendar.calendarId } }),
  ).toMatchObject({ isSelected: false });
});

test("event writes roll back when advancing the sync cursor fails", async () => {
  const f = await fixture("google");
  await f.sync(async () => ({
    events: f.events,
    deletedIds: [],
    nextSyncToken: "before",
  }));
  const before = await f.db.externalEvent.findMany({ orderBy: { id: "asc" } });
  await f.db.$executeRawUnsafe(
    "CREATE TRIGGER refuse_cursor BEFORE UPDATE ON calendar_sync_state BEGIN SELECT RAISE(ABORT, 'cursor failed'); END",
  );
  try {
    await expect(
      f.sync(async () => ({
        events: f.events.map((event) => ({
          ...event,
          changeTag: "new",
          title: "Changed",
        })),
        deletedIds: [],
        nextSyncToken: "after",
      })),
    ).rejects.toThrow();
    expect(
      await f.db.externalEvent.findMany({ orderBy: { id: "asc" } }),
    ).toEqual(before);
    expect((await getSyncState(f.db, f.calendar.calendarId))?.syncToken).toBe(
      "before",
    );
  } finally {
    await f.db.$executeRawUnsafe("DROP TRIGGER refuse_cursor");
  }
});

for (const provider of ["google", "microsoft"] as const) {
  test(`${provider}: opt-in fetches all pages again and restores unchanged details without duplicate events`, async () => {
    const f = await fixture(provider);
    await f.sync(async () => ({
      events: f.events,
      deletedIds: [],
      nextSyncToken: "first-cursor",
    }));
    const before = await f.db.externalEvent.findMany({
      orderBy: { id: "asc" },
    });
    await f.privacy(false);
    expect(await f.db.externalEvent.findMany()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: null,
          joinUrl: null,
          description: null,
        }),
      ]),
    );
    await f.sync(
      async () => ({
        events: [],
        deletedIds: [],
        nextSyncToken: "private-cursor",
      }),
      false,
    );
    const old = await getSyncState(f.db, f.calendar.calendarId);
    expect(provider === "google" ? old?.syncToken : old?.deltaLink).toBe(
      "private-cursor",
    );
    await f.privacy(true);
    const reset = await getSyncState(f.db, f.calendar.calendarId);
    expect(reset).toMatchObject({
      syncToken: null,
      deltaLink: null,
      syncGeneration: (old?.syncGeneration ?? 0) + 1,
    });
    // Re-saving the already enabled choice must not repeatedly restart syncing.
    await f.privacy(true);
    expect(
      (await getSyncState(f.db, f.calendar.calendarId))?.syncGeneration,
    ).toBe(reset?.syncGeneration);
    let pages = 0;
    const restored = await f.sync(
      async ({ syncToken, deltaLink, pageToken }) => {
        expect(syncToken).toBeUndefined();
        expect(deltaLink).toBeUndefined();
        pages++;
        return pageToken
          ? {
              events: f.events.slice(1),
              deletedIds: [],
              nextSyncToken: "restored-cursor",
            }
          : {
              events: f.events.slice(0, 1),
              deletedIds: [],
              nextPageToken: "page-two",
            };
      },
    );
    expect(pages).toBe(2);
    expect(restored).toMatchObject({
      fullResync: true,
      written: 2,
      skipped: 0,
    });
    const after = await f.db.externalEvent.findMany({ orderBy: { id: "asc" } });
    expect(after.map(({ updatedAt: _, ...event }) => event)).toEqual(
      before.map(({ updatedAt: _, ...event }) => event),
    );
    expect(
      await listEventsInRange(
        f.db,
        tomorrowNoon() - DAY,
        tomorrowNoon() + 30 * DAY,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider,
          title: "Meeting 20",
          joinUrl: "https://meet.example/room-20",
        }),
      ]),
    );
    expect(
      await f.sync(async () => ({
        events: f.events,
        deletedIds: [],
        nextSyncToken: "restored-cursor",
      })),
    ).toMatchObject({ fullResync: false, written: 0, skipped: 2 });
  });

  test(`${provider}: a private fetch in flight cannot consume the opt-in refresh or overwrite its data`, async () => {
    const f = await fixture(provider);
    await f.privacy(false);
    let deliver!: (page: SyncPage) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = f.sync(async () => {
      started();
      return new Promise<SyncPage>((resolve) => {
        deliver = resolve;
      });
    }, false);
    await entered;
    await f.privacy(true);
    await f.sync(async () => ({
      events: f.events,
      deletedIds: [],
      nextSyncToken: "new-full-cursor",
    }));
    deliver({
      events: f.events,
      deletedIds: [],
      nextSyncToken: "old-private-cursor",
    });
    expect(await pending).toMatchObject({ superseded: true, written: 0 });
    const state = await getSyncState(f.db, f.calendar.calendarId);
    expect(provider === "google" ? state?.syncToken : state?.deltaLink).toBe(
      "new-full-cursor",
    );
    expect(
      (await f.db.externalEvent.findMany()).every(
        (event) => event.title !== null,
      ),
    ).toBe(true);
    expect(
      await f.sync(
        async () => {
          throw new Error(
            "Must not fetch with an obsolete preference snapshot",
          );
        },
        false,
        0,
      ),
    ).toMatchObject({ superseded: true, pages: 0 });
  });
}
