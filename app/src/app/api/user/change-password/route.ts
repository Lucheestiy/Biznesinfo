import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { updateUserPasswordHash } from "@/lib/auth/users";
import { revokeAllUserSessions, createSession, setSessionCookie, getSessionCookieToken, revokeSessionByToken } from "@/lib/auth/sessions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "CSRF" }, { status: 403 });
  }

  const ip = getClientIp(request);
  const rl = rateLimit({ key: `user:pwd:${ip}`, limit: 20, windowMs: 60 * 60_000 });
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

  const currentPassword = typeof (body as any)?.currentPassword === "string" ? (body as any).currentPassword : "";
  const newPassword = typeof (body as any)?.newPassword === "string" ? (body as any).newPassword : "";

  if (!currentPassword || newPassword.length < 8) {
    return NextResponse.json({ error: "BadRequest" }, { status: 400 });
  }

  if (!verifyPassword(currentPassword, user.password_hash)) {
    return NextResponse.json({ error: "InvalidCredentials" }, { status: 401 });
  }

  const passwordHash = hashPassword(newPassword);
  await updateUserPasswordHash(user.id, passwordHash);

  // Revoke all sessions and create a fresh one for the current device.
  await revokeAllUserSessions(user.id);

  const tokenToRevoke = await getSessionCookieToken();
  if (tokenToRevoke) {
    await revokeSessionByToken(tokenToRevoke);
  }

  const session = await createSession({
    userId: user.id,
    ip,
    userAgent: request.headers.get("user-agent"),
  });
  await setSessionCookie(session.token, session.expiresAt);

  return NextResponse.json({ success: true });
}
