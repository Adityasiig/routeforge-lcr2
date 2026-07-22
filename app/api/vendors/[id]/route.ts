import { NextResponse } from "next/server";
import { removeVendor } from "@/lib/storage";
import { DeckError } from "@/lib/lcr2";
import { isDeckVariant } from "@/lib/variants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const variant = new URL(request.url).searchParams.get("variant");
    if (!isDeckVariant(variant)) throw new DeckError("Choose either the SD or Convo rate-deck variant.");
    const { id } = await context.params;
    return NextResponse.json({ vendors: await removeVendor(variant, id) });
  } catch (error) {
    const message = error instanceof DeckError ? error.message : "Vendor deck could not be removed.";
    return NextResponse.json({ error: message }, { status: error instanceof DeckError ? 400 : 500 });
  }
}
