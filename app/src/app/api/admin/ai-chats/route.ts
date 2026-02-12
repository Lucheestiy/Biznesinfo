import { NextResponse } from "next/server";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import { ensureAiChatsDbSchema, getAiChatsDbPool } from "@/lib/ai/db";
import { getAiInstanceId } from "@/lib/ai/instance";

export const runtime = "nodejs";

type ListRow = {
  id: string;
  source: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  turn_count: number;
  last_user_message: string | null;
  last_assistant_message: string | null;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
};

function isUndefinedTableError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as any).code === "42P01");
}

function isUndefinedColumnError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as any).code === "42703");
}

export async function GET(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, Math.min(200, Number.parseInt(searchParams.get("limit") || "80", 10) || 80));
  const scopeRaw = (searchParams.get("scope") || "all").trim().toLowerCase();
  const scope: "mine" | "all" = scopeRaw === "mine" ? "mine" : "all";

  await ensureAiChatsDbSchema();
  const pool = getAiChatsDbPool();
  const instanceId = getAiInstanceId();

  try {
    let rows: ListRow[] = [];
    if (scope === "all") {
      const res = await pool.query<ListRow>(
        `
          SELECT
            s.id,
            s.source,
            s.created_at::text,
            s.updated_at::text,
            s.last_message_at::text,
            COALESCE(tc.turn_count, 0)::int AS turn_count,
            lt.user_message AS last_user_message,
            lt.assistant_message AS last_assistant_message,
            s.user_id::text AS user_id,
            s.user_email AS user_email,
            s.user_name AS user_name
          FROM ai_assistant_sessions s
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS turn_count
            FROM ai_assistant_turns t
            WHERE t.session_id = s.id
          ) tc ON true
          LEFT JOIN LATERAL (
            SELECT t.user_message, t.assistant_message
            FROM ai_assistant_turns t
            WHERE t.session_id = s.id
            ORDER BY t.turn_index DESC
            LIMIT 1
          ) lt ON true
          WHERE COALESCE(s.context->>'instanceId', '') = $1
          ORDER BY s.last_message_at DESC
          LIMIT $2
        `,
        [instanceId, limit],
      );
      rows = res.rows;
    } else {
      const res = await pool.query<ListRow>(
        `
          SELECT
            s.id,
            s.source,
            s.created_at::text,
            s.updated_at::text,
            s.last_message_at::text,
            COALESCE(tc.turn_count, 0)::int AS turn_count,
            lt.user_message AS last_user_message,
            lt.assistant_message AS last_assistant_message,
            s.user_id::text AS user_id,
            s.user_email AS user_email,
            s.user_name AS user_name
          FROM ai_assistant_sessions s
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS turn_count
            FROM ai_assistant_turns t
            WHERE t.session_id = s.id
          ) tc ON true
          LEFT JOIN LATERAL (
            SELECT t.user_message, t.assistant_message
            FROM ai_assistant_turns t
            WHERE t.session_id = s.id
            ORDER BY t.turn_index DESC
            LIMIT 1
          ) lt ON true
          WHERE s.user_id::text = $1
            AND COALESCE(s.context->>'instanceId', '') = $2
          ORDER BY s.last_message_at DESC
          LIMIT $3
        `,
        [user.id, instanceId, limit],
      );
      rows = res.rows;
    }

    const sessions = rows.map((row) => ({
      id: row.id,
      source: row.source || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastMessageAt: row.last_message_at,
      turnCount: Number(row.turn_count || 0),
      lastUserMessage: row.last_user_message || null,
      lastAssistantMessage: row.last_assistant_message || null,
      user: {
        id: row.user_id || "",
        email: row.user_email || "",
        name: row.user_name || null,
      },
    }));

    return NextResponse.json(
      { scope, instanceId, sessions },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (isUndefinedTableError(error) || isUndefinedColumnError(error)) {
      return NextResponse.json(
        { scope, instanceId, sessions: [] },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }
    return NextResponse.json({ error: "InternalError" }, { status: 500 });
  }
}
