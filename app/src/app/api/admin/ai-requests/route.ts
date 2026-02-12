import { NextResponse } from "next/server";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import { getDbPool } from "@/lib/auth/db";

export const runtime = "nodejs";

type RequestCityRegionHint = {
  source: "currentMessage" | "lookupSeed" | "historySeed";
  city: string | null;
  region: string | null;
  phrase: string | null;
};
type RequestWebsiteScanDepth = {
  deepScanUsed: boolean;
  deepScanUsedCount: number;
  scannedPagesTotal: number;
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function parseBoolQueryParam(raw: string | null): boolean {
  const value = (raw || "").trim().toLowerCase();
  if (!value) return false;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

type ProviderFilter = "stub" | "openai" | "codex";

function parseProviderFilter(raw: string | null): ProviderFilter | null {
  const value = (raw || "").trim().toLowerCase();
  if (value === "stub" || value === "openai" || value === "codex") return value;
  return null;
}

function truncate(raw: string, max: number): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function getProviderStatus() {
  const providerRaw = (process.env.AI_ASSISTANT_PROVIDER || "stub").trim().toLowerCase();
  const provider = providerRaw === "openai" ? "openai" : (providerRaw === "codex" || providerRaw === "codex-auth" || providerRaw === "codex_cli" ? "codex" : "stub");
  const openaiModel = (process.env.OPENAI_MODEL || "").trim() || "gpt-4o-mini";
  const openaiBaseUrl = (process.env.OPENAI_BASE_URL || "").trim() || "https://api.openai.com/v1";
  const hasOpenaiKey = Boolean((process.env.OPENAI_API_KEY || "").trim());
  const codexModel = (process.env.CODEX_MODEL || "").trim() || "gpt-5.2-codex";
  const codexBaseUrl = (process.env.CODEX_BASE_URL || "").trim() || "https://chatgpt.com/backend-api/codex";
  const hasCodexAuthPath = Boolean((process.env.CODEX_AUTH_JSON_PATH || "").trim());

  return {
    provider,
    openai: {
      model: openaiModel,
      baseUrl: openaiBaseUrl,
      hasKey: hasOpenaiKey,
    },
    codex: {
      model: codexModel,
      baseUrl: codexBaseUrl,
      hasAuthPath: hasCodexAuthPath,
    },
  };
}

export async function GET(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const limit = clampInt(Number(searchParams.get("limit") || "100"), 1, 200);
  const offset = clampInt(Number(searchParams.get("offset") || "0"), 0, 10_000);
  const provider = parseProviderFilter(searchParams.get("provider"));
  const onlyErrors = parseBoolQueryParam(searchParams.get("onlyErrors"));
  const onlyWebsiteAttempted = parseBoolQueryParam(searchParams.get("onlyWebsiteAttempted"));
  const onlyWebsiteDeep = parseBoolQueryParam(searchParams.get("onlyWebsiteDeep"));
  const providerValue = provider || "";

  const pool = getDbPool();
  const countRes = await pool.query<{ total_count: string }>(
    `
      SELECT COUNT(*)::bigint AS total_count
      FROM ai_requests r
      JOIN users u ON u.id = r.user_id
      WHERE ($1::boolean = FALSE OR (r.payload #>> '{_assistant,request,websiteScanDepth,deepScanUsed}') = 'true')
        AND ($2::text = '' OR COALESCE(NULLIF(LOWER(r.payload #>> '{_assistant,response,provider}'), ''), 'stub') = $2::text)
        AND ($3::boolean = FALSE OR COALESCE(jsonb_typeof(r.payload #> '{_assistant,response,providerError}') = 'object', FALSE))
        AND ($4::boolean = FALSE OR COALESCE((r.payload #>> '{_assistant,request,websiteScanAttempted}') = 'true', FALSE))
    `,
    [onlyWebsiteDeep, providerValue, onlyErrors, onlyWebsiteAttempted],
  );
  const total = Math.max(0, Number(countRes.rows[0]?.total_count || "0") || 0);

  const listRes = await pool.query<{
    id: string;
    user_id: string;
    company_id: string | null;
    message: string;
    created_at: Date;
    payload: any;
    email: string;
    name: string | null;
    plan: string;
  }>(
    `
      SELECT r.id, r.user_id, r.company_id, r.message, r.created_at, r.payload,
             u.email, u.name, u.plan
      FROM ai_requests r
      JOIN users u ON u.id = r.user_id
      WHERE ($3::boolean = FALSE OR (r.payload #>> '{_assistant,request,websiteScanDepth,deepScanUsed}') = 'true')
        AND ($4::text = '' OR COALESCE(NULLIF(LOWER(r.payload #>> '{_assistant,response,provider}'), ''), 'stub') = $4::text)
        AND ($5::boolean = FALSE OR COALESCE(jsonb_typeof(r.payload #> '{_assistant,response,providerError}') = 'object', FALSE))
        AND ($6::boolean = FALSE OR COALESCE((r.payload #>> '{_assistant,request,websiteScanAttempted}') = 'true', FALSE))
      ORDER BY r.created_at DESC
      LIMIT $1 OFFSET $2
    `,
    [limit, offset, onlyWebsiteDeep, providerValue, onlyErrors, onlyWebsiteAttempted],
  );

  const requests = listRes.rows.map((row) => {
    const payload = row.payload ?? null;
    const assistant = payload && typeof payload === "object" && !Array.isArray(payload) ? payload._assistant : null;
    const requestMeta = assistant && typeof assistant === "object" && !Array.isArray(assistant) ? assistant.request : null;
    const responseMeta = assistant && typeof assistant === "object" && !Array.isArray(assistant) ? assistant.response : null;
    const guardrails = assistant && typeof assistant === "object" && !Array.isArray(assistant) ? assistant.guardrails : null;

    const provider = typeof responseMeta?.provider === "string" ? responseMeta.provider : null;
    const model = typeof responseMeta?.model === "string" ? responseMeta.model : null;
    const isStub = Boolean(responseMeta?.isStub);
    const providerError =
      responseMeta?.providerError && typeof responseMeta.providerError === "object" && !Array.isArray(responseMeta.providerError)
        ? {
            name: typeof responseMeta.providerError.name === "string" ? responseMeta.providerError.name : "ProviderError",
            message: truncate(
              typeof responseMeta.providerError.message === "string" ? responseMeta.providerError.message : "",
              240,
            ),
          }
        : null;

    const promptInjection = guardrails?.promptInjection ?? null;
    const injectionFlagged = Boolean(promptInjection?.flagged);
    const injectionSignals = Array.isArray(promptInjection?.signals)
      ? promptInjection.signals.filter((s: unknown) => typeof s === "string").slice(0, 12)
      : [];

    const replyText = typeof responseMeta?.text === "string" ? responseMeta.text : null;
    const replyPreview = replyText ? truncate(replyText, 280) : null;

    const templateMeta =
      responseMeta?.template && typeof responseMeta.template === "object" && !Array.isArray(responseMeta.template)
        ? responseMeta.template
        : null;
    const template = templateMeta
      ? {
          hasSubject: Boolean(templateMeta.hasSubject),
          hasBody: Boolean(templateMeta.hasBody),
          hasWhatsApp: Boolean(templateMeta.hasWhatsApp),
          isCompliant: Boolean(templateMeta.isCompliant),
        }
      : null;

    const canceled = Boolean(responseMeta?.canceled);
    const durationMs = typeof responseMeta?.durationMs === "number" ? Math.max(0, Math.floor(responseMeta.durationMs)) : null;
    const usageMeta =
      responseMeta?.usage && typeof responseMeta.usage === "object" && !Array.isArray(responseMeta.usage) ? responseMeta.usage : null;
    const usage =
      usageMeta &&
      typeof usageMeta.inputTokens === "number" &&
      typeof usageMeta.outputTokens === "number" &&
      typeof usageMeta.totalTokens === "number"
        ? {
            inputTokens: Math.max(0, Math.floor(usageMeta.inputTokens)),
            outputTokens: Math.max(0, Math.floor(usageMeta.outputTokens)),
            totalTokens: Math.max(0, Math.floor(usageMeta.totalTokens)),
          }
        : null;

    const feedbackMeta =
      assistant?.feedback && typeof assistant.feedback === "object" && !Array.isArray(assistant.feedback) ? assistant.feedback : null;
    const feedback = feedbackMeta
      ? {
          rating: feedbackMeta.rating === "down" ? "down" : "up",
          reason: typeof feedbackMeta.reason === "string" ? feedbackMeta.reason : null,
          createdAt: typeof feedbackMeta.createdAt === "string" ? feedbackMeta.createdAt : null,
        }
      : null;

    const companyIds = Array.isArray(requestMeta?.companyIds)
      ? requestMeta.companyIds.filter((x: unknown) => typeof x === "string").slice(0, 16)
      : [];
    const vendorLookupFiltersRaw =
      requestMeta?.vendorLookupFilters && typeof requestMeta.vendorLookupFilters === "object" && !Array.isArray(requestMeta.vendorLookupFilters)
        ? requestMeta.vendorLookupFilters
        : null;
    const vendorLookupFilters = {
      city: typeof vendorLookupFiltersRaw?.city === "string" ? truncate(vendorLookupFiltersRaw.city, 72) : null,
      region: typeof vendorLookupFiltersRaw?.region === "string" ? truncate(vendorLookupFiltersRaw.region, 72) : null,
    };
    const cityRegionHints: RequestCityRegionHint[] = Array.isArray(requestMeta?.cityRegionHints)
      ? requestMeta.cityRegionHints
          .filter((x: unknown) => x && typeof x === "object" && !Array.isArray(x))
          .map((x: unknown): RequestCityRegionHint => {
            const raw = x as Record<string, unknown>;
            return {
              source:
                raw.source === "lookupSeed" || raw.source === "historySeed" || raw.source === "currentMessage"
                  ? raw.source
                  : "currentMessage",
              city: typeof raw.city === "string" ? truncate(raw.city, 72) : null,
              region: typeof raw.region === "string" ? truncate(raw.region, 72) : null,
              phrase: typeof raw.phrase === "string" ? truncate(raw.phrase, 72) : null,
            };
          })
          .filter((x: RequestCityRegionHint) => Boolean(x.city || x.region || x.phrase))
          .slice(0, 6)
      : [];
    const websiteScanDepthRaw =
      requestMeta?.websiteScanDepth && typeof requestMeta.websiteScanDepth === "object" && !Array.isArray(requestMeta.websiteScanDepth)
        ? requestMeta.websiteScanDepth
        : null;
    const websiteScanDepth: RequestWebsiteScanDepth = {
      deepScanUsed: Boolean(websiteScanDepthRaw?.deepScanUsed),
      deepScanUsedCount:
        typeof websiteScanDepthRaw?.deepScanUsedCount === "number"
          ? Math.max(0, Math.floor(websiteScanDepthRaw.deepScanUsedCount))
          : 0,
      scannedPagesTotal:
        typeof websiteScanDepthRaw?.scannedPagesTotal === "number"
          ? Math.max(0, Math.floor(websiteScanDepthRaw.scannedPagesTotal))
          : 0,
    };
    const websiteScanTargetCount =
      typeof requestMeta?.websiteScanTargetCount === "number" ? Math.max(0, Math.floor(requestMeta.websiteScanTargetCount)) : 0;
    const websiteScanInsightCount =
      typeof requestMeta?.websiteScanInsightCount === "number" ? Math.max(0, Math.floor(requestMeta.websiteScanInsightCount)) : 0;
    const websiteScanAttempted = Boolean(requestMeta?.websiteScanAttempted);

    const plan = typeof requestMeta?.plan === "string" ? requestMeta.plan : row.plan;
    const guardrailsVersion = typeof guardrails?.version === "number" ? guardrails.version : null;
    const hasPrompt = Array.isArray(assistant?.prompt);

    return {
      id: row.id,
      createdAt: row.created_at,
      user: { id: row.user_id, email: row.email, name: row.name },
      plan,
      companyId: row.company_id,
      companyIds,
      vendorLookupFilters,
      cityRegionHints,
      websiteScan: {
        attempted: websiteScanAttempted,
        targetCount: websiteScanTargetCount,
        insightCount: websiteScanInsightCount,
        depth: websiteScanDepth,
      },
      messagePreview: truncate(row.message, 240),
      provider: provider || "stub",
      model,
      isStub,
      providerError,
      injectionFlagged,
      injectionSignals,
      guardrailsVersion,
      hasPrompt,
      replyPreview,
      template,
      canceled,
      durationMs,
      usage,
      feedback,
    };
  });

  const returned = requests.length;
  const hasMore = offset + returned < total;

  return NextResponse.json(
    {
      success: true,
      status: getProviderStatus(),
      filters: { provider, onlyErrors, onlyWebsiteAttempted, onlyWebsiteDeep },
      pagination: { limit, offset, returned, total, hasMore },
      requests,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
