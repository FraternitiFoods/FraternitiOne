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
 * an authenticated user. Redirects to /login rather than returning null —
 * callers that need to branch on "logged in or not" should use
 * `getCurrentUser()` directly instead.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
