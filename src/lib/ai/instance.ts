const DEFAULT_AI_INSTANCE_ID = "biznesinfo.lucheestiy.com";

function normalizeInstanceId(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;

  if (value.includes("://")) {
    try {
      const parsed = new URL(value);
      const host = String(parsed.host || "").trim().toLowerCase();
      return host || null;
    } catch {
      // fall through to best-effort normalization
    }
  }

  const withoutPath = value.split("/")[0]?.trim().toLowerCase() || "";
  return withoutPath || null;
}

export function getAiInstanceId(): string {
  const explicit = normalizeInstanceId(process.env.AI_INSTANCE_ID || "");
  if (explicit) return explicit;

  const fromBaseUrl = normalizeInstanceId(process.env.PUBLIC_BASE_URL || "");
  if (fromBaseUrl) return fromBaseUrl;

  return DEFAULT_AI_INSTANCE_ID;
}
