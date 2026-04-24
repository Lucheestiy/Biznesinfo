import { NextResponse } from "next/server";
import { biznesinfoGetCompaniesSummary } from "@/lib/biznesinfo/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idsRaw = (searchParams.get("ids") || "").trim();
  if (!idsRaw) {
    return NextResponse.json({ companies: [] });
  }

  const ids = idsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);

  const companies = await biznesinfoGetCompaniesSummary(ids);
  // This endpoint serves explicit user-picked IDs (favorites, shortlist, header menu).
  // Do not silently hide cards here even if they are later flagged by liquidation filters.
  return NextResponse.json({ companies });
}
