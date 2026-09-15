import { API_URL } from "./environment";
import { dayShown, expect, seed, seedRoutine, test, todayAt } from "./support";

function meeting(
  provider: string,
  start: number,
  end: number,
  title = "Changed meeting",
) {
  const time = (at: number) => ({
    dateTime: new Date(at).toISOString(),
    timeZone: "UTC",
  });
  return provider === "google"
    ? {
        id: "provider-event",
        summary: title,
        start: time(start),
        end: time(end),
        status: "confirmed",
        transparency: "opaque",
        etag: `v${end}`,
        description: "Private notes",
      }
    : {
        id: "provider-event",
        subject: title,
        start: time(start),
        end: time(end),
        showAs: "busy",
        changeKey: `v${end}`,
        body: { contentType: "text", content: "Private notes" },
      };
}

// This suite tests sync/repair, not a race against the real clock crossing the
// 10:00 slot's movement cutoff during a long CI run. Timers still run normally.
test.beforeEach(async ({ page }) => {
  const now = todayAt(9);
  await seed("/clock", { now });
  await page.clock.setFixedTime(now);
});

for (const provider of ["google", "microsoft"] as const) {
  test(`${provider} delivery repairs only the collision, preserves slot identity and full duration`, async ({
    page,
    signIn,
  }) => {
    const user = await signIn();
    const calendars = await seed<{ calendars: { id: string }[] }>(
      "/calendar",
      { provider, calendars: [{ name: "Work" }] },
      user.token,
    );
    const calendarId = calendars.calendars[0]?.id;
    if (!calendarId) throw new Error("Missing seeded calendar");
    await seedRoutine(
      user.token,
      { name: "Deep work", sessionMinutes: 30 },
      { slotStartsAt: todayAt(10) },
    );
    await seedRoutine(
      user.token,
      { name: "Healthy walk", sessionMinutes: 20 },
      { slotStartsAt: todayAt(12) },
    );
    const headers = { authorization: `Bearer ${user.token}` };
    // /today and opening the app enqueue foreground sync. That consumer can
    // win ingestion/repair after /calendar/delta publishes its provider page,
    // so this one delivery can legitimately report moved: 0. Inspect without
    // foreground side effects and deliver before navigating when asserting an
    // exact per-invocation repair count. Queue-driven Sync is covered below.
    const before = await seed<{ slots: { id: string; title: string }[] }>(
      "/inspect",
      {},
      user.token,
    );
    const moved = await seed<{
      sync: { superseded?: boolean };
      repair: { moved: number };
    }>(
      "/calendar/delta",
      {
        calendarId,
        events: [meeting(provider, todayAt(9, 45), todayAt(10, 30))],
      },
      user.token,
    );
    expect(moved.sync.superseded, JSON.stringify(moved)).not.toBe(true);
    expect(moved.repair.moved, JSON.stringify(moved)).toBe(1);
    await page.goto("/");
    await dayShown(page);
    await page.reload();
    await dayShown(page);
    await expect(
      page.locator(".wr-daygrid-item", { hasText: "Changed meeting" }),
    ).toBeVisible();
    await expect(
      page.locator(".wr-daygrid-item", { hasText: "Deep work" }),
    ).toHaveCount(1);
    const after = await (
      await page.request.get(`${API_URL}/today`, { headers })
    ).json();
    const focus = after.slots.find(
      (slot: { title: string }) => slot.title === "Deep work",
    );
    expect(focus.id).toBe(
      before.slots.find((slot) => slot.title === "Deep work")?.id,
    );
    expect(focus.endsAt - focus.startsAt).toBe(30 * 60_000);
    expect(focus.startsAt).toBeGreaterThanOrEqual(todayAt(10, 30));
    expect(
      after.slots.find(
        (slot: { title: string }) => slot.title === "Healthy walk",
      ),
    ).toMatchObject({
      id: before.slots.find((slot) => slot.title === "Healthy walk")?.id,
      startsAt: todayAt(12),
      endsAt: todayAt(12, 20),
    });
    // Retrying the same provider delivery must not duplicate or churn healthy work.
    const retried = await seed<{ repair: { moved: number } }>(
      "/calendar/delta",
      {
        calendarId,
        events: [meeting(provider, todayAt(9, 45), todayAt(10, 30))],
      },
      user.token,
    );
    expect(retried.repair.moved).toBe(0);
    const persisted = await seed<{
      events: { slotId: string; reasonCode: string | null }[];
    }>("/inspect", {}, user.token);
    expect(
      persisted.events.filter(
        (event) => event.reasonCode === "calendar_change",
      ),
    ).toEqual([expect.objectContaining({ slotId: focus.id })]);
  });

  test(`${provider} opting back in restores unchanged meetings on sync and shows calendar provenance`, async ({
    page,
    signIn,
  }) => {
    const user = await signIn();
    const seeded = await seed<{ calendars: { id: string }[] }>(
      "/calendar",
      { provider, calendars: [{ name: "Work" }] },
      user.token,
    );
    const calendarId = seeded.calendars[0]?.id;
    if (!calendarId) throw new Error("Missing calendar");
    const providerLabel = provider === "google" ? "Google" : "Outlook";
    const link =
      provider === "google"
        ? { hangoutLink: "https://meet.google.com/abc-defg-hij" }
        : {
            onlineMeeting: {
              joinUrl: "https://teams.microsoft.com/l/meetup-join/test",
            },
          };
    await seed(
      "/calendar/delta",
      {
        calendarId,
        events: [10, 15].map((hour) => ({
          ...meeting(
            provider,
            todayAt(hour),
            todayAt(hour + 1),
            `Review ${hour}`,
          ),
          ...link,
          id: `meeting-${hour}`,
        })),
      },
      user.token,
    );
    const privacy = async (name: RegExp) => {
      await page.goto("/settings");
      await page.getByRole("radio", { name }).click();
      await page.getByRole("button", { name: "Update", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Update", exact: true }),
      ).toHaveCount(0);
    };
    await privacy(/Busy times only/);
    await page.goto("/");
    await dayShown(page);
    await expect(
      page.locator(".wr-slot-meeting .wr-slot-name", { hasText: /^Busy$/ }),
    ).toHaveCount(2);
    await expect(
      page
        .locator(".wr-slot-meeting")
        .getByText(`${providerLabel} · 60 min`, { exact: true }),
    ).toHaveCount(2);
    await privacy(/Save meeting details/);
    await page.goto("/");
    await dayShown(page);
    // The provider fixture keeps the exact same events/tags. This is the real
    // Sync button and queue path, not another fixture delivery or a clock jump.
    await page
      .getByRole("button", { name: "Sync calendars now", exact: true })
      .click();
    for (const hour of [10, 15]) {
      const block = page.locator(".wr-daygrid-item", {
        hasText: `Review ${hour}`,
      });
      // Queue batching can take 5s; Today's last existing settle read is at
      // 10s. Wait for that user-visible refresh, not just its initial spinner.
      await expect(block).toBeVisible({ timeout: 15_000 });
      await expect(
        block.getByText(`${providerLabel} · 60 min`, { exact: true }),
      ).toBeVisible();
    }
    await page.locator(".wr-daygrid-item", { hasText: "Review 15" }).click();
    const detail = page.locator(".wr-widget", {
      has: page.getByRole("heading", { name: "Review 15", exact: true }),
    });
    await expect(
      detail.getByText(new RegExp(`${providerLabel} ·`)),
    ).toBeVisible();
    await expect(
      detail.getByRole("button", {
        name: provider === "google" ? "Join Google Meet" : "Join Teams",
      }),
    ).toBeVisible();
    await expect(
      detail.getByRole("button", { name: "Show details" }),
    ).toBeVisible();
    await expect(
      detail.getByRole("button", {
        name: /^(Start|Resume|Stop|Postpone|Mark it done)$/,
      }),
    ).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("meeting-restored.png"),
      fullPage: true,
    });
  });

  test(`${provider} a full-day collision becomes Not placed; later private syncs cannot restore erased details`, async ({
    page,
    signIn,
  }) => {
    const user = await signIn();
    const calendars = await seed<{ calendars: { id: string }[] }>(
      "/calendar",
      { provider, calendars: [{ name: "Work" }] },
      user.token,
    );
    const calendarId = calendars.calendars[0]?.id;
    if (!calendarId) throw new Error("Missing seeded calendar");
    await seedRoutine(
      user.token,
      { name: "Unplaced focus", sessionMinutes: 30 },
      { slotStartsAt: todayAt(10) },
    );
    const outcome = await seed<{ repair: { bucketed: number } }>(
      "/calendar/delta",
      { calendarId, events: [meeting(provider, todayAt(0), todayAt(24))] },
      user.token,
    );
    expect(outcome.repair.bucketed).toBe(1);
    await page.goto("/");
    await dayShown(page);
    const widget = page.locator(".wr-widget", {
      has: page.getByText("Not placed", { exact: true }),
    });
    await expect(
      widget.getByText("Unplaced focus", { exact: true }),
    ).toBeVisible();
    await expect(
      widget.getByRole("button", { name: /Drop|Choose time/ }),
    ).toHaveCount(0);
    await page.goto("/settings");
    await page.getByRole("radio", { name: /Busy times only/ }).click();
    await page.getByRole("button", { name: "Update", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Update", exact: true }),
    ).toHaveCount(0);
    await seed(
      "/calendar/delta",
      {
        calendarId,
        events: [
          meeting(
            provider,
            todayAt(0),
            todayAt(24),
            "Later confidential title",
          ),
        ],
      },
      user.token,
    );
    const data = await (
      await page.request.get(`${API_URL}/today?range=full`, {
        headers: { authorization: `Bearer ${user.token}` },
      })
    ).json();
    expect(data.meetings).toHaveLength(1);
    expect(data.meetings[0]).toMatchObject({
      title: null,
      description: null,
      joinUrl: null,
    });
    await page.goto("/");
    await dayShown(page);
    await expect(
      page.getByText("Later confidential title", { exact: true }),
    ).toHaveCount(0);
    await expect(
      widget.getByText("Unplaced focus", { exact: true }),
    ).toBeVisible();
  });
}
