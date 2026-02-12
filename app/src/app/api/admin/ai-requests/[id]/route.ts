import { NextResponse } from "next/server";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import { getDbPool } from "@/lib/auth/db";

export const runtime = "nodejs";

type WebsiteScanSummary = {
  attempted: boolean;
  targetCount: number;
  insightCount: number;
  depth: {
    deepScanUsed: boolean;
    deepScanUsedCount: number;
    scannedPagesTotal: number;
  };
};

function parseWebsiteScanSummary(payloadRaw: unknown): WebsiteScanSummary | null {
  if (!payloadRaw || typeof payloadRaw !== "object" || Array.isArray(payloadRaw)) return null;
  const payload = payloadRaw as Record<string, unknown>;
  const assistant =
    payload._assistant && typeof payload._assistant === "object" && !Array.isArray(payload._assistant)
      ? (payload._assistant as Record<string, unknown>)
      : null;
  if (!assistant) return null;
  const request =
    assistant.request && typeof assistant.request === "object" && !Array.isArray(assistant.request)
      ? (assistant.request as Record<string, unknown>)
      : null;
  if (!request) return null;

  const depthRaw =
    request.websiteScanDepth && typeof request.websiteScanDepth === "object" && !Array.isArray(request.websiteScanDepth)
      ? (request.websiteScanDepth as Record<string, unknown>)
      : null;

  const targetCount =
    typeof request.websiteScanTargetCount === "number" ? Math.max(0, Math.floor(request.websiteScanTargetCount)) : 0;
  const insightCount =
    typeof request.websiteScanInsightCount === "number" ? Math.max(0, Math.floor(request.websiteScanInsightCount)) : 0;
  const attempted = Boolean(request.websiteScanAttempted);

  const deepScanUsed = Boolean(depthRaw?.deepScanUsed);
  const deepScanUsedCount = typeof depthRaw?.deepScanUsedCount === "number" ? Math.max(0, Math.floor(depthRaw.deepScanUsedCount)) : 0;
  const scannedPagesTotal = typeof depthRaw?.scannedPagesTotal === "number" ? Math.max(0, Math.floor(depthRaw.scannedPagesTotal)) : 0;

  if (!attempted && targetCount === 0 && insightCount === 0 && !deepScanUsed && deepScanUsedCount === 0 && scannedPagesTotal === 0) {
    return null;
  }

  return {
    attempted,
    targetCount,
    insightCount,
    depth: {
      deepScanUsed,
      deepScanUsedCount,
      scannedPagesTotal,
    },
  };
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = await ctx.params;
  const id = (params?.id || "").trim();
  if (!id) return NextResponse.json({ error: "BadRequest" }, { status: 400 });

  const pool = getDbPool();
  const res = await pool.query<{
    id: string;
    user_id: string;
    email: string;
    name: string | null;
    plan: string;
    company_id: string | null;
    message: string;
    created_at: Date;
    payload: any;
  }>(
    `
      SELECT r.id, r.user_id, r.company_id, r.message, r.created_at, r.payload,
             u.email, u.name, u.plan
      FROM ai_requests r
      JOIN users u ON u.id = r.user_id
      WHERE r.id = $1
      LIMIT 1
    `,
    [id],
  );

  const row = res.rows[0];
  if (!row) return NextResponse.json({ error: "NotFound" }, { status: 404 });
  const payload = row.payload ?? null;
  const websiteScan = parseWebsiteScanSummary(payload);

  return NextResponse.json(
    {
      success: true,
      request: {
        id: row.id,
        createdAt: row.created_at,
        user: { id: row.user_id, email: row.email, name: row.name, plan: row.plan },
        companyId: row.company_id,
        message: row.message,
        websiteScan,
        payload,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
