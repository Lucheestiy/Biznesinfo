import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { rateLimit } from "@/lib/security/rateLimit";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import { getDbPool } from "@/lib/auth/db";

export const runtime = "nodejs";

type FeedbackRating = "up" | "down";
type FeedbackReason = "hallucination" | "format" | "too_long" | "wrong_language" | "too_generic" | "other";

const ALLOWED_REASONS = new Set<FeedbackReason>([
  "hallucination",
  "format",
  "too_long",
  "wrong_language",
  "too_generic",
  "other",
]);

export async function POST(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "CSRF" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit({ key: `ai:feedback:${user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RateLimited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "BadRequest" }, { status: 400 });
  }

  const requestId = typeof (body as any)?.requestId === "string" ? (body as any).requestId.trim() : "";
  const ratingRaw = typeof (body as any)?.rating === "string" ? (body as any).rating.trim() : "";
  const reasonRaw = typeof (body as any)?.reason === "string" ? (body as any).reason.trim() : "";

  if (!requestId) return NextResponse.json({ error: "BadRequest" }, { status: 400 });
  if (ratingRaw !== "up" && ratingRaw !== "down") return NextResponse.json({ error: "BadRequest" }, { status: 400 });

  const rating = ratingRaw as FeedbackRating;
  const reason = reasonRaw && ALLOWED_REASONS.has(reasonRaw as FeedbackReason) ? (reasonRaw as FeedbackReason) : null;

  const feedback = {
    rating,
    reason,
    createdAt: new Date().toISOString(),
  };

  const pool = getDbPool();
  const res = await pool.query<{ id: string }>(
    `
      UPDATE ai_requests
      SET payload = jsonb_set(
        COALESCE(payload, '{}'::jsonb),
        '{_assistant,feedback}',
        $3::jsonb,
        true
      )
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `,
    [requestId, user.id, JSON.stringify(feedback)],
  );

  if (!res.rows[0]) return NextResponse.json({ error: "NotFound" }, { status: 404 });
  return NextResponse.json({ success: true, feedback });
}

