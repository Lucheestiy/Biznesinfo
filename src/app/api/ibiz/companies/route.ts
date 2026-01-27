import { NextResponse } from "next/server";
import { ibizGetCompaniesSummary } from "@/lib/ibiz/store";

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

  const companies = await ibizGetCompaniesSummary(ids);
  return NextResponse.json({ companies });
}

