import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { randomBytes, createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { Role, Department } from "@prisma/client";

const COOKIE_NAME = "fo_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Creates a database-backed session (decision: session-based auth, not JWT —
 * plan.md section 5) and sets the session cookie. The cookie carries an
 * opaque random token; only its hash is stored in the database, so a DB leak
 * alone can't be replayed as a valid session cookie.
 */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

/** Deletes the current session, both the cookie and its database row. */
export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (token) {
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  cookieStore.delete(COOKIE_NAME);
}

export type CurrentUser = {
  id: string;
  name: string;
  /// Nullable as of plan.md section 16 (2026-09-24) — a phone+PIN
  /// SITE_SUPERVISOR login may have no email on file.
  email: string | null;
  role: Role;
  department: Department | null;
};

/**
 * Data Access Layer entry point (see Next.js authentication guide, "Creating
 * a Data Access Layer"): the one place that turns a session cookie into a
 * verified user. `cache()` memoizes this per server render pass so multiple
 * calls in one request don't each hit the database.
 *
 * Returns `null` rather than redirecting — callers decide whether the
 * absence of a session is an error (see `requireUser` below) or something to
 * render around (e.g. a public page's nav bar).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) {
    if (session) {
      // Expired — clean it up so it doesn't linger in the table.
      await db.session.delete({ where: { id: session.id } }).catch(() => {});
    }
    return null;
  }

  if (!session.user.isActive) return null;

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
    department: session.user.department,
  };
});
