export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { biznesinfoWarmStore } = await import("@/lib/biznesinfo/store");
    await biznesinfoWarmStore();
  } catch {
    // App keeps running; warmup will retry on next request.
  }
}
