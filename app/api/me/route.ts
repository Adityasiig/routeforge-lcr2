import { NextResponse } from "next/server";
import { resolveEntityFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns the logged-in entity's display identity for the UI (topbar label).
// Never exposes credentials — only the id, label, and username.
export async function GET(request: Request) {
  const account = await resolveEntityFromRequest(request);
  if (!account) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  return NextResponse.json(
    { id: account.id, label: account.label, username: account.username },
    { headers: { "Cache-Control": "no-store" } },
  );
}
