import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { deleteSession } from "@/lib/session";

/**
 * Fixes a redirect loop between proxy.ts and requireUser(): proxy.ts only
 * checks whether the session *cookie* is present (optimistic check, by
 * design — see its own comment and the Next.js Authentication guide,
 * "Optimistic checks with Proxy"), while requireUser() checks whether that
 * cookie's session still exists in the database (authoritative check).
 *
 * When the DB session is gone but the browser cookie survives (expired
 * server-side and cleaned up, deleted by an admin, or just a stale dev-DB
 * reset) those two checks permanently disagree: proxy.ts sees the cookie and
 * treats a bare /login hit as "already logged in," bouncing it back to
 * /dashboard; requireUser() then fails its DB check and sends the browser
 * back to /login. Neither layer is able to clear the cookie itself — proxy
 * doesn't touch the DB, and Next.js only allows `cookies().delete()` from a
 * Server Function or Route Handler, never during a Server Component render
 * (see node_modules/next/dist/docs/.../cookies.md, "Good to know") — so
 * requireUser() (called from Server Components like the (app) layout) can't
 * clear it either. Result: ERR_TOO_MANY_REDIRECTS.
 *
 * requireUser() redirects here instead of straight to /login whenever its DB
 * check fails. This route is under /api, which proxy.ts's matcher
 * deliberately excludes, so it can't itself get caught in the loop; it does
 * the one thing neither other layer can — actually delete the stale cookie —
 * then redirects to /login, which proxy.ts now correctly treats as a
 * logged-out request.
 */
export async function GET(request: NextRequest) {
  await deleteSession();

  const next = request.nextUrl.searchParams.get("next");
  const loginUrl = new URL("/login", request.url);
  if (next) loginUrl.searchParams.set("next", next);

  return NextResponse.redirect(loginUrl);
}
