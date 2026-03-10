import { randomUUID } from "node:crypto";
import { ensureAiChatsDbSchema, getAiChatsDbPool } from "@/lib/ai/db";
import { getAiInstanceId } from "@/lib/ai/instance";

export type AssistantConversationMessage = { role: "user" | "assistant"; content: string };

export type AssistantSessionRef = {
  id: string;
  created: boolean;
  reusedRequested: boolean;
};

const ASSISTANT_RECENT_SESSION_REUSE_WINDOW_MINUTES = 120;

type AssistantTurnRef = {
  id: string;
  turnIndex: number;
};

function isUndefinedTableError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as any).code === "42P01");
}

function isUndefinedColumnError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as any).code === "42703");
}

function normalizeUuid(raw: string | null | undefined): string | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(text)) return null;
  return text.toLowerCase();
}

function normalizeSessionContext(raw: unknown, instanceId: string): Record<string, unknown> {
  const base =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  base.instanceId = instanceId;
  return base;
}

export async function getOrCreateAssistantSession(params: {
  sessionId?: string | null;
  preferRecent?: boolean;
  userId: string;
  userEmail?: string | null;
  userName?: string | null;
  companyId?: string | null;
  source?: string | null;
  context?: unknown;
}): Promise<AssistantSessionRef | null> {
  await ensureAiChatsDbSchema();
  const pool = getAiChatsDbPool();
  const instanceId = getAiInstanceId();
  const requestedId = normalizeUuid(params.sessionId);
  const userEmail = String(params.userEmail || "").trim() || null;
  const userName = String(params.userName || "").trim() || null;
  const source = String(params.source || "").trim() || null;
  const companyId = String(params.companyId || "").trim() || null;
  const sessionContext = normalizeSessionContext(params.context, instanceId);

  try {
    if (requestedId) {
      const existing = await pool.query<{ id: string }>(
        `
          SELECT id
          FROM ai_assistant_sessions
          WHERE id = $1
            AND user_id = $2
            AND COALESCE(context->>'instanceId', '') = $3
          LIMIT 1
        `,
        [requestedId, params.userId, instanceId],
      );
      if (existing.rows[0]?.id) {
        return { id: existing.rows[0].id, created: false, reusedRequested: true };
      }
    }

    if (!requestedId && params.preferRecent) {
      const recent = await pool.query<{ id: string }>(
        `
          SELECT s.id
          FROM ai_assistant_sessions s
          WHERE s.user_id = $1
            AND (($2::text IS NULL AND s.source IS NULL) OR s.source = $2)
            AND (($3::text IS NULL AND s.company_id IS NULL) OR s.company_id = $3)
            AND COALESCE(s.context->>'instanceId', '') = $4
            AND s.last_message_at >= now() - (($5::text || ' minutes')::interval)
          ORDER BY s.last_message_at DESC
          LIMIT 1
        `,
        [params.userId, source, companyId, instanceId, String(ASSISTANT_RECENT_SESSION_REUSE_WINDOW_MINUTES)],
      );

      if (recent.rows[0]?.id) {
        return { id: recent.rows[0].id, created: false, reusedRequested: false };
      }
    }

    const id = randomUUID();
    try {
      await pool.query(
        `
          INSERT INTO ai_assistant_sessions (id, user_id, user_email, user_name, company_id, source, context)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [id, params.userId, userEmail, userName, companyId, source, sessionContext],
      );
    } catch (insertError) {
      if (!isUndefinedColumnError(insertError)) throw insertError;

      await pool.query(
        `
          INSERT INTO ai_assistant_sessions (id, user_id, company_id, source, context)
          VALUES ($1, $2, $3, $4, $5)
        `,
        [id, params.userId, companyId, source, sessionContext],
      );
    }
    return { id, created: true, reusedRequested: false };
  } catch (error) {
    if (isUndefinedTableError(error)) return null;
    throw error;
  }
}

export async function getAssistantSessionHistory(params: {
  sessionId: string;
  userId: string;
  maxTurns?: number;
}): Promise<AssistantConversationMessage[]> {
  await ensureAiChatsDbSchema();
  const pool = getAiChatsDbPool();
  const instanceId = getAiInstanceId();
  const sessionId = normalizeUuid(params.sessionId);
  if (!sessionId) return [];
  const maxTurns = Math.max(1, Math.min(24, Math.floor(params.maxTurns || 0) || 0 || 8));

  try {
    const turns = await pool.query<{
      user_message: string;
      assistant_message: string | null;
      turn_index: number;
    }>(
      `
        SELECT t.user_message, t.assistant_message, t.turn_index
        FROM ai_assistant_turns t
        JOIN ai_assistant_sessions s ON s.id = t.session_id
        WHERE t.session_id = $1
          AND s.user_id = $2
          AND COALESCE(s.context->>'instanceId', '') = $4
        ORDER BY t.turn_index DESC
        LIMIT $3
      `,
      [sessionId, params.userId, maxTurns, instanceId],
    );

    if (turns.rows.length === 0) return [];

    const ordered = turns.rows.slice().sort((a, b) => a.turn_index - b.turn_index);
    const out: AssistantConversationMessage[] = [];
    for (const row of ordered) {
      const userMessage = String(row.user_message || "").trim();
      if (userMessage) out.push({ role: "user", content: userMessage });
      const assistantMessage = String(row.assistant_message || "").trim();
      if (assistantMessage) out.push({ role: "assistant", content: assistantMessage });
    }
    return out;
  } catch (error) {
    if (isUndefinedTableError(error)) return [];
    throw error;
  }
}

export async function appendAssistantSessionTurn(params: {
  sessionId: string | null;
  userId: string;
  requestId: string;
  userMessage: string;
  assistantMessage: string;
  rankingSeedText?: string | null;
  vendorCandidateIds?: string[];
  vendorCandidateSlugs?: string[];
  requestMeta?: unknown;
  responseMeta?: unknown;
}): Promise<AssistantTurnRef | null> {
  const sessionId = normalizeUuid(params.sessionId);
  if (!sessionId) return null;

  await ensureAiChatsDbSchema();
  const pool = getAiChatsDbPool();
  const instanceId = getAiInstanceId();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const session = await client.query<{ id: string }>(
      `
        SELECT id
        FROM ai_assistant_sessions
        WHERE id = $1
          AND user_id = $2
          AND COALESCE(context->>'instanceId', '') = $3
        FOR UPDATE
      `,
      [sessionId, params.userId, instanceId],
    );
    if (!session.rows[0]?.id) {
      await client.query("ROLLBACK");
      return null;
    }

    const nextTurn = await client.query<{ turn_index: number }>(
      "SELECT COALESCE(MAX(turn_index), 0) + 1 AS turn_index FROM ai_assistant_turns WHERE session_id = $1",
      [sessionId],
    );
    const turnIndex = nextTurn.rows[0]?.turn_index || 1;
    const turnId = randomUUID();

    await client.query(
      `
        INSERT INTO ai_assistant_turns (
          id,
          session_id,
          user_id,
          turn_index,
          request_id,
          user_message,
          assistant_message,
          ranking_seed_text,
          vendor_candidate_ids,
          vendor_candidate_slugs,
          request_meta,
          response_meta
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        turnId,
        sessionId,
        params.userId,
        turnIndex,
        params.requestId || null,
        params.userMessage,
        params.assistantMessage ?? null,
        params.rankingSeedText || null,
        Array.isArray(params.vendorCandidateIds) ? params.vendorCandidateIds : null,
        Array.isArray(params.vendorCandidateSlugs) ? params.vendorCandidateSlugs : null,
        params.requestMeta ?? null,
        params.responseMeta ?? null,
      ],
    );

    await client.query(
      `
        UPDATE ai_assistant_sessions
           SET updated_at = now(),
               last_message_at = now()
         WHERE id = $1
      `,
      [sessionId],
    );

    await client.query("COMMIT");
    return { id: turnId, turnIndex };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }

    if (isUndefinedTableError(error) || isUndefinedColumnError(error)) return null;
    throw error;
  } finally {
    client.release();
  }
}

export async function beginAssistantSessionTurn(params: {
  sessionId: string | null;
  userId: string;
  requestId: string;
  userMessage: string;
  assistantMessage?: string | null;
  rankingSeedText?: string | null;
  vendorCandidateIds?: string[];
  vendorCandidateSlugs?: string[];
  requestMeta?: unknown;
  responseMeta?: unknown;
}): Promise<AssistantTurnRef | null> {
  const sessionId = normalizeUuid(params.sessionId);
  if (!sessionId) return null;

  await ensureAiChatsDbSchema();
  const pool = getAiChatsDbPool();
  const instanceId = getAiInstanceId();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const session = await client.query<{ id: string }>(
      `
        SELECT id
        FROM ai_assistant_sessions
        WHERE id = $1
          AND user_id = $2
          AND COALESCE(context->>'instanceId', '') = $3
        FOR UPDATE
      `,
      [sessionId, params.userId, instanceId],
    );
    if (!session.rows[0]?.id) {
      await client.query("ROLLBACK");
      return null;
    }

    const existing = await client.query<{ id: string; turn_index: number }>(
      `
        SELECT id, turn_index
        FROM ai_assistant_turns
        WHERE session_id = $1
          AND user_id = $2
          AND request_id = $3
        ORDER BY turn_index DESC
        LIMIT 1
        FOR UPDATE
      `,
      [sessionId, params.userId, params.requestId || null],
    );
    if (existing.rows[0]?.id) {
      await client.query("COMMIT");
      return {
        id: existing.rows[0].id,
        turnIndex: existing.rows[0].turn_index || 0,
      };
    }

    const nextTurn = await client.query<{ turn_index: number }>(
      "SELECT COALESCE(MAX(turn_index), 0) + 1 AS turn_index FROM ai_assistant_turns WHERE session_id = $1",
      [sessionId],
    );
    const turnIndex = nextTurn.rows[0]?.turn_index || 1;
    const turnId = randomUUID();

    await client.query(
      `
        INSERT INTO ai_assistant_turns (
          id,
          session_id,
          user_id,
          turn_index,
          request_id,
          user_message,
          assistant_message,
          ranking_seed_text,
          vendor_candidate_ids,
          vendor_candidate_slugs,
          request_meta,
          response_meta
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        turnId,
        sessionId,
        params.userId,
        turnIndex,
        params.requestId || null,
        params.userMessage,
        params.assistantMessage ?? "",
        params.rankingSeedText || null,
        Array.isArray(params.vendorCandidateIds) ? params.vendorCandidateIds : null,
        Array.isArray(params.vendorCandidateSlugs) ? params.vendorCandidateSlugs : null,
        params.requestMeta ?? null,
        params.responseMeta ?? null,
      ],
    );

    await client.query(
      `
        UPDATE ai_assistant_sessions
           SET updated_at = now(),
               last_message_at = now()
         WHERE id = $1
      `,
      [sessionId],
    );

    await client.query("COMMIT");
    return { id: turnId, turnIndex };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }

    if (isUndefinedTableError(error) || isUndefinedColumnError(error)) return null;
    throw error;
  } finally {
    client.release();
  }
}

export async function appendAssistantSessionTurnDelta(params: {
  sessionId: string | null;
  userId: string;
  turnId: string | null;
  delta: string;
}): Promise<boolean> {
  const sessionId = normalizeUuid(params.sessionId);
  const turnId = normalizeUuid(params.turnId);
  const delta = String(params.delta || "");
  if (!sessionId || !turnId || !delta) return false;

  await ensureAiChatsDbSchema();
  const pool = getAiChatsDbPool();
  const instanceId = getAiInstanceId();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const session = await client.query<{ id: string }>(
      `
        SELECT id
        FROM ai_assistant_sessions
        WHERE id = $1
          AND user_id = $2
          AND COALESCE(context->>'instanceId', '') = $3
        FOR UPDATE
      `,
      [sessionId, params.userId, instanceId],
    );
    if (!session.rows[0]?.id) {
      await client.query("ROLLBACK");
      return false;
    }

    const updated = await client.query(
      `
        UPDATE ai_assistant_turns
           SET assistant_message = COALESCE(assistant_message, '') || $1
         WHERE id = $2
           AND session_id = $3
           AND user_id = $4
      `,
      [delta, turnId, sessionId, params.userId],
    );

    if (Number(updated.rowCount || 0) > 0) {
      await client.query(
        `
          UPDATE ai_assistant_sessions
             SET updated_at = now(),
                 last_message_at = now()
           WHERE id = $1
        `,
        [sessionId],
      );
      await client.query("COMMIT");
      return true;
    }

    await client.query("ROLLBACK");
    return false;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }

    if (isUndefinedTableError(error) || isUndefinedColumnError(error)) return false;
    throw error;
  } finally {
    client.release();
  }
}

export async function finalizeAssistantSessionTurn(params: {
  sessionId: string | null;
  userId: string;
  turnId: string | null;
  assistantMessage: string;
  responseMeta?: unknown;
}): Promise<boolean> {
  const sessionId = normalizeUuid(params.sessionId);
  const turnId = normalizeUuid(params.turnId);
  if (!sessionId || !turnId) return false;

  await ensureAiChatsDbSchema();
  const pool = getAiChatsDbPool();
  const instanceId = getAiInstanceId();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const session = await client.query<{ id: string }>(
      `
        SELECT id
        FROM ai_assistant_sessions
        WHERE id = $1
          AND user_id = $2
          AND COALESCE(context->>'instanceId', '') = $3
        FOR UPDATE
      `,
      [sessionId, params.userId, instanceId],
    );
    if (!session.rows[0]?.id) {
      await client.query("ROLLBACK");
      return false;
    }

    const updated = await client.query(
      `
        UPDATE ai_assistant_turns
           SET assistant_message = $1,
               response_meta = CASE
                 WHEN $2::jsonb IS NULL THEN response_meta
                 ELSE COALESCE(response_meta, '{}'::jsonb) || $2::jsonb
               END
         WHERE id = $3
           AND session_id = $4
           AND user_id = $5
      `,
      [params.assistantMessage ?? "", params.responseMeta ?? null, turnId, sessionId, params.userId],
    );

    if (Number(updated.rowCount || 0) > 0) {
      await client.query(
        `
          UPDATE ai_assistant_sessions
             SET updated_at = now(),
                 last_message_at = now()
           WHERE id = $1
        `,
        [sessionId],
      );
      await client.query("COMMIT");
      return true;
    }

    await client.query("ROLLBACK");
    return false;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }

    if (isUndefinedTableError(error) || isUndefinedColumnError(error)) return false;
    throw error;
  } finally {
    client.release();
  }
}

export async function reconcileStaleAssistantTurns(params: {
  userId: string;
  olderThanMinutes?: number;
  limit?: number;
}): Promise<number> {
  const userId = String(params.userId || "").trim();
  if (!userId) return 0;

  const olderThanMinutes = Math.max(1, Math.min(24 * 60, Math.floor(params.olderThanMinutes || 0) || 15));
  const limit = Math.max(1, Math.min(200, Math.floor(params.limit || 0) || 10));
  const instanceId = getAiInstanceId();

  await ensureAiChatsDbSchema();
  const pool = getAiChatsDbPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const updated = await client.query<{ session_id: string }>(
      `
        WITH stale AS (
          SELECT t.id
          FROM ai_assistant_turns t
          JOIN ai_assistant_sessions s ON s.id = t.session_id
          WHERE t.user_id = $1
            AND COALESCE(s.context->>'instanceId', '') = $2
            AND t.created_at < now() - (($3::text || ' minutes')::interval)
            AND COALESCE(t.response_meta->>'completionState', 'pending') IN ('pending', 'streaming')
          ORDER BY t.created_at ASC
          LIMIT $4
        )
        UPDATE ai_assistant_turns t
           SET assistant_message = COALESCE(t.assistant_message, ''),
               response_meta = COALESCE(t.response_meta, '{}'::jsonb) || jsonb_build_object(
                 'completionState', 'failed',
                 'reconciled', true,
                 'reconcileReason', 'stale_pending_timeout',
                 'reconciledAt', now()
               )
        FROM stale
        WHERE t.id = stale.id
        RETURNING t.session_id::text AS session_id
      `,
      [userId, instanceId, String(olderThanMinutes), limit],
    );

    const rows = updated.rows || [];
    if (rows.length > 0) {
      const sessionIds = Array.from(new Set(rows.map((r) => String(r.session_id || "").trim()).filter(Boolean)));
      if (sessionIds.length > 0) {
        await client.query(
          `
            UPDATE ai_assistant_sessions
               SET updated_at = now()
             WHERE id = ANY($1::uuid[])
          `,
          [sessionIds],
        );
      }
    }

    await client.query("COMMIT");
    return rows.length;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }

    if (isUndefinedTableError(error) || isUndefinedColumnError(error)) return 0;
    throw error;
  } finally {
    client.release();
  }
}
