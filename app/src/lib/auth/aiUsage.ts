import { randomUUID } from "node:crypto";
import { getDbPool } from "./db";

function utcDayString(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function consumeAiRequest(params: {
  userId: string;
  limitPerDay: number;
}): Promise<
  | { ok: true; day: string; used: number; limit: number }
  | { ok: false; day: string; used: number; limit: number }
> {
  const pool = getDbPool();
  const day = utcDayString();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query<{ id: string; requests_count: number }>(
      "SELECT id, requests_count FROM ai_usage_daily WHERE user_id = $1 AND day = $2 FOR UPDATE",
      [params.userId, day],
    );

    let id: string;
    let used: number;
    if (!existing.rows[0]) {
      id = randomUUID();
      used = 0;
      await client.query(
        "INSERT INTO ai_usage_daily (id, user_id, day, requests_count) VALUES ($1, $2, $3, 0)",
        [id, params.userId, day],
      );
    } else {
      id = existing.rows[0].id;
      used = existing.rows[0].requests_count;
    }

    const limit = Math.max(0, Math.floor(params.limitPerDay));
    if (limit > 0 && used >= limit) {
      await client.query("ROLLBACK");
      return { ok: false, day, used, limit };
    }

    const nextUsed = used + 1;
    await client.query(
      "UPDATE ai_usage_daily SET requests_count = $1, updated_at = now() WHERE id = $2",
      [nextUsed, id],
    );

    await client.query("COMMIT");
    return { ok: true, day, used: nextUsed, limit };
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

