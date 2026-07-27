import { NextResponse } from "next/server";
import { DeckError } from "@/lib/lcr2";
import { addVendors, listVendors, replaceVendors } from "@/lib/storage";
import { isDeckVariant } from "@/lib/variants";
import { resolveEntityFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const account = await resolveEntityFromRequest(request);
    if (!account) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const variant = new URL(request.url).searchParams.get("variant");
    if (!isDeckVariant(variant)) throw new DeckError("Choose either the SD or Convo rate-deck variant.");
    return NextResponse.json({ vendors: await listVendors(account.id, variant) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof DeckError ? error.message : "Saved vendor decks could not be loaded.";
    return NextResponse.json({ error: message }, { status: error instanceof DeckError ? 400 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const account = await resolveEntityFromRequest(request);
    if (!account) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const form = await request.formData();
    const variant = form.get("variant");
    if (!isDeckVariant(variant)) throw new DeckError("Choose either the SD or Convo rate-deck variant.");
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
    if (!files.length) return NextResponse.json({ error: "Choose at least one vendor CSV." }, { status: 400 });

    // Per-file pre-checks (extension / size). A file that fails is skipped with
    // a reason rather than aborting the whole upload; good files continue on to
    // content validation and are saved.
    const preSkipped: { name: string; reason: string }[] = [];
    const decks: { name: string; size: number; text: string }[] = [];
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        preSkipped.push({ name: file.name, reason: "Not a .csv file." });
        continue;
      }
      if (file.size > 100 * 1024 * 1024) {
        preSkipped.push({ name: file.name, reason: "Larger than the 100 MB per-file limit." });
        continue;
      }
      decks.push({ name: file.name, size: file.size, text: await file.text() });
    }

    const operation = form.get("operation") === "replace" ? "replace" : "add";
    const result = operation === "replace"
      ? await replaceVendors(account.id, variant, decks)
      : await addVendors(account.id, variant, decks);
    return NextResponse.json({
      vendors: result.vendors,
      operation,
      saved: result.saved,
      skipped: [...preSkipped, ...result.skipped],
    });
  } catch (error) {
    const message = error instanceof DeckError ? error.message : "Vendor decks could not be saved.";
    return NextResponse.json({ error: message }, { status: error instanceof DeckError ? 400 : 500 });
  }
}
