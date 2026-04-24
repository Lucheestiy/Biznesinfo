import { NextResponse } from "next/server";
import { biznesinfoGetCatalogStats } from "@/lib/biznesinfo/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get("region");
  const data = await biznesinfoGetCatalogStats(region);
  return NextResponse.json(data);
}
