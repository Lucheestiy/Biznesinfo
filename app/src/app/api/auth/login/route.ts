import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";
import { isAuthEnabled } from "@/lib/auth/currentUser";
import { findUserByEmail } from "@/lib/auth/users";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, setSessionCookie } from "@/lib/auth/sessions";

export const runtime = "nodejs";

function badRequest(message: string) {
  return NextResponse.json({ error: "BadRequest", message }, { status: 400 });
}

export async function POST(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "CSRF" }, { status: 403 });
  }

  const ip = getClientIp(request);
  const rl = rateLimit({ key: `auth:login:${ip}`, limit: 20, windowMs: 10 * 60_000 });
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
    return badRequest("Invalid JSON");
  }

  const email = typeof (body as any)?.email === "string" ? (body as any).email : "";
  const password = typeof (body as any)?.password === "string" ? (body as any).password : "";

  if (!email.trim() || !password) return badRequest("Missing credentials");

  const user = await findUserByEmail(email);
  if (!user) return NextResponse.json({ error: "InvalidCredentials" }, { status: 401 });
  if (!verifyPassword(password, user.password_hash)) return NextResponse.json({ error: "InvalidCredentials" }, { status: 401 });

  const session = await createSession({
    userId: user.id,
    ip,
    userAgent: request.headers.get("user-agent"),
  });
  await setSessionCookie(session.token, session.expiresAt);

  return NextResponse.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      plan: user.plan,
    },
  });
}
