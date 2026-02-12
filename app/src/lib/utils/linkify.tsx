import React from "react";

type LinkToken =
  | { type: "text"; text: string }
  | { type: "link"; kind: "url" | "email" | "phone" | "internal"; text: string; href: string; trailing: string };

function stripTrailingPunctuation(raw: string): { core: string; trailing: string } {
  let core = raw || "";
  let trailing = "";
  while (core.length > 0 && /[)\],.;:!?}"'`»“”’]+$/u.test(core)) {
    const ch = core.slice(-1);
    core = core.slice(0, -1);
    trailing = ch + trailing;
  }
  return { core, trailing };
}

function normalizeUrl(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;

  const candidate = s.startsWith("www.") ? `https://${s}` : s;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function normalizeTel(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  const cleaned = s.replace(/[^\d+]/gu, "");
  const normalized = cleaned.startsWith("+") ? `+${cleaned.replace(/[^\d]/gu, "")}` : cleaned.replace(/[^\d]/gu, "");
  const digits = normalized.replace(/[^\d]/gu, "");
  if (digits.length < 9) return null;
  if (digits.length > 20) return null;
  return normalized.startsWith("+") ? `tel:${normalized}` : `tel:${digits}`;
}

function normalizeInternalPath(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s.startsWith("/")) return null;
  if (!/^\/(?:company|catalog)\//u.test(s)) return null;
  if (s.includes("..")) return null;
  if (/[\\\u0000-\u001F]/u.test(s)) return null;

  const pathOnly = s.split(/[?#]/u, 1)[0] || s;

  if (pathOnly.startsWith("/company/")) {
    const rawSlug = pathOnly.slice("/company/".length);
    if (!rawSlug) return null;

    let decoded = rawSlug;
    try {
      decoded = decodeURIComponent(rawSlug);
    } catch {
      decoded = rawSlug;
    }

    let cleaned = decoded.replace(/[)"'`»“”’.,;:!?}]+$/gu, "").trim();
    if (!cleaned) return null;
    cleaned = cleaned.replace(/[^\p{L}\p{N}-]/gu, "");
    if (!cleaned) return null;
    return `/company/${encodeURIComponent(cleaned)}`;
  }

  if (s.length > 300) return s.slice(0, 300);
  return s;
}

function tokenizeUrlsAndEmails(text: string): LinkToken[] {
  const input = String(text || "");
  if (!input) return [];

  const urlRe = /\b(?:https?:\/\/|www\.)[^\s<>()]+/giu;
  const emailRe = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;

  const matches: Array<{ kind: "url" | "email"; index: number; raw: string }> = [];

  for (const m of input.matchAll(urlRe)) {
    if (typeof m.index !== "number") continue;
    matches.push({ kind: "url", index: m.index, raw: m[0] || "" });
  }

  for (const m of input.matchAll(emailRe)) {
    if (typeof m.index !== "number") continue;
    matches.push({ kind: "email", index: m.index, raw: m[0] || "" });
  }

  matches.sort((a, b) => a.index - b.index || b.raw.length - a.raw.length);

  const out: LinkToken[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index < cursor) continue;
    if (match.index > cursor) out.push({ type: "text", text: input.slice(cursor, match.index) });

    const { core, trailing } = stripTrailingPunctuation(match.raw);
    if (!core) {
      cursor = match.index + match.raw.length;
      if (trailing) out.push({ type: "text", text: trailing });
      continue;
    }

    const href =
      match.kind === "url"
        ? normalizeUrl(core)
        : core
          ? `mailto:${core}`
          : null;

    if (!href) {
      out.push({ type: "text", text: match.raw });
      cursor = match.index + match.raw.length;
      continue;
    }

    out.push({ type: "link", kind: match.kind, text: core, href, trailing });
    cursor = match.index + match.raw.length;
    if (trailing) out.push({ type: "text", text: trailing });
  }

  if (cursor < input.length) out.push({ type: "text", text: input.slice(cursor) });
  return out.length > 0 ? out : [{ type: "text", text: input }];
}

function linkifyInternalPaths(tokens: LinkToken[]): LinkToken[] {
  const out: LinkToken[] = [];
  const internalRe = /\/(?:company|catalog)\/[^\s<>()]+/giu;

  for (const token of tokens) {
    if (token.type !== "text") {
      out.push(token);
      continue;
    }

    const text = token.text || "";
    if (!text) continue;

    let cursor = 0;
    for (const m of text.matchAll(internalRe)) {
      if (typeof m.index !== "number") continue;
      const start = m.index;
      const raw = m[0] || "";
      const end = start + raw.length;

      const prev = start > 0 ? text[start - 1] : "";
      if (prev && /[A-Za-z0-9_]/u.test(prev)) continue;

      const { core, trailing } = stripTrailingPunctuation(raw);
      const href = normalizeInternalPath(core);
      if (!href) continue;

      if (start > cursor) out.push({ type: "text", text: text.slice(cursor, start) });
      out.push({ type: "link", kind: "internal", text: core, href, trailing });
      cursor = end;
      if (trailing) out.push({ type: "text", text: trailing });
    }

    if (cursor < text.length) out.push({ type: "text", text: text.slice(cursor) });
  }

  return out;
}

function linkifyPhones(tokens: LinkToken[]): LinkToken[] {
  const out: LinkToken[] = [];
  const phoneRe = /\+?\d[\d\s().-]{7,}\d/gu;

  for (const token of tokens) {
    if (token.type !== "text") {
      out.push(token);
      continue;
    }

    const text = token.text || "";
    if (!text) continue;

    let cursor = 0;
    for (const m of text.matchAll(phoneRe)) {
      if (typeof m.index !== "number") continue;
      const start = m.index;
      const raw = m[0] || "";
      const end = start + raw.length;

      const prev = start > 0 ? text[start - 1] : "";
      const next = end < text.length ? text[end] : "";
      const isBoundaryOk = (!prev || !/[A-Za-z0-9_]/u.test(prev)) && (!next || !/[A-Za-z0-9_]/u.test(next));
      if (!isBoundaryOk) continue;

      const { core, trailing } = stripTrailingPunctuation(raw);
      const tel = normalizeTel(core);
      if (!tel) continue;

      if (start > cursor) out.push({ type: "text", text: text.slice(cursor, start) });
      out.push({ type: "link", kind: "phone", text: core, href: tel, trailing });
      cursor = end;
      if (trailing) out.push({ type: "text", text: trailing });
    }

    if (cursor < text.length) out.push({ type: "text", text: text.slice(cursor) });
  }

  return out;
}

export function renderLinkifiedText(text: string): React.ReactNode {
  const initial = tokenizeUrlsAndEmails(text);
  const tokens = linkifyPhones(linkifyInternalPaths(initial));
  return tokens.map((token, idx) => {
    if (token.type === "text") return token.text;

    const isExternal = token.kind === "url";
    return (
      <a
        key={`${token.kind}:${idx}`}
        href={token.href}
        className="text-[#820251] underline underline-offset-2 break-words hover:text-[#6a0143]"
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noreferrer noopener" : undefined}
      >
        {token.text}
      </a>
    );
  });
}
