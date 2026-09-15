import { addonReleased } from "@wiseroutine/plans/features";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { App, Ctx } from "./context";
import { enforce } from "./context";
import { requireFeature } from "./features";

/** Route-level availability. Slot lifecycle/recovery and account data are core:
 * never gate an entire /slots or /settings subtree behind capture. */
export const releaseGates: MiddlewareHandler<App> = async (c, next) => {
  const path = c.req.path.replace(/\/$/, "");
  const method = c.req.method;
  if (path === "/capture") requireFeature(c, "quick_capture");
  if (
    path === "/inbox" ||
    /^\/todos(?:\/[^/]+)?$/.test(path) ||
    /^\/todos\/[^/]+\/details$/.test(path)
  )
    requireFeature(c, "inbox");
  if (
    /^\/(?:captures|todos)\/[^/]+\/files(?:\/[^/]+)?$/.test(path) &&
    method === "PUT"
  )
    requireFeature(c, "capture_files");
  // Downloads/deletion remain authorized recovery paths even after an upload rollback.
  if (path.startsWith("/addons/") || (path === "/addons" && method !== "GET"))
    requireFeature(c, "community_addons");
  if (path.startsWith("/addons/")) {
    let id: string;
    try {
      id = decodeURIComponent(path.split("/")[2] ?? "");
    } catch {
      throw new HTTPException(400);
    }
    if (!addonReleased(c.get("features"), id))
      throw new HTTPException(404, {
        message: "This addon is not currently available",
      });
  }
  const addon = c.req.header("x-wr-addon");
  if (addon && !addonReleased(c.get("features"), addon))
    throw new HTTPException(403, {
      message: "This addon is not currently available",
    });
  if (path === "/scope") {
    const days = Number(c.req.query("days") ?? 7);
    if (!(days === 1 && c.get("features").quick_capture))
      requireFeature(c, "week_view");
    if (days > 7) requireFeature(c, "month_view");
  }
  await next();
};

/** Hidden fields are not reset when editing legacy data. Existing preferences
 * remain stored and honored; only new/changed premium options are refused. */
export function enforceActivityFeatures(
  c: Ctx,
  body: Record<string, unknown>,
  previous: Record<string, unknown> = {},
): void {
  const changed = (key: string) =>
    body[key] !== undefined &&
    JSON.stringify(body[key]) !== JSON.stringify(previous[key]);
  const advanced =
    ((changed("minimumType") || changed("minimumValue")) &&
      (body.minimumType ?? previous.minimumType ?? "countPerDay") !==
        "countPerDay") ||
    (changed("preferredWindows") &&
      Array.isArray(body.preferredWindows) &&
      body.preferredWindows.length > 0) ||
    (changed("importance") && body.importance !== "normal") ||
    (changed("graceMinutes") && body.graceMinutes !== 3) ||
    (changed("bufferBeforeMeetingMinutes") &&
      body.bufferBeforeMeetingMinutes !== 0);
  if (advanced) {
    requireFeature(c, "advanced_scheduling");
    enforce(c, { kind: "plan.rearrange" });
  }
  if (
    (changed("minimumType") || changed("minimumValue")) &&
    (body.minimumType ?? previous.minimumType) === "countPerWeek"
  )
    requireFeature(c, "weekly_planning");
  const moduleChange =
    (changed("presetKey") && body.presetKey !== null) ||
    (changed("sessionEnabled") && body.sessionEnabled === true) ||
    (changed("startPolicy") && body.startPolicy !== "manual") ||
    (changed("configJson") && body.configJson !== null);
  if (moduleChange) {
    requireFeature(c, "guided_sessions");
    const preset = body.presetKey ?? previous.presetKey;
    if (
      typeof preset === "string" &&
      !addonReleased(c.get("features"), preset.split("/")[0] ?? "")
    )
      throw new HTTPException(404, {
        message: "This activity type is not currently available",
      });
  }
}
