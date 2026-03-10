import { getDbPool } from "@/lib/auth/db";

type AcquireOk = { ok: true; acquired: true; skipped: boolean; expiresAt: string | null };
type AcquireBusy = {
  ok: true;
  acquired: false;
  skipped: false;
  lock: { requestId: string; expiresAt: string; retryAfterSeconds: number };
};

function isUndefinedTableError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as any).code === "42P01");
}

export async function tryAcquireAiRequestLock(params: {
  userId: string;
  requestId: string;
  ttlSeconds: number;
}): Promise<AcquireOk | AcquireBusy> {
  const pool = getDbPool();
  const ttlSeconds = Math.max(30, Math.min(60 * 30, Math.floor(params.ttlSeconds || 0) || 0));

  try {
    await pool.query("DELETE FROM ai_request_locks WHERE user_id = $1 AND expires_at < now()", [params.userId]);

    const inserted = await pool.query<{ expires_at: string }>(
      `
        INSERT INTO ai_request_locks (user_id, request_id, expires_at, updated_at)
        VALUES ($1, $2, now() + ($3 * interval '1 second'), now())
        ON CONFLICT (user_id) DO NOTHING
        RETURNING expires_at
      `,
      [params.userId, params.requestId, ttlSeconds],
    );

    if (inserted.rows[0]?.expires_at) {
      return { ok: true, acquired: true, skipped: false, expiresAt: inserted.rows[0].expires_at };
    }

    const existing = await pool.query<{ request_id: string; expires_at: string; retry_after_seconds: number }>(
      `
        SELECT request_id,
               expires_at,
               GREATEST(0, CEIL(EXTRACT(EPOCH FROM (expires_at - now()))))::int AS retry_after_seconds
        FROM ai_request_locks
        WHERE user_id = $1
        LIMIT 1
      `,
      [params.userId],
    );

    const row = existing.rows[0];
    if (!row) {
      // Race: lock row was deleted between the insert attempt and the select.
      return { ok: true, acquired: true, skipped: false, expiresAt: null };
    }

    return {
      ok: true,
      acquired: false,
      skipped: false,
      lock: {
        requestId: row.request_id,
        expiresAt: row.expires_at,
        retryAfterSeconds: Number.isFinite(row.retry_after_seconds) ? row.retry_after_seconds : 1,
      },
    };
  } catch (error) {
    if (isUndefinedTableError(error)) return { ok: true, acquired: true, skipped: true, expiresAt: null };
    throw error;
  }
}

export async function extendAiRequestLock(params: {
  userId: string;
  requestId: string;
  ttlSeconds: number;
}): Promise<void> {
  const pool = getDbPool();
  const ttlSeconds = Math.max(30, Math.min(60 * 30, Math.floor(params.ttlSeconds || 0) || 0));

  try {
    await pool.query(
      `
        UPDATE ai_request_locks
           SET expires_at = now() + ($3 * interval '1 second'),
               updated_at = now()
         WHERE user_id = $1 AND request_id = $2
      `,
      [params.userId, params.requestId, ttlSeconds],
    );
  } catch (error) {
    if (isUndefinedTableError(error)) return;
    throw error;
  }
}

export async function releaseAiRequestLock(params: { userId: string; requestId: string }): Promise<void> {
  const pool = getDbPool();
  try {
    await pool.query("DELETE FROM ai_request_locks WHERE user_id = $1 AND request_id = $2", [params.userId, params.requestId]);
  } catch (error) {
    if (isUndefinedTableError(error)) return;
    throw error;
  }
}

