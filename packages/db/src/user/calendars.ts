import { at, atOrNull, ms, msOrNull, type UserDatabase } from "../client";

/**
 * Calendar connections, tokens and sync state.
 *
 * No `userId` anywhere: this database belongs to exactly one person, so
 * filtering by user would be filtering by "the only one". A query here cannot
 * cross a user boundary even by mistake.
 */

export interface ConnectionInput {
  provider: "google" | "microsoft";
  providerAccountId: string;
  email: string;
  scopes: string;
}

export async function upsertConnection(
  db: UserDatabase,
  input: ConnectionInput,
  now: number,
  newId: () => string,
): Promise<string> {
  const connection = await db.calendarConnection.upsert({
    where: {
      provider_providerAccountId: {
        provider: input.provider,
        providerAccountId: input.providerAccountId,
      },
    },
    update: { status: "active", scopes: input.scopes, email: input.email },
    create: { id: newId(), ...input, createdAt: at(now) },
    select: { id: true },
  });
  return connection.id;
}

export function listConnections(db: UserDatabase) {
  return db.calendarConnection.findMany();
}

/** A connection whose token no longer works. The UI surfaces this as
 *  "reconnect your calendar" — a silently dead connection is fatal to trust. */
export async function markNeedsReauth(
  db: UserDatabase,
  connectionId: string,
): Promise<void> {
  await db.calendarConnection.update({
    where: { id: connectionId },
    data: { status: "needs_reauth" },
  });
}

/* ── Encrypted tokens ────────────────────────────────────────────────────── */

export interface StoredToken {
  accessTokenCiphertext: string;
  accessTokenIv: string;
  refreshTokenCiphertext: string | null;
  refreshTokenIv: string | null;
  keyVersion: number;
  expiresAt: number;
}

export async function saveTokens(
  db: UserDatabase,
  connectionId: string,
  token: StoredToken,
  now: number,
): Promise<void> {
  const data = {
    accessTokenCiphertext: token.accessTokenCiphertext,
    accessTokenIv: token.accessTokenIv,
    refreshTokenCiphertext: token.refreshTokenCiphertext,
    refreshTokenIv: token.refreshTokenIv,
    keyVersion: token.keyVersion,
    expiresAt: at(token.expiresAt),
    updatedAt: at(now),
  };

  await db.oAuthToken.upsert({
    where: { connectionId },
    update: data,
    create: { connectionId, ...data },
  });
}

export async function getTokens(db: UserDatabase, connectionId: string) {
  const row = await db.oAuthToken.findUnique({ where: { connectionId } });
  return row ? { ...row, expiresAt: ms(row.expiresAt) } : null;
}

/* ── Calendars ───────────────────────────────────────────────────────────── */

export interface CalendarInput {
  connectionId: string;
  providerCalendarId: string;
  name: string;
  timeZone?: string | null;
  isPrimary?: boolean;
  accessRole?: string | null;
}

export async function upsertCalendars(
  db: UserDatabase,
  inputs: readonly CalendarInput[],
  now: number,
  newId: () => string,
): Promise<string[]> {
  const ids: string[] = [];

  for (const input of inputs) {
    const row = await db.calendar.upsert({
      where: {
        connectionId_providerCalendarId: {
          connectionId: input.connectionId,
          providerCalendarId: input.providerCalendarId,
        },
      },
      // Name and access role change upstream; selection is the user's and must
      // survive a resync, so it is deliberately not in the update.
      update: { name: input.name, accessRole: input.accessRole ?? null },
      create: {
        id: newId(),
        connectionId: input.connectionId,
        providerCalendarId: input.providerCalendarId,
        name: input.name,
        timeZone: input.timeZone ?? null,
        isPrimary: input.isPrimary ?? false,
        accessRole: input.accessRole ?? null,
        createdAt: at(now),
      },
      select: { id: true },
    });
    ids.push(row.id);
  }

  return ids;
}

export function listCalendars(db: UserDatabase, onlySelected = false) {
  return db.calendar.findMany({
    where: onlySelected ? { isSelected: true } : {},
  });
}

export async function setCalendarSelected(
  db: UserDatabase,
  calendarId: string,
  isSelected: boolean,
): Promise<void> {
  await db.calendar.update({ where: { id: calendarId }, data: { isSelected } });
}

/* ── Sync state ──────────────────────────────────────────────────────────── */

export async function getSyncState(db: UserDatabase, calendarId: string) {
  const row = await db.calendarSyncState.findUnique({ where: { calendarId } });
  if (!row) return undefined;

  // Same boundary rule as everywhere: instants leave here as epoch-ms numbers.
  return {
    ...row,
    lastFullSyncAt: msOrNull(row.lastFullSyncAt),
    lastIncrementalAt: msOrNull(row.lastIncrementalAt),
    windowRebasedAt: msOrNull(row.windowRebasedAt),
    watchExpiresAt: msOrNull(row.watchExpiresAt),
  };
}

export interface SyncStatePatch {
  syncToken?: string | null;
  deltaLink?: string | null;
  lastFullSyncAt?: number | null;
  lastIncrementalAt?: number | null;
  windowRebasedAt?: number | null;
  watchChannelId?: string | null;
  watchResourceId?: string | null;
  watchSecret?: string | null;
  watchExpiresAt?: number | null;
  consecutiveFailures?: number;
  syncGeneration?: number;
}

const INSTANT_FIELDS = new Set([
  "lastFullSyncAt",
  "lastIncrementalAt",
  "windowRebasedAt",
  "watchExpiresAt",
]);

export async function saveSyncState(
  db: UserDatabase,
  calendarId: string,
  patch: SyncStatePatch,
): Promise<void> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    data[key] = INSTANT_FIELDS.has(key)
      ? atOrNull(value as number | null)
      : value;
  }

  await db.calendarSyncState.upsert({
    where: { calendarId },
    update: data,
    create: { calendarId, ...data },
  });
}

/** Everything one sync job needs, in a single query rather than three. */
export async function getCalendarForSync(db: UserDatabase, calendarId: string) {
  const row = await db.calendar.findUnique({
    where: { id: calendarId },
    select: {
      id: true,
      connectionId: true,
      providerCalendarId: true,
      connection: { select: { provider: true, status: true } },
    },
  });
  if (!row) return undefined;

  return {
    calendarId: row.id,
    connectionId: row.connectionId,
    providerCalendarId: row.providerCalendarId,
    provider: row.connection.provider as "google" | "microsoft",
    connectionStatus: row.connection.status,
  };
}
