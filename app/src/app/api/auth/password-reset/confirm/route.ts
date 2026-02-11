import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";
import { isAuthEnabled } from "@/lib/auth/currentUser";
import { resetPasswordByToken } from "@/lib/auth/passwordReset";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "CSRF" }, { status: 403 });
  }

  const ip = getClientIp(request);
  const rl = rateLimit({ key: `auth:reset_confirm:${ip}`, limit: 20, windowMs: 60 * 60_000 });
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

  const token = typeof (body as any)?.token === "string" ? (body as any).token : "";
  const newPassword = typeof (body as any)?.newPassword === "string" ? (body as any).newPassword : "";
  if (!token || newPassword.length < 8) {
    return NextResponse.json({ error: "BadRequest" }, { status: 400 });
  }

  try {
    const result = await resetPasswordByToken({ token, newPassword });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Password reset confirm failed:", error);
    return NextResponse.json({ error: "InternalError" }, { status: 500 });
  }
}

