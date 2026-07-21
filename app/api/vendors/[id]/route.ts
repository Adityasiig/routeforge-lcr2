import { NextResponse } from "next/server";
import { removeVendor } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ vendors: await removeVendor(id) });
  } catch {
    return NextResponse.json({ error: "Vendor deck could not be removed." }, { status: 500 });
  }
}
