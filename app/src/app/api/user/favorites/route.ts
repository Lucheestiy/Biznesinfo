import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import { addFavorite, listFavorites, removeFavorite, setFavorites } from "@/lib/auth/favorites";
import { companySlugForUrl } from "@/lib/biznesinfo/slug";

export const runtime = "nodejs";

const DASH_VARIANTS_RE = /[-‐‑‒–—―]/gu;

function normalizeFavoriteId(raw: string): string {
  return companySlugForUrl((raw || "").trim());
}

function normalizeFavoriteIds(rawIds: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawIds || []) {
    const id = normalizeFavoriteId(raw);
    if (!id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

function needsNormalization(rawIds: string[], normalized: string[]): boolean {
  if (rawIds.length !== normalized.length) return true;
  for (let i = 0; i < rawIds.length; i += 1) {
    if ((rawIds[i] || "").trim() !== normalized[i]) return true;
  }
  return false;
}

export async function GET() {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rawFavorites = await listFavorites(user.id);
  const favorites = normalizeFavoriteIds(rawFavorites);
  if (needsNormalization(rawFavorites, favorites)) {
    await setFavorites(user.id, favorites);
  }
  return NextResponse.json({ favorites }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "CSRF" }, { status: 403 });
  }

  const ip = getClientIp(request);
  const rl = rateLimit({ key: `user:fav:${ip}`, limit: 120, windowMs: 60_000 });
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

  const action = typeof (body as any)?.action === "string" ? (body as any).action : "";
  const companyIdRaw = typeof (body as any)?.companyId === "string" ? (body as any).companyId : "";
  const companyId = normalizeFavoriteId(companyIdRaw);

  if (!companyId.trim()) return NextResponse.json({ error: "BadRequest" }, { status: 400 });

  if (action === "remove") {
    await removeFavorite(user.id, companyId.trim());
    const legacyId = companyId.trim().replace(DASH_VARIANTS_RE, "");
    if (legacyId && legacyId !== companyId.trim()) {
      await removeFavorite(user.id, legacyId);
    }
  } else {
    await addFavorite(user.id, companyId.trim());
  }

  const rawFavorites = await listFavorites(user.id);
  const favorites = normalizeFavoriteIds(rawFavorites);
  if (needsNormalization(rawFavorites, favorites)) {
    await setFavorites(user.id, favorites);
  }
  return NextResponse.json({ favorites });
}

export async function PUT(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "CSRF" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "BadRequest" }, { status: 400 });
  }

  const favorites = Array.isArray((body as any)?.favorites) ? (body as any).favorites : [];
  const ids = normalizeFavoriteIds(favorites.filter((v: any) => typeof v === "string"));

  await setFavorites(user.id, ids);
  const updatedRaw = await listFavorites(user.id);
  const updated = normalizeFavoriteIds(updatedRaw);
  if (needsNormalization(updatedRaw, updated)) {
    await setFavorites(user.id, updated);
  }
  return NextResponse.json({ favorites: updated });
}
