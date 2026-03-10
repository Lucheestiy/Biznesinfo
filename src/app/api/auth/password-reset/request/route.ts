import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";
import { isAuthEnabled } from "@/lib/auth/currentUser";
import { createPasswordResetToken } from "@/lib/auth/passwordReset";

export const runtime = "nodejs";

function isDebugReturnEnabled(): boolean {
  const raw = (process.env.AUTH_DEBUG_RESET_TOKENS || "").trim();
  if (!raw) return false;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

async function sendResetEmail(params: { to: string; token: string }) {
  const smtpUrl = (process.env.SMTP_URL || "").trim();
  if (!smtpUrl) return;

  const from = (process.env.EMAIL_FROM || "").trim() || "no-reply@biznesinfo.lucheestiy.com";
  const baseUrl = (process.env.PUBLIC_BASE_URL || "").trim() || "https://biznesinfo.lucheestiy.com";
  const url = `${baseUrl.replace(/\/$/, "")}/reset/${encodeURIComponent(params.token)}`;

  const { default: nodemailer } = await import("nodemailer");
  const transporter = nodemailer.createTransport(smtpUrl);
  await transporter.sendMail({
    from,
    to: params.to,
    subject: "Сброс пароля Biznesinfo",
    text: `Ссылка для сброса пароля: ${url}`,
  });
}

export async function POST(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "CSRF" }, { status: 403 });
  }

  const ip = getClientIp(request);
  const rl = rateLimit({ key: `auth:reset_req:${ip}`, limit: 10, windowMs: 60 * 60_000 });
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

  const email = typeof (body as any)?.email === "string" ? (body as any).email : "";
  if (!email.trim() || !email.includes("@")) {
    // Don't leak; respond success.
    return NextResponse.json({ success: true });
  }

  try {
    const created = await createPasswordResetToken(email);
    if (created) {
      await sendResetEmail({ to: email.trim(), token: created.token });
      if (isDebugReturnEnabled()) {
        return NextResponse.json({ success: true, token: created.token });
      }
    }
  } catch (error) {
    console.error("Password reset request failed:", error);
    // Still respond success to avoid leaking.
  }

  return NextResponse.json({ success: true });
}
