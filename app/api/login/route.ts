import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, authConfigured, signSession, verifyCredentials } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // ignore — handled as invalid below
  }
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!authConfigured()) {
    return NextResponse.json(
      { error: "Login is not configured on the server. Set AUTH_ACCOUNTS (or AUTH_USERNAME/AUTH_PASSWORD) and AUTH_SECRET." },
      { status: 500 },
    );
  }
  const account = username && password ? await verifyCredentials(username, password) : null;
  if (!account) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  const token = await signSession(account.id);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
