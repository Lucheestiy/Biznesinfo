import React from "react";

const STOP_WORDS = new Set([
  "и",
  "в",
  "во",
  "на",
  "по",
  "для",
  "с",
  "со",
  "к",
  "ко",
  "от",
  "до",
  "из",
  "у",
  "о",
  "об",
  "обо",
  "а",
  "но",
  "или",
]);

const VOWEL_END_RE = /[aeiouyаеёиоуыэюя]$/iu;

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function tokenizeHighlightQuery(raw: string): string[] {
  const cleaned = (raw || "")
    .trim()
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'“”„]/gu, " ")
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  if (!cleaned) return [];

  const tokens: string[] = [];
  const seen = new Set<string>();

  for (const part of cleaned.split(" ")) {
    const token = part.trim();
    if (!token) continue;
    if (STOP_WORDS.has(token)) continue;
    if (token.length < 2 && !/\d/gu.test(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
    if (tokens.length >= 12) break;
  }

  return tokens;
}

function expandTokenRoots(token: string): string[] {
  const out = new Set<string>();
  const t = (token || "").trim().toLowerCase().replace(/ё/gu, "е");
  if (!t) return [];

  out.add(t);

  if (t.length >= 4 && VOWEL_END_RE.test(t)) {
    const stem = t.slice(0, -1);
    if (stem.length >= 3) out.add(stem);
    if (stem.endsWith("к") && stem.length >= 3) {
      out.add(`${stem.slice(0, -1)}ч`);
    }
  }

  return Array.from(out);
}

function rootToPattern(root: string): string | null {
  const r = (root || "").trim().toLowerCase().replace(/ё/gu, "е");
  if (!r) return null;
  if (r.length < 3 && !/\d/gu.test(r)) return null;

  if (r === "сыр") {
    return `сыр(?!ь)(?!окопч)(?!овялен)(?!овял)[\\p{L}\\p{N}-]*`;
  }

  if (r === "лес") {
    return `лес(?!т)[\\p{L}\\p{N}-]*`;
  }

  if (r === "газ") {
    return `газ(?!ет)(?!он)(?!ел)(?!ир)[\\p{L}\\p{N}-]*`;
  }

  const escaped = escapeRegExp(r).replace(/е/gu, "[её]");
  return `${escaped}[\\p{L}\\p{N}-]*`;
}

export function buildHighlightRegex(tokens: string[]): RegExp | null {
  const roots: string[] = [];
  for (const token of tokens || []) {
    roots.push(...expandTokenRoots(token));
  }

  const uniq = Array.from(new Set(roots.map((t) => (t || "").trim()).filter(Boolean)));
  if (!uniq.length) return null;

  const patterns = uniq
    .sort((a, b) => b.length - a.length)
    .map((root) => rootToPattern(root))
    .filter((p): p is string => Boolean(p));

  const joined = patterns.join("|");
  if (!joined) return null;
  return new RegExp(`(${joined})`, "giu");
}

export function highlightText(
  text: string,
  tokens: string[],
  markClassName = "bg-yellow-300 text-gray-900 rounded px-0.5",
): React.ReactNode {
  const value = text || "";
  if (!value.trim()) return text;
  if (!tokens || tokens.length === 0) return text;

  const regex = buildHighlightRegex(tokens);
  if (!regex) return text;

  const parts = value.split(regex);
  if (parts.length <= 1) return text;

  return parts.map((part, idx) =>
    idx % 2 === 1 ? (
      <mark key={`m${idx}`} className={markClassName}>
        {part}
      </mark>
    ) : (
      <React.Fragment key={`t${idx}`}>{part}</React.Fragment>
    ),
  );
}
