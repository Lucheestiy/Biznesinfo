import { getDbPool } from "./db";

type Migration = {
  id: string;
  sql: string;
};

const MIGRATIONS: Migration[] = [
  {
    id: "20260203_02_users",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
        plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'paid', 'partner')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    id: "20260203_03_sessions",
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        ip TEXT,
        user_agent TEXT
      );

      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
    `,
  },
  {
    id: "20260203_04_password_reset_tokens",
    sql: `
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens(user_id);
      CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx ON password_reset_tokens(expires_at);
    `,
  },
  {
    id: "20260203_05_favorites",
    sql: `
      CREATE TABLE IF NOT EXISTS favorites (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(user_id, company_id)
      );

      CREATE INDEX IF NOT EXISTS favorites_user_id_idx ON favorites(user_id);
    `,
  },
  {
    id: "20260203_06_plan_limits",
    sql: `
      CREATE TABLE IF NOT EXISTS plan_limits (
        plan TEXT PRIMARY KEY CHECK (plan IN ('free', 'paid', 'partner')),
        ai_requests_per_day INT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      INSERT INTO plan_limits (plan, ai_requests_per_day) VALUES
        ('free', 1),
        ('paid', 10),
        ('partner', 10)
      ON CONFLICT (plan) DO NOTHING;
    `,
  },
  {
    id: "20260203_07_ai_usage_daily",
    sql: `
      CREATE TABLE IF NOT EXISTS ai_usage_daily (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day DATE NOT NULL,
        requests_count INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(user_id, day)
      );

      CREATE INDEX IF NOT EXISTS ai_usage_daily_user_id_idx ON ai_usage_daily(user_id);
      CREATE INDEX IF NOT EXISTS ai_usage_daily_day_idx ON ai_usage_daily(day);
    `,
  },
  {
    id: "20260203_08_ai_requests",
    sql: `
      CREATE TABLE IF NOT EXISTS ai_requests (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id TEXT,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS ai_requests_user_id_idx ON ai_requests(user_id);
      CREATE INDEX IF NOT EXISTS ai_requests_created_at_idx ON ai_requests(created_at);
    `,
  },
  {
    id: "20260203_09_ai_requests_payload",
    sql: `
      ALTER TABLE ai_requests
        ADD COLUMN IF NOT EXISTS payload JSONB;
    `,
  },
  {
    id: "20260203_10_partner_domains",
    sql: `
      CREATE TABLE IF NOT EXISTS partner_domains (
        id UUID PRIMARY KEY,
        domain TEXT NOT NULL UNIQUE,
        ai_requests_per_day INT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
];

export async function ensureAuthDb(): Promise<{ applied: string[] }> {
  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const appliedRows = await client.query<{ id: string }>("SELECT id FROM schema_migrations");
    const applied = new Set(appliedRows.rows.map((r) => r.id));

    const newlyApplied: string[] = [];
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      await client.query(m.sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
      newlyApplied.push(m.id);
    }

    await client.query("COMMIT");
    return { applied: newlyApplied };
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
