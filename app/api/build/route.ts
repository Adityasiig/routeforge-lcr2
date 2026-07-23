import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { buildLcr2Deck, DeckError } from "@/lib/lcr2";
import { readVendorDecks } from "@/lib/storage";
import { parseTrafficUpload } from "@/lib/traffic";
import { isDeckVariant, variantLabel } from "@/lib/variants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFilename(name: string, variant: "sd" | "convo") {
  const stem = name.replace(/\.csv$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "Customer";
  return `${stem}_USA_${variantLabel(variant).toUpperCase()}_LCR2_Rate_Deck.csv`;
}

export async function POST(request: Request) {
  const requestId = randomUUID().slice(0, 8);
  try {
    const form = await request.formData();
    const variant = form.get("variant");
    if (!isDeckVariant(variant)) throw new DeckError("Choose either the SD or Convo rate-deck variant.");
    const customer = form.get("customer");
    if (!(customer instanceof File)) throw new DeckError("Choose the customer CSV rate deck.");
    if (!customer.name.toLowerCase().endsWith(".csv")) throw new DeckError("The customer deck must be a CSV file.");
    if (customer.size > 100 * 1024 * 1024) throw new DeckError("The customer deck exceeds the 100 MB limit.");
    const traffic = form.get("traffic");
    if (!(traffic instanceof File)) throw new DeckError("Choose the current traffic Excel or CSV file.");
    if (traffic.size > 100 * 1024 * 1024) throw new DeckError("The current traffic file exceeds the 100 MB limit.");
    const markup = String(form.get("markup") ?? "").trim();
    if (!markup) throw new DeckError("Enter the markup percentage for new codes.");
    const singleVendor = form.get("singleVendor") === "require2" ? "require2" : "fallback";
    const decimalValue = form.get("decimals");
    const decimals = decimalValue === null || decimalValue === "" ? undefined : Number(decimalValue);
    const [vendorTexts, trafficRows] = await Promise.all([readVendorDecks(variant), parseTrafficUpload(traffic)]);
    const result = buildLcr2Deck(await customer.text(), vendorTexts, { markup, singleVendor, decimals }, trafficRows);
    const filename = safeFilename(customer.name, variant);
    return new Response(result.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-LCR-Filename": filename,
        "X-LCR-Summary": Buffer.from(JSON.stringify(result.summary), "utf8").toString("base64"),
      },
    });
  } catch (error) {
    const message = error instanceof DeckError ? error.message : "The LCR 2 deck could not be built.";
    if (!(error instanceof DeckError)) console.error(`[LCR2 build ${requestId}]`, error);
    return NextResponse.json({ error: message, requestId }, { status: error instanceof DeckError ? 400 : 500 });
  }
}
