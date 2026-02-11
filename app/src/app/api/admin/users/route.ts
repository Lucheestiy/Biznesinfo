import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import { listUsers, setUserPlan, setUserRole } from "@/lib/auth/users";

export const runtime = "nodejs";

function isAllowedPlan(plan: string): plan is "free" | "paid" | "partner" {
  return plan === "free" || plan === "paid" || plan === "partner";
}

function isAllowedRole(role: string): role is "user" | "admin" {
  return role === "user" || role === "admin";
}

export async function GET(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") || "50");
  const offset = Number(searchParams.get("offset") || "0");

  const users = await listUsers({ limit, offset });
  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      plan: u.plan,
      created_at: u.created_at,
      updated_at: u.updated_at,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "CSRF" }, { status: 403 });
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

  const userId = typeof (body as any)?.userId === "string" ? (body as any).userId : "";
  const plan = typeof (body as any)?.plan === "string" ? (body as any).plan : null;
  const role = typeof (body as any)?.role === "string" ? (body as any).role : null;

  if (!userId) return NextResponse.json({ error: "BadRequest" }, { status: 400 });

  if (plan != null) {
    if (!isAllowedPlan(plan)) return NextResponse.json({ error: "BadRequest" }, { status: 400 });
    await setUserPlan(userId, plan);
  }
  if (role != null) {
    if (!isAllowedRole(role)) return NextResponse.json({ error: "BadRequest" }, { status: 400 });
    await setUserRole(userId, role);
  }

  return NextResponse.json({ success: true });
}

