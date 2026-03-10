import { NextResponse } from "next/server";
import { reindexAll } from "@/lib/meilisearch/indexer";

const ADMIN_SECRET = process.env.ADMIN_SECRET || "dev-secret-change-me";

export async function POST(request: Request) {
  // Check authorization
  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("Starting reindex from PostgreSQL catalog...");
    const result = await reindexAll();

    return NextResponse.json({
      success: true,
      indexed: result.indexed,
      total: result.total,
      message: `Successfully indexed ${result.indexed} companies`,
    });
  } catch (error) {
    console.error("Reindex failed:", error);
    return NextResponse.json({
      success: false,
      error: "Indexing failed",
      message: String(error),
    }, { status: 500 });
  }
}

// Also support GET for health check of admin endpoint
export async function GET() {
  return NextResponse.json({
    endpoint: "/api/admin/reindex",
    method: "POST",
    auth: "Bearer token required",
    description: "Triggers a full reindex of the Meilisearch companies index from PostgreSQL",
  });
}
