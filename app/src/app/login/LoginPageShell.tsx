import Link from "next/link";

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
  const registerHref = nextPath === "/cabinet" ? "/register" : `/register?next=${encodeURIComponent(nextPath)}`;

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800">
      <header className="bg-[#a0006d] text-white">
        <div className="max-w-xl mx-auto px-4 py-4">
          <span className="text-2xl font-semibold tracking-tight">Biznesinfo.by</span>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-8">
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8">
          <h1 className="text-3xl font-bold mb-2">Вход</h1>
          <p className="text-gray-600 mb-6">Войдите, чтобы открыть личный кабинет и лимиты AI.</p>

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
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#a0006d]/30"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-[#820251] text-white px-4 py-3 rounded-lg font-semibold hover:bg-[#6a0143] transition-colors"
            >
              Вход
            </button>
          </form>

          <div className="mt-6 flex items-center justify-between gap-4 text-sm">
            <Link href={registerHref} className="text-[#820251] hover:underline">
              Создать аккаунт
            </Link>
            <Link href="/reset" className="text-gray-600 hover:text-gray-800 hover:underline">
              Забыли пароль?
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
