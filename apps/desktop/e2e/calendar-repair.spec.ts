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
    const before = await (
      await page.request.get(`${API_URL}/today`, { headers })
    ).json();
    await page.goto("/");
    await dayShown(page);
    const moved = await seed<{ repair: { moved: number } }>(
      "/calendar/delta",
      {
        calendarId,
        events: [meeting(provider, todayAt(9, 45), todayAt(10, 30))],
      },
      user.token,
    );
    expect(moved.repair.moved).toBe(1);
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
      before.slots.find((slot: { title: string }) => slot.title === "Deep work")
        .id,
    );
    expect(focus.endsAt - focus.startsAt).toBe(30 * 60_000);
    expect(focus.startsAt).toBeGreaterThanOrEqual(todayAt(10, 30));
    expect(
      after.slots.find(
        (slot: { title: string }) => slot.title === "Healthy walk",
      ),
    ).toMatchObject({
      id: before.slots.find(
        (slot: { title: string }) => slot.title === "Healthy walk",
      ).id,
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
