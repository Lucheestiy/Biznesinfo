import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import { getUserEffectivePlan } from "@/lib/auth/plans";
import { consumeAiRequest } from "@/lib/auth/aiUsage";
import { createAiRequest } from "@/lib/ai/requests";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "CSRF" }, { status: 403 });
  }

  const ip = getClientIp(request);
  const rl = rateLimit({ key: `ai:req:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RateLimited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "BadRequest" }, { status: 400 });
  }

  const message = typeof (body as any)?.message === "string" ? (body as any).message : "";
  const companyId = typeof (body as any)?.companyId === "string" ? (body as any).companyId : null;
  const payload = (body as any)?.payload ?? null;
  if (!message.trim()) return NextResponse.json({ error: "BadRequest" }, { status: 400 });

  const effective = await getUserEffectivePlan(user);
  const quota = await consumeAiRequest({ userId: user.id, limitPerDay: effective.aiRequestsPerDay });
  if (!quota.ok) {
    return NextResponse.json(
      { error: "QuotaExceeded", day: quota.day, used: quota.used, limit: quota.limit, plan: effective.plan },
      { status: 429 },
    );
  }

  const created = await createAiRequest({
    userId: user.id,
    companyId: companyId?.trim() || null,
    message: message.trim().slice(0, 5000),
    payload,
  });

  return NextResponse.json({
    success: true,
    requestId: created.id,
    day: quota.day,
    used: quota.used,
    limit: quota.limit,
    plan: effective.plan,
  });
}
