import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "fo_session";
const PUBLIC_ROUTES = new Set(["/login"]);

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
  const isPublicRoute = PUBLIC_ROUTES.has(pathname);

  if (!isPublicRoute && !hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isPublicRoute && hasSessionCookie) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
