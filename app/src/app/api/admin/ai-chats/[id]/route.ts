import { NextResponse } from "next/server";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import { ensureAiChatsDbSchema, getAiChatsDbPool } from "@/lib/ai/db";
import { getAiInstanceId } from "@/lib/ai/instance";

export const runtime = "nodejs";

type SessionRow = {
  id: string;
  user_id: string;
  source: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  user_email: string | null;
  user_name: string | null;
};

type TurnRow = {
  id: string;
  turn_index: number;
  user_message: string;
  assistant_message: string | null;
  created_at: string;
};

function isUndefinedTableError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as any).code === "42P01");
}

function isUndefinedColumnError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as any).code === "42703");
}

function normalizeUuid(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) return null;
  return value.toLowerCase();
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = await context.params;
  const sessionId = normalizeUuid(params.id);
  if (!sessionId) return NextResponse.json({ error: "BadRequest" }, { status: 400 });

  await ensureAiChatsDbSchema();
  const pool = getAiChatsDbPool();
  const instanceId = getAiInstanceId();

  try {
    const sessionRes = await pool.query<SessionRow>(
      `
        SELECT
          s.id,
          s.user_id::text AS user_id,
          s.source,
          s.created_at::text,
          s.updated_at::text,
          s.last_message_at::text,
          s.user_email,
          s.user_name
        FROM ai_assistant_sessions s
        WHERE s.id = $1
          AND COALESCE(s.context->>'instanceId', '') = $2
        LIMIT 1
      `,
      [sessionId, instanceId],
    );

    const session = sessionRes.rows[0] || null;
    if (!session) return NextResponse.json({ error: "NotFound" }, { status: 404 });

    const turnsRes = await pool.query<TurnRow>(
      `
        SELECT
          id,
          turn_index,
          user_message,
          assistant_message,
          created_at::text
        FROM ai_assistant_turns
        WHERE session_id = $1
        ORDER BY turn_index ASC
        LIMIT 300
      `,
      [sessionId],
    );

    return NextResponse.json(
      {
        instanceId,
        session: {
          id: session.id,
          source: session.source || null,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
          lastMessageAt: session.last_message_at,
          user: {
            id: session.user_id,
            email: session.user_email || "",
            name: session.user_name || null,
          },
          turns: turnsRes.rows.map((turn) => ({
            id: turn.id,
            turnIndex: Number(turn.turn_index || 0),
            userMessage: turn.user_message || "",
            assistantMessage: turn.assistant_message || null,
            createdAt: turn.created_at,
          })),
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (isUndefinedTableError(error) || isUndefinedColumnError(error)) {
      return NextResponse.json({ error: "NotFound" }, { status: 404 });
    }
    return NextResponse.json({ error: "InternalError" }, { status: 500 });
  }
}
