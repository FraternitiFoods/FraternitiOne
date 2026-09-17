import "server-only";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
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
    redirect("/api/auth/clear-session");
  }
  return user;
}
