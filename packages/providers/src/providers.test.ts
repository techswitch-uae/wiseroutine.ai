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
    // Stated once, on the series - which is where a recurring Teams meeting
    // keeps its link.
    onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/bb" },
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
  /**
   * The bug this was found by: every one-off Teams meeting came through with
   * its link and every recurring one - which is most of them - came through
   * with none, because the occurrence Graph sends has no `onlineMeeting` on
   * it. Exactly the shape of the subject problem above, one field along.
   */
  test("an occurrence inherits the series join link", async () => {
    const fetched = await withFetch(page([master, occurrence]), () =>
      microsoftSyncPage({ accessToken: "t", calendarId: "cal" }),
    );
    const found = fetched.events.find((e) => e.providerEventId === "occ-1");
    expect(found?.joinUrl).toBe("https://teams.microsoft.com/l/meetup-join/bb");
  });

  // An instance moved out of the series can be a meeting of its own.
  test("an occurrence with its own link keeps it", async () => {
    const moved = {
      ...occurrence,
      id: "occ-2",
      onlineMeeting: {
        joinUrl: "https://teams.microsoft.com/l/meetup-join/own",
      },
    };
    const fetched = await withFetch(page([master, moved]), () =>
      microsoftSyncPage({ accessToken: "t", calendarId: "cal" }),
    );
    const found = fetched.events.find((e) => e.providerEventId === "occ-2");
    expect(found?.joinUrl).toBe(
      "https://teams.microsoft.com/l/meetup-join/own",
    );
  });

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

/**
 * Where the meeting is held.
 *
 * Both providers have sent this all along and it was read off the wire and
 * thrown away, so a block on the day said when a call was and never how to get
 * into it.
 */
describe("the join link", () => {
  test("google: the video entry, not the phone number beside it", () => {
    const event = normaliseGoogleEvent({
      id: "g1",
      summary: "Design review",
      start: { dateTime: "2026-08-24T10:00:00Z" },
      end: { dateTime: "2026-08-24T11:00:00Z" },
      conferenceData: {
        entryPoints: [
          { entryPointType: "phone", uri: "tel:+39-0000000" },
          {
            entryPointType: "video",
            uri: "https://meet.google.com/abc-defg-hij",
          },
          { entryPointType: "more", uri: "https://tel.meet/abc-defg-hij" },
        ],
      },
    });

    expect(event.joinUrl).toBe("https://meet.google.com/abc-defg-hij");
  });

  // Still the only link on events created before conferenceData existed.
  test("google: falls back to the older hangoutLink", () => {
    const event = normaliseGoogleEvent({
      id: "g2",
      start: { dateTime: "2026-08-24T10:00:00Z" },
      end: { dateTime: "2026-08-24T11:00:00Z" },
      hangoutLink: "https://meet.google.com/old-style-link",
    });

    expect(event.joinUrl).toBe("https://meet.google.com/old-style-link");
  });

  test("microsoft: the online meeting's join url", () => {
    const event = normaliseMicrosoftEvent({
      id: "m1",
      subject: "Standup",
      start: { dateTime: "2026-08-24T10:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-08-24T10:15:00.0000000", timeZone: "UTC" },
      isOnlineMeeting: true,
      onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/x" },
    });

    expect(event.joinUrl).toBe("https://teams.microsoft.com/l/meetup-join/x");
  });

  test("a meeting in a room has no link at all", () => {
    const event = normaliseGoogleEvent({
      id: "g3",
      start: { dateTime: "2026-08-24T10:00:00Z" },
      end: { dateTime: "2026-08-24T11:00:00Z" },
    });

    expect(event.joinUrl).toBeNull();
  });

  /**
   * The link reaches a button that hands a URL to the operating system, so
   * what arrives from a provider is filtered where it arrives rather than at
   * each of the places that later show it.
   */
  test("anything that is not a web address is dropped", () => {
    for (const uri of [
      "tel:+39-0000000",
      "javascript:alert(1)",
      "file:///Users/someone/secrets",
      "not a url at all",
    ]) {
      const event = normaliseGoogleEvent({
        id: `g-${uri}`,
        start: { dateTime: "2026-08-24T10:00:00Z" },
        end: { dateTime: "2026-08-24T11:00:00Z" },
        conferenceData: { entryPoints: [{ entryPointType: "video", uri }] },
      });
      expect(event.joinUrl).toBeNull();
    }
  });
});

/**
 * The link that is only in the description.
 *
 * `conferenceData` is filled in by Google's own conferencing and by nothing
 * else, so a diary booked through Calendly, HubSpot or a Zoom scheduler has
 * none of it at all - the join link arrives as a line of text in the body,
 * which is where a real "Meeting with ArMa Global" was found hiding.
 */
describe("a link in the description", () => {
  const event = (description: string) =>
    normaliseGoogleEvent({
      id: "d1",
      summary: "Meeting with ArMa Global",
      start: { dateTime: "2026-09-02T09:00:00Z" },
      end: { dateTime: "2026-09-02T10:00:00Z" },
      description,
    });

  test("finds a zoom link in the body text", () => {
    expect(
      event(
        "Join Zoom Meeting\nhttps://us02web.zoom.us/j/8412345678\n\nID: 841",
      ).joinUrl,
    ).toBe("https://us02web.zoom.us/j/8412345678");
  });

  test("finds one that exists only as a link's href", () => {
    expect(
      event(
        'Click <a href="https://meet.google.com/xyz-abcd-efg">here</a> to join',
      ).joinUrl,
    ).toBe("https://meet.google.com/xyz-abcd-efg");
  });

  /**
   * A description is full of URLs - map links, unsubscribe footers, the
   * organiser's own website - so "the first link in the text" is the wrong
   * answer far more often than it is the right one.
   */
  test("ignores the links that are not meetings", () => {
    expect(
      event(
        "Directions: https://maps.example.com/x\nUnsubscribe: https://mail.example.com/u",
      ).joinUrl,
    ).toBeNull();
  });

  /**
   * The body keeps its shape without keeping its markup: emphasis and links
   * survive as a notation the reader turns into elements, and nothing is ever
   * handed to a DOM as HTML.
   */
  test("carries the formatting across as a notation, not as markup", () => {
    const { description } = event(
      "<p>Agenda:</p><ul><li><b>Deck</b> &amp; <i>numbers</i></li></ul>",
    );
    expect(description).toBe("Agenda:\n\n• **Deck** & _numbers_");
  });

  test("a link keeps both its words and its address", () => {
    const { description } = event(
      'Read the <a href="https://example.com/brief">brief</a> first',
    );
    expect(description).toBe(
      "Read the [brief](https://example.com/brief) first",
    );
  });

  // A link whose words are the address itself would otherwise be written out
  // twice, once as the label and once in the brackets.
  test("a bare link is written once", () => {
    const { description } = event(
      '<a href="https://example.com/x">https://example.com/x</a>',
    );
    expect(description).toBe("https://example.com/x");
  });

  // The structured field is the provider's own answer and beats a guess at
  // one, so a Meet link on the event wins over anything written in the body.
  test("prefers the event's own conference data over the body", () => {
    const found = normaliseGoogleEvent({
      id: "d2",
      start: { dateTime: "2026-09-02T09:00:00Z" },
      end: { dateTime: "2026-09-02T10:00:00Z" },
      conferenceData: {
        entryPoints: [
          { entryPointType: "video", uri: "https://meet.google.com/real-link" },
        ],
      },
      description: "Old link: https://us02web.zoom.us/j/000",
    });
    expect(found.joinUrl).toBe("https://meet.google.com/real-link");
  });
});
