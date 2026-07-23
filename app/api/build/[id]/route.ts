import { NextResponse } from "next/server";
import { DeckError } from "@/lib/lcr2";
import { getBuildJobStatus, getCompletedBuild } from "@/lib/build-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const wantsDownload = new URL(request.url).searchParams.get("download") === "1";
    if (wantsDownload) {
      const { status, csv } = await getCompletedBuild(id);
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${status.filename}"`,
          "Cache-Control": "no-store",
          "X-LCR-Filename": status.filename,
        },
      });
    }
    return NextResponse.json(await getBuildJobStatus(id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof DeckError ? error.message : "The build job could not be read.";
    return NextResponse.json({ error: message }, { status: error instanceof DeckError ? 400 : 500 });
  }
}
