"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useLanguage } from "@/contexts/LanguageContext";
import { shouldApplyFinalAssistantText } from "@/lib/ai/streamFinalization";
import { renderLinkifiedText } from "@/lib/utils/linkify";
import type { BiznesinfoCompanySummary } from "@/lib/biznesinfo/types";

type UserPlan = "free" | "paid" | "partner";

type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  requestId?: string;
  localFallbackUsed?: boolean;
  fallbackNotice?: string | null;
  provider?: string | null;
  feedback?: AssistantFeedback | null;
};

type AssistantCopyKind = "answer" | "email" | "whatsapp" | "subject" | "body" | "chat";

type AssistantFeedback = { rating: "up" | "down"; reason: string | null; createdAt: string };

type AssistantRfqForm = {
  companyTarget: string;
  what: string;
  qty: string;
  location: string;
  deadline: string;
  notes: string;
};

const ASSISTANT_CHAT_STATE_KEY_PREFIX = "biznesinfo:assistant:chat:v1";
const ASSISTANT_STORED_MESSAGES_LIMIT = 60;
const LEGACY_ASSISTANT_INTRO_FINGERPRINTS = [
  "я помогу разобраться с рубриками",
  "я ваш личный помощник лориэн",
  "готово! я могу помочь с:",
];

type PersistedAssistantChatState = {
  conversationId: string | null;
  draft: string;
  messages: AssistantMessage[];
  savedAt: string;
};

function normalizeInternalPath(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  return value;
}

function extractCompanyIdFromInput(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;

  const valueWithoutHash = value.replace(/^#/, "");
  const directIdMatch = valueWithoutHash.match(/^[A-Za-z0-9_-]{1,128}$/u);
  if (directIdMatch) return valueWithoutHash;

  const pathMatch = value.match(/\/company\/([^/?#\s]+)/iu);
  if (pathMatch && pathMatch[1]) {
    const decoded = decodeURIComponent(pathMatch[1]).trim();
    if (decoded) return decoded;
  }

  try {
    const url = new URL(value);
    const urlPathMatch = url.pathname.match(/^\/company\/([^/?#\s]+)/iu);
    if (urlPathMatch && urlPathMatch[1]) {
      const decoded = decodeURIComponent(urlPathMatch[1]).trim();
      if (decoded) return decoded;
    }
  } catch {
    // ignore invalid URL
  }

  return null;
}

function looksLikeOutreachIntent(text: string): boolean {
  return /(?:заявк|коммерческ|предложен|состав(?:ь|ьте)\s+обращен|запрос\s+поставщик|письм[оа]\s+поставщик|rfq|request\s+for\s+quote|supplier\s+request)/iu
    .test(String(text || ""));
}

function normalizeAssistantMessageForCompare(text: string): string {
  return String(text || "").toLowerCase().replace(/\s+/gu, " ").trim();
}

function isLegacyAssistantIntroMessage(content: string): boolean {
  const normalized = normalizeAssistantMessageForCompare(content);
  if (!normalized) return false;
  return LEGACY_ASSISTANT_INTRO_FINGERPRINTS.some((fingerprint) => normalized.includes(fingerprint));
}

function sanitizeStoredAssistantMessages(input: unknown): AssistantMessage[] {
  if (!Array.isArray(input)) return [];

  const out: AssistantMessage[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const item = input[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;

    const roleRaw = (item as any).role;
    const role = roleRaw === "assistant" ? "assistant" : (roleRaw === "user" ? "user" : null);
    if (!role) continue;

    const content = typeof (item as any).content === "string" ? (item as any).content : "";
    if (!content.trim()) continue;
    if (role === "assistant" && isLegacyAssistantIntroMessage(content)) continue;

    const idRaw = typeof (item as any).id === "string" ? (item as any).id.trim() : "";
    const requestId = typeof (item as any).requestId === "string" ? (item as any).requestId : undefined;
    const fallbackNotice = typeof (item as any).fallbackNotice === "string" ? (item as any).fallbackNotice : null;
    const provider = typeof (item as any).provider === "string" ? (item as any).provider : null;
    const localFallbackUsed = Boolean((item as any).localFallbackUsed);

    let feedback: AssistantFeedback | null = null;
    if ((item as any).feedback && typeof (item as any).feedback === "object" && !Array.isArray((item as any).feedback)) {
      const ratingRaw = (item as any).feedback.rating;
      const createdAtRaw = (item as any).feedback.createdAt;
      if ((ratingRaw === "up" || ratingRaw === "down") && typeof createdAtRaw === "string" && createdAtRaw) {
        feedback = {
          rating: ratingRaw,
          reason: typeof (item as any).feedback.reason === "string" ? (item as any).feedback.reason : null,
          createdAt: createdAtRaw,
        };
      }
    }

    out.push({
      id: idRaw || `restored-${role}-${i}`,
      role,
      content,
      requestId,
      localFallbackUsed,
      fallbackNotice,
      provider,
      feedback,
    });
  }

  return out.slice(-ASSISTANT_STORED_MESSAGES_LIMIT);
}

function formatPlanLabel(plan: UserPlan): string {
  if (plan === "free") return "Free";
  if (plan === "paid") return "Paid";
  return "Partner";
}

async function writeTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.top = "-1000px";
      el.style.left = "-1000px";
      document.body.appendChild(el);
      el.focus();
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function AssistantClient({
  user,
  initialUsage,
}: {
  user: { name: string | null; email: string; plan: UserPlan; aiRequestsPerDay: number };
  initialUsage?: { used: number; limit: number; day: string };
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const abortRef = useRef<AbortController | null>(null);
  const chatVersionRef = useRef(0);
  const companyIdFromUrl = (searchParams.get("companyId") || "").trim();
  const companyNameFromUrl = (searchParams.get("companyName") || "").trim();
  const companyIdsFromUrl = (searchParams.get("companyIds") || "").trim();
  const returnToFromUrl = (searchParams.get("returnTo") || "").trim();
  const [referrerCompanyPath, setReferrerCompanyPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingReplyId, setStreamingReplyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState<{ used: number; limit: number; day: string } | null>(initialUsage ?? null);
  const [quotaResetting, setQuotaResetting] = useState(false);
  const [quotaResetMessage, setQuotaResetMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ id: string; kind: AssistantCopyKind } | null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [feedbackOpenId, setFeedbackOpenId] = useState<string | null>(null);
  const [feedbackSendingId, setFeedbackSendingId] = useState<string | null>(null);
  const [rfqOpen, setRfqOpen] = useState(false);
  const [rfqForm, setRfqForm] = useState<AssistantRfqForm>({
    companyTarget: companyIdFromUrl || "",
    what: "",
    qty: "",
    location: "",
    deadline: "",
    notes: "",
  });
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [shortlistCompanies, setShortlistCompanies] = useState<BiznesinfoCompanySummary[]>([]);
  const [shortlistCompaniesLoading, setShortlistCompaniesLoading] = useState(false);
  const [chatStateReady, setChatStateReady] = useState(false);
  const [newDialogModalOpen, setNewDialogModalOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const copiedTimeoutRef = useRef<number | null>(null);
  const sendingRef = useRef(false);

  const canChat = user.plan === "paid" || user.plan === "partner";
  const planLabel = useMemo(() => formatPlanLabel(user.plan), [user.plan]);
  const chatCopyMarkerId = "__chat_conversation__";
  const chatStorageKey = useMemo(
    () => `${ASSISTANT_CHAT_STATE_KEY_PREFIX}:${String(user.email || "").trim().toLowerCase()}`,
    [user.email],
  );

  const companyContext = useMemo(() => {
    const companyId = companyIdFromUrl || null;
    const companyName = companyNameFromUrl || null;
    if (!companyId && !companyName) return null;
    return { companyId, companyName };
  }, [companyIdFromUrl, companyNameFromUrl]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ref = document.referrer;
    if (!ref) return;

    try {
      const refUrl = new URL(ref);
      if (refUrl.origin !== window.location.origin) return;
      if (!refUrl.pathname.startsWith("/company/")) return;
      const path = normalizeInternalPath(`${refUrl.pathname}${refUrl.search}${refUrl.hash}`);
      if (!path || path.startsWith("/assistant")) return;
      setReferrerCompanyPath(path);
    } catch {
      // ignore malformed referrer
    }
  }, []);

  const backToCompanyHref = useMemo(() => {
    const returnToPath = normalizeInternalPath(returnToFromUrl);
    if (returnToPath && !returnToPath.startsWith("/assistant")) {
      return returnToPath;
    }

    if (companyContext?.companyId) {
      return `/company/${encodeURIComponent(companyContext.companyId)}`;
    }

    const referrerPath = normalizeInternalPath(referrerCompanyPath);
    if (referrerPath && referrerPath.startsWith("/company/")) {
      return referrerPath;
    }

    return null;
  }, [companyContext?.companyId, returnToFromUrl, referrerCompanyPath]);

  const shortlistCompanyIds = useMemo(() => {
    if (!companyIdsFromUrl) return [];
    const exclude = companyContext?.companyId ? companyContext.companyId.toLowerCase() : null;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of companyIdsFromUrl.split(",")) {
      const id = raw.trim();
      if (!id) continue;
      const key = id.toLowerCase();
      if (exclude && key === exclude) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(id);
      if (out.length >= 8) break;
    }
    return out;
  }, [companyIdsFromUrl, companyContext?.companyId]);

  const shortlistCompaniesById = useMemo(() => {
    const map = new Map<string, BiznesinfoCompanySummary>();
    for (const c of shortlistCompanies) {
      map.set(c.id, c);
    }
    return map;
  }, [shortlistCompanies]);

  const manualTargetCompanyId = useMemo(() => extractCompanyIdFromInput(rfqForm.companyTarget), [rfqForm.companyTarget]);

  const resolvedSendCompanyId = useMemo(() => {
    if (companyContext?.companyId) return companyContext.companyId;
    if (manualTargetCompanyId) return manualTargetCompanyId;
    if (shortlistCompanyIds.length === 1) return shortlistCompanyIds[0];
    return null;
  }, [companyContext?.companyId, manualTargetCompanyId, shortlistCompanyIds]);

  const buildIntroMessage = (): AssistantMessage => ({
    id: "intro",
    role: "assistant",
    content:
      t("ai.chatIntro") ||
      "Здравствуйте! Я ваш личный помощник Лориэн. Подберу релевантные рубрики на портале, которые соответствуют вашему запросу, а также помогу составить и отправить коммерческое предложение/заявку по вопросам сотрудничества.",
  });

  const [messages, setMessages] = useState<AssistantMessage[]>(() => [buildIntroMessage()]);

  useEffect(() => {
    setChatStateReady(false);
    try {
      const raw = window.sessionStorage.getItem(chatStorageKey);
      if (raw) {
        const parsed: PersistedAssistantChatState = JSON.parse(raw);
        const restoredMessages = sanitizeStoredAssistantMessages(parsed?.messages);
        const restoredConversationId =
          typeof parsed?.conversationId === "string" && parsed.conversationId.trim() ? parsed.conversationId.trim() : null;
        if (restoredMessages.length > 0 || restoredConversationId) {
          setMessages([buildIntroMessage(), ...restoredMessages]);
          setConversationId(restoredConversationId);
          setDraft("");
          setChatStateReady(true);
          return;
        }
      }
    } catch {
      // ignore storage parse/read errors and fall back to fresh chat state
    }

    setMessages([buildIntroMessage()]);
    setConversationId(null);
    setDraft("");
    setChatStateReady(true);
  }, [chatStorageKey]);

  useEffect(() => {
    if (!chatStateReady) return;
    try {
      const persistedMessages = messages.filter((m) => m.id !== "intro").slice(-ASSISTANT_STORED_MESSAGES_LIMIT);
      const payload: PersistedAssistantChatState = {
        conversationId: conversationId || null,
        draft: "",
        messages: persistedMessages,
        savedAt: new Date().toISOString(),
      };
      if (persistedMessages.length === 0 && !payload.conversationId) {
        window.sessionStorage.removeItem(chatStorageKey);
        return;
      }
      window.sessionStorage.setItem(chatStorageKey, JSON.stringify(payload));
    } catch {
      // ignore storage write errors
    }
  }, [chatStateReady, chatStorageKey, messages, conversationId]);

  useEffect(() => {
    if (shortlistCompanyIds.length === 0) {
      setShortlistCompanies([]);
      setShortlistCompaniesLoading(false);
      return;
    }

    let isMounted = true;
    setShortlistCompaniesLoading(true);
    fetch(`/api/biznesinfo/companies?ids=${encodeURIComponent(shortlistCompanyIds.join(","))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((resp: { companies?: BiznesinfoCompanySummary[] } | null) => {
        if (!isMounted) return;
        setShortlistCompanies(resp?.companies || []);
        setShortlistCompaniesLoading(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setShortlistCompanies([]);
        setShortlistCompaniesLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [shortlistCompanyIds]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, sending]);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) window.clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!openActionsId) return;
    const onClick = () => setOpenActionsId(null);
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [openActionsId]);

  useEffect(() => {
    if (!feedbackOpenId) return;
    const onClick = () => setFeedbackOpenId(null);
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [feedbackOpenId]);

  const resetChat = () => {
    chatVersionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    sendingRef.current = false;
    setSending(false);
    setStreamingReplyId(null);
    setError(null);
    setCopied(null);
    setOpenActionsId(null);
    setFeedbackOpenId(null);
    setFeedbackSendingId(null);
    setQuotaResetMessage(null);
    setRfqOpen(false);
    setNewDialogModalOpen(false);
    setConversationId(null);
    try {
      window.sessionStorage.removeItem(chatStorageKey);
    } catch {
      // ignore storage write errors
    }
    if (copiedTimeoutRef.current) window.clearTimeout(copiedTimeoutRef.current);
    setMessages([buildIntroMessage()]);
    setDraft("");

    setTimeout(() => draftRef.current?.focus(), 0);
  };

  const resetPromptCounter = async () => {
    if (quotaResetting) return;

    setQuotaResetting(true);
    setQuotaResetMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/ai/reset-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.message || data?.error || (t("common.error") || "Ошибка"));
        return;
      }

      const day = typeof data?.day === "string" && data.day ? data.day : (quota?.day || new Date().toISOString().slice(0, 10));
      const used = typeof data?.used === "number" ? Math.max(0, Math.floor(data.used)) : 0;
      const limit = typeof data?.limit === "number" ? Math.max(0, Math.floor(data.limit)) : user.aiRequestsPerDay;
      setQuota({ day, used, limit });
      setQuotaResetMessage(t("ai.resetCounterDone") || "Счётчик запросов сброшен.");
    } catch {
      setError(t("common.networkError") || "Ошибка сети");
    } finally {
      setQuotaResetting(false);
    }
  };

  const extractEmailParts = (text: string): {
    subject: string | null;
    body: string;
    whatsapp: string | null;
    markers: { subject: boolean; body: boolean; whatsapp: boolean };
    preamble: string | null;
  } => {
    const lines = String(text || "").split(/\r?\n/u);
    let subject: string | null = null;
    let subjectIdx: number | null = null;
    let bodyIdx: number | null = null;
    let whatsappIdx: number | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || "";
      if (subject === null) {
        const m = line.match(/^\s*(subject|тема(?:\s+письма)?)\s*[:\-—]\s*(.+)\s*$/iu);
        if (m && m[2]) {
          subject = m[2].trim() || null;
          subjectIdx = i;
        }
      }
      if (bodyIdx === null) {
        const m = line.match(/^\s*(body|текст|сообщение|письмо)\s*[:\-—]\s*(.*)\s*$/iu);
        if (m) bodyIdx = i;
      }
      if (whatsappIdx === null) {
        const m = line.match(
          /^\s*(whatsapp|whats\s*app|сообщение\s+для\s+мессенджера|мессенджер(?:\s+сообщение)?)\s*[:\-—]\s*(.*)\s*$/iu,
        );
        if (m) whatsappIdx = i;
      }
    }

    const markerIdxs = [subjectIdx, bodyIdx, whatsappIdx].filter((v) => v != null) as number[];
    const preamble =
      markerIdxs.length > 0
        ? lines
            .slice(0, Math.min(...markerIdxs))
            .join("\n")
            .trim() || null
        : null;

    const bodyEnd = bodyIdx !== null && whatsappIdx !== null && whatsappIdx > bodyIdx ? whatsappIdx : lines.length;
    if (bodyIdx !== null) {
      const firstLine = lines[bodyIdx] || "";
      const first = firstLine.replace(/^\s*(body|текст|сообщение|письмо)\s*[:\-—]\s*/iu, "");
      const rest = lines.slice(bodyIdx + 1, bodyEnd);
      const body = [first, ...rest].join("\n").trim();

      if (whatsappIdx !== null) {
        const waFirstLine = lines[whatsappIdx] || "";
        const waFirst = waFirstLine.replace(
          /^\s*(whatsapp|whats\s*app|сообщение\s+для\s+мессенджера|мессенджер(?:\s+сообщение)?)\s*[:\-—]\s*/iu,
          "",
        );
        const waRest = lines.slice(whatsappIdx + 1);
        const whatsapp = [waFirst, ...waRest].join("\n").trim() || null;
        return {
          subject,
          body,
          whatsapp,
          markers: { subject: subjectIdx !== null, body: true, whatsapp: true },
          preamble,
        };
      }

      return {
        subject,
        body,
        whatsapp: null,
        markers: { subject: subjectIdx !== null, body: true, whatsapp: false },
        preamble,
      };
    }

    const fallbackEnd = whatsappIdx !== null ? whatsappIdx : lines.length;
    const body = lines
      .slice(0, fallbackEnd)
      .filter((_, idx) => idx !== subjectIdx)
      .join("\n")
      .trim();

    if (whatsappIdx !== null) {
      const waFirstLine = lines[whatsappIdx] || "";
      const waFirst = waFirstLine.replace(
        /^\s*(whatsapp|whats\s*app|сообщение\s+для\s+мессенджера|мессенджер(?:\s+сообщение)?)\s*[:\-—]\s*/iu,
        "",
      );
      const waRest = lines.slice(whatsappIdx + 1);
      const whatsapp = [waFirst, ...waRest].join("\n").trim() || null;
      return {
        subject,
        body,
        whatsapp,
        markers: { subject: subjectIdx !== null, body: false, whatsapp: true },
        preamble,
      };
    }

    return {
      subject,
      body,
      whatsapp: null,
      markers: { subject: subjectIdx !== null, body: false, whatsapp: false },
      preamble,
    };
  };

  const buildEmailCopy = (text: string): string => {
    const { subject, body } = extractEmailParts(text);
    const subjectValue = subject || (t("ai.export.defaultSubject") || "Запрос через Biznesinfo");
    const subjectLabel = t("ai.export.subjectLabel") || "Тема";
    const bodyLabel = t("ai.export.bodyLabel") || "Текст";
    const bodyValue = body || String(text || "").trim();
    return `${subjectLabel}: ${subjectValue}\n\n${bodyLabel}:\n${bodyValue}`;
  };

  const buildWhatsAppCopy = (text: string): string => {
    const { whatsapp, body } = extractEmailParts(text);
    const value = (whatsapp || body || String(text || "")).trim();
    const maxChars = 1200;
    if (value.length <= maxChars) return value;
    return `${value.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
  };

  const tr = (key: string, fallback: string): string => {
    const value = t(key);
    if (!value || value === key) return fallback;
    return value;
  };

  const buildChatCopyText = (): string => {
    const userLabel = tr("ai.copyChatUserLabel", "Пользователь");
    const assistantLabel = tr("ai.copyChatAssistantLabel", "AI-ассистент");

    return messages
      .map((message) => {
        const text = String(message.content || "").trim();
        if (!text) return null;
        const speaker = message.role === "user" ? userLabel : assistantLabel;
        return `${speaker}:\n${text}`;
      })
      .filter(Boolean)
      .join("\n\n");
  };

  const copyRawText = async (params: { messageId: string; kind: AssistantCopyKind; text: string }) => {
    const ok = await writeTextToClipboard(params.text);
    if (!ok) return;

    setCopied({ id: params.messageId, kind: params.kind });
    if (copiedTimeoutRef.current) window.clearTimeout(copiedTimeoutRef.current);
    copiedTimeoutRef.current = window.setTimeout(() => setCopied(null), 2000);
  };

  const copyAssistantMessage = async (message: AssistantMessage, kind: "answer" | "email" | "whatsapp") => {
    if (message.role !== "assistant") return;

    const textToCopy =
      kind === "answer" ? message.content : (kind === "email" ? buildEmailCopy(message.content) : buildWhatsAppCopy(message.content));

    const ok = await writeTextToClipboard(textToCopy);
    if (!ok) return;

    setCopied({ id: message.id, kind });
    setOpenActionsId(null);
    if (copiedTimeoutRef.current) window.clearTimeout(copiedTimeoutRef.current);
    copiedTimeoutRef.current = window.setTimeout(() => setCopied(null), 2000);
  };

  const copyChatConversation = async () => {
    const text = buildChatCopyText();
    if (!text) return;

    const ok = await writeTextToClipboard(text);
    if (!ok) return;

    setCopied({ id: chatCopyMarkerId, kind: "chat" });
    setOpenActionsId(null);
    if (copiedTimeoutRef.current) window.clearTimeout(copiedTimeoutRef.current);
    copiedTimeoutRef.current = window.setTimeout(() => setCopied(null), 2000);
  };

  const replaceSearchParams = (next: URLSearchParams) => {
    const qs = next.toString();
    const href = qs ? `${pathname}?${qs}` : pathname;
    router.replace(href, { scroll: false });
  };

  const removeShortlistCompany = (companyId: string) => {
    const key = (companyId || "").trim().toLowerCase();
    if (!key) return;
    const nextIds = shortlistCompanyIds.filter((id) => id.toLowerCase() !== key);

    const next = new URLSearchParams(searchParams.toString());
    if (nextIds.length > 0) {
      next.set("companyIds", nextIds.join(","));
    } else {
      next.delete("companyIds");
    }
    replaceSearchParams(next);
  };

  const renderAssistantMessageContent = (message: AssistantMessage) => {
    if (message.role !== "assistant") return message.content;
    if (message.id === "intro") return renderLinkifiedText(message.content);

    const parts = extractEmailParts(message.content);
    const hasTemplateMarkers = parts.markers.subject || parts.markers.body || parts.markers.whatsapp;
    if (!hasTemplateMarkers) return renderLinkifiedText(message.content);

    const subjectValue = parts.subject || (t("ai.export.defaultSubject") || "Запрос через Biznesinfo");
    const subjectLabel = tr("ai.export.subjectLabel", "Тема");
    const bodyLabel = tr("ai.export.bodyLabel", "Текст");
    const whatsappLabel = tr("ai.export.messengerLabel", "Сообщение для мессенджера");
    const copyLabel = tr("ai.copy", "Копировать");

    return (
      <div className="space-y-3">
        {parts.preamble && (
          <div className="text-gray-700">
            {renderLinkifiedText(parts.preamble)}
          </div>
        )}

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold text-gray-600">{subjectLabel}</div>
            <button
              type="button"
              onClick={() => void copyRawText({ messageId: message.id, kind: "subject", text: subjectValue })}
              className="inline-flex items-center justify-center rounded-lg px-2 py-1 text-[11px] text-gray-500 hover:text-gray-800 hover:bg-white border border-transparent hover:border-gray-200 transition"
            >
              {copyLabel}
            </button>
          </div>
          <div className="mt-1 text-sm text-gray-900">{renderLinkifiedText(subjectValue)}</div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold text-gray-600">{bodyLabel}</div>
            <button
              type="button"
              onClick={() => void copyRawText({ messageId: message.id, kind: "body", text: parts.body || "" })}
              className="inline-flex items-center justify-center rounded-lg px-2 py-1 text-[11px] text-gray-500 hover:text-gray-800 hover:bg-white border border-transparent hover:border-gray-200 transition"
            >
              {copyLabel}
            </button>
          </div>
          <div className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">{renderLinkifiedText(parts.body || "")}</div>
        </div>

        {parts.whatsapp && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold text-gray-600">{whatsappLabel}</div>
              <button
                type="button"
                onClick={() => void copyAssistantMessage(message, "whatsapp")}
                className="inline-flex items-center justify-center rounded-lg px-2 py-1 text-[11px] text-gray-500 hover:text-gray-800 hover:bg-white border border-transparent hover:border-gray-200 transition"
              >
                {copyLabel}
              </button>
            </div>
            <div className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">{renderLinkifiedText(parts.whatsapp)}</div>
          </div>
        )}
      </div>
    );
  };

  const submitFeedback = async (params: {
    messageId: string;
    requestId: string;
    rating: "up" | "down";
    reason: string | null;
  }) => {
    if (!params.requestId) return;
    if (feedbackSendingId) return;

    setFeedbackSendingId(params.messageId);
    setError(null);
    try {
      const res = await fetch("/api/ai/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: params.requestId,
          rating: params.rating,
          reason: params.reason || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || (t("common.error") || "Ошибка"));
        return;
      }
      const feedback: AssistantFeedback =
        data?.feedback && typeof data.feedback === "object" && !Array.isArray(data.feedback)
          ? {
              rating: data.feedback.rating === "down" ? "down" : "up",
              reason: typeof data.feedback.reason === "string" ? data.feedback.reason : null,
              createdAt: typeof data.feedback.createdAt === "string" ? data.feedback.createdAt : new Date().toISOString(),
            }
          : { rating: params.rating, reason: params.reason, createdAt: new Date().toISOString() };

      setMessages((prev) =>
        prev.map((m) => (m.id === params.messageId ? { ...m, feedback } : m)),
      );
      setFeedbackOpenId(null);
    } catch {
      setError(t("common.networkError") || "Ошибка сети");
    } finally {
      setFeedbackSendingId(null);
    }
  };

  const buildRfqDraft = (form: AssistantRfqForm): string => {
    const targetCompanyId = resolvedSendCompanyId;
    const target =
      companyContext?.companyName || (targetCompanyId ? `#${targetCompanyId}` : null);

    const lines: string[] = [];
    if (target) {
      lines.push(`Составь обращение/запрос к этой компании: ${target}.`);
    } else {
      lines.push("Составь обращение/запрос к конкретной компании из каталога Biznesinfo.");
    }

    const what = form.what.trim();
    const qty = form.qty.trim();
    const location = form.location.trim();
    const deadline = form.deadline.trim();
    const notes = form.notes.trim();

    if (what) lines.push(`Что нужно: ${what}`);
    if (qty) lines.push(`Количество/объём: ${qty}`);
    if (location) lines.push(`Город/регион: ${location}`);
    if (deadline) lines.push(`Срок: ${deadline}`);
    if (notes) lines.push(`Требования: ${notes}`);

    lines.push("");
    lines.push("Если данных не хватает, сначала задай до 3 уточняющих вопросов.");
    lines.push("Верни ответ строго в этих блоках:");
    lines.push("Тема: <одна строка>");
    lines.push("Текст:");
    lines.push("<текст письма>");
    lines.push("Сообщение для мессенджера:");
    lines.push("<короткое сообщение>");

    return lines.join("\n");
  };

  const resetRfqForm = () => {
    setRfqForm({
      companyTarget: companyContext?.companyId || "",
      what: "",
      qty: "",
      location: "",
      deadline: "",
      notes: "",
    });
  };

  const fillRfqIntoDraft = () => {
    const hasExplicitTarget = Boolean(companyContext?.companyName || resolvedSendCompanyId);
    if (!hasExplicitTarget) {
      setError("Чтобы избежать спама, выберите конкретную компанию (ID карточки или ссылка /company/...).");
      setTimeout(() => draftRef.current?.focus(), 0);
      return;
    }
    if (!companyContext?.companyId && !manualTargetCompanyId && shortlistCompanyIds.length > 1) {
      setError("Чтобы избежать спама, выберите одну конкретную компанию, а не список.");
      setTimeout(() => draftRef.current?.focus(), 0);
      return;
    }
    setError(null);
    setDraft(buildRfqDraft(rfqForm));
    setRfqOpen(false);
    setTimeout(() => draftRef.current?.focus(), 0);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    if (!canChat) return;
    if (sendingRef.current) return;

    const outreachIntent = looksLikeOutreachIntent(text);
    const hasExplicitTarget = Boolean(companyContext?.companyName || resolvedSendCompanyId);
    if (outreachIntent && !hasExplicitTarget) {
      setError("Чтобы избежать спама, выберите конкретную компанию перед отправкой запроса.");
      return;
    }
    if (outreachIntent && !companyContext?.companyId && !manualTargetCompanyId && shortlistCompanyIds.length > 1) {
      setError("Чтобы избежать спама, отправка запроса доступна только в одну выбранную компанию.");
      return;
    }

    const startChatVersion = chatVersionRef.current;
    sendingRef.current = true;

    const abortController = new AbortController();
    abortRef.current?.abort();
    abortRef.current = abortController;

    const history = messages
      .filter((m) => m.id !== "intro")
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content }));

    setDraft("");
    setError(null);
    setQuotaResetMessage(null);
    setSending(true);
    setStreamingReplyId(null);
    const userMessage: AssistantMessage = { id: crypto.randomUUID(), role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);

    let assistantAdded = false;

    try {
      const payload: Record<string, unknown> = { source: "assistant_page", page: "/assistant" };
      const context: Record<string, unknown> = {};
      if (companyContext) Object.assign(context, companyContext);
      if (shortlistCompanyIds.length > 0) context.shortlistCompanyIds = shortlistCompanyIds;
      if (Object.keys(context).length > 0) payload.context = context;

      const requestBody: Record<string, unknown> = {
        message: text,
        history,
        payload,
      };
      if (conversationId) requestBody.conversationId = conversationId;
      if (resolvedSendCompanyId) requestBody.companyId = resolvedSendCompanyId;
      if (!resolvedSendCompanyId && shortlistCompanyIds.length > 0) requestBody.companyIds = shortlistCompanyIds;

      const res = await fetch("/api/ai/request?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429 && data?.error === "QuotaExceeded") {
          const used = typeof data?.used === "number" ? data.used : null;
          const limit = typeof data?.limit === "number" ? data.limit : null;
          const day = typeof data?.day === "string" ? data.day : null;
          if (used !== null && limit !== null && day) setQuota({ used, limit, day });
          setError(
            used !== null && limit !== null
              ? `Лимит AI на сегодня: ${used}/${limit}`
              : (t("ai.limitExceeded") || "Лимит AI на сегодня исчерпан"),
          );
          return;
        }
        if (res.status === 409 && data?.error === "AiBusy") {
          const retryAfterSeconds = typeof data?.retryAfterSeconds === "number" ? data.retryAfterSeconds : null;
          const msgBase = t("ai.busy") || "AI занят — подождите немного и попробуйте ещё раз.";
          const msg = retryAfterSeconds ? `${msgBase} (${retryAfterSeconds}s)` : msgBase;
          setError(msg);
          const assistantMessage: AssistantMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: msg,
            requestId: undefined,
            feedback: null,
          };
          setMessages((prev) => [...prev, assistantMessage]);
          return;
        }
        if (res.status === 401) {
          setError(t("auth.loginRequired") || "Нужно войти в кабинет.");
          return;
        }
        setError(data?.message || data?.error || (t("common.error") || "Ошибка"));
        return;
      }

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream") || !res.body) {
        setError(t("common.error") || "Ошибка");
        return;
      }

      const assistantMessageId = crypto.randomUUID();
      let assistantText = "";
      let requestId: string | undefined;
      let localFallbackUsed = false;
      let fallbackNotice: string | null = null;
      let provider: string | null = null;
      let done = false;

      const addAssistantIfNeeded = () => {
        if (assistantAdded) return;
        assistantAdded = true;
        setStreamingReplyId(assistantMessageId);
        const assistantMessage: AssistantMessage = {
          id: assistantMessageId,
          role: "assistant",
          content: assistantText || (t("common.loading") || "Загрузка..."),
          requestId,
          localFallbackUsed,
          fallbackNotice,
          provider,
          feedback: null,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      };

      const updateAssistant = () => {
        if (!assistantAdded) {
          addAssistantIfNeeded();
          return;
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  content: assistantText || (t("common.loading") || "Загрузка..."),
                  requestId: requestId ?? m.requestId,
                  localFallbackUsed: localFallbackUsed || m.localFallbackUsed || false,
                  fallbackNotice: fallbackNotice ?? m.fallbackNotice ?? null,
                  provider: provider ?? m.provider ?? null,
                }
              : m,
          ),
        );
      };

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;
        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const idx = buffer.indexOf("\n\n");
          if (idx < 0) break;
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          const lines = rawEvent.split(/\r?\n/u);
          let eventName = "message";
          const dataLines: string[] = [];
          for (const line of lines) {
            if (!line) continue;
            if (line.startsWith("event:")) eventName = line.slice("event:".length).trim() || eventName;
            if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
          }
          const dataRaw = dataLines.join("\n").trim();
          if (!dataRaw) continue;

          let data: any = null;
          try {
            data = JSON.parse(dataRaw);
          } catch {
            data = null;
          }

          if (eventName === "meta") {
            if (typeof data?.requestId === "string") requestId = data.requestId;
            if (typeof data?.conversationId === "string" && data.conversationId) setConversationId(data.conversationId);
            continue;
          }

          if (eventName === "delta") {
            const delta = typeof data?.delta === "string" ? data.delta : "";
            if (!delta) continue;
            assistantText += delta;
            updateAssistant();
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
            continue;
          }

          if (eventName === "error") {
            const msg = typeof data?.message === "string" ? data.message : (data?.error || "");
            if (msg) setError(String(msg));
            continue;
          }

          if (eventName === "done") {
            done = true;
            if (typeof data?.used === "number" && typeof data?.limit === "number" && typeof data?.day === "string") {
              setQuota({ used: data.used, limit: data.limit, day: data.day });
            }
            if (typeof data?.requestId === "string") requestId = data.requestId;
            if (typeof data?.conversationId === "string" && data.conversationId) setConversationId(data.conversationId);
            const finalText = typeof data?.reply?.text === "string" ? data.reply.text : "";
            const reasonCodes = Array.isArray(data?.reply?.reasonCodes)
              ? data.reply.reasonCodes.filter((value: unknown): value is string => typeof value === "string")
              : [];
            if (
              finalText &&
              shouldApplyFinalAssistantText({
                streamedText: assistantText,
                finalText,
                reasonCodes,
              })
            ) {
              assistantText = finalText;
            }
            localFallbackUsed = Boolean(data?.reply?.localFallbackUsed);
            fallbackNotice = typeof data?.reply?.fallbackNotice === "string" ? data.reply.fallbackNotice : null;
            provider = typeof data?.reply?.provider === "string" ? data.reply.provider : null;
            updateAssistant();
            break;
          }
        }
      }

      if (!assistantAdded) {
        assistantText = assistantText || "Запрос сохранён. Скоро здесь появится полноценный чат-ассистент с ответами в реальном времени. (stub)";
        addAssistantIfNeeded();
        updateAssistant();
      }
    } catch {
      if (abortController.signal.aborted) {
        if (abortRef.current === abortController) abortRef.current = null;
        if (chatVersionRef.current !== startChatVersion) return;
        if (!assistantAdded) {
          const assistantMessage: AssistantMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: t("ai.stopped") || "Остановлено.",
            requestId: undefined,
            feedback: null,
          };
          setMessages((prev) => [...prev, assistantMessage]);
        }
        return;
      }
      setError(t("common.networkError") || "Ошибка сети");
    } finally {
      sendingRef.current = false;
      setSending(false);
      setStreamingReplyId(null);
      if (abortRef.current === abortController) abortRef.current = null;
    }
  };

  const stopGenerating = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-100">
      <Header />

      <main className="flex-grow">
        <div className="bg-white border-b border-gray-200">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Link href="/" className="hover:text-[#820251]">
                {t("common.home")}
              </Link>
              <span>/</span>
              <span className="text-[#820251] font-medium">{t("ai.title")}</span>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-1.5 py-4 sm:px-4 sm:py-10">
          <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-2.5 sm:p-8">
              {backToCompanyHref && (
                <div className="mb-2 sm:mb-3">
                  <Link
                    href={backToCompanyHref}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#820251]/25 bg-[#820251]/10 px-3 py-2 text-sm font-semibold text-[#820251] shadow-sm hover:bg-[#820251]/15 hover:text-[#6a0143] transition-colors"
                  >
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#820251]/30 bg-white">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                      </svg>
                    </span>
                    <span>{t("common.back") || "Назад"}</span>
                  </Link>
                </div>
              )}

              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{t("ai.title")}</h1>
              <p className="mt-2 text-gray-600">{t("ai.personalAssistant")}</p>

              {!canChat ? (
                <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
                  <div className="font-semibold text-amber-900">Доступно в платном плане</div>
                  <p className="mt-2 text-sm text-amber-800">
                    У вас план Free — чат-ассистент доступен для <span className="font-semibold">Paid</span> и{" "}
                    <span className="font-semibold">Partner</span>.
                  </p>
                  <p className="mt-3 text-sm text-amber-800">
                    Если вы уже оплатили доступ, но видите Free — напишите нам через{" "}
                    <Link href="/ad-request" className="underline underline-offset-2 hover:text-amber-900">
                      заявку
                    </Link>{" "}
                    или в{" "}
                    <Link href="/cabinet" className="underline underline-offset-2 hover:text-amber-900">
                      личном кабинете
                    </Link>
                    .
                  </p>
                </div>
              ) : (
	                <div className="mt-4 sm:mt-6 -mx-1 sm:mx-0 rounded-2xl border border-gray-200 bg-white overflow-hidden">
	                  <div className="px-2 sm:px-5 py-3 border-b border-gray-200 bg-gray-50 flex flex-col items-start sm:flex-row sm:items-start sm:justify-between gap-3">
	                    <div className="min-w-0">
	                      {companyContext && (
	                        <div className="text-xs text-gray-600 break-words sm:truncate">
	                          <span className="text-gray-500">Контекст:</span>{" "}
	                          <span className="font-semibold text-[#820251]">
	                            {companyContext.companyName || (companyContext.companyId ? `#${companyContext.companyId}` : "—")}
	                          </span>
	                        </div>
	                      )}

	                      {shortlistCompanyIds.length > 0 && (
	                        <div className={`text-xs text-gray-600 break-words sm:truncate ${companyContext ? "mt-1" : ""}`}>
	                          <span className="text-gray-500">{t("ai.shortlistLabel") || "Подбор компаний"}:</span>{" "}
	                          <span className="font-semibold text-[#820251]">{shortlistCompanyIds.length}</span>
	                          {shortlistCompaniesLoading && (
	                            <span className="ml-2 text-gray-400">{t("common.loading") || "Загрузка..."}</span>
	                          )}
	                        </div>
	                      )}

	                      {!companyContext && shortlistCompanyIds.length === 0 && (
	                        <div className="text-xs text-gray-500">
	                          {t("ai.chatMemoryHint") || "Контекст диалога: последние 12 сообщений"}
	                        </div>
	                      )}

		                      {shortlistCompanyIds.length > 0 && (
		                        <div className="mt-2 flex flex-wrap gap-2">
		                          {shortlistCompanyIds.map((id) => {
		                            const company = shortlistCompaniesById.get(id);
		                            const label = company?.name || `#${id}`;
		                            const metaParts: string[] = [];
		                            if (company?.primary_category_name) metaParts.push(company.primary_category_name);
		                            if (company?.region) metaParts.push(company.region);
		                            const meta = metaParts.join(" • ");
		                            const title = company ? [company.name, meta].filter(Boolean).join(" — ") : id;
		                            const removeTitle = tr("ai.shortlistRemove", "Убрать из подбора");
		                            return (
		                              <div key={id} className="relative group">
		                                <Link
		                                  href={`/company/${id}`}
		                                  title={title}
		                                  className="inline-flex max-w-[16rem] min-w-0 flex-col gap-0.5 rounded-xl border border-gray-200 bg-white px-3 py-2 pr-8 text-left hover:border-[#820251] transition-colors"
		                                >
		                                  <span className="truncate text-xs font-semibold text-gray-800 group-hover:text-[#820251]">
		                                    {label}
		                                  </span>
		                                  {meta && (
		                                    <span className="truncate text-[11px] text-gray-500">
		                                      {meta}
		                                    </span>
		                                  )}
		                                </Link>
		                                <button
		                                  type="button"
		                                  onClick={(e) => {
		                                    e.preventDefault();
		                                    e.stopPropagation();
		                                    removeShortlistCompany(id);
		                                  }}
		                                  aria-label={removeTitle}
		                                  title={removeTitle}
		                                  className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 hover:text-gray-800 hover:border-gray-300 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition"
		                                >
		                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
		                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
		                                  </svg>
		                                </button>
		                              </div>
		                            );
		                          })}
		                        </div>
			                      )}
	                    </div>
	                    <div className="w-full sm:w-auto">
	                      <button
	                        type="button"
	                        onClick={() => setNewDialogModalOpen(true)}
	                        className="inline-flex w-full sm:w-auto items-center justify-center rounded-xl border border-[#820251]/25 bg-white px-3 py-2 text-xs font-semibold text-[#820251] hover:bg-[#820251]/5 transition-colors"
	                      >
	                        {t("ai.openNewDialog") || "Открыть новый диалог"}
	                      </button>
	                    </div>
                  </div>
                  <div
                    ref={scrollRef}
                    className="h-[clamp(320px,55dvh,520px)] sm:h-[420px] overflow-y-auto p-2 sm:p-5 space-y-4 bg-gradient-to-b from-white to-gray-50"
                  >
                    {messages.map((m) => (
                      <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[98%] sm:max-w-[90%] rounded-2xl px-3 sm:px-4 py-3 text-[15px] sm:text-sm leading-relaxed shadow-sm ${
                            m.role === "user"
                              ? "bg-[#820251] text-white rounded-br-md"
                              : "relative group bg-white border border-gray-200 text-gray-900 rounded-bl-md pr-11 whitespace-pre-wrap break-words"
                          }`}
                        >
                          {m.role === "assistant" && m.id !== "intro" && (
                            <div className="absolute right-2 top-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenActionsId((prev) => (prev === m.id ? null : m.id));
                                }}
                                aria-label={copied?.id === m.id ? t("ai.copied") : (t("ai.copyOptions") || t("ai.copyAnswer"))}
                                title={copied?.id === m.id ? t("ai.copied") : (t("ai.copyOptions") || t("ai.copyAnswer"))}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition opacity-80 sm:opacity-0 sm:group-hover:opacity-100"
                              >
                                {copied?.id === m.id ? (
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M8 7a2 2 0 012-2h7a2 2 0 012 2v7m-1 4H8a2 2 0 01-2-2V7a2 2 0 012-2h7"
                                    />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 5v4a2 2 0 002 2h4" />
                                  </svg>
                                )}
                              </button>

                              {openActionsId === m.id && (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-2 w-56 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden"
                                >
                                  <button
                                    type="button"
                                    onClick={() => void copyAssistantMessage(m, "answer")}
                                    className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                                  >
                                    {t("ai.copyAnswer") || "Скопировать ответ"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void copyAssistantMessage(m, "email")}
                                    className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                                  >
                                    {t("ai.copyAsEmail") || "Скопировать как письмо"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void copyAssistantMessage(m, "whatsapp")}
                                    className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                                  >
                                    {t("ai.copyAsWhatsApp") || "Скопировать как сообщение"}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                          {renderAssistantMessageContent(m)}
                          {m.role === "assistant" && m.id !== "intro" && m.localFallbackUsed && m.fallbackNotice && (
                            <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                              {m.fallbackNotice}
                            </div>
                          )}

                          {m.role === "assistant" && m.id !== "intro" && m.requestId && (
                            <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                              {m.feedback ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400">{tr("ai.feedback.thanks", "Спасибо за оценку!")}</span>
                                  <span className="text-gray-300">•</span>
                                  <span className="font-semibold text-gray-600">
                                    {m.feedback.rating === "up" ? "👍" : "👎"}
                                  </span>
                                  {m.feedback.reason && (
                                    <span className="text-gray-400">
                                      {tr(`ai.feedback.reason.${m.feedback.reason}`, m.feedback.reason)}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    disabled={feedbackSendingId === m.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void submitFeedback({ messageId: m.id, requestId: m.requestId!, rating: "up", reason: null });
                                    }}
                                    className="inline-flex items-center justify-center rounded-lg px-2 py-1 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-50 border border-transparent hover:border-gray-200 disabled:opacity-60 disabled:cursor-not-allowed"
                                    aria-label={tr("ai.feedback.up", "Полезно")}
                                    title={tr("ai.feedback.up", "Полезно")}
                                  >
                                    👍
                                  </button>
                                  <button
                                    type="button"
                                    disabled={feedbackSendingId === m.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setFeedbackOpenId((prev) => (prev === m.id ? null : m.id));
                                    }}
                                    className="inline-flex items-center justify-center rounded-lg px-2 py-1 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-50 border border-transparent hover:border-gray-200 disabled:opacity-60 disabled:cursor-not-allowed"
                                    aria-label={tr("ai.feedback.down", "Не полезно")}
                                    title={tr("ai.feedback.down", "Не полезно")}
                                  >
                                    👎
                                  </button>

                                  {feedbackOpenId === m.id && (
                                    <div
                                      onClick={(e) => e.stopPropagation()}
                                      className="ml-2 flex flex-wrap gap-2"
                                    >
                                      {[
                                        { id: "hallucination", label: tr("ai.feedback.reason.hallucination", "Придуманные факты") },
                                        { id: "format", label: tr("ai.feedback.reason.format", "Плохой формат") },
                                        { id: "too_generic", label: tr("ai.feedback.reason.too_generic", "Слишком общо") },
                                        { id: "too_long", label: tr("ai.feedback.reason.too_long", "Слишком длинно") },
                                        { id: "wrong_language", label: tr("ai.feedback.reason.wrong_language", "Не тот язык") },
                                        { id: "other", label: tr("ai.feedback.reason.other", "Другое") },
                                      ].map((reason) => (
                                        <button
                                          key={reason.id}
                                          type="button"
                                          disabled={feedbackSendingId === m.id}
                                          onClick={() =>
                                            void submitFeedback({
                                              messageId: m.id,
                                              requestId: m.requestId!,
                                              rating: "down",
                                              reason: reason.id,
                                            })
                                          }
                                          className="inline-flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 text-[11px] transition-colors border border-gray-200 disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                          {reason.label}
                                        </button>
                                      ))}
                                      <button
                                        type="button"
                                        disabled={feedbackSendingId === m.id}
                                        onClick={() =>
                                          void submitFeedback({ messageId: m.id, requestId: m.requestId!, rating: "down", reason: null })
                                        }
                                        className="inline-flex items-center justify-center rounded-full bg-white hover:bg-gray-50 text-gray-600 px-3 py-1 text-[11px] transition-colors border border-gray-200 disabled:opacity-60 disabled:cursor-not-allowed"
                                      >
                                        {tr("ai.feedback.skip", "Без причины")}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {sending && !streamingReplyId && (
                      <div className="flex justify-start">
                        <div className="max-w-[98%] sm:max-w-[90%] rounded-2xl px-3 sm:px-4 py-3 text-[15px] sm:text-sm leading-relaxed shadow-sm bg-white border border-gray-200 text-gray-500 rounded-bl-md animate-pulse">
                          {t("common.loading") || "Загрузка..."}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-gray-200 p-2 sm:p-4 bg-white">
                    {error && <div className="mb-3 text-sm text-red-700">{error}</div>}
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="flex-1">
                        <label
                          htmlFor="assistant-request-input"
                          className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#820251]"
                        >
                          {tr("ai.requestInputLabel", "Что нужно найти или заказать")}
                        </label>
                        <div className="rounded-2xl border-2 border-[#c73d8f] bg-gradient-to-b from-[#fff2fa] to-white shadow-[0_8px_22px_rgba(160,0,109,0.12)] transition-colors focus-within:border-[#820251] focus-within:shadow-[0_10px_26px_rgba(130,2,81,0.18)]">
                          <textarea
                            id="assistant-request-input"
                            ref={draftRef}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (sending) return;
                              if (e.key !== "Enter") return;
                              if (e.shiftKey) return;
                              if (e.nativeEvent.isComposing) return;
                              e.preventDefault();
                              void send();
                            }}
                            placeholder={t("ai.placeholder") || "Опишите, что вам нужно найти или заказать..."}
                            rows={3}
                            className="w-full min-h-[112px] max-h-[260px] resize-y overflow-y-auto rounded-2xl border-0 bg-transparent px-3 sm:px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-0"
                            disabled={sending}
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={send}
                        disabled={sending || !draft.trim()}
                        className="w-full sm:w-auto sm:self-end inline-flex items-center justify-center rounded-xl bg-[#820251] text-white px-6 py-3 font-semibold hover:bg-[#6a0143] disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {sending ? (t("common.loading") || "Загрузка...") : (t("ai.sendRequest") || "Отправить")}
                      </button>
                      {sending && (
                        <button
                          type="button"
                          onClick={stopGenerating}
                          className="w-full sm:w-auto sm:self-end inline-flex items-center justify-center rounded-xl bg-gray-200 text-gray-900 px-5 py-3 font-semibold hover:bg-gray-300"
                        >
                          {t("ai.stopGenerating") || "Стоп"}
                        </button>
                      )}
                    </div>
                    <div className="mt-3 rounded-xl border border-[#820251]/20 bg-[#820251]/5 px-3 py-2 text-xs text-[#6a0143]">
                      <div className="whitespace-pre-line">
                        {t("ai.oneClickHelp") ||
                          "Как отправить заявку быстро:\n1) Выберите конкретную компанию в конструкторе и опишите задачу.\n2) Нажмите «Отправить запрос».\n3) В ответе нажмите «Скопировать как письмо» или «Скопировать как сообщение» и отправьте контакту компании."}
                      </div>
                      <button
                        type="button"
                        onClick={() => setRfqOpen((prev) => !prev)}
                        className="mt-2 inline-flex items-center justify-center rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-[#820251] border border-[#820251]/30 hover:bg-[#820251]/10"
                      >
                        {rfqOpen ? `${t("common.hide") || "Скрыть"} конструктор` : (t("ai.rfq.open") || "Конструктор запроса")}
                      </button>
                    </div>

                    {rfqOpen && (
                      <div className="mt-3">
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                          <div className="text-xs font-semibold text-gray-800">
                            {t("ai.rfq.title") || "Конструктор запроса"}
                          </div>
                          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">
                                {t("ai.rfq.company") || "Компания (ID карточки)"}
                              </label>
                              <input
                                type="text"
                                value={rfqForm.companyTarget}
                                onChange={(e) => setRfqForm((prev) => ({ ...prev, companyTarget: e.target.value }))}
                                placeholder={t("ai.rfq.companyPlaceholder") || "Например: 12345 или /company/12345"}
                                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#a0006d]/20"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">{t("ai.rfq.what") || "Что нужно"}</label>
                              <input
                                type="text"
                                value={rfqForm.what}
                                onChange={(e) => setRfqForm((prev) => ({ ...prev, what: e.target.value }))}
                                placeholder={t("ai.rfq.whatPlaceholder") || "Например: упаковочная плёнка / бухгалтерские услуги"}
                                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#a0006d]/20"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">
                                {t("ai.rfq.qty") || "Количество / объём"}
                              </label>
                              <input
                                type="text"
                                value={rfqForm.qty}
                                onChange={(e) => setRfqForm((prev) => ({ ...prev, qty: e.target.value }))}
                                placeholder={t("ai.rfq.qtyPlaceholder") || "Например: 500 шт / 3 месяца / 2 объекта"}
                                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#a0006d]/20"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">
                                {t("ai.rfq.location") || "Город / регион"}
                              </label>
                              <input
                                type="text"
                                value={rfqForm.location}
                                onChange={(e) => setRfqForm((prev) => ({ ...prev, location: e.target.value }))}
                                placeholder={t("ai.rfq.locationPlaceholder") || "Например: Минск / Минская область"}
                                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#a0006d]/20"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">{t("ai.rfq.deadline") || "Дедлайн"}</label>
                              <input
                                type="text"
                                value={rfqForm.deadline}
                                onChange={(e) => setRfqForm((prev) => ({ ...prev, deadline: e.target.value }))}
                                placeholder={t("ai.rfq.deadlinePlaceholder") || "Например: до 15 марта"}
                                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#a0006d]/20"
                              />
                            </div>
                          </div>
                          <div className="mt-3">
                            <label className="block text-xs text-gray-600 mb-1">
                              {t("ai.rfq.notes") || "Требования / примечания"}
                            </label>
                            <textarea
                              value={rfqForm.notes}
                              onChange={(e) => setRfqForm((prev) => ({ ...prev, notes: e.target.value }))}
                              placeholder={t("ai.rfq.notesPlaceholder") || "Например: доставка, сертификаты, условия оплаты…"}
                              rows={2}
                              className="w-full resize-none rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#a0006d]/20"
                            />
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={resetRfqForm}
                              className="text-xs text-gray-600 hover:text-gray-800 hover:underline underline-offset-2"
                            >
                              {t("ai.rfq.reset") || "Очистить"}
                            </button>
                            <button
                              type="button"
                              onClick={fillRfqIntoDraft}
                              disabled={!rfqForm.what.trim()}
                              className="inline-flex items-center justify-center rounded-xl bg-[#820251] text-white px-4 py-2 text-xs font-semibold hover:bg-[#6a0143] disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {t("ai.rfq.fill") || "Заполнить в чат"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="mt-2 text-xs text-gray-500">
                      {t("ai.disclaimer") ||
                        "Ответы генерируются AI и могут быть неточными. Не передавайте чувствительные данные и проверяйте важную информацию."}
                    </div>
                  </div>
                </div>
	              )}

              <div className="mt-4 sm:mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:p-5">
                <div className="text-sm text-gray-600">
                  <div>
                    <span className="text-gray-500">Email:</span> {user.email}
                  </div>
                  <div className="mt-1">
                    <span className="text-gray-500">План:</span> {planLabel}
                  </div>
                  <div className="mt-1">
                    <span className="text-gray-500">Лимит:</span> {user.aiRequestsPerDay} запросов/день
                  </div>
                  {quota && (
                    <div className="mt-1">
                      <span className="text-gray-500">Сегодня ({quota.day}):</span> {quota.used}/{quota.limit}
                      {quota.limit > 0 && (
                        <span className="text-gray-500"> • Осталось:</span>
                      )}
                      {quota.limit > 0 && (
                        <span> {Math.max(0, quota.limit - quota.used)}</span>
                      )}
                    </div>
                  )}
                  {canChat && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void resetPromptCounter()}
                        disabled={quotaResetting}
                        className="inline-flex items-center justify-center rounded-lg border border-[#820251]/30 bg-[#820251]/5 px-3 py-1.5 text-xs font-medium text-[#820251] hover:bg-[#820251]/10 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {quotaResetting ? "Сброс..." : "Сбросить счётчик (тест)"}
                      </button>
                      {quotaResetMessage && (
                        <span className="text-xs text-emerald-700">{quotaResetMessage}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
	            </div>
	          </div>
	        </div>
	        {newDialogModalOpen && (
	          <div
	            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4"
	            onClick={() => setNewDialogModalOpen(false)}
	          >
	            <div
	              role="dialog"
	              aria-modal="true"
	              className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl"
	              onClick={(e) => e.stopPropagation()}
	            >
	              <div className="text-base font-semibold text-gray-900">
	                {t("ai.newDialogModalTitle") || "Открыть новый диалог?"}
	              </div>
	              <p className="mt-2 text-sm text-gray-600">
	                {t("ai.newDialogModalText") ||
	                  "Текущий контекст чата будет очищен. Если нужно сохранить ответ, сначала скопируйте его."}
	              </p>
	              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
	                <button
	                  type="button"
	                  onClick={() => setNewDialogModalOpen(false)}
	                  className="inline-flex items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
	                >
	                  {t("ai.newDialogCancel") || "Отмена"}
	                </button>
	                <button
	                  type="button"
	                  onClick={resetChat}
	                  className="inline-flex items-center justify-center rounded-xl bg-[#820251] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6a0143]"
	                >
	                  {sending
	                    ? (t("ai.newDialogConfirmWhileSending") || "Остановить и открыть")
	                    : (t("ai.newDialogConfirm") || "Открыть")}
	                </button>
	              </div>
	            </div>
	          </div>
	        )}
	      </main>

      <Footer />
    </div>
  );
}
