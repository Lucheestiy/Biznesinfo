import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { getDbPool } from "./db";
import type { UserRow } from "./users";

export const SESSION_COOKIE_NAME = "biznesinfo_session";

const DEFAULT_SESSION_DAYS = 30;

function sessionTtlSeconds(): number {
  const daysRaw = (process.env.AUTH_SESSION_DAYS || "").trim();
  const days = daysRaw ? Number(daysRaw) : DEFAULT_SESSION_DAYS;
  if (!Number.isFinite(days) || days <= 0) return DEFAULT_SESSION_DAYS * 86400;
  return Math.floor(days * 86400);
}

function sha256Base64(input: string): string {
  return createHash("sha256").update(input).digest("base64");
}

function newSessionToken(): string {
  // 32 bytes -> 43 char base64url-ish, but we keep base64 for simplicity (cookie-safe).
  return randomBytes(32).toString("base64url");
}

export async function getSessionCookieToken(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE_NAME)?.value || null;
  return value ? value.trim() : null;
}

export async function createSession(params: {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const pool = getDbPool();
  const token = newSessionToken();
  const tokenHash = sha256Base64(token);
  const ttlSeconds = sessionTtlSeconds();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const id = randomUUID();
  await pool.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, params.userId, tokenHash, expiresAt, params.ip || null, params.userAgent || null],
  );

  return { token, expiresAt };
}

export async function revokeSessionByToken(token: string): Promise<void> {
  const pool = getDbPool();
  const tokenHash = sha256Base64(token);
  await pool.query(
    "UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
    [tokenHash],
  );
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
    [userId],
  );
}

export async function getUserBySessionToken(token: string): Promise<UserRow | null> {
  const pool = getDbPool();
  const tokenHash = sha256Base64(token);
  const res = await pool.query<UserRow>(
    `SELECT u.*
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
     LIMIT 1`,
    [tokenHash],
  );
  if (!res.rows[0]) return null;

  // Best-effort last_seen update (don't fail auth if it errors).
  pool.query("UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1", [tokenHash]).catch(() => {});

  return res.rows[0];
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  const secure = (process.env.AUTH_COOKIE_SECURE || "").trim();
  const secureFlag = secure ? secure !== "0" && secure.toLowerCase() !== "false" : process.env.NODE_ENV === "production";

  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureFlag,
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}
