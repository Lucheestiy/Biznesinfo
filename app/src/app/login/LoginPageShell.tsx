import Link from "next/link";
import PasswordField from "./PasswordField";

function loginErrorMessage(code?: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "invalid":
      return "Неверный email или пароль.";
    case "missing":
      return "Введите email и пароль.";
    case "rate_limited":
      return "Слишком много попыток. Подождите и попробуйте снова.";
    case "csrf":
      return "Ошибка безопасности запроса. Обновите страницу и попробуйте снова.";
    default:
      return "Не удалось выполнить вход. Попробуйте снова.";
  }
}

export default function LoginPageShell({
  nextPath,
  errorCode,
}: {
  nextPath: string;
  errorCode?: string | null;
}) {
  const error = loginErrorMessage(errorCode);
  const registerHref = "/add-company";

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800">
      <header className="bg-[#a0006d] text-white">
        <div className="max-w-xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white transition-colors hover:bg-white/20"
              aria-label="На главную"
              title="На главную"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
                <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <Link href="/" className="text-2xl font-semibold tracking-tight hover:opacity-90 transition-opacity">
              biznesinfo.by
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-8">
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8">
          <h1 className="text-3xl font-bold mb-2">Вход</h1>
          <p className="text-gray-600 mb-6">
            Войдите, чтобы открыть личный кабинет портала. AI-ассистент и функции кабинета доступны только авторизованным пользователям.
          </p>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <form method="post" action="/api/auth/login" className="space-y-4">
            <input type="hidden" name="next" value={nextPath} />

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#a0006d]/30"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Пароль
              </label>
              <PasswordField />
            </div>

            <div className="flex justify-end">
              <Link href="/reset" className="text-sm text-[#820251] hover:underline">
                Забыли пароль?
              </Link>
            </div>

            <button
              type="submit"
              className="w-full bg-[#820251] text-white px-4 py-3 rounded-lg font-semibold hover:bg-[#6a0143] transition-colors"
            >
              Вход
            </button>
          </form>

          <div className="mt-6 text-sm">
            <Link href={registerHref} className="text-[#820251] hover:underline">
              Создать аккаунт
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
