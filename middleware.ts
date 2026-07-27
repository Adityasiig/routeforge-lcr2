import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, getAccount, verifySession } from "@/lib/auth";

// Paths reachable without a session: the login screen, its API, logout, and the
// container health check (Docker HEALTHCHECK must not require auth).
const PUBLIC_PATHS = ["/login", "/api/login", "/api/logout", "/api/health"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  // A session is valid only if it verifies AND still maps to a known entity
  // (so a removed or renamed account is treated as logged out).
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const entityId = await verifySession(token);
  if (entityId && getAccount(entityId)) return NextResponse.next();

  // Unauthenticated: JSON 401 for API calls, redirect to /login for pages.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  if (pathname && pathname !== "/") loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

// Run on everything except Next internals and static asset files.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml|woff2?)$).*)"],
};
