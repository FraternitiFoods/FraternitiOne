import "server-only";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser, type CurrentUser } from "@/lib/session";

const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Same bcrypt mechanism as password hashing, kept as its own named function
 * (not a reused alias) so call sites read as what they are — a supervisor's
 * PIN (plan.md section 16), not a password.
 */
export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

/**
 * Use in Server Components, Server Actions, and Route Handlers that require
 * an authenticated user. Redirects rather than returning null — callers that
 * need to branch on "logged in or not" should use `getCurrentUser()`
 * directly instead.
 *
 * Redirects to /api/auth/clear-session, not /login directly — see that
 * route's comment. In short: this check can fail (cookie present, DB session
 * gone) in a way proxy.ts's own optimistic cookie check won't agree with,
 * and unlike a Route Handler, a Server Component render can't clear the
 * stale cookie itself; redirecting straight to /login here would leave that
 * cookie in place and loop forever against proxy.ts.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    // x-pathname is set by proxy.ts on every request — forwarded here so
    // clear-session knows whether to land back on /login or /m/login
    // (plan.md section 16): this function has no other way to see which
    // "side" of the app called it.
    const pathname = (await headers()).get("x-pathname");
    const clearSessionUrl = pathname
      ? `/api/auth/clear-session?next=${encodeURIComponent(pathname)}`
      : "/api/auth/clear-session";
    redirect(clearSessionUrl);
  }
  return user;
}
