import { at, ms, type UserDatabase } from "../client";
import { setActivityActive } from "./activities";
import { cancelUnstartedSlots } from "./slots";

/**
 * The addons a user has installed.
 *
 * An addon is a package somebody outside this repo wrote. What is stored here
 * is not the package - the bundle lives on disk, put there by the app once its
 * signature has been checked - but the *decision*: which version, what the
 * user agreed to let it do, and whether it is switched on.
 *
 * `grantedJson` is the one that matters. It is what the host bridge and the
 * Worker both check against, and it is deliberately a separate column from the
 * manifest: what an addon *asks for* and what it *was given* are different
 * lists, and only one of them is a gate. An addon that gains a capability in a
 * new version does not gain it here until somebody says so.
 */

export interface AddonRow {
  id: string;
  version: string;
  /** The manifest as installed, already validated by `parseManifest`. */
  manifestJson: string;
  /** The capabilities actually granted, as JSON. Not what it asked for. */
  grantedJson: string;
  /** sha256 of the bundle whose signature was checked before it was written. */
  bundleHash: string;
  isEnabled: boolean;
  installedAt: number;
}

const toRow = (row: {
  id: string;
  version: string;
  manifestJson: string;
  grantedJson: string;
  bundleHash: string;
  isEnabled: boolean;
  installedAt: Date;
}): AddonRow => ({
  id: row.id,
  version: row.version,
  manifestJson: row.manifestJson,
  grantedJson: row.grantedJson,
  bundleHash: row.bundleHash,
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
 * An upsert rather than a create, because re-installing something the user
 * removed and then wanted back is the ordinary case, not the exception. The
 * grant is rewritten each time: a new version may ask for more, and the answer
 * to that question is the one just given rather than the one given last year.
 *
 * `isEnabled` is deliberately not carried over on an upgrade. An addon the
 * user had switched off does not switch itself on by publishing.
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

export async function setAddonEnabled(
  db: UserDatabase,
  id: string,
  isEnabled: boolean,
): Promise<void> {
  await db.addon.update({ where: { id }, data: { isEnabled } });
}

export interface RemovalResult {
  /** Activities the addon owned, now paused. */
  paused: number;
  /** Slots ahead of the clock that were cancelled. */
  cancelled: number;
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
  const owned = await db.activity.findMany({
    where: { ownerAddonId: id },
    select: { id: true },
  });

  let cancelled = 0;
  for (const activity of owned) {
    await setActivityActive(db, activity.id, false);
    cancelled += await cancelUnstartedSlots(
      db,
      { activityId: activity.id, from: now, reasonCode: "addon_removed" },
      now,
      newId,
    );
  }

  await db.addon.deleteMany({ where: { id } });

  return { paused: owned.length, cancelled };
}
