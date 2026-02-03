import { NextResponse } from "next/server";
import { meiliSuggest, isMeiliHealthy } from "@/lib/meilisearch";
import { biznesinfoSuggest } from "@/lib/biznesinfo/store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";
  const region = searchParams.get("region") || null;
  const limit = parseInt(searchParams.get("limit") || "8", 10);

  const safeLimit = Number.isFinite(limit) ? limit : 8;

  // Try Meilisearch first
  try {
    if (await isMeiliHealthy()) {
      const data = await meiliSuggest({
        query,
        region,
        limit: safeLimit,
      });
      return NextResponse.json(data);
    }
  } catch (error) {
    console.error("Meilisearch error, falling back to in-memory suggest:", error);
  }

  // Fallback to in-memory suggest
  const data = await biznesinfoSuggest({
    query,
    region,
    limit: safeLimit,
  });
  return NextResponse.json(data);
}
