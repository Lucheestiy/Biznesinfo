import { NextResponse } from "next/server";
import { biznesinfoGetCompaniesSummary } from "@/lib/biznesinfo/store";
import { filterOutLiquidatedByKartoteka } from "@/lib/biznesinfo/kartoteka";

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
  const filtered = await filterOutLiquidatedByKartoteka(companies);
  return NextResponse.json({ companies: filtered.items });
}
