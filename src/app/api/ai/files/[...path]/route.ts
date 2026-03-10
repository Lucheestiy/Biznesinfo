import { NextResponse } from "next/server";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import { readAiUploadFile } from "@/lib/ai/uploads";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ path?: string[] }> };

function decodePathSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw || "").trim();
  } catch {
    return null;
  }
}

export async function GET(_: Request, ctx: RouteContext) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = await ctx.params;
  const pathParts = Array.isArray(params?.path) ? params.path : [];
  if (pathParts.length !== 3) return NextResponse.json({ error: "NotFound" }, { status: 404 });

  const ownerIdDecoded = decodePathSegment(pathParts[0]);
  if (!ownerIdDecoded) return NextResponse.json({ error: "NotFound" }, { status: 404 });
  if (me.role !== "admin" && ownerIdDecoded !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const file = await readAiUploadFile({
    ownerId: pathParts[0] || "",
    requestId: pathParts[1] || "",
    fileName: pathParts[2] || "",
  });
  if (!file) return NextResponse.json({ error: "NotFound" }, { status: 404 });
  const body = new Uint8Array(file.content);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${file.fileName}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
