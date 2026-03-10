import { NextResponse } from "next/server";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";

export const runtime = "nodejs";

export async function GET() {
  if (!isAuthEnabled()) {
    return NextResponse.json({ enabled: false, user: null }, { headers: { "Cache-Control": "no-store" } });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ enabled: true, user: null }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    {
      enabled: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        plan: user.plan,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

