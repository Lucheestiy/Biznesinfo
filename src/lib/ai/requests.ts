import { randomUUID } from "node:crypto";
import { getDbPool } from "@/lib/auth/db";

export async function createAiRequest(params: {
  id?: string;
  userId: string;
  companyId?: string | null;
  message: string;
  assistantSessionId?: string | null;
  assistantTurnId?: string | null;
  payload?: unknown;
}): Promise<{ id: string }> {
  const pool = getDbPool();
  const id = (params.id || "").trim() || randomUUID();
  try {
    await pool.query(
      `
        INSERT INTO ai_requests (
          id,
          user_id,
          company_id,
          message,
          assistant_session_id,
          assistant_turn_id,
          payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        id,
        params.userId,
        params.companyId || null,
        params.message,
        params.assistantSessionId || null,
        params.assistantTurnId || null,
        params.payload ?? null,
      ],
    );
  } catch (error) {
    const code = typeof (error as any)?.code === "string" ? (error as any).code : "";
    if (code !== "42703") throw error; // undefined_column

    await pool.query(
      "INSERT INTO ai_requests (id, user_id, company_id, message, payload) VALUES ($1, $2, $3, $4, $5)",
      [id, params.userId, params.companyId || null, params.message, params.payload ?? null],
    );
  }
  return { id };
}

export async function linkAiRequestConversation(params: {
  requestId: string;
  assistantSessionId?: string | null;
  assistantTurnId?: string | null;
}): Promise<void> {
  const pool = getDbPool();
  const sessionId = (params.assistantSessionId || "").trim() || null;
  const turnId = (params.assistantTurnId || "").trim() || null;
  if (!sessionId && !turnId) return;

  try {
    await pool.query(
      `
        UPDATE ai_requests
           SET assistant_session_id = COALESCE($2, assistant_session_id),
               assistant_turn_id = COALESCE($3, assistant_turn_id)
         WHERE id = $1
      `,
      [params.requestId, sessionId, turnId],
    );
  } catch (error) {
    const code = typeof (error as any)?.code === "string" ? (error as any).code : "";
    if (code === "42703" || code === "42P01") return;
    throw error;
  }
}
