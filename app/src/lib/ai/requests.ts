import { randomUUID } from "node:crypto";
import { getDbPool } from "@/lib/auth/db";

export async function createAiRequest(params: {
  userId: string;
  companyId?: string | null;
  message: string;
  payload?: unknown;
}): Promise<{ id: string }> {
  const pool = getDbPool();
  const id = randomUUID();
  await pool.query(
    "INSERT INTO ai_requests (id, user_id, company_id, message, payload) VALUES ($1, $2, $3, $4, $5)",
    [id, params.userId, params.companyId || null, params.message, params.payload ?? null],
  );
  return { id };
}
