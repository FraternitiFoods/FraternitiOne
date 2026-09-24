import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "fo_session";
// /m/login is the phone+PIN equivalent of /login (plan.md section 16) — its
// own public entry point, since a SITE_SUPERVISOR session has nothing to do
// with the desktop email+password one.
const PUBLIC_ROUTES = new Set(["/login", "/forgot-password", "/m/login"]);
// /reset-password/[token] is dynamic, so it's matched by prefix below rather
// than added to the exact-match PUBLIC_ROUTES set.
const PUBLIC_ROUTE_PREFIXES = ["/reset-password/"];

/**
 * Optimistic auth gate only — checks whether the session cookie is present,
 * not whether it's still valid in the database. Proxy runs on every request
 * (including prefetches), so it deliberately avoids a DB round trip here;
 * the authoritative check is `requireUser()` (see lib/auth.ts), which every
 * protected Server Component/Action calls regardless of what happens here.
 * See the Next.js Authentication guide, "Optimistic checks with Proxy".
 */
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const isPublicRoute =
    PUBLIC_ROUTES.has(pathname) ||
    PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (!isPublicRoute && !hasSessionCookie) {
    const loginPath = pathname.startsWith("/m") ? "/m/login" : "/login";
    const loginUrl = new URL(loginPath, request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Reset-password links are capability tokens (e.g. an admin's own invite
  // link, opened in the same browser they're already signed in on) — they
  // must stay reachable regardless of an existing session, unlike /login and
  // /forgot-password which redirect an already-authenticated visitor away.
  const isResetPasswordRoute = pathname.startsWith("/reset-password/");

  if (isPublicRoute && hasSessionCookie && !isResetPasswordRoute) {
    const destination = pathname.startsWith("/m") ? "/m" : "/dashboard";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  // Forwarded so requireUser() (lib/auth.ts) can tell, on its own DB-check
  // failure, whether to bounce back to /login or /m/login — it has no other
  // way to know which "side" of the app a Server Component render is on.
  const headers = new Headers(request.headers);
  headers.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
