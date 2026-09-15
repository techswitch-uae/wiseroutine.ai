import { at, type Directory, directoryTransaction } from "../client";

export type HandoffResult =
  | { status: "pending" | "expired" }
  | { status: "ready"; token: string }
  | { status: "failed"; reason: string };

export async function createSocialHandoff(
  db: Directory,
  input: {
    id: string;
    claimHash: string;
    provider: string;
    now: number;
  },
): Promise<void> {
  // Indexed cleanup bounds retention, including attempts whose app never polls.
  await db.socialHandoff.deleteMany({
    where: { expiresAt: { lte: at(input.now) } },
  });
  await db.socialHandoff.create({
    data: {
      id: input.id,
      claimHash: input.claimHash,
      provider: input.provider,
      expiresAt: at(input.now + 600_000),
      createdAt: at(input.now),
    },
  });
}

/** A browser can start this attempt once. The proof is minted by the server,
 * then carried only in Better Auth's server-owned, browser-bound OAuth state. */
export function beginSocialHandoff(
  db: Directory,
  id: string,
  proofHash: string,
  now: number,
) {
  return directoryTransaction(db, async (tx) => {
    const row = await tx.socialHandoff.findUnique({ where: { id } });
    if (row?.status !== "pending" || row.expiresAt.getTime() <= now)
      return null;
    await tx.socialHandoff.update({
      where: { id },
      data: { status: "started", proofHash },
    });
    return { provider: row.provider };
  });
}

/** Conditional transition: expiry, another callback or a consumed claim can
 * never resurrect an attempt. Call only after verified OAuth, not getSession. */
export async function completeSocialHandoff(
  db: Directory,
  input: {
    id: string;
    proofHash: string;
    provider: string;
    now: number;
    result:
      | { status: "ready"; token: string }
      | { status: "failed"; reason: string };
  },
): Promise<boolean> {
  const updated = await db.socialHandoff.updateMany({
    where: {
      id: input.id,
      proofHash: input.proofHash,
      provider: input.provider,
      status: "started",
      expiresAt: { gt: at(input.now) },
    },
    data: {
      ...input.result,
      expiresAt: at(input.now + 120_000),
      proofHash: null,
    },
  });
  return updated.count === 1;
}

/** The writer lock is acquired before reading. Concurrent claims cannot both
 * receive a token; deletion and the selected result commit together. */
export function claimSocialHandoff(
  db: Directory,
  claimHash: string,
  now: number,
): Promise<HandoffResult> {
  return directoryTransaction(db, async (tx) => {
    const row = await tx.socialHandoff.findUnique({ where: { claimHash } });
    if (!row) return { status: "expired" };
    if (
      row.expiresAt.getTime() > now &&
      ["pending", "started"].includes(row.status)
    )
      return { status: "pending" };
    await tx.socialHandoff.delete({ where: { id: row.id } });
    if (row.expiresAt.getTime() <= now) return { status: "expired" };
    if (row.status === "ready" && row.token)
      return { status: "ready", token: row.token };
    if (row.status === "failed" && row.reason)
      return { status: "failed", reason: row.reason };
    return { status: "expired" };
  });
}
