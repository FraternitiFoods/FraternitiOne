import "server-only";

import { randomBytes, createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { PasswordResetPurpose } from "@prisma/client";

const INVITE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RESET_DURATION_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues a new invite/reset link (raw token, only its hash is stored — same
 * discipline as Session, see lib/session.ts). Any of the user's existing
 * unused tokens for the same purpose are deleted first, so an old email
 * (e.g. a leaked or superseded invite) stops being a live link once a new
 * one is issued.
 */
export async function createPasswordResetToken(
  userId: string,
  purpose: PasswordResetPurpose
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const duration = purpose === "INVITE" ? INVITE_DURATION_MS : RESET_DURATION_MS;

  await db.$transaction([
    db.passwordResetToken.deleteMany({
      where: { userId, purpose, usedAt: null },
    }),
    db.passwordResetToken.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        purpose,
        expiresAt: new Date(Date.now() + duration),
      },
    }),
  ]);

  return token;
}

export type ValidatedResetToken = {
  id: string;
  userId: string;
  purpose: PasswordResetPurpose;
  userName: string;
  /// Nullable as of plan.md section 16 — a supervisor account may have none.
  /// In practice this flow is only reachable for email-based accounts today
  /// (invite/reset emails require an email to send to), but the type must
  /// match the underlying (now-nullable) User.email column.
  userEmail: string | null;
};

/** Read-only check — does NOT mark the token used. See `consumePasswordResetToken`. */
export async function validatePasswordResetToken(
  token: string
): Promise<ValidatedResetToken | null> {
  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { name: true, email: true, isActive: true } } },
  });

  if (!record || record.usedAt || record.expiresAt < new Date() || !record.user.isActive) {
    return null;
  }

  return {
    id: record.id,
    userId: record.userId,
    purpose: record.purpose,
    userName: record.user.name,
    userEmail: record.user.email,
  };
}

/**
 * Atomically marks a token used, guarded by `usedAt: null` in the `where`
 * clause so two concurrent submits of the same link can't both succeed —
 * whichever loses the race gets `count: 0` and reports the link as already
 * used. Call this from the server action that actually sets the password,
 * not from a page render (see `validatePasswordResetToken` for a read-only
 * check safe to call during render).
 */
export async function consumePasswordResetToken(tokenId: string): Promise<boolean> {
  const result = await db.passwordResetToken.updateMany({
    where: { id: tokenId, usedAt: null },
    data: { usedAt: new Date() },
  });
  return result.count === 1;
}
