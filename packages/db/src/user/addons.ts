import { at, ms, type UserDatabase } from "../client";
import { setActivityActive } from "./activities";
import { cancelUnstartedSlots } from "./slots";

/**
 * The addons a user has installed.
 *
 * Not the package: the bundle lives on the device. This is the decision:
 * which version, what the user agreed to let it do, whether it is on, and its
 * settings.
 *
 * `grantedJson` is the gate. The desktop host and the Worker both check
 * against it, never against the manifest. A new version that asks for more
 * keeps the old grant until the user allows the rest on the Addons page.
 */

export interface AddonRow {
  id: string;
  version: string;
  /** The manifest as installed, already validated by `parseManifest`. */
  manifestJson: string;
  /** The capabilities actually granted, as JSON. Not what it asked for. */
  grantedJson: string;
  /** sha256 of the bundle as published. Empty for a bundled addon. */
  bundleHash: string;
  /** Addon-level settings, as JSON. Never secrets. */
  settingsJson: string;
  isEnabled: boolean;
  installedAt: number;
}

const toRow = (row: {
  id: string;
  version: string;
  manifestJson: string;
  grantedJson: string;
  bundleHash: string;
  settingsJson: string;
  isEnabled: boolean;
  installedAt: Date;
}): AddonRow => ({
  id: row.id,
  version: row.version,
  manifestJson: row.manifestJson,
  grantedJson: row.grantedJson,
  bundleHash: row.bundleHash,
  settingsJson: row.settingsJson,
  isEnabled: row.isEnabled,
  installedAt: ms(row.installedAt),
});

export async function listAddons(db: UserDatabase): Promise<AddonRow[]> {
  const rows = await db.addon.findMany({ orderBy: { installedAt: "asc" } });
  return rows.map(toRow);
}

export async function getAddon(
  db: UserDatabase,
  id: string,
): Promise<AddonRow | null> {
  const row = await db.addon.findUnique({ where: { id } });
  return row ? toRow(row) : null;
}

export interface AddonInput {
  id: string;
  version: string;
  manifestJson: string;
  grantedJson: string;
  bundleHash: string;
}

/**
 * Install, or move an existing install to a new version.
 *
 * An upsert: re-installing something removed earlier is the ordinary case.
 * The grant written is whatever the caller decided; the route decides that,
 * not this function. `isEnabled` is kept on an upgrade, so an addon the user
 * switched off does not switch itself on by publishing.
 */
export async function installAddon(
  db: UserDatabase,
  input: AddonInput,
  now: number,
): Promise<AddonRow> {
  const existing = await db.addon.findUnique({
    where: { id: input.id },
    select: { isEnabled: true },
  });

  const row = await db.addon.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      version: input.version,
      manifestJson: input.manifestJson,
      grantedJson: input.grantedJson,
      bundleHash: input.bundleHash,
      isEnabled: true,
      installedAt: at(now),
    },
    update: {
      version: input.version,
      manifestJson: input.manifestJson,
      grantedJson: input.grantedJson,
      bundleHash: input.bundleHash,
      isEnabled: existing?.isEnabled ?? true,
    },
  });

  return toRow(row);
}

export async function setAddonSettings(
  db: UserDatabase,
  id: string,
  settingsJson: string,
): Promise<void> {
  await db.addon.update({ where: { id }, data: { settingsJson } });
}

export async function setAddonEnabled(
  db: UserDatabase,
  id: string,
  isEnabled: boolean,
): Promise<void> {
  await db.addon.update({ where: { id }, data: { isEnabled } });
}

/**
 * The activities that stop working if this addon does.
 *
 * A wider set than the ones the addon *created*, and the difference was a real
 * bug: removing the breathing addon reported "0 activities, 0 slots" while the
 * user's Breathing activity sat there on their day, because that activity was
 * created by the user from the library and its `owner_addon_id` is null.
 *
 * Two ways an activity can depend on an addon, and both count:
 *
 * 1. **The addon created it.** `owner_addon_id` names it. Slots an addon
 *    places carry it; activities may in a later version.
 * 2. **It runs the addon's activity type.** `preset_key` is `addonId/typeKey`,
 *    so the prefix names the addon. This is every guided session in the app,
 *    including the four Wise Routine ships.
 *
 * The prefix match is on `id/` rather than `id`, so `wiseroutine.stretch` does
 * not claim `wiseroutine.stretching/guided`. Addon ids may not contain a
 * slash - `isAddonId` refuses one - which is what makes the separator
 * unambiguous.
 */
export const dependentsOf = (id: string) => ({
  OR: [{ ownerAddonId: id }, { presetKey: { startsWith: `${id}/` } }],
});

export interface RemovalResult {
  /** Activities that depended on the addon, now paused. */
  paused: number;
  /** Slots ahead of the clock that were cancelled. */
  cancelled: number;
}

/** What switching an addon off would cost, before switching it off. */
export interface AddonImpact {
  /** The activities that would be paused, named so the user can recognise
   *  them. A count alone asks somebody to confirm a number. */
  activities: { id: string; name: string }[];
  /** Slots still ahead of the clock that would come off the day. */
  futureSlots: number;
}

/**
 * What would happen, asked before it happens.
 *
 * Read-only and deliberately separate from the doing: a confirmation that
 * names three activities and two slots is one a person can actually decide
 * about, and computing it inside the mutation would mean either confirming
 * afterwards or guessing beforehand.
 *
 * Counted against the same `dependentsOf` the mutation uses, so what the
 * dialog promises and what happens cannot drift apart.
 */
export async function addonImpact(
  db: UserDatabase,
  id: string,
  now: number,
): Promise<AddonImpact> {
  const activities = await db.activity.findMany({
    where: { ...dependentsOf(id), isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (activities.length === 0) return { activities: [], futureSlots: 0 };

  const futureSlots = await db.slot.count({
    where: {
      activityId: { in: activities.map((activity) => activity.id) },
      startsAt: { gt: at(now) },
      // The same set `cancelUnstartedSlots` will actually take. A slot already
      // started, completed or skipped is the past and stays; counting it here
      // would promise to remove something that is not going to be removed.
      status: { in: ["planned", "live"] },
    },
  });

  return { activities, futureSlots };
}

/**
 * Remove an addon, and clear the future it had claimed.
 *
 * The rule is: **take the future, leave the past.** A slot the user has
 * already done is a fact about their week and the numbers were computed from
 * it; deleting it would make last Tuesday change retroactively, which is not
 * something an uninstall is entitled to do. A slot still ahead of the clock is
 * a plan, and a plan made by an addon that is no longer here should not still
 * be on the day.
 *
 * Pausing the activities is not a nicety either - it is what makes the
 * cancelling stick. The planner works from active activities and their
 * minimums, so an activity left active would simply have its slots placed
 * again on the next run, and the cancelled ones would reappear within minutes.
 *
 * Paused rather than archived or deleted, because removing an addon is
 * reversible and this should be too: install it again and the activities are
 * still there, still configured, waiting to be switched back on.
 *
 * The `Addon` row goes last. If anything above fails the install is still
 * recorded, which leaves a user who can try again - the opposite order leaves
 * one who cannot, with orphaned activities and nothing owning them.
 */
export async function removeAddon(
  db: UserDatabase,
  id: string,
  now: number,
  newId: () => string,
): Promise<RemovalResult> {
  const result = await pauseDependents(db, id, now, newId);
  await db.addon.deleteMany({ where: { id } });
  return result;
}

/**
 * Take the future the addon claimed, leave the past.
 *
 * Shared by removing and by switching off, because they owe the user the same
 * thing. The difference between the two is only what happens to the `Addon`
 * row - one deletes it, the other clears a flag - and an activity whose
 * session no longer runs is a slot that opens into nothing either way.
 *
 * `pausedByAddonAt` is stamped as it goes, so `resumeDependents` knows which
 * of the paused activities were paused *by this* rather than by the user. An
 * activity somebody switched off themselves must not switch itself back on
 * because an addon was re-enabled.
 */
export async function pauseDependents(
  db: UserDatabase,
  id: string,
  now: number,
  newId: () => string,
): Promise<RemovalResult> {
  const affected = await db.activity.findMany({
    where: { ...dependentsOf(id), isActive: true },
    select: { id: true },
  });

  let cancelled = 0;
  for (const activity of affected) {
    await setActivityActive(db, activity.id, false);
    await db.activity.update({
      where: { id: activity.id },
      data: { pausedByAddonAt: at(now) },
    });
    cancelled += await cancelUnstartedSlots(
      db,
      { activityId: activity.id, from: now, reasonCode: "addon_removed" },
      now,
      newId,
    );
  }

  return { paused: affected.length, cancelled };
}

/**
 * Switch back on exactly what this addon's switch switched off.
 *
 * Only activities carrying `pausedByAddonAt`, which is what makes the toggle a
 * toggle rather than a one-way door: switch an addon off, agree to lose its
 * activities, change your mind, and they are back as they were - same minutes,
 * same days, same settings.
 *
 * Slots are not restored. They were cancelled, and the day has moved on; the
 * planner places new ones for an active activity on its next run, which is the
 * same path any newly added activity takes. Resurrecting a cancelled slot
 * would put a block back at a time that may now be a meeting.
 */
export async function resumeDependents(
  db: UserDatabase,
  id: string,
): Promise<{ resumed: number }> {
  const paused = await db.activity.findMany({
    where: { ...dependentsOf(id), pausedByAddonAt: { not: null } },
    select: { id: true },
  });

  for (const activity of paused) {
    await setActivityActive(db, activity.id, true);
    await db.activity.update({
      where: { id: activity.id },
      data: { pausedByAddonAt: null },
    });
  }

  return { resumed: paused.length };
}
