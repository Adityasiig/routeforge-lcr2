import { NextResponse } from "next/server";
import { DeckError } from "@/lib/lcr2";
import { listVendors, replaceVendors } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ vendors: await listVendors() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Saved vendor decks could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
    if (!files.length) return NextResponse.json({ error: "Choose at least one vendor CSV." }, { status: 400 });
    if (files.length > 100) return NextResponse.json({ error: "A maximum of 100 vendor decks can be saved at once." }, { status: 400 });
    const decks = await Promise.all(files.map(async (file) => {
      if (!file.name.toLowerCase().endsWith(".csv")) throw new DeckError(`${file.name} is not a CSV file.`);
      if (file.size > 100 * 1024 * 1024) throw new DeckError(`${file.name} exceeds the 100 MB limit.`);
      return { name: file.name, size: file.size, text: await file.text() };
    }));
    return NextResponse.json({ vendors: await replaceVendors(decks) });
  } catch (error) {
    const message = error instanceof DeckError ? error.message : "Vendor decks could not be saved.";
    return NextResponse.json({ error: message }, { status: error instanceof DeckError ? 400 : 500 });
  }
}
