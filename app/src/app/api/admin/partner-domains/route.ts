import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import { deletePartnerDomain, listPartnerDomains, upsertPartnerDomain } from "@/lib/auth/partnerDomains";

export const runtime = "nodejs";

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase();
}

function isValidDomain(domain: string): boolean {
  if (!domain) return false;
  if (domain.includes("@")) return false;
  if (domain.includes("/")) return false;
  if (domain.includes(" ")) return false;
  if (!domain.includes(".")) return false;
  return /^[a-z0-9.-]+$/i.test(domain);
}

export async function GET(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") || "100");
  const offset = Number(searchParams.get("offset") || "0");

  const domains = await listPartnerDomains({ limit, offset });
  return NextResponse.json(
    {
      domains: domains.map((d) => ({
        id: d.id,
        domain: d.domain,
        ai_requests_per_day: d.ai_requests_per_day,
        created_at: d.created_at,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "CSRF" }, { status: 403 });
  }

  const ip = getClientIp(request);
  const rl = rateLimit({ key: `admin:partner-domains:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RateLimited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
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

  const domainRaw = typeof (body as any)?.domain === "string" ? (body as any).domain : "";
  const domain = normalizeDomain(domainRaw);

  const aiRequestsPerDayRaw = (body as any)?.aiRequestsPerDay;
  const aiRequestsPerDay =
    aiRequestsPerDayRaw == null || aiRequestsPerDayRaw === ""
      ? null
      : typeof aiRequestsPerDayRaw === "number"
        ? aiRequestsPerDayRaw
        : Number(aiRequestsPerDayRaw);

  if (!isValidDomain(domain)) return NextResponse.json({ error: "BadRequest" }, { status: 400 });
  if (aiRequestsPerDay != null && (!Number.isFinite(aiRequestsPerDay) || aiRequestsPerDay < 0)) {
    return NextResponse.json({ error: "BadRequest" }, { status: 400 });
  }

  await upsertPartnerDomain({ domain, aiRequestsPerDay });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "CSRF" }, { status: 403 });
  }

  const ip = getClientIp(request);
  const rl = rateLimit({ key: `admin:partner-domains:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RateLimited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const domainRaw = searchParams.get("domain") || "";

  let domain = domainRaw;
  if (!domain) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    domain = typeof (body as any)?.domain === "string" ? (body as any).domain : "";
  }

  const normalized = normalizeDomain(domain);
  if (!isValidDomain(normalized)) return NextResponse.json({ error: "BadRequest" }, { status: 400 });

  const deleted = await deletePartnerDomain(normalized);
  return NextResponse.json({ success: true, deleted });
}

