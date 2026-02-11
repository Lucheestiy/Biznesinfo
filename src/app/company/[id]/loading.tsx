export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="h-14 bg-white shadow-sm" />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="animate-pulse">
          <div className="h-48 md:h-64 rounded-3xl bg-gray-200" />

          <div className="mt-6 flex items-start gap-4">
            <div className="h-20 w-20 rounded-2xl bg-gray-200" />
            <div className="flex-1 min-w-0">
              <div className="h-7 w-2/3 rounded bg-gray-200" />
              <div className="mt-3 h-4 w-1/2 rounded bg-gray-200" />
              <div className="mt-2 h-4 w-1/3 rounded bg-gray-200" />
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="h-32 rounded-2xl bg-gray-200" />
            <div className="h-32 rounded-2xl bg-gray-200" />
          </div>
        </div>
      </div>
    </div>
  );
}

