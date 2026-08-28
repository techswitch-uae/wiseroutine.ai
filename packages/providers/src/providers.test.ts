import { isBusy } from "@wiseroutine/scheduler";
import { describe, expect, test } from "vitest";
import { normaliseGoogleEvent } from "./google";
import { microsoftSyncPage, normaliseMicrosoftEvent } from "./microsoft";
import { decodeIdToken, toCalendarEvent } from "./types";

/**
 * Fixtures shaped like real provider payloads. These exist mainly to pin the
 * mapping of the fields that decide free/busy - the ones that make the product
 * look broken when they are wrong.
 */

describe("normaliseGoogleEvent", () => {
  test("a normal timed meeting", () => {
    const event = normaliseGoogleEvent({
      id: "abc123",
      etag: '"3181161784712000"',
      iCalUID: "abc123@google.com",
      status: "confirmed",
      summary: "Design review",
      updated: "2026-08-24T09:12:03.000Z",
      start: { dateTime: "2026-08-24T10:00:00+02:00", timeZone: "Europe/Rome" },
      end: { dateTime: "2026-08-24T11:00:00+02:00", timeZone: "Europe/Rome" },
    });

    expect(event.title).toBe("Design review");
    expect(event.isAllDay).toBe(false);
    expect(event.busyStatus).toBe("busy");
    expect(event.changeTag).toBe('"3181161784712000"');
    expect(new Date(event.startsAt).toISOString()).toBe(
      "2026-08-24T08:00:00.000Z",
    );
    expect(event.endsAt - event.startsAt).toBe(3_600_000);
    expect(isBusy(toCalendarEvent(event, "c"))).toBe(true);
  });

  // The failure that makes every user appear to have no free time at all.
  test("a working-location event is carried through as such and is not busy", () => {
    const event = normaliseGoogleEvent({
      id: "wl-1",
      eventType: "workingLocation",
      summary: "Office",
      start: { date: "2026-08-24" },
      end: { date: "2026-08-25" },
    });

    expect(event.kind).toBe("workingLocation");
    expect(isBusy(toCalendarEvent(event, "c"))).toBe(false);
  });

  test("a declined invitation is detected via the self attendee", () => {
    const event = normaliseGoogleEvent({
      id: "d-1",
      summary: "All hands",
      attendees: [
        { email: "someone@else.com", responseStatus: "accepted" },
        { email: "me@example.com", self: true, responseStatus: "declined" },
      ],
      start: { dateTime: "2026-08-24T10:00:00Z" },
      end: { dateTime: "2026-08-24T11:00:00Z" },
    });

    expect(event.responseStatus).toBe("declined");
    expect(isBusy(toCalendarEvent(event, "c"))).toBe(false);
  });

  test("transparency maps to free", () => {
    const event = normaliseGoogleEvent({
      id: "t-1",
      transparency: "transparent",
      start: { dateTime: "2026-08-24T10:00:00Z" },
      end: { dateTime: "2026-08-24T11:00:00Z" },
    });
    expect(event.busyStatus).toBe("free");
  });

  test("a cancelled instance is a tombstone carrying its series", () => {
    const event = normaliseGoogleEvent({
      id: "rec-1_20260824T080000Z",
      status: "cancelled",
      recurringEventId: "rec-1",
      start: { dateTime: "2026-08-24T10:00:00Z" },
      end: { dateTime: "2026-08-24T11:00:00Z" },
    });
    expect(event.isCancelled).toBe(true);
    expect(event.seriesMasterId).toBe("rec-1");
  });

  test("all-day events are flagged and not treated as an instant", () => {
    const event = normaliseGoogleEvent({
      id: "ad-1",
      summary: "Q3 planning week",
      start: { date: "2026-08-24" },
      end: { date: "2026-08-29" },
    });
    expect(event.isAllDay).toBe(true);
    expect(isBusy(toCalendarEvent(event, "c"))).toBe(false);
  });
});

describe("normaliseMicrosoftEvent", () => {
  // The classic Graph bug: dateTime carries NO offset and the zone is separate.
  test("times are read as UTC when Graph answers in UTC", () => {
    const event = normaliseMicrosoftEvent({
      id: "AAMkAD",
      changeKey: "CQAAABYAAAA",
      iCalUId: "040000008200E00074C5B7101A82E008",
      subject: "Client sync",
      isAllDay: false,
      isCancelled: false,
      showAs: "busy",
      responseStatus: { response: "accepted" },
      start: { dateTime: "2026-08-24T13:15:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-08-24T14:00:00.0000000", timeZone: "UTC" },
      lastModifiedDateTime: "2026-08-20T07:00:00Z",
    });

    expect(new Date(event.startsAt).toISOString()).toBe(
      "2026-08-24T13:15:00.000Z",
    );
    expect(event.endsAt - event.startsAt).toBe(45 * 60_000);
    expect(event.changeTag).toBe("CQAAABYAAAA");
    expect(isBusy(toCalendarEvent(event, "c"))).toBe(true);
  });

  test("showAs free and declined both mean not busy", () => {
    const free = normaliseMicrosoftEvent({
      id: "f",
      showAs: "free",
      start: { dateTime: "2026-08-24T10:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-08-24T11:00:00.0000000", timeZone: "UTC" },
    });
    expect(free.busyStatus).toBe("free");

    const declined = normaliseMicrosoftEvent({
      id: "d",
      showAs: "busy",
      responseStatus: { response: "declined" },
      start: { dateTime: "2026-08-24T10:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-08-24T11:00:00.0000000", timeZone: "UTC" },
    });
    expect(declined.responseStatus).toBe("declined");
    expect(isBusy(toCalendarEvent(declined, "c"))).toBe(false);
  });

  test("out of office maps to oof and stays busy", () => {
    const event = normaliseMicrosoftEvent({
      id: "o",
      showAs: "oof",
      start: { dateTime: "2026-08-24T10:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-08-24T18:00:00.0000000", timeZone: "UTC" },
    });
    expect(event.busyStatus).toBe("oof");
    expect(isBusy(toCalendarEvent(event, "c"))).toBe(true);
  });

  test("an occurrence keeps its series master id", () => {
    const event = normaliseMicrosoftEvent({
      id: "occ-1",
      seriesMasterId: "master-1",
      showAs: "busy",
      start: { dateTime: "2026-08-24T09:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-08-24T09:30:00.0000000", timeZone: "UTC" },
    });
    expect(event.seriesMasterId).toBe("master-1");
  });
});

describe("decodeIdToken", () => {
  test("reads the claims we need", () => {
    const payload = { sub: "1234", email: "mara@example.com", name: "Mara K." };
    const token = `header.${btoa(JSON.stringify(payload))}.signature`;
    expect(decodeIdToken(token)).toMatchObject(payload);
  });

  test("a malformed token yields nothing rather than throwing", () => {
    expect(decodeIdToken("not-a-token")).toEqual({});
  });
});

/** Answer one Graph call with a canned payload, then put `fetch` back. */
async function withFetch<T>(body: unknown, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

/**
 * A recurring meeting arrives from `calendarView/delta` as two kinds of thing,
 * and taking the payload at face value gets both of them wrong: the occurrence
 * carries the times but no subject, and the master carries the subject but is
 * not a booking at all. That shipped - every recurring meeting rendered as
 * "Busy", and every series added a phantom busy block at its first instance.
 */
describe("microsoft recurring series", () => {
  const page = (items: unknown[]) => ({ value: items });

  const master = {
    id: "series-1",
    type: "seriesMaster",
    subject: "BB Standup",
    start: { dateTime: "2026-08-27T08:30:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-08-27T08:45:00.0000000", timeZone: "UTC" },
  };
  const occurrence = {
    id: "occ-1",
    type: "occurrence",
    seriesMasterId: "series-1",
    // No `subject`: Graph expects it to be inherited from the master.
    start: { dateTime: "2026-08-28T08:30:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-08-28T08:45:00.0000000", timeZone: "UTC" },
  };

  test("an occurrence inherits the series subject", async () => {
    const fetched = await withFetch(page([master, occurrence]), () =>
      microsoftSyncPage({ accessToken: "t", calendarId: "cal" }),
    );
    const found = fetched.events.find((e) => e.providerEventId === "occ-1");
    expect(found?.title).toBe("BB Standup");
  });

  // The master's start is its first instance, which the occurrences already
  // cover. Storing it too double-books that slot against a meeting that is not
  // separately in the diary.
  test("the series master is not stored as a booking", async () => {
    const fetched = await withFetch(page([master, occurrence]), () =>
      microsoftSyncPage({ accessToken: "t", calendarId: "cal" }),
    );
    expect(fetched.events.map((e) => e.providerEventId)).toEqual(["occ-1"]);
  });

  // A later delta page can carry occurrences whose master is not in it.
  test("an orphan occurrence stays untitled rather than throwing", async () => {
    const fetched = await withFetch(page([occurrence]), () =>
      microsoftSyncPage({ accessToken: "t", calendarId: "cal" }),
    );
    expect(fetched.events).toHaveLength(1);
    expect(fetched.events[0]?.title).toBeNull();
  });
});
