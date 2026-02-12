"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: "user" | "admin";
};

type ChatSessionRow = {
  id: string;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  turnCount: number;
  lastUserMessage: string | null;
  lastAssistantMessage: string | null;
  user?: { id: string; email: string; name: string | null } | null;
};

type ChatTurn = {
  id: string;
  turnIndex: number;
  userMessage: string;
  assistantMessage: string | null;
  createdAt: string;
};

type ChatSessionDetail = {
  id: string;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  user: { id: string; email: string; name: string | null } | null;
  turns: ChatTurn[];
};

function fmtDateTime(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function shortText(value: string | null | undefined, max = 180): string {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export default function AiChatsAdminClient({
  currentUser,
  instanceId,
}: {
  currentUser: CurrentUser;
  instanceId: string;
}) {
  const [scope, setScope] = useState<"mine" | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSessionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChatSessionDetail | null>(null);

  const selectedSession = useMemo(
    () => sessions.find((item) => item.id === selectedId) || null,
    [sessions, selectedId],
  );

  const loadSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "120");
      qs.set("scope", scope);
      const res = await fetch(`/api/admin/ai-chats?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(data?.error || "Ошибка загрузки истории"));
        setSessions([]);
        return;
      }
      const rows = Array.isArray(data?.sessions) ? data.sessions : [];
      setSessions(rows);
      if (!selectedId && rows[0]?.id) setSelectedId(rows[0].id);
      if (selectedId && !rows.find((r: ChatSessionRow) => r.id === selectedId)) {
        setSelectedId(rows[0]?.id || null);
      }
    } catch {
      setError("Ошибка сети при загрузке истории.");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  const openSession = async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/admin/ai-chats/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDetailError(String(data?.error || "Не удалось загрузить диалог."));
        return;
      }
      setDetail((data?.session || null) as ChatSessionDetail | null);
    } catch {
      setDetailError("Ошибка сети при загрузке диалога.");
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    openSession(selectedId);
  }, [selectedId]);

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-100">
      <Header />
      <main className="flex-grow">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">AI чаты (админ)</h1>
              <p className="text-sm text-gray-600 mt-1">Показываются только чаты текущего инстанса: {instanceId}</p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/admin"
                className="inline-flex items-center justify-center rounded-lg bg-gray-100 px-4 py-2 text-gray-800 font-semibold hover:bg-gray-200 transition-colors"
              >
                В админку
              </Link>
              <Link
                href="/assistant"
                className="inline-flex items-center justify-center rounded-lg bg-[#820251] px-4 py-2 text-white font-semibold hover:bg-[#6d0245] transition-colors"
              >
                Открыть ассистента
              </Link>
              <button
                type="button"
                onClick={loadSessions}
                className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-white font-semibold hover:bg-black transition-colors"
              >
                Обновить
              </button>
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
            Админ: <span className="font-semibold">{currentUser.name || currentUser.email}</span> ({currentUser.role})
          </div>

          <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
            <label className="text-sm text-gray-700 font-medium mr-3">Режим просмотра:</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value === "mine" ? "mine" : "all")}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="all">Все чаты (admin)</option>
              <option value="mine">Только мои чаты</option>
            </select>
          </div>

          {(error || detailError) && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error || detailError}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)] gap-4">
            <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="text-sm text-gray-600">
                  Сессий: <span className="font-semibold text-gray-900">{sessions.length}</span>
                </div>
              </div>

              <div className="max-h-[70vh] overflow-y-auto">
                {loading ? (
                  <div className="p-4 text-sm text-gray-600">Загрузка списка чатов...</div>
                ) : sessions.length === 0 ? (
                  <div className="p-4 text-sm text-gray-600">История пока пустая.</div>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {sessions.map((session) => {
                      const active = session.id === selectedId;
                      return (
                        <li key={session.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(session.id)}
                            className={`w-full text-left px-4 py-3 transition-colors ${
                              active ? "bg-[#f7eaf2]" : "hover:bg-gray-50"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-xs text-gray-500">
                                  {fmtDateTime(session.lastMessageAt)} • {session.turnCount} ход(ов)
                                </div>
                                <div className="text-sm font-semibold text-gray-900 mt-1 break-all">{session.id}</div>
                                {session.user && (
                                  <div className="text-xs text-gray-600 mt-1 truncate">
                                    {session.user.name || session.user.email}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="text-sm text-gray-700 mt-2">
                              <span className="font-semibold">Вы:</span>{" "}
                              {shortText(session.lastUserMessage, 120) || "—"}
                            </div>
                            <div className="text-sm text-gray-700 mt-1">
                              <span className="font-semibold">Ассистент:</span>{" "}
                              {shortText(session.lastAssistantMessage, 120) || "—"}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="text-sm text-gray-600">
                  {selectedSession ? (
                    <>
                      Диалог: <span className="font-semibold text-gray-900 break-all">{selectedSession.id}</span>
                    </>
                  ) : (
                    "Выберите диалог слева"
                  )}
                </div>
              </div>

              <div className="p-4 max-h-[70vh] overflow-y-auto">
                {detailLoading ? (
                  <div className="text-sm text-gray-600">Загрузка диалога...</div>
                ) : !detail ? (
                  <div className="text-sm text-gray-600">Диалог не выбран.</div>
                ) : detail.turns.length === 0 ? (
                  <div className="text-sm text-gray-600">В этой сессии пока нет сообщений.</div>
                ) : (
                  <div className="space-y-4">
                    {detail.turns.map((turn) => (
                      <div key={turn.id} className="space-y-2">
                        <div className="text-xs text-gray-500">
                          Ход #{turn.turnIndex} • {fmtDateTime(turn.createdAt)}
                        </div>
                        <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
                          <div className="text-xs font-semibold text-blue-800 mb-1">Вы</div>
                          <div className="whitespace-pre-wrap text-sm text-gray-900">{turn.userMessage}</div>
                        </div>
                        <div className="rounded-xl border border-purple-100 bg-purple-50 px-3 py-2">
                          <div className="text-xs font-semibold text-purple-800 mb-1">Ассистент</div>
                          <div className="whitespace-pre-wrap text-sm text-gray-900">{turn.assistantMessage || "—"}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
