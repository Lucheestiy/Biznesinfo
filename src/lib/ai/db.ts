import { Pool } from "pg";
import { getDbPool } from "@/lib/auth/db";

const AI_CHATS_SCHEMA_MIGRATION_ID = "20260208_01_ai_chats_store";

const AI_CHATS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS ai_assistant_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    user_email TEXT,
    user_name TEXT,
    company_id TEXT,
    source TEXT,
    context JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  ALTER TABLE ai_assistant_sessions
    ADD COLUMN IF NOT EXISTS user_email TEXT,
    ADD COLUMN IF NOT EXISTS user_name TEXT;

  CREATE INDEX IF NOT EXISTS ai_assistant_sessions_user_id_last_message_idx
    ON ai_assistant_sessions(user_id, last_message_at DESC);
  CREATE INDEX IF NOT EXISTS ai_assistant_sessions_last_message_idx
    ON ai_assistant_sessions(last_message_at DESC);
  CREATE INDEX IF NOT EXISTS ai_assistant_sessions_user_email_idx
    ON ai_assistant_sessions(user_email);

  CREATE TABLE IF NOT EXISTS ai_assistant_turns (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES ai_assistant_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    turn_index INT NOT NULL CHECK (turn_index > 0),
    request_id UUID,
    user_message TEXT NOT NULL,
    assistant_message TEXT,
    ranking_seed_text TEXT,
    vendor_candidate_ids TEXT[],
    vendor_candidate_slugs TEXT[],
    request_meta JSONB,
    response_meta JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(session_id, turn_index)
  );

  CREATE INDEX IF NOT EXISTS ai_assistant_turns_session_turn_idx
    ON ai_assistant_turns(session_id, turn_index DESC);
  CREATE INDEX IF NOT EXISTS ai_assistant_turns_user_created_idx
    ON ai_assistant_turns(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS ai_assistant_turns_request_id_idx
    ON ai_assistant_turns(request_id);
`;

let aiChatsPool: Pool | null = null;
let aiChatsPoolKey: string | null = null;

const ensuredSchemaKeys = new Set<string>();
const inFlightEnsure = new Map<string, Promise<void>>();

function getExternalAiChatsDatabaseUrl(): string | null {
  const direct = String(process.env.AI_CHATS_DATABASE_URL || "").trim();
  if (direct) return direct;
  return null;
}

function getPoolIdentityKey(): string {
  const external = getExternalAiChatsDatabaseUrl();
  if (!external) return "primary:DATABASE_URL";
  return `external:${external}`;
}

export function usesExternalAiChatsDb(): boolean {
  return Boolean(getExternalAiChatsDatabaseUrl());
}

export function getAiChatsDbPool(): Pool {
  const external = getExternalAiChatsDatabaseUrl();
  if (!external) return getDbPool();

  if (aiChatsPool && aiChatsPoolKey === external) return aiChatsPool;

  aiChatsPool = new Pool({
    connectionString: external,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  aiChatsPoolKey = external;
  return aiChatsPool;
}

async function applyAiChatsSchema(): Promise<void> {
  const pool = getAiChatsDbPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_chat_schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const existing = await client.query<{ id: string }>(
      "SELECT id FROM ai_chat_schema_migrations WHERE id = $1 LIMIT 1",
      [AI_CHATS_SCHEMA_MIGRATION_ID],
    );

    if (!existing.rows[0]?.id) {
      await client.query(AI_CHATS_SCHEMA_SQL);
      await client.query(
        "INSERT INTO ai_chat_schema_migrations (id) VALUES ($1)",
        [AI_CHATS_SCHEMA_MIGRATION_ID],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureAiChatsDbSchema(): Promise<void> {
  const key = getPoolIdentityKey();
  if (ensuredSchemaKeys.has(key)) return;

  const active = inFlightEnsure.get(key);
  if (active) {
    await active;
    return;
  }

  const task = (async () => {
    await applyAiChatsSchema();
    ensuredSchemaKeys.add(key);
  })();
  inFlightEnsure.set(key, task);

  try {
    await task;
  } finally {
    inFlightEnsure.delete(key);
  }
}
