import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { rateLimit } from "@/lib/security/rateLimit";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import { getUserEffectivePlan } from "@/lib/auth/plans";
import { resetAiUsage } from "@/lib/auth/aiUsage";

export const runtime = "nodejs";

function isResetEnabled(request: Request): boolean {
  const env = (process.env.AI_USAGE_RESET_ENABLED || "").trim().toLowerCase();
  if (env === "1" || env === "true" || env === "yes") return true;

  const host = (request.headers.get("host") || "").toLowerCase();
  if (host.includes("develop")) return true;

  const publicBase = (process.env.PUBLIC_BASE_URL || "").toLowerCase();
  if (publicBase.includes("develop")) return true;

  return false;
}

export async function POST(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });
  if (!isResetEnabled(request)) return NextResponse.json({ error: "FeatureDisabled" }, { status: 404 });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "CSRF" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit({ key: `ai:usage-reset:${user.id}`, limit: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RateLimited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const usage = await resetAiUsage({ userId: user.id });
  const effective = await getUserEffectivePlan(user);

  return NextResponse.json({
    success: true,
    day: usage.day,
    used: usage.used,
    limit: effective.aiRequestsPerDay,
    message: "AI prompt counter reset for today.",
  });
}
