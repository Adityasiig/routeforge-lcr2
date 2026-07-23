import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { DeckError } from "@/lib/lcr2";
import { createBuildJob } from "@/lib/build-jobs";
import { getVendorDeckPaths } from "@/lib/storage";
import { isDeckVariant, variantLabel } from "@/lib/variants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = randomUUID().slice(0, 8);
  try {
    let body: { variant?: unknown; markup?: unknown; singleVendor?: unknown; decimals?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      // handled below as invalid variant
    }
    const variant = body.variant;
    if (!isDeckVariant(variant)) throw new DeckError("Choose either the SD or Convo rate-deck variant.");

    const markupRaw = body.markup === undefined || body.markup === null ? "" : String(body.markup).trim();
    if (markupRaw !== "") {
      const numeric = Number(markupRaw);
      if (!Number.isFinite(numeric) || numeric < 0) throw new DeckError("Markup must be a finite, non-negative percentage.");
    }
    const singleVendor = body.singleVendor === "require2" ? "require2" : "fallback";
    const decimals = body.decimals === undefined || body.decimals === null || body.decimals === "" ? undefined : Number(body.decimals);

    const vendorPaths = await getVendorDeckPaths(variant);
    if (!vendorPaths.length) throw new DeckError(`Save at least one ${variantLabel(variant)} vendor deck first.`);

    const filename = `Vendor_LCR2_USA_${variantLabel(variant).toUpperCase()}_Rate_Deck.csv`;
    const job = await createBuildJob({
      variant,
      filename,
      kind: "vendor-lcr2",
      vendorPaths,
      options: { markup: markupRaw || undefined, singleVendor, decimals },
    });
    return NextResponse.json({ jobId: job.jobId, state: job.state }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof DeckError ? error.message : "The vendor LCR 2 deck could not be built.";
    if (!(error instanceof DeckError)) console.error(`[vendor-lcr2 ${requestId}]`, error);
    return NextResponse.json({ error: message, requestId }, { status: error instanceof DeckError ? 400 : 500 });
  }
}
