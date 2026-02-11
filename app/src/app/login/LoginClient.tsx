"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useLanguage } from "@/contexts/LanguageContext";

export default function LoginClient({ nextPath }: { nextPath?: string | null }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [email, setEmail] = useState("");
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
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message || data?.error || "Ошибка входа");
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
            <h1 className="text-2xl font-bold text-gray-800 mb-2">{t("auth.login") || "Вход"}</h1>
            <p className="text-gray-600 mb-6">
              {t("auth.loginDesc") || "Войдите, чтобы открыть личный кабинет и лимиты AI."}
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
                  {t("auth.password") || "Пароль"}
                </label>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete="current-password"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#a0006d]/40"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-[#820251] text-white px-4 py-2.5 rounded-lg font-semibold hover:bg-[#6a0143] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? (t("common.loading") || "Загрузка...") : (t("auth.login") || "Войти")}
              </button>
            </form>

            <div className="mt-6 text-sm text-gray-600 flex items-center justify-between">
              <Link href="/register" className="text-[#820251] hover:underline">
                {t("auth.createAccount") || "Создать аккаунт"}
              </Link>
              <Link href="/reset" className="text-gray-600 hover:underline">
                {t("auth.forgot") || "Забыли пароль?"}
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

