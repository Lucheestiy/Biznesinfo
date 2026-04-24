"use client";

import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { companySlugForUrl } from "@/lib/biznesinfo/slug";
import type { BiznesinfoPhoneExt } from "@/lib/biznesinfo/types";
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/browser/safeStorage";

interface CompanyCallDialogProps {
  open: boolean;
  companyId: string;
  companyName: string;
  phone: BiznesinfoPhoneExt | null;
  email?: string;
  website?: string;
  address?: string;
  onClose: () => void;
}

interface StoredCompanyCall {
  companyId: string;
  companyName: string;
  phoneNumber: string;
  calledAt: string;
}

const COMPANY_CALL_HISTORY_STORAGE_KEY = "biznes_company_call_history_v1";

function normalizePhoneForTel(phone: string): string {
  const trimmed = (phone || "").trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/[^\d+]/g, "");
  if (!cleaned) return trimmed;
  if (cleaned.startsWith("+")) return `+${cleaned.slice(1).replace(/\+/g, "")}`;
  return cleaned.replace(/\+/g, "");
}

function escapeVCardText(value: string): string {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function sanitizeFileName(value: string): string {
  return String(value || "company-contact")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "company-contact";
}

function buildCompanyVCard(params: {
  companyName: string;
  phone: string;
  email?: string;
  website?: string;
  address?: string;
}): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeVCardText(params.companyName)}`,
    `ORG:${escapeVCardText(params.companyName)}`,
    `TEL;TYPE=WORK,VOICE:${escapeVCardText(normalizePhoneForTel(params.phone) || params.phone)}`,
  ];

  if ((params.email || "").trim()) {
    lines.push(`EMAIL;TYPE=INTERNET,WORK:${escapeVCardText(params.email || "")}`);
  }
  if ((params.website || "").trim()) {
    lines.push(`URL:${escapeVCardText(params.website || "")}`);
  }
  if ((params.address || "").trim()) {
    lines.push(`ADR;TYPE=WORK:;;${escapeVCardText(params.address || "")};;;;`);
  }

  lines.push("END:VCARD");
  return `${lines.join("\r\n")}\r\n`;
}

function readStoredCompanyCalls(): Record<string, StoredCompanyCall> {
  const raw = safeLocalStorageGet(COMPANY_CALL_HISTORY_STORAGE_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const out: Record<string, StoredCompanyCall> = {};
    for (const [rawKey, rawValue] of Object.entries(parsed)) {
      const key = companySlugForUrl(String(rawKey || "").trim());
      if (!key) continue;
      const value = rawValue as Partial<StoredCompanyCall>;
      if (
        typeof value?.companyName !== "string" ||
        typeof value?.phoneNumber !== "string" ||
        typeof value?.calledAt !== "string"
      ) {
        continue;
      }
      out[key] = {
        companyId: key,
        companyName: value.companyName.trim(),
        phoneNumber: value.phoneNumber.trim(),
        calledAt: value.calledAt.trim(),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeStoredCompanyCalls(value: Record<string, StoredCompanyCall>): void {
  safeLocalStorageSet(COMPANY_CALL_HISTORY_STORAGE_KEY, JSON.stringify(value));
}

function getStoredCompanyCall(companyId: string): StoredCompanyCall | null {
  const normalizedId = companySlugForUrl((companyId || "").trim());
  if (!normalizedId) return null;
  return readStoredCompanyCalls()[normalizedId] || null;
}

function rememberCompanyCall(params: {
  companyId: string;
  companyName: string;
  phoneNumber: string;
}): StoredCompanyCall | null {
  const normalizedId = companySlugForUrl((params.companyId || "").trim());
  const phoneNumber = (params.phoneNumber || "").trim();
  const companyName = (params.companyName || "").trim();
  if (!normalizedId || !phoneNumber || !companyName) return null;

  const nextEntry: StoredCompanyCall = {
    companyId: normalizedId,
    companyName,
    phoneNumber,
    calledAt: new Date().toISOString(),
  };
  const stored = readStoredCompanyCalls();
  stored[normalizedId] = nextEntry;
  writeStoredCompanyCalls(stored);
  return nextEntry;
}

function getLocaleFromLanguage(language: string): string {
  if (language === "en") return "en-US";
  if (language === "be") return "be-BY";
  if (language === "zh") return "zh-CN";
  return "ru-RU";
}

function formatCalledAt(value: string, language: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  try {
    return new Intl.DateTimeFormat(getLocaleFromLanguage(language), {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export default function CompanyCallDialog({
  open,
  companyId,
  companyName,
  phone,
  email,
  website,
  address,
  onClose,
}: CompanyCallDialogProps) {
  const { t, language } = useLanguage();
  const [lastCalledAt, setLastCalledAt] = useState("");

  useEffect(() => {
    if (!open) return;
    const entry = getStoredCompanyCall(companyId);
    setLastCalledAt(entry?.calledAt || "");
  }, [companyId, open]);

  const selectedCallPhoneNumber = (phone?.number || "").trim();
  const selectedCallPhoneHref = useMemo(
    () => normalizePhoneForTel(selectedCallPhoneNumber) || selectedCallPhoneNumber,
    [selectedCallPhoneNumber],
  );
  const formattedLastCalledAt = useMemo(
    () => formatCalledAt(lastCalledAt, language),
    [language, lastCalledAt],
  );

  const handleCallNow = () => {
    if (!selectedCallPhoneHref || typeof window === "undefined") return;
    const entry = rememberCompanyCall({
      companyId,
      companyName,
      phoneNumber: selectedCallPhoneNumber,
    });
    setLastCalledAt(entry?.calledAt || "");
    onClose();
    window.location.href = `tel:${selectedCallPhoneHref}`;
  };

  const handleSaveContact = () => {
    if (!selectedCallPhoneNumber || typeof document === "undefined" || typeof window === "undefined") return;

    const vCard = buildCompanyVCard({
      companyName,
      phone: selectedCallPhoneNumber,
      email,
      website,
      address,
    });

    const blob = new Blob([vCard], { type: "text/vcard;charset=utf-8" });
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `${sanitizeFileName(companyName)}.vcf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1500);
  };

  if (!open || !phone) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`${t("company.call")}: ${companyName}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-3xl border border-white/60 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-[#9a0660] to-[#5a0138] px-5 py-4 text-white">
          <div className="text-sm text-white/80">{t("company.call")}</div>
          <div className="mt-1 text-xl font-bold leading-tight">{companyName}</div>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div>
            <div className="mb-1 text-sm text-gray-500">{t("company.phone")}</div>
            <div className="break-all text-lg font-semibold text-[#820251]">{phone.number}</div>
            {phone.labels && phone.labels.length > 0 && (
              <div className="mt-1 text-sm text-gray-500">{phone.labels.join(", ")}</div>
            )}
          </div>

          {formattedLastCalledAt && (
            <div className="rounded-2xl border border-[#166534]/15 bg-[#166534]/[0.06] px-4 py-3 text-sm text-[#166534]">
              <span className="font-semibold">{t("company.lastCalled")}:</span> {formattedLastCalledAt}
            </div>
          )}

          <p className="text-sm leading-relaxed text-gray-600">
            {t("company.callContactHint")}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={handleCallNow}
              className="inline-flex items-center justify-center rounded-xl bg-[#820251] px-4 py-3 font-semibold text-white transition-colors hover:bg-[#6f0145]"
            >
              {t("company.call")}
            </button>
            <button
              type="button"
              onClick={handleSaveContact}
              className="inline-flex items-center justify-center rounded-xl border-2 border-[#166534] px-4 py-3 font-semibold text-[#166534] transition-colors hover:bg-[#166534] hover:text-white"
            >
              {t("company.saveContact")}
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
          >
            {t("company.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
