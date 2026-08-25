import { at, type Directory, ms } from "../client";

/**
 * Push-channel routing.
 *
 * A webhook arrives knowing only a channel id or a Graph resource. With one
 * database per user we have to resolve the user *before* we can open anything,
 * so the mapping and the shared secret live in the directory.
 */

export interface WatchRoute {
  channelId: string;
  userId: string;
  calendarId: string;
  provider: "google" | "microsoft";
  secret: string;
  expiresAt: number;
}

export async function registerWatch(
  directory: Directory,
  input: Omit<WatchRoute, "expiresAt"> & { expiresAt: number },
  now: number,
): Promise<void> {
  const data = {
    userId: input.userId,
    calendarId: input.calendarId,
    provider: input.provider,
    secret: input.secret,
    expiresAt: at(input.expiresAt),
  };

  await directory.watchChannel.upsert({
    where: { channelId: input.channelId },
    update: data,
    create: { channelId: input.channelId, ...data, createdAt: at(now) },
  });
}

export async function findWatchRoute(
  directory: Directory,
  channelId: string,
): Promise<WatchRoute | undefined> {
  const row = await directory.watchChannel.findUnique({ where: { channelId } });
  if (!row) return undefined;

  return {
    channelId: row.channelId,
    userId: row.userId,
    calendarId: row.calendarId,
    provider: row.provider as "google" | "microsoft",
    secret: row.secret,
    expiresAt: ms(row.expiresAt),
  };
}

/** Google channels expire after 7 days with no renewal API; Graph
 *  subscriptions after just under 7. Renew well before, and expect an overlap
 *  window where both the old and new channel deliver. */
export async function watchesExpiringBefore(
  directory: Directory,
  before: number,
  limit: number,
): Promise<WatchRoute[]> {
  const rows = await directory.watchChannel.findMany({
    where: { expiresAt: { lt: at(before) }, user: { deletedAt: null } },
    orderBy: { expiresAt: "asc" },
    take: limit,
  });

  return rows.map((row) => ({
    channelId: row.channelId,
    userId: row.userId,
    calendarId: row.calendarId,
    provider: row.provider as "google" | "microsoft",
    secret: row.secret,
    expiresAt: ms(row.expiresAt),
  }));
}

export async function unregisterWatch(
  directory: Directory,
  channelId: string,
): Promise<void> {
  await directory.watchChannel.deleteMany({ where: { channelId } });
}
