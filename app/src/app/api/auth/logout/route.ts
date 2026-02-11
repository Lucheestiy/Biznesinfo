import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { isAuthEnabled } from "@/lib/auth/currentUser";
import { clearSessionCookie, getSessionCookieToken, revokeSessionByToken } from "@/lib/auth/sessions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ success: true });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "CSRF" }, { status: 403 });
  }

  const token = await getSessionCookieToken();
  if (token) {
    await revokeSessionByToken(token);
  }
  await clearSessionCookie();
  return NextResponse.json({ success: true });
}
