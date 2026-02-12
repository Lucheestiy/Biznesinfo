"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useLanguage } from "@/contexts/LanguageContext";

type ProviderStatus = {
  provider: "stub" | "openai" | "codex";
  openai: { model: string; baseUrl: string; hasKey: boolean };
  codex: { model: string; baseUrl: string; hasAuthPath: boolean };
};

type AiRequestListRow = {
  id: string;
  createdAt: string;
  user: { id: string; email: string; name: string | null };
  plan: string;
  companyId: string | null;
  companyIds: string[];
  vendorLookupFilters: { city: string | null; region: string | null };
  cityRegionHints: Array<{
    source: "currentMessage" | "lookupSeed" | "historySeed";
    city: string | null;
    region: string | null;
    phrase: string | null;
  }>;
  websiteScan: {
    attempted: boolean;
    targetCount: number;
    insightCount: number;
    depth: {
      deepScanUsed: boolean;
      deepScanUsedCount: number;
      scannedPagesTotal: number;
    };
  };
  messagePreview: string;
  provider: string;
  model: string | null;
  isStub: boolean;
  providerError: { name: string; message: string } | null;
  injectionFlagged: boolean;
  injectionSignals: string[];
  guardrailsVersion: number | null;
  hasPrompt: boolean;
  replyPreview: string | null;
  template: { hasSubject: boolean; hasBody: boolean; hasWhatsApp: boolean; isCompliant: boolean } | null;
  canceled: boolean;
  durationMs: number | null;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
  feedback: { rating: "up" | "down"; reason: string | null; createdAt: string | null } | null;
};

type AiRequestDetail = {
  id: string;
  createdAt: string;
  user: { id: string; email: string; name: string | null; plan: string };
  companyId: string | null;
  message: string;
  websiteScan: {
    attempted: boolean;
    targetCount: number;
    insightCount: number;
    depth: {
      deepScanUsed: boolean;
      deepScanUsedCount: number;
      scannedPagesTotal: number;
    };
  } | null;
  payload: unknown;
};

type ProviderFilterOption = "all" | "stub" | "openai" | "codex";
type FilterPreset = "errors_non_stub" | "web_attempted_deep" | "down_feedback";
type ListPagination = {
  limit: number;
  offset: number;
  returned: number;
  total: number;
  hasMore: boolean;
};

const DEFAULT_PAGE_SIZE = 100;
const PAGE_SIZE_OPTIONS = [50, 100, 200] as const;

function parseBoolSearchParam(raw: string | null): boolean {
  const value = (raw || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function parseIntSearchParam(raw: string | null, fallback: number, min: number, max: number): number {
  const value = Number(raw || "");
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function parseProviderFilterOption(raw: string | null): ProviderFilterOption {
  const value = (raw || "").trim().toLowerCase();
  if (value === "stub" || value === "openai" || value === "codex") return value;
  return "all";
}

function parseFilterPreset(raw: string | null): FilterPreset | null {
  const value = (raw || "").trim().toLowerCase();
  if (value === "errors_non_stub" || value === "web_attempted_deep" || value === "down_feedback") return value;
  return null;
}

function parsePageSize(raw: string | null): number {
  const value = parseIntSearchParam(raw, DEFAULT_PAGE_SIZE, 1, 200);
  return PAGE_SIZE_OPTIONS.includes(value as (typeof PAGE_SIZE_OPTIONS)[number]) ? value : DEFAULT_PAGE_SIZE;
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function formatDurationShort(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const n = Math.max(0, Math.floor(ms));
  if (n < 1000) return `${n}ms`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}s`;
  if (n < 60_000) return `${Math.round(n / 1000)}s`;
  const m = Math.floor(n / 60_000);
  const s = Math.round((n - m * 60_000) / 1000);
  return `${m}m ${s}s`;
}

function formatTokens(n: number): string {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v >= 100_000) return `${Math.round(v / 1000)}k`;
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(2)}k`;
  return String(v);
}

function formatGeoHintsPreview(hints: AiRequestListRow["cityRegionHints"]): string {
  if (!Array.isArray(hints) || hints.length === 0) return "";
  return hints
    .slice(0, 3)
    .map((hint) => {
      const parts = [hint.city, hint.region, hint.phrase, hint.source].filter(Boolean);
      return parts.join(" | ");
    })
    .filter(Boolean)
    .join(" ; ");
}

export default function AiRequestsClient() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();

  const initialPreset = parseFilterPreset(searchParams.get("preset"));
  const initialLimit = parsePageSize(searchParams.get("limit"));
  const initialOffset = parseIntSearchParam(searchParams.get("offset"), 0, 0, 10_000);
  const initialQuery = (searchParams.get("q") || "").trim();
  const initialProvider = initialPreset ? "all" : parseProviderFilterOption(searchParams.get("provider"));
  const initialOnlyErrors = initialPreset ? initialPreset === "errors_non_stub" : parseBoolSearchParam(searchParams.get("onlyErrors"));
  const initialOnlyInjected = initialPreset ? false : parseBoolSearchParam(searchParams.get("onlyInjected"));
  const initialOnlyNonStub = initialPreset ? initialPreset === "errors_non_stub" : parseBoolSearchParam(searchParams.get("onlyNonStub"));
  const initialOnlyRated = initialPreset ? false : parseBoolSearchParam(searchParams.get("onlyRated"));
  const initialOnlyDown = initialPreset ? initialPreset === "down_feedback" : parseBoolSearchParam(searchParams.get("onlyDown"));
  const initialOnlyGeoHints = initialPreset ? false : parseBoolSearchParam(searchParams.get("onlyGeoHints"));
  const initialOnlyWebsiteAttempted = initialPreset
    ? initialPreset === "web_attempted_deep"
    : parseBoolSearchParam(searchParams.get("onlyWebsiteAttempted"));
  const initialOnlyWebsiteDeep = initialPreset
    ? initialPreset === "web_attempted_deep"
    : parseBoolSearchParam(searchParams.get("onlyWebsiteDeep"));

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [requests, setRequests] = useState<AiRequestListRow[]>([]);
  const [pagination, setPagination] = useState<ListPagination>({
    limit: initialLimit,
    offset: initialOffset,
    returned: 0,
    total: 0,
    hasMore: false,
  });
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState(initialQuery);
  const [limit, setLimit] = useState(initialLimit);
  const [offset, setOffset] = useState(initialOffset);
  const [providerFilter, setProviderFilter] = useState<ProviderFilterOption>(initialProvider);
  const [onlyErrors, setOnlyErrors] = useState(initialOnlyErrors);
  const [onlyInjected, setOnlyInjected] = useState(initialOnlyInjected);
  const [onlyNonStub, setOnlyNonStub] = useState(initialOnlyNonStub);
  const [onlyRated, setOnlyRated] = useState(initialOnlyRated);
  const [onlyDown, setOnlyDown] = useState(initialOnlyDown);
  const [onlyGeoHints, setOnlyGeoHints] = useState(initialOnlyGeoHints);
  const [onlyWebsiteAttempted, setOnlyWebsiteAttempted] = useState(initialOnlyWebsiteAttempted);
  const [onlyWebsiteDeep, setOnlyWebsiteDeep] = useState(initialOnlyWebsiteDeep);
  const [jumpPageInput, setJumpPageInput] = useState("1");

  const [openId, setOpenId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<AiRequestDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [copyLinkState, setCopyLinkState] = useState<"idle" | "ok" | "error">("idle");
  const [showShortcutLegend, setShowShortcutLegend] = useState(false);

  const isPresetActive = (preset: FilterPreset): boolean => {
    if (preset === "errors_non_stub") {
      return (
        providerFilter === "all" &&
        onlyErrors &&
        onlyNonStub &&
        !onlyInjected &&
        !onlyRated &&
        !onlyDown &&
        !onlyGeoHints &&
        !onlyWebsiteAttempted &&
        !onlyWebsiteDeep
      );
    }
    if (preset === "web_attempted_deep") {
      return (
        providerFilter === "all" &&
        !onlyErrors &&
        !onlyNonStub &&
        !onlyInjected &&
        !onlyRated &&
        !onlyDown &&
        !onlyGeoHints &&
        onlyWebsiteAttempted &&
        onlyWebsiteDeep
      );
    }
    return (
      providerFilter === "all" &&
      !onlyErrors &&
      !onlyNonStub &&
      !onlyInjected &&
      !onlyRated &&
      onlyDown &&
      !onlyGeoHints &&
      !onlyWebsiteAttempted &&
      !onlyWebsiteDeep
    );
  };

  const applyPreset = (preset: FilterPreset) => {
    setProviderFilter("all");
    setOnlyErrors(false);
    setOnlyInjected(false);
    setOnlyNonStub(false);
    setOnlyRated(false);
    setOnlyDown(false);
    setOnlyGeoHints(false);
    setOnlyWebsiteAttempted(false);
    setOnlyWebsiteDeep(false);

    if (preset === "errors_non_stub") {
      setOnlyErrors(true);
      setOnlyNonStub(true);
    } else if (preset === "web_attempted_deep") {
      setOnlyWebsiteAttempted(true);
      setOnlyWebsiteDeep(true);
    } else {
      setOnlyDown(true);
    }
    setOffset(0);
  };

  const getActivePreset = (): FilterPreset | null => {
    if (isPresetActive("errors_non_stub")) return "errors_non_stub";
    if (isPresetActive("web_attempted_deep")) return "web_attempted_deep";
    if (isPresetActive("down_feedback")) return "down_feedback";
    return null;
  };

  const resetFilters = () => {
    setQuery("");
    setProviderFilter("all");
    setOnlyErrors(false);
    setOnlyInjected(false);
    setOnlyNonStub(false);
    setOnlyRated(false);
    setOnlyDown(false);
    setOnlyGeoHints(false);
    setOnlyWebsiteAttempted(false);
    setOnlyWebsiteDeep(false);
    setOffset(0);
  };

  const copyTriageLink = useCallback(async () => {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyLinkState("ok");
    } catch {
      setCopyLinkState("error");
    }
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      if (providerFilter !== "all") params.set("provider", providerFilter);
      if (onlyErrors) params.set("onlyErrors", "1");
      if (onlyWebsiteAttempted) params.set("onlyWebsiteAttempted", "1");
      if (onlyWebsiteDeep) params.set("onlyWebsiteDeep", "1");
      const res = await fetch(`/api/admin/ai-requests?${params.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Ошибка");
        return;
      }
      const nextRequests: AiRequestListRow[] = Array.isArray(data?.requests) ? data.requests : [];
      const apiPaginationRaw = data?.pagination && typeof data.pagination === "object" ? data.pagination : null;
      const nextPagination: ListPagination = {
        limit:
          apiPaginationRaw && typeof (apiPaginationRaw as { limit?: unknown }).limit === "number"
            ? Math.max(1, Math.min(200, Math.floor((apiPaginationRaw as { limit: number }).limit)))
            : limit,
        offset:
          apiPaginationRaw && typeof (apiPaginationRaw as { offset?: unknown }).offset === "number"
            ? Math.max(0, Math.floor((apiPaginationRaw as { offset: number }).offset))
            : offset,
        returned:
          apiPaginationRaw && typeof (apiPaginationRaw as { returned?: unknown }).returned === "number"
            ? Math.max(0, Math.floor((apiPaginationRaw as { returned: number }).returned))
            : nextRequests.length,
        total:
          apiPaginationRaw && typeof (apiPaginationRaw as { total?: unknown }).total === "number"
            ? Math.max(0, Math.floor((apiPaginationRaw as { total: number }).total))
            : nextRequests.length,
        hasMore:
          apiPaginationRaw && typeof (apiPaginationRaw as { hasMore?: unknown }).hasMore === "boolean"
            ? Boolean((apiPaginationRaw as { hasMore: boolean }).hasMore)
            : false,
      };

      setStatus(data?.status || null);
      setRequests(nextRequests);
      setPagination(nextPagination);
      if (nextPagination.limit !== limit) setLimit(nextPagination.limit);
      if (nextPagination.offset !== offset) setOffset(nextPagination.offset);
    } catch {
      setError("Ошибка сети");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Re-fetch from server for heavy filters to avoid client-only post-filtering.
  }, [limit, offset, providerFilter, onlyErrors, onlyWebsiteAttempted, onlyWebsiteDeep]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    const activePreset = getActivePreset();
    if (query.trim()) params.set("q", query.trim());
    if (limit !== DEFAULT_PAGE_SIZE) params.set("limit", String(limit));
    if (offset > 0) params.set("offset", String(offset));
    if (activePreset) params.set("preset", activePreset);
    if (providerFilter !== "all") params.set("provider", providerFilter);
    if (!activePreset) {
      if (onlyErrors) params.set("onlyErrors", "1");
      if (onlyInjected) params.set("onlyInjected", "1");
      if (onlyNonStub) params.set("onlyNonStub", "1");
      if (onlyRated) params.set("onlyRated", "1");
      if (onlyDown) params.set("onlyDown", "1");
      if (onlyGeoHints) params.set("onlyGeoHints", "1");
      if (onlyWebsiteAttempted) params.set("onlyWebsiteAttempted", "1");
      if (onlyWebsiteDeep) params.set("onlyWebsiteDeep", "1");
    }

    const nextSearch = params.toString();
    const currentSearch = window.location.search.startsWith("?") ? window.location.search.slice(1) : "";
    if (nextSearch === currentSearch) return;
    const nextUrl = nextSearch ? `${window.location.pathname}?${nextSearch}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }, [
    query,
    limit,
    offset,
    providerFilter,
    onlyErrors,
    onlyInjected,
    onlyNonStub,
    onlyRated,
    onlyDown,
    onlyGeoHints,
    onlyWebsiteAttempted,
    onlyWebsiteDeep,
  ]);

  const stats = useMemo(() => {
    const total = requests.length;
    const stub = requests.filter((r) => r.isStub).length;
    const nonStub = total - stub;
    const errors = requests.filter((r) => Boolean(r.providerError)).length;
    const injected = requests.filter((r) => r.injectionFlagged).length;
    const rated = requests.filter((r) => Boolean(r.feedback)).length;
    const down = requests.filter((r) => r.feedback?.rating === "down").length;
    const templateOk = requests.filter((r) => r.template?.isCompliant).length;
    const geoHints = requests.filter((r) => Array.isArray(r.cityRegionHints) && r.cityRegionHints.length > 0).length;
    const websiteAttempted = requests.filter((r) => Boolean(r.websiteScan?.attempted)).length;
    const websiteDeep = requests.filter((r) => Boolean(r.websiteScan?.depth?.deepScanUsed)).length;
    return { total, stub, nonStub, errors, injected, rated, down, templateOk, geoHints, websiteAttempted, websiteDeep };
  }, [requests]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter((r) => {
      if (providerFilter !== "all") {
        const p = (r.provider || "").toLowerCase();
        if (providerFilter === "stub" && p !== "stub") return false;
        if (providerFilter === "openai" && p !== "openai") return false;
        if (providerFilter === "codex" && p !== "codex") return false;
      }
      if (onlyErrors && !r.providerError) return false;
      if (onlyInjected && !r.injectionFlagged) return false;
      if (onlyNonStub && r.isStub) return false;
      if (onlyRated && !r.feedback) return false;
      if (onlyDown && r.feedback?.rating !== "down") return false;
      if (onlyGeoHints && (!Array.isArray(r.cityRegionHints) || r.cityRegionHints.length === 0)) return false;
      if (onlyWebsiteAttempted && !r.websiteScan?.attempted) return false;
      if (onlyWebsiteDeep && !r.websiteScan?.depth?.deepScanUsed) return false;
      if (!q) return true;

      const hay = [
        r.id,
        r.user.email,
        r.user.name || "",
        r.companyId || "",
        r.vendorLookupFilters?.city || "",
        r.vendorLookupFilters?.region || "",
        ...(Array.isArray(r.cityRegionHints)
          ? r.cityRegionHints.flatMap((hint) => [hint.city || "", hint.region || "", hint.phrase || "", hint.source || ""])
          : []),
        r.websiteScan?.attempted ? "website_scan_attempted" : "",
        r.websiteScan?.depth?.deepScanUsed ? "website_scan_deep" : "",
        r.websiteScan?.targetCount ? String(r.websiteScan.targetCount) : "",
        r.websiteScan?.insightCount ? String(r.websiteScan.insightCount) : "",
        r.messagePreview || "",
        r.replyPreview || "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [
    requests,
    query,
    providerFilter,
    onlyErrors,
    onlyInjected,
    onlyNonStub,
    onlyRated,
    onlyDown,
    onlyGeoHints,
    onlyWebsiteAttempted,
    onlyWebsiteDeep,
  ]);

  const openDetails = async (id: string) => {
    setOpenId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/ai-requests/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDetailError(data?.error || "Ошибка");
        return;
      }
      setDetail(data?.request || null);
    } catch {
      setDetailError("Ошибка сети");
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetails = () => {
    setOpenId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  };

  const copyJson = async (value: unknown) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    } catch {
      // ignore
    }
  };

  const pageSize = Math.max(1, pagination.limit || limit);
  const pageFrom = pagination.total === 0 ? 0 : pagination.offset + 1;
  const pageTo = pagination.total === 0 ? 0 : Math.min(pagination.offset + Math.max(0, pagination.returned), pagination.total);
  const pageNumber = pagination.total === 0 ? 1 : Math.floor(pagination.offset / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(pagination.total / pageSize));
  const lastPageOffset = Math.max(0, (totalPages - 1) * pageSize);
  const hasActiveFilterState =
    query.trim().length > 0 ||
    providerFilter !== "all" ||
    onlyErrors ||
    onlyInjected ||
    onlyNonStub ||
    onlyRated ||
    onlyDown ||
    onlyGeoHints ||
    onlyWebsiteAttempted ||
    onlyWebsiteDeep ||
    offset > 0;
  const canGoFirst = pagination.offset > 0;
  const canGoPrev = pagination.offset > 0;
  const canGoNext = pagination.hasMore;
  const canGoLast = pagination.total > 0 && pagination.offset < lastPageOffset;

  const goToPage = (targetPageRaw: string | number) => {
    const raw = typeof targetPageRaw === "number" ? targetPageRaw : Number(targetPageRaw || "");
    if (!Number.isFinite(raw)) {
      setJumpPageInput(String(pageNumber));
      return;
    }
    const targetPage = Math.max(1, Math.min(totalPages, Math.floor(raw)));
    const nextOffset = (targetPage - 1) * pageSize;
    setOffset(nextOffset);
    setJumpPageInput(String(targetPage));
  };

  useEffect(() => {
    setJumpPageInput(String(pageNumber));
  }, [pageNumber]);

  useEffect(() => {
    if (copyLinkState === "idle") return;
    const timer = window.setTimeout(() => setCopyLinkState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copyLinkState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key || "";
      if (key === "Escape") {
        setShowShortcutLegend(false);
        return;
      }
      const isHelpShortcut = key === "?" || (key === "/" && event.shiftKey);
      if (isHelpShortcut) {
        event.preventDefault();
        setShowShortcutLegend((prev) => !prev);
        return;
      }
      const isCopyShortcut = key === "c" || key === "C";
      if (!isCopyShortcut) return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        const editableTag = tag === "input" || tag === "textarea" || tag === "select";
        const contentEditable = target.isContentEditable || Boolean(target.closest('[contenteditable="true"]'));
        if (editableTag || contentEditable) return;
      }

      void copyTriageLink();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copyTriageLink]);

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-100">
      <Header />
      <main className="flex-grow">
        <div className="container mx-auto px-4 py-10">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
            <div>
              <div className="text-sm text-gray-500">
                <Link href="/admin" className="hover:text-[#820251]">
                  {t("admin.title") || "Админка"}
                </Link>
                <span className="mx-2">/</span>
                <span className="text-gray-800 font-medium">AI</span>
              </div>
              <h1 className="text-3xl font-bold text-gray-800 mt-1">AI запросы</h1>
              <div className="text-sm text-gray-600 mt-2">
                На странице: <span className="font-semibold">{stats.total}</span> • Всего по серверным фильтрам:{" "}
                <span className="font-semibold">{pagination.total}</span> • Stub:{" "}
                <span className="font-semibold">{stats.stub}</span> • Non-stub:{" "}
                <span className="font-semibold">{stats.nonStub}</span> • Ошибки:{" "}
                <span className="font-semibold">{stats.errors}</span> • Injection:{" "}
                <span className="font-semibold">{stats.injected}</span> • Rated:{" "}
                <span className="font-semibold">{stats.rated}</span> • 👎:{" "}
                <span className="font-semibold">{stats.down}</span> • Template OK:{" "}
                <span className="font-semibold">{stats.templateOk}</span> • Geo hints:{" "}
                <span className="font-semibold">{stats.geoHints}</span> • Web attempted:{" "}
                <span className="font-semibold">{stats.websiteAttempted}</span> • Web deep:{" "}
                <span className="font-semibold">{stats.websiteDeep}</span>
              </div>
              {status && (
                <div className="text-xs text-gray-500 mt-2">
                  Provider: <span className="font-semibold">{status.provider}</span>
                  {status.provider === "openai" && (
                    <>
                      {" "}
                      • Model: <span className="font-semibold">{status.openai.model}</span> • Key:{" "}
                      <span className="font-semibold">{status.openai.hasKey ? "yes" : "no"}</span>
                    </>
                  )}
                  {status.provider === "codex" && (
                    <>
                      {" "}
                      • Model: <span className="font-semibold">{status.codex.model}</span> • Auth path:{" "}
                      <span className="font-semibold">{status.codex.hasAuthPath ? "yes" : "no"}</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/admin/reindex"
                className="bg-[#820251] text-white px-4 py-2 rounded-lg font-semibold hover:bg-[#6a0143]"
              >
                Реиндекс
              </Link>
              <button
                type="button"
                onClick={() => void copyTriageLink()}
                className="bg-white text-gray-800 border border-gray-300 px-4 py-2 rounded-lg font-semibold hover:bg-gray-50"
                title="Copy triage link (c / Shift+C)"
              >
                Copy triage link (c / Shift+C)
              </button>
              <button
                type="button"
                onClick={load}
                className="bg-gray-900 text-white px-4 py-2 rounded-lg font-semibold hover:bg-black"
              >
                {t("admin.refresh") || "Обновить"}
              </button>
            </div>
          </div>

          {copyLinkState !== "idle" && (
            <div
              className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
                copyLinkState === "ok"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              {copyLinkState === "ok" ? "Ссылка скопирована" : "Не удалось скопировать ссылку"}
            </div>
          )}

          {(error || detailError) && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
              {error || detailError}
            </div>
          )}

          {loading ? (
            <div className="bg-white rounded-lg p-8 text-gray-600">{t("common.loading") || "Загрузка..."}</div>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-600">Пресеты:</span>
                  <button
                    type="button"
                    onClick={() => setShowShortcutLegend((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-md px-2 py-1 hover:bg-gray-100"
                    title="Shortcut help (?)"
                  >
                    <span>Shortcut help</span>
                    <kbd className="rounded border border-gray-300 bg-white px-1.5 py-0.5 font-mono text-[11px] leading-none">?</kbd>
                  </button>
                  {showShortcutLegend && (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-md px-2 py-1">
                      <span>Copy triage link:</span>
                      <kbd className="rounded border border-gray-300 bg-white px-1.5 py-0.5 font-mono text-[11px] leading-none">
                        c
                      </kbd>
                      <span>/</span>
                      <kbd className="rounded border border-gray-300 bg-white px-1.5 py-0.5 font-mono text-[11px] leading-none">
                        Shift+C
                      </kbd>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => applyPreset("errors_non_stub")}
                    className={`px-2.5 py-1.5 rounded-lg border text-xs ${
                      isPresetActive("errors_non_stub")
                        ? "border-red-300 bg-red-50 text-red-700"
                        : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    Ошибки + Non-stub
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("web_attempted_deep")}
                    className={`px-2.5 py-1.5 rounded-lg border text-xs ${
                      isPresetActive("web_attempted_deep")
                        ? "border-cyan-300 bg-cyan-50 text-cyan-800"
                        : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    Web attempted + deep
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("down_feedback")}
                    className={`px-2.5 py-1.5 rounded-lg border text-xs ${
                      isPresetActive("down_feedback")
                        ? "border-amber-300 bg-amber-50 text-amber-800"
                        : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    Down feedback
                  </button>
                  <button
                    type="button"
                    disabled={!hasActiveFilterState}
                    onClick={resetFilters}
                    className={`px-2.5 py-1.5 rounded-lg border text-xs ${
                      hasActiveFilterState
                        ? "border-gray-300 text-gray-700 hover:bg-gray-50"
                        : "border-gray-200 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    Сбросить фильтры
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                  <div className="lg:col-span-2">
                    <label className="block text-xs text-gray-600 mb-1">Поиск</label>
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="email, companyId, текст…"
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#a0006d]/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Provider</label>
                    <select
                      value={providerFilter}
                      onChange={(e) => {
                        setProviderFilter(e.target.value as ProviderFilterOption);
                        setOffset(0);
                      }}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#a0006d]/20"
                    >
                      <option value="all">Все</option>
                      <option value="stub">stub</option>
                      <option value="openai">openai</option>
                      <option value="codex">codex</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">На странице</label>
                    <select
                      value={limit}
                      onChange={(e) => {
                        const nextLimit = parsePageSize(e.target.value);
                        setLimit(nextLimit);
                        setOffset(0);
                      }}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#a0006d]/20"
                    >
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="lg:col-span-2 flex items-end gap-3 flex-wrap">
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={onlyErrors}
                        onChange={(e) => {
                          setOnlyErrors(e.target.checked);
                          setOffset(0);
                        }}
                      />
                      Ошибки
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={onlyInjected} onChange={(e) => setOnlyInjected(e.target.checked)} />
                      Injection
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={onlyNonStub} onChange={(e) => setOnlyNonStub(e.target.checked)} />
                      Non-stub
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={onlyRated} onChange={(e) => setOnlyRated(e.target.checked)} />
                      Rated
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={onlyDown} onChange={(e) => setOnlyDown(e.target.checked)} />
                      👎 only
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={onlyGeoHints} onChange={(e) => setOnlyGeoHints(e.target.checked)} />
                      Geo hints
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={onlyWebsiteAttempted}
                        onChange={(e) => {
                          setOnlyWebsiteAttempted(e.target.checked);
                          setOffset(0);
                        }}
                      />
                      Web attempted
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={onlyWebsiteDeep}
                        onChange={(e) => {
                          setOnlyWebsiteDeep(e.target.checked);
                          setOffset(0);
                        }}
                      />
                      Web deep
                    </label>
                  </div>
                </div>
              </div>

              <div className="mt-4 bg-white rounded-lg shadow-sm overflow-x-auto border border-gray-200">
                <table className="min-w-[1100px] w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left px-4 py-3">Время</th>
                      <th className="text-left px-4 py-3">User</th>
                      <th className="text-left px-4 py-3">Plan</th>
                      <th className="text-left px-4 py-3">Company</th>
                      <th className="text-left px-4 py-3">Provider</th>
                      <th className="text-left px-4 py-3">Flags</th>
                      <th className="text-left px-4 py-3">Feedback</th>
                      <th className="text-left px-4 py-3">Message</th>
                      <th className="text-left px-4 py-3">Reply</th>
                      <th className="text-left px-4 py-3">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{r.user.email}</div>
                          {r.user.name && <div className="text-xs text-gray-500">{r.user.name}</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{r.plan || "—"}</td>
                        <td className="px-4 py-3">
                          {r.companyId ? (
                            <Link href={`/company/${r.companyId}`} className="text-[#820251] hover:underline">
                              {r.companyId}
                            </Link>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                          {r.companyIds?.length > 0 && (
                            <div className="text-xs text-gray-500 mt-1">+{r.companyIds.length} shortlist</div>
                          )}
                          {(r.vendorLookupFilters?.city || r.vendorLookupFilters?.region) && (
                            <div className="text-xs text-gray-500 mt-1">
                              geo: {[r.vendorLookupFilters.city, r.vendorLookupFilters.region].filter(Boolean).join(", ")}
                            </div>
                          )}
                          {r.websiteScan?.attempted && (
                            <div className="text-xs text-gray-500 mt-1">
                              web: targets {r.websiteScan.targetCount} • insights {r.websiteScan.insightCount}
                              {r.websiteScan.depth?.scannedPagesTotal > 0 ? ` • pages ${r.websiteScan.depth.scannedPagesTotal}` : ""}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          <div className="font-medium">{r.provider}</div>
                          <div className="text-xs text-gray-500">
                            {r.isStub ? "stub" : "live"}
                            {r.canceled ? " • canceled" : ""}
                            {r.model ? ` • ${r.model}` : ""}
                            {r.durationMs != null ? ` • ${formatDurationShort(r.durationMs)}` : ""}
                            {r.usage?.totalTokens ? ` • ${formatTokens(r.usage.totalTokens)} tok` : ""}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {r.providerError && (
                              <span className="inline-flex items-center rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs">
                                error
                              </span>
                            )}
                            {r.injectionFlagged && (
                              <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs">
                                injection
                              </span>
                            )}
                            {r.canceled && (
                              <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 text-xs">
                                canceled
                              </span>
                            )}
                            {r.template && (
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                                  r.template.isCompliant ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-700"
                                }`}
                              >
                                tpl
                              </span>
                            )}
                            {r.guardrailsVersion != null && (
                              <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 text-xs">
                                g{r.guardrailsVersion}
                              </span>
                            )}
                            {r.cityRegionHints?.length > 0 && (
                              <span
                                title={formatGeoHintsPreview(r.cityRegionHints)}
                                className="inline-flex items-center rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-xs"
                              >
                                geo
                              </span>
                            )}
                            {r.websiteScan?.depth?.deepScanUsed && (
                              <span className="inline-flex items-center rounded-full bg-cyan-100 text-cyan-800 px-2 py-0.5 text-xs">
                                web-deep
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {r.feedback ? (
                            <div className="text-xs">
                              <div className="font-semibold">{r.feedback.rating === "up" ? "👍" : "👎"}</div>
                              {r.feedback.reason && <div className="text-gray-500 mt-1">{r.feedback.reason}</div>}
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700 max-w-[22rem]">
                          <div className="truncate" title={r.messagePreview}>
                            {r.messagePreview || "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-700 max-w-[22rem]">
                          <div className="truncate" title={r.replyPreview || ""}>
                            {r.replyPreview || "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => void openDetails(r.id)}
                            className="text-xs text-[#820251] hover:underline underline-offset-2"
                          >
                            Открыть
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                          Ничего не найдено
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
                <div>
                  Показаны {pageFrom}–{pageTo} из {pagination.total}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!canGoFirst}
                    onClick={() => setOffset(0)}
                    className={`px-3 py-1.5 rounded-lg border text-sm ${
                      canGoFirst
                        ? "border-gray-300 text-gray-700 hover:bg-gray-50"
                        : "border-gray-200 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    В начало
                  </button>
                  <button
                    type="button"
                    disabled={!canGoPrev}
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                    className={`px-3 py-1.5 rounded-lg border text-sm ${
                      canGoPrev
                        ? "border-gray-300 text-gray-700 hover:bg-gray-50"
                        : "border-gray-200 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    Назад
                  </button>
                  <span className="text-gray-700">
                    Страница {pageNumber} / {totalPages}
                  </span>
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      goToPage(jumpPageInput);
                    }}
                  >
                    <label className="text-gray-600">Перейти:</label>
                    <input
                      value={jumpPageInput}
                      onChange={(e) => setJumpPageInput(e.target.value)}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      aria-label="Страница"
                      className="w-16 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#a0006d]/20"
                    />
                    <button
                      type="submit"
                      className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm"
                    >
                      OK
                    </button>
                  </form>
                  <button
                    type="button"
                    disabled={!canGoNext}
                    onClick={() => setOffset(offset + limit)}
                    className={`px-3 py-1.5 rounded-lg border text-sm ${
                      canGoNext
                        ? "border-gray-300 text-gray-700 hover:bg-gray-50"
                        : "border-gray-200 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    Вперед
                  </button>
                  <button
                    type="button"
                    disabled={!canGoLast}
                    onClick={() => setOffset(lastPageOffset)}
                    className={`px-3 py-1.5 rounded-lg border text-sm ${
                      canGoLast
                        ? "border-gray-300 text-gray-700 hover:bg-gray-50"
                        : "border-gray-200 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    В конец
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
      <Footer />

      {openId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50">
              <div className="min-w-0">
                <div className="text-sm text-gray-500 truncate">AI request</div>
                <div className="font-semibold text-gray-900 truncate">{openId}</div>
              </div>
              <button
                type="button"
                onClick={closeDetails}
                className="text-gray-500 hover:text-gray-800"
                aria-label="Close"
                title="Close"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 max-h-[80vh] overflow-y-auto">
              {detailLoading ? (
                <div className="text-gray-600">{t("common.loading") || "Загрузка..."}</div>
              ) : detail ? (
                <div className="space-y-4">
                  <div className="text-sm text-gray-700">
                    <div>
                      <span className="text-gray-500">Когда:</span> {formatDateTime(detail.createdAt)}
                    </div>
                    <div className="mt-1">
                      <span className="text-gray-500">User:</span> {detail.user.email}{" "}
                      <span className="text-gray-500">({detail.user.plan})</span>
                    </div>
                    <div className="mt-1">
                      <span className="text-gray-500">Company:</span>{" "}
                      {detail.companyId ? (
                        <Link href={`/company/${detail.companyId}`} className="text-[#820251] hover:underline">
                          {detail.companyId}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </div>
                    <div className="mt-1">
                      <span className="text-gray-500">Website scan:</span>{" "}
                      {detail.websiteScan ? (
                        <>
                          {detail.websiteScan.attempted ? "attempted" : "not-attempted"} • targets{" "}
                          {detail.websiteScan.targetCount} • insights {detail.websiteScan.insightCount} • pages{" "}
                          {detail.websiteScan.depth.scannedPagesTotal} • deep{" "}
                          {detail.websiteScan.depth.deepScanUsed ? "yes" : "no"}
                        </>
                      ) : (
                        "—"
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-gray-600 mb-2">Message</div>
                    <pre className="whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-900">
                      {detail.message}
                    </pre>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-xs font-semibold text-gray-600">Payload (JSON)</div>
                      <button
                        type="button"
                        onClick={() => void copyJson(detail.payload)}
                        className="text-xs text-[#820251] hover:underline underline-offset-2"
                      >
                        Copy JSON
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-900 overflow-x-auto">
                      {JSON.stringify(detail.payload, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="text-gray-600">Нет данных</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
