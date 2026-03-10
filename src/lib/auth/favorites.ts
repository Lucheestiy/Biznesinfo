import { randomUUID } from "node:crypto";
import { getDbPool } from "./db";

export async function listFavorites(userId: string): Promise<string[]> {
  const pool = getDbPool();
  const res = await pool.query<{ company_id: string }>(
    "SELECT company_id FROM favorites WHERE user_id = $1 ORDER BY created_at DESC",
    [userId],
  );
  return res.rows.map((r) => r.company_id);
}

export async function addFavorite(userId: string, companyId: string): Promise<void> {
  const pool = getDbPool();
  const id = randomUUID();
  await pool.query(
    `INSERT INTO favorites (id, user_id, company_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, company_id) DO NOTHING`,
    [id, userId, companyId],
  );
}

export async function removeFavorite(userId: string, companyId: string): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    "DELETE FROM favorites WHERE user_id = $1 AND company_id = $2",
    [userId, companyId],
  );
}

export async function setFavorites(userId: string, companyIds: string[]): Promise<void> {
  const pool = getDbPool();
  const unique = Array.from(new Set(companyIds.map((c) => c.trim()).filter(Boolean)));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM favorites WHERE user_id = $1", [userId]);
    for (const companyId of unique) {
      await client.query(
        "INSERT INTO favorites (id, user_id, company_id) VALUES ($1, $2, $3)",
        [randomUUID(), userId, companyId],
      );
    }
    await client.query("COMMIT");
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

