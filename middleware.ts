import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

// Paths reachable without a session: the login screen, its API, logout, and the
// container health check (Docker HEALTHCHECK must not require auth).
const PUBLIC_PATHS = ["/login", "/api/login", "/api/logout", "/api/health"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = await verifySession(token);
  if (user) return NextResponse.next();

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
