import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";
import { isAuthEnabled } from "@/lib/auth/currentUser";
import { findUserByEmail, upsertUserFromTrustedLogin, type UserPlan, type UserRole, type UserRow } from "@/lib/auth/users";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, setSessionCookie } from "@/lib/auth/sessions";

export const runtime = "nodejs";

const FEDERATION_HOP_HEADER = "x-auth-federation-hop";
const PREMIUM_PLANS = new Set<UserPlan>(["paid", "partner"]);

type FederatedUser = {
  email: string;
  name: string | null;
  role: UserRole;
  plan: UserPlan;
};

function badRequest(message: string) {
  return NextResponse.json({ error: "BadRequest", message }, { status: 400 });
}

function normalizeRole(raw: unknown): UserRole | null {
  if (raw === "admin" || raw === "user") return raw;
  return null;
}

function normalizePlan(raw: unknown): UserPlan | null {
  if (raw === "free" || raw === "paid" || raw === "partner") return raw;
  return null;
}

function parseFederatedUser(payload: unknown): FederatedUser | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const rawUser = (payload as Record<string, unknown>).user;
  if (!rawUser || typeof rawUser !== "object" || Array.isArray(rawUser)) return null;

  const email = typeof (rawUser as Record<string, unknown>).email === "string"
    ? String((rawUser as Record<string, unknown>).email).trim().toLowerCase()
    : "";
  const role = normalizeRole((rawUser as Record<string, unknown>).role);
  const plan = normalizePlan((rawUser as Record<string, unknown>).plan);
  if (!email || !role || !plan) return null;

  const name = typeof (rawUser as Record<string, unknown>).name === "string"
    ? String((rawUser as Record<string, unknown>).name).trim() || null
    : null;

  return { email, name, role, plan };
}

function isPremiumOrAdmin(user: FederatedUser): boolean {
  return user.role === "admin" || PREMIUM_PLANS.has(user.plan);
}

async function tryFederatedPremiumLogin(params: {
  request: Request;
  email: string;
  password: string;
}): Promise<UserRow | null> {
  const upstreamUrl = String(process.env.AUTH_FEDERATION_UPSTREAM_LOGIN_URL || "").trim();
  if (!upstreamUrl) return null;
  if ((params.request.headers.get(FEDERATION_HOP_HEADER) || "").trim() === "1") return null;

  try {
    const res = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [FEDERATION_HOP_HEADER]: "1",
      },
      body: JSON.stringify({
        email: params.email,
        password: params.password,
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;

    const payload = await res.json().catch(() => null);
    const remoteUser = parseFederatedUser(payload);
    if (!remoteUser) return null;
    if (!isPremiumOrAdmin(remoteUser)) return null;

    return upsertUserFromTrustedLogin({
      email: remoteUser.email,
      passwordHash: hashPassword(params.password),
      name: remoteUser.name,
      role: remoteUser.role,
      plan: remoteUser.plan,
    });
  } catch {
    return null;
  }
}

function normalizeNextPath(raw: unknown): string {
  if (typeof raw !== "string") return "/cabinet";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/cabinet";
  return trimmed;
}

function isFormRequest(request: Request): boolean {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  return contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
}

function requestOrigin(request: Request): string {
  const forwardedProto = (request.headers.get("x-forwarded-proto") || "").split(",")[0]?.trim();
  const forwardedHost = (request.headers.get("x-forwarded-host") || "").split(",")[0]?.trim();
  const host = (request.headers.get("host") || "").trim();
  const proto = forwardedProto || "https";
  const resolvedHost = forwardedHost || host;
  if (resolvedHost) return `${proto}://${resolvedHost}`;
  try {
    return new URL(request.url).origin;
  } catch {
    return "https://biznesinfo.lucheestiy.com";
  }
}

function loginErrorRedirect(request: Request, nextPath: string, code: string): NextResponse {
  const url = new URL("/login", requestOrigin(request));
  if (nextPath && nextPath !== "/cabinet") url.searchParams.set("next", nextPath);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url, 303);
}

function successRedirect(request: Request, nextPath: string): NextResponse {
  return NextResponse.redirect(new URL(nextPath, requestOrigin(request)), 303);
}

export async function POST(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });
  const formRequest = isFormRequest(request);

  try {
    assertSameOrigin(request);
  } catch {
    return formRequest
      ? loginErrorRedirect(request, "/cabinet", "csrf")
      : NextResponse.json({ error: "CSRF" }, { status: 403 });
  }

  const ip = getClientIp(request);
  const rl = rateLimit({ key: `auth:login:${ip}`, limit: 20, windowMs: 10 * 60_000 });
  if (!rl.ok) {
    if (formRequest) return loginErrorRedirect(request, "/cabinet", "rate_limited");
    return NextResponse.json(
      { error: "RateLimited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let email = "";
  let password = "";
  let nextPath = "/cabinet";
  try {
    if (formRequest) {
      const form = await request.formData();
      email = typeof form.get("email") === "string" ? String(form.get("email")) : "";
      password = typeof form.get("password") === "string" ? String(form.get("password")) : "";
      nextPath = normalizeNextPath(form.get("next"));
    } else {
      const body = await request.json();
      email = typeof (body as any)?.email === "string" ? (body as any).email : "";
      password = typeof (body as any)?.password === "string" ? (body as any).password : "";
      nextPath = normalizeNextPath((body as any)?.next);
    }
  } catch {
    return formRequest ? loginErrorRedirect(request, "/cabinet", "invalid") : badRequest("Invalid payload");
  }

  if (!email.trim() || !password) {
    return formRequest ? loginErrorRedirect(request, nextPath, "missing") : badRequest("Missing credentials");
  }

  let user = await findUserByEmail(email);
  let authenticated = Boolean(user && verifyPassword(password, user.password_hash));

  if (!authenticated) {
    const federated = await tryFederatedPremiumLogin({ request, email, password });
    if (federated) {
      user = federated;
      authenticated = true;
    }
  }

  if (!user || !authenticated) {
    return formRequest
      ? loginErrorRedirect(request, nextPath, "invalid")
      : NextResponse.json({ error: "InvalidCredentials" }, { status: 401 });
  }

  const session = await createSession({
    userId: user.id,
    ip,
    userAgent: request.headers.get("user-agent"),
  });
  await setSessionCookie(session.token, session.expiresAt);

  if (formRequest) return successRedirect(request, nextPath);

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
