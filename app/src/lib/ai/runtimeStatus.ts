import "server-only";

import { readFile } from "node:fs/promises";

export type AssistantRuntimeStatus = {
  provider: "stub" | "openai" | "codex";
  state: "online" | "fallback";
  reason: "provider_ready" | "missing_openai_key" | "missing_codex_auth" | "stub_mode";
};

function getConfiguredProvider(): AssistantRuntimeStatus["provider"] {
  const raw = (process.env.AI_ASSISTANT_PROVIDER || "stub").trim().toLowerCase();
  if (raw === "openai") return "openai";
  if (raw === "codex" || raw === "codex-auth" || raw === "codex_cli") return "codex";
  return "stub";
}

async function hasCodexAccessToken(): Promise<boolean> {
  const candidates = Array.from(
    new Set(
      [
        (process.env.CODEX_AUTH_JSON_PATH || "").trim(),
        "/run/secrets/codex_auth_json",
        "/root/.codex/auth.json",
      ].filter(Boolean),
    ),
  );

  for (const source of candidates) {
    try {
      const raw = (await readFile(source, "utf8")).trim();
      if (!raw) continue;

      if (raw.startsWith("{")) {
        try {
          const parsed: unknown = JSON.parse(raw);
          const token =
            parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as any)?.tokens?.access_token : null;
          if (typeof token === "string" && token.trim()) return true;
        } catch {
          // Ignore malformed JSON and continue with the next candidate.
        }
      }

      if (!raw.includes("\n") && raw.length > 10) return true;
    } catch {
      // Ignore unreadable auth candidates.
    }
  }

  return false;
}

export async function getAssistantRuntimeStatus(): Promise<AssistantRuntimeStatus> {
  const provider = getConfiguredProvider();

  if (provider === "openai") {
    return {
      provider,
      state: (process.env.OPENAI_API_KEY || "").trim() ? "online" : "fallback",
      reason: (process.env.OPENAI_API_KEY || "").trim() ? "provider_ready" : "missing_openai_key",
    };
  }

  if (provider === "codex") {
    const hasAuth = await hasCodexAccessToken();
    return {
      provider,
      state: hasAuth ? "online" : "fallback",
      reason: hasAuth ? "provider_ready" : "missing_codex_auth",
    };
  }

  return {
    provider: "stub",
    state: "fallback",
    reason: "stub_mode",
  };
}
