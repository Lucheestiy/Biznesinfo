import { NextResponse } from "next/server";
import { ensureAuthDb } from "@/lib/auth/migrations";

const ADMIN_SECRET = process.env.ADMIN_SECRET || "dev-secret-change-me";

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await ensureAuthDb();
    return NextResponse.json({
      success: true,
      applied: result.applied,
      appliedCount: result.applied.length,
    });
  } catch (error) {
    console.error("Auth DB migrate failed:", error);
    return NextResponse.json({
      success: false,
      error: "Migrate failed",
      message: String(error),
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/admin/migrate",
    method: "POST",
    auth: "Bearer token required",
    description: "Applies DB migrations required for auth/cabinet/AI limits",
  });
}
