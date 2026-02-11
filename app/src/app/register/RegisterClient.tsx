"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useLanguage } from "@/contexts/LanguageContext";

export default function RegisterClient({ nextPath }: { nextPath?: string | null }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = useMemo(() => {
    if (!nextPath) return "/cabinet";
    if (!nextPath.startsWith("/")) return "/cabinet";
    return nextPath;
  }, [nextPath]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message || data?.error || "Ошибка регистрации");
        return;
      }
      router.replace(redirectTo);
    } catch {
      setError("Ошибка сети");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-100">
      <Header />
      <main className="flex-grow">
        <div className="container mx-auto px-4 py-10">
          <div className="max-w-md mx-auto bg-white rounded-xl shadow-sm p-8">
            <h1 className="text-2xl font-bold text-gray-800 mb-2">{t("auth.register") || "Регистрация"}</h1>
            <p className="text-gray-600 mb-6">
              {t("auth.registerDesc") || "Создайте аккаунт для кабинета и лимитов AI."}
            </p>

            {error && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  autoComplete="email"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#a0006d]/40"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("auth.name") || "Имя"}
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  type="text"
                  autoComplete="name"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#a0006d]/40"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("auth.password") || "Пароль"}
                </label>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#a0006d]/40"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t("auth.passwordHint") || "Минимум 8 символов."}
                </p>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-[#820251] text-white px-4 py-2.5 rounded-lg font-semibold hover:bg-[#6a0143] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? (t("common.loading") || "Загрузка...") : (t("auth.register") || "Создать")}
              </button>
            </form>

            <div className="mt-6 text-sm text-gray-600">
              <span>{t("auth.haveAccount") || "Уже есть аккаунт?"} </span>
              <Link href="/login" className="text-[#820251] hover:underline">
                {t("auth.login") || "Войти"}
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

