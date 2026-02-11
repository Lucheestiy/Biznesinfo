import { NextResponse } from "next/server";
import { setUserRoleByEmail } from "@/lib/auth/users";

const ADMIN_SECRET = process.env.ADMIN_SECRET || "dev-secret-change-me";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "BadRequest" }, { status: 400 });
  }

  const email = typeof (body as any)?.email === "string" ? (body as any).email : "";
  if (!email.trim()) return NextResponse.json({ error: "BadRequest" }, { status: 400 });

  const ok = await setUserRoleByEmail(email, "admin");
  if (!ok) return NextResponse.json({ error: "NotFound" }, { status: 404 });

  return NextResponse.json({ success: true });
}

