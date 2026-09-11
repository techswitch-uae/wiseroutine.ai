import { z } from "zod";

/** Both create and patch accept partial input; only create supplies defaults.
 * No coercion: false, null, strings and Infinity are not durations. Limits
 * bound work and storage while including every value offered by the UI. */
export const activityPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(["recovery", "focus", "task"]).optional(),
  minimumType: z.enum(["countPerDay", "durationPerDay", "countPerWeek"]).optional(),
  minimumValue: z.number().int().min(1).max(1440).optional(),
  sessionMinutes: z.number().int().min(1).max(480).optional(),
  daysOfWeek: z.number().int().min(1).max(127).optional(),
  importance: z.enum(["low", "normal", "high"]).optional(),
  graceMinutes: z.number().int().min(0).max(30).optional(),
  bufferBeforeMeetingMinutes: z.number().int().min(0).max(480).optional(),
  preferredWindows: z.array(z.number().int().min(0).max(1439)).max(48).optional(),
  isActive: z.boolean().optional(),
  presetKey: z.string().max(200).nullable().optional(),
  sessionEnabled: z.boolean().optional(),
  startPolicy: z.enum(["manual", "auto", "prompt"]).optional(),
  configJson: z.string().max(8192).refine((text) => {
    try { JSON.parse(text); return true; } catch { return false; }
  }, "configJson must be JSON").nullable().optional(),
}).strict();
