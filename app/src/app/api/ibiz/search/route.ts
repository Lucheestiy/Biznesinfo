import { NextResponse } from "next/server";
import { meiliSearch, isMeiliHealthy } from "@/lib/meilisearch";
import { ibizSearch } from "@/lib/ibiz/store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";
  const keywords = searchParams.get("keywords") || null;
  const region = searchParams.get("region") || null;
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const limit = parseInt(searchParams.get("limit") || "24", 10);

  const safeOffset = Number.isFinite(offset) ? offset : 0;
  const safeLimit = Number.isFinite(limit) ? limit : 24;

  // Try Meilisearch first
  try {
    if (await isMeiliHealthy()) {
      const data = await meiliSearch({
        query,
        keywords,
        region,
        offset: safeOffset,
        limit: safeLimit,
      });
      return NextResponse.json(data);
    }
  } catch (error) {
    console.error("Meilisearch error, falling back to in-memory search:", error);
  }

  // Fallback to in-memory search
  const data = await ibizSearch({
    query,
    region,
    offset: safeOffset,
    limit: safeLimit,
  });
  return NextResponse.json(data);
}
