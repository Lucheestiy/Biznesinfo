import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDbPool } from "./db";
import { findUserByEmail, normalizeEmail } from "./users";
import { hashPassword } from "./password";
import { revokeAllUserSessions } from "./sessions";

function sha256Base64(input: string): string {
  return createHash("sha256").update(input).digest("base64");
}

const DEFAULT_RESET_TTL_MIN = 30;

function resetTtlMs(): number {
  const raw = (process.env.AUTH_RESET_TOKEN_TTL_MIN || "").trim();
  const minutes = raw ? Number(raw) : DEFAULT_RESET_TTL_MIN;
  if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_RESET_TTL_MIN * 60_000;
  return Math.floor(minutes * 60_000);
}

export async function createPasswordResetToken(email: string): Promise<{ token: string } | null> {
  const pool = getDbPool();
  const normalized = normalizeEmail(email);
  const user = await findUserByEmail(normalized);
  if (!user) return null;

  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256Base64(token);
  const expiresAt = new Date(Date.now() + resetTtlMs());

  const id = randomUUID();
  await pool.query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [id, user.id, tokenHash, expiresAt],
  );

  return { token };
}

export async function resetPasswordByToken(params: {
  token: string;
  newPassword: string;
}): Promise<{ ok: true } | { ok: false; reason: "invalid" | "expired" }> {
  const pool = getDbPool();
  const tokenHash = sha256Base64(params.token);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const row = await client.query<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>(
      `SELECT id, user_id, expires_at, used_at
       FROM password_reset_tokens
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash],
    );

    const rec = row.rows[0];
    if (!rec) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "invalid" };
    }
    if (rec.used_at) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "invalid" };
    }
    if (rec.expires_at.getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "expired" };
    }

    const passwordHash = hashPassword(params.newPassword);
    await client.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [passwordHash, rec.user_id]);
    await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [rec.id]);

    await client.query("COMMIT");

    // Revoke all sessions after password change.
    await revokeAllUserSessions(rec.user_id);

    return { ok: true };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw error;
  } finally {
    client.release();
  }
}

