"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useLanguage } from "@/contexts/LanguageContext";

type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: "user" | "admin";
  plan: "free" | "paid" | "partner";
  created_at: string;
  updated_at: string;
};

type PlanLimit = {
  plan: "free" | "paid" | "partner";
  ai_requests_per_day: number;
};

type PartnerDomain = {
  id: string;
  domain: string;
  ai_requests_per_day: number | null;
  created_at: string;
};

export default function AdminClient() {
  const { t } = useLanguage();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [limitsLoading, setLimitsLoading] = useState(true);
  const [domainsLoading, setDomainsLoading] = useState(true);
  const [limits, setLimits] = useState<PlanLimit[]>([]);
  const [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({});
  const [savingLimitPlan, setSavingLimitPlan] = useState<PlanLimit["plan"] | null>(null);
  const [partnerDomains, setPartnerDomains] = useState<PartnerDomain[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [newDomainLimit, setNewDomainLimit] = useState("");
  const [savingDomain, setSavingDomain] = useState(false);
  const [deletingDomain, setDeletingDomain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users?limit=100", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Ошибка");
        return;
      }
      setUsers(Array.isArray(data?.users) ? data.users : []);
    } catch {
      setError("Ошибка сети");
    } finally {
      setLoading(false);
    }
  };

  const loadPlanLimits = async () => {
    setLimitsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/plan-limits", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Ошибка");
        return;
      }
      const rows = Array.isArray(data?.limits) ? (data.limits as PlanLimit[]) : [];
      setLimits(rows);
      const drafts: Record<string, string> = {};
      for (const row of rows) drafts[row.plan] = String(row.ai_requests_per_day);
      setLimitDrafts(drafts);
    } catch {
      setError("Ошибка сети");
    } finally {
      setLimitsLoading(false);
    }
  };

  const loadPartnerDomains = async () => {
    setDomainsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/partner-domains?limit=200", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Ошибка");
        return;
      }
      setPartnerDomains(Array.isArray(data?.domains) ? data.domains : []);
    } catch {
      setError("Ошибка сети");
    } finally {
      setDomainsLoading(false);
    }
  };

  const loadAll = async () => {
    await Promise.all([loadUsers(), loadPlanLimits(), loadPartnerDomains()]);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [users]);

  const updateUser = async (userId: string, patch: Partial<Pick<AdminUser, "plan" | "role">>) => {
    setSavingUserId(userId);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Ошибка");
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...patch } as AdminUser : u)));
    } catch {
      setError("Ошибка сети");
    } finally {
      setSavingUserId(null);
    }
  };

  const savePlanLimit = async (plan: PlanLimit["plan"]) => {
    const raw = (limitDrafts[plan] || "").trim();
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      setError("Неверный лимит");
      return;
    }

    setSavingLimitPlan(plan);
    setError(null);
    try {
      const res = await fetch("/api/admin/plan-limits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, aiRequestsPerDay: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Ошибка");
        return;
      }
      const nextValue = Math.max(0, Math.floor(value));
      setLimits((prev) => prev.map((l) => (l.plan === plan ? { ...l, ai_requests_per_day: nextValue } : l)));
      setLimitDrafts((prev) => ({ ...prev, [plan]: String(nextValue) }));
    } catch {
      setError("Ошибка сети");
    } finally {
      setSavingLimitPlan(null);
    }
  };

  const upsertDomain = async () => {
    const domain = newDomain.trim().toLowerCase();
    const limitRaw = newDomainLimit.trim();
    const aiRequestsPerDay = limitRaw ? Number(limitRaw) : null;

    if (!domain || !domain.includes(".") || domain.includes("@") || domain.includes(" ")) {
      setError("Неверный домен");
      return;
    }
    if (aiRequestsPerDay != null && (!Number.isFinite(aiRequestsPerDay) || aiRequestsPerDay < 0)) {
      setError("Неверный лимит");
      return;
    }

    setSavingDomain(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/partner-domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, aiRequestsPerDay }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Ошибка");
        return;
      }
      setNewDomain("");
      setNewDomainLimit("");
      await loadPartnerDomains();
    } catch {
      setError("Ошибка сети");
    } finally {
      setSavingDomain(false);
    }
  };

  const removeDomain = async (domain: string) => {
    setDeletingDomain(domain);
    setError(null);
    try {
      const res = await fetch(`/api/admin/partner-domains?domain=${encodeURIComponent(domain)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Ошибка");
        return;
      }
      setPartnerDomains((prev) => prev.filter((d) => d.domain !== domain));
    } catch {
      setError("Ошибка сети");
    } finally {
      setDeletingDomain(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-100">
      <Header />
      <main className="flex-grow">
        <div className="container mx-auto px-4 py-10">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
            <h1 className="text-3xl font-bold text-gray-800">{t("admin.title") || "Админка"}</h1>
            <div className="flex items-center gap-2">
              <Link
                href="/admin/ai-requests"
                className="bg-gray-100 text-gray-800 px-4 py-2 rounded-lg font-semibold hover:bg-gray-200"
              >
                AI
              </Link>
              <Link
                href="/admin/ai-chats"
                className="bg-gray-100 text-gray-800 px-4 py-2 rounded-lg font-semibold hover:bg-gray-200"
              >
                AI чаты
              </Link>
              <button
                onClick={loadAll}
                className="bg-gray-900 text-white px-4 py-2 rounded-lg font-semibold hover:bg-black"
              >
                {t("admin.refresh") || "Обновить"}
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="bg-white rounded-lg p-8 text-gray-600">{t("common.loading") || "Загрузка..."}</div>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
                <table className="min-w-[900px] w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left px-4 py-3">Email</th>
                      <th className="text-left px-4 py-3">{t("auth.name") || "Имя"}</th>
                      <th className="text-left px-4 py-3">{t("cabinet.role") || "Роль"}</th>
                      <th className="text-left px-4 py-3">{t("cabinet.plan") || "План"}</th>
                      <th className="text-left px-4 py-3">{t("admin.created") || "Создан"}</th>
                      <th className="text-left px-4 py-3">{t("admin.actions") || "Действия"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{u.email}</td>
                        <td className="px-4 py-3 text-gray-700">{u.name || "—"}</td>
                        <td className="px-4 py-3">
                          <select
                            value={u.role}
                            onChange={(e) => updateUser(u.id, { role: e.target.value as any })}
                            disabled={savingUserId === u.id}
                            className="rounded border border-gray-300 px-2 py-1"
                          >
                            <option value="user">user</option>
                            <option value="admin">admin</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={u.plan}
                            onChange={(e) => updateUser(u.id, { plan: e.target.value as any })}
                            disabled={savingUserId === u.id}
                            className="rounded border border-gray-300 px-2 py-1"
                          >
                            <option value="free">free</option>
                            <option value="paid">paid</option>
                            <option value="partner">partner</option>
                          </select>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{new Date(u.created_at).toLocaleString()}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {savingUserId === u.id ? (t("common.loading") || "Загрузка...") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-8 grid gap-6 lg:grid-cols-2">
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h2 className="text-lg font-semibold text-gray-800 mb-1">Лимиты AI по планам</h2>
                  <p className="text-sm text-gray-600 mb-4">Количество запросов в день для каждого плана.</p>

                  {limitsLoading ? (
                    <div className="text-gray-600 text-sm">{t("common.loading") || "Загрузка..."}</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-[420px] w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                          <tr>
                            <th className="text-left px-3 py-2">План</th>
                            <th className="text-left px-3 py-2">Запросов/день</th>
                            <th className="text-left px-3 py-2">Сохранить</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {(["free", "paid", "partner"] as const).map((plan) => {
                            const row = limits.find((l) => l.plan === plan);
                            const draft = limitDrafts[plan] ?? (row ? String(row.ai_requests_per_day) : "");
                            return (
                              <tr key={plan} className="hover:bg-gray-50">
                                <td className="px-3 py-2 font-medium text-gray-900">{plan}</td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    min={0}
                                    value={draft}
                                    onChange={(e) => setLimitDrafts((prev) => ({ ...prev, [plan]: e.target.value }))}
                                    className="w-32 rounded border border-gray-300 px-2 py-1"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <button
                                    onClick={() => savePlanLimit(plan)}
                                    disabled={savingLimitPlan === plan}
                                    className="bg-gray-900 text-white px-3 py-1.5 rounded font-semibold hover:bg-black disabled:opacity-60"
                                  >
                                    {savingLimitPlan === plan ? (t("common.loading") || "…") : "Сохранить"}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h2 className="text-lg font-semibold text-gray-800 mb-1">Партнёрские домены</h2>
                  <p className="text-sm text-gray-600 mb-4">
                    Пользователи с email на этих доменах получают план <span className="font-medium">partner</span>.
                    Лимит можно оставить пустым — будет использован лимит плана.
                  </p>

                  <div className="flex flex-wrap gap-2 items-end mb-4">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-600">Домен</span>
                      <input
                        value={newDomain}
                        onChange={(e) => setNewDomain(e.target.value)}
                        placeholder="example.com"
                        className="w-56 rounded border border-gray-300 px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-600">Лимит (опц.)</span>
                      <input
                        value={newDomainLimit}
                        onChange={(e) => setNewDomainLimit(e.target.value)}
                        placeholder="10"
                        className="w-32 rounded border border-gray-300 px-3 py-2 text-sm"
                      />
                    </label>
                    <button
                      onClick={upsertDomain}
                      disabled={savingDomain}
                      className="bg-gray-900 text-white px-4 py-2 rounded-lg font-semibold hover:bg-black disabled:opacity-60"
                    >
                      {savingDomain ? (t("common.loading") || "…") : "Добавить/обновить"}
                    </button>
                  </div>

                  {domainsLoading ? (
                    <div className="text-gray-600 text-sm">{t("common.loading") || "Загрузка..."}</div>
                  ) : partnerDomains.length === 0 ? (
                    <div className="text-gray-600 text-sm">Список пуст.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-[520px] w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                          <tr>
                            <th className="text-left px-3 py-2">Домен</th>
                            <th className="text-left px-3 py-2">Лимит</th>
                            <th className="text-left px-3 py-2">Создан</th>
                            <th className="text-left px-3 py-2">Действия</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {partnerDomains.map((d) => (
                            <tr key={d.id} className="hover:bg-gray-50">
                              <td className="px-3 py-2 font-medium text-gray-900">{d.domain}</td>
                              <td className="px-3 py-2 text-gray-700">
                                {d.ai_requests_per_day == null ? "по плану" : d.ai_requests_per_day}
                              </td>
                              <td className="px-3 py-2 text-gray-600">{new Date(d.created_at).toLocaleString()}</td>
                              <td className="px-3 py-2">
                                <button
                                  onClick={() => removeDomain(d.domain)}
                                  disabled={deletingDomain === d.domain}
                                  className="text-red-700 hover:text-red-900 font-semibold disabled:opacity-60"
                                >
                                  {deletingDomain === d.domain ? (t("common.loading") || "…") : "Удалить"}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
