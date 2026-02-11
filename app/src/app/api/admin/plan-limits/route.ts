import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import { listPlanLimits, upsertPlanLimits } from "@/lib/auth/plans";

export const runtime = "nodejs";

function isAllowedPlan(plan: string): plan is "free" | "paid" | "partner" {
  return plan === "free" || plan === "paid" || plan === "partner";
}

export async function GET() {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const limits = await listPlanLimits();
  return NextResponse.json(
    { limits },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "CSRF" }, { status: 403 });
  }

  const ip = getClientIp(request);
  const rl = rateLimit({ key: `admin:plan-limits:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RateLimited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "BadRequest" }, { status: 400 });
  }

  const plan = typeof (body as any)?.plan === "string" ? (body as any).plan : "";
  const aiRequestsPerDayRaw = (body as any)?.aiRequestsPerDay;
  const aiRequestsPerDay = typeof aiRequestsPerDayRaw === "number" ? aiRequestsPerDayRaw : Number(aiRequestsPerDayRaw);

  if (!isAllowedPlan(plan)) return NextResponse.json({ error: "BadRequest" }, { status: 400 });
  if (!Number.isFinite(aiRequestsPerDay) || aiRequestsPerDay < 0) {
    return NextResponse.json({ error: "BadRequest" }, { status: 400 });
  }

  await upsertPlanLimits({ plan, aiRequestsPerDay });

  return NextResponse.json({ success: true });
}

