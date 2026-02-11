"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useLanguage } from "@/contexts/LanguageContext";

export default function CabinetClient({
  user,
}: {
  user: { email: string; name: string | null; plan: string; role: string };
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [name, setName] = useState(user.name || "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdSaved, setPwdSaved] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);

  useEffect(() => {
    if (!profileSaved) return;
    const id = setTimeout(() => setProfileSaved(false), 2500);
    return () => clearTimeout(id);
  }, [profileSaved]);

  useEffect(() => {
    if (!pwdSaved) return;
    const id = setTimeout(() => setPwdSaved(false), 2500);
    return () => clearTimeout(id);
  }, [pwdSaved]);

  const planLabel = useMemo(() => {
    if (user.plan === "free") return t("plan.free") || "free";
    if (user.plan === "paid") return t("plan.paid") || "paid";
    if (user.plan === "partner") return t("plan.partner") || "partner";
    return user.plan;
  }, [t, user.plan]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  };

  const saveProfile = async () => {
    setProfileError(null);
    setProfileSaved(false);
    setProfileSaving(true);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProfileError(data?.error || "Ошибка");
        return;
      }
      setProfileSaved(true);
      router.refresh();
    } catch {
      setProfileError("Ошибка сети");
    } finally {
      setProfileSaving(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    setPwdSaved(false);
    setPwdSaving(true);
    try {
      const res = await fetch("/api/user/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwdError(data?.error || "Ошибка");
        return;
      }
      setPwdSaved(true);
      setCurrentPassword("");
      setNewPassword("");
    } catch {
      setPwdError("Ошибка сети");
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-100">
      <Header />

      <main className="flex-grow">
        <div className="bg-white border-b border-gray-200">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Link href="/" className="hover:text-[#820251]">
                {t("common.home")}
              </Link>
              <span>/</span>
              <span className="text-[#820251] font-medium">
                {t("cabinet.title") || "Личный кабинет"}
              </span>
            </div>
          </div>
        </div>

        <div className="container mx-auto py-10 px-4">
          <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-sm p-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">
              {t("cabinet.title") || "Личный кабинет"}
            </h1>
            <p className="text-gray-600 mb-6">
              {t("cabinet.welcome") || "Добро пожаловать!"}
            </p>

            <div className="rounded-xl border border-gray-200 p-5 mb-6">
              <div className="text-sm text-gray-500">{t("cabinet.profile") || "Профиль"}</div>
              <div className="mt-2 space-y-1 text-gray-800">
                <div><span className="text-gray-500">Email:</span> {user.email}</div>
                <div className="pt-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("auth.name") || "Имя"}
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    type="text"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#a0006d]/40"
                    placeholder={t("cabinet.namePlaceholder") || "Ваше имя"}
                  />
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      onClick={saveProfile}
                      disabled={profileSaving}
                      className="inline-flex items-center justify-center bg-gray-900 text-white px-4 py-2 rounded-lg font-semibold hover:bg-black disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {profileSaving ? (t("common.loading") || "Загрузка...") : (t("cabinet.save") || "Сохранить")}
                    </button>
                    {profileSaved && <span className="text-sm text-green-700">{t("cabinet.saved") || "Сохранено"}</span>}
                    {profileError && <span className="text-sm text-red-700">{profileError}</span>}
                  </div>
                </div>

                <div className="pt-2"><span className="text-gray-500">{t("cabinet.plan") || "План"}:</span> {planLabel}</div>
                <div><span className="text-gray-500">{t("cabinet.role") || "Роль"}:</span> {user.role}</div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 p-5 mb-6">
              <div className="text-sm text-gray-500">{t("cabinet.password") || "Пароль"}</div>
              <form onSubmit={changePassword} className="mt-3 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("cabinet.currentPassword") || "Текущий пароль"}
                  </label>
                  <input
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    type="password"
                    autoComplete="current-password"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#a0006d]/40"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("cabinet.newPassword") || "Новый пароль"}
                  </label>
                  <input
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#a0006d]/40"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">{t("auth.passwordHint") || "Минимум 8 символов."}</p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={pwdSaving}
                    className="inline-flex items-center justify-center bg-gray-900 text-white px-4 py-2 rounded-lg font-semibold hover:bg-black disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {pwdSaving ? (t("common.loading") || "Загрузка...") : (t("cabinet.changePassword") || "Сменить пароль")}
                  </button>
                  {pwdSaved && <span className="text-sm text-green-700">{t("cabinet.saved") || "Сохранено"}</span>}
                  {pwdError && <span className="text-sm text-red-700">{pwdError}</span>}
                </div>
              </form>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/favorites"
                className="inline-flex items-center justify-center bg-[#820251] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[#6a0143] transition-colors"
              >
                {t("favorites.title") || "Избранное"}
              </Link>
              <button
                onClick={logout}
                className="inline-flex items-center justify-center bg-gray-100 text-gray-800 px-6 py-3 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
              >
                {t("auth.logout") || "Выйти"}
              </button>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
