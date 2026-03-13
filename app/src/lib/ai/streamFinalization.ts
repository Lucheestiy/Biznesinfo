const REWRITE_REASON_CODES = new Set([
  "missing_cards_rewritten",
  "domain_leak_filtered",
  "no_results_filtered",
]);

const FALLBACK_OVERRIDE_MARKER =
  /(подобрал\s+компан\p{L}*\s+из\s+каталог|быстрый\s+first-pass|короткий\s+прозрачный\s+ranking|не\s+подставляю\s+нерелевант|по\s+текущ(?:ему|им)\s+критер\p{L}*[^.\n]{0,50}не\s+найд)/iu;
const TEMPLATE_BLOCK_MARKER =
  /(сообщение\s+для\s+мессенджера|тема\s*:|текст\s*:|subject\s*:|body\s*:|whats\s*app\s*:|модель\s+кофемашин\p{L}*\s*:\s*\[|неисправност\p{L}*\s*:\s*\[|контакт\s*:\s*\[)/iu;
const CLARIFYING_REPLY_MARKER =
  /(для\s+того\s+чтобы\s+помочь\s+вам,\s*мне\s+нужно\s+уточнить\s+несколько\s+вопрос|чтобы\s+подобрать\s+точнее,\s*уточните,\s*пожалуйста|в\s+каком\s+городе\/регионе\s+ищете)/iu;
const SHORTLIST_REPLY_MARKER =
  /(\/\s*company\s*\/|\/\s*catalog\s*\/|подобрал\p{L}*\s+компан\p{L}*|короткий\s+прозрачный\s+ranking|первичн\p{L}*\s+подбор|(?:^|\n)\s*\d+\.\s+)/iu;
const CAPABILITIES_REPLY_MARKER =
  /(что\s+ты\s+уме\p{L}*|что\s+я\s+уме\p{L}*|чем\s+може\p{L}*\s+помоч\p{L}*|я\s+уме\p{L}*|могу\s+помочь|мои\s+возможност\p{L}*)/iu;

function normalizeComparisonText(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[^\p{L}\p{N}\s/.\-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function tokenOverlapScore(a: string, b: string): number {
  const aTokens = new Set(normalizeComparisonText(a).split(" ").filter((token) => token.length >= 3));
  const bTokens = new Set(normalizeComparisonText(b).split(" ").filter((token) => token.length >= 3));
  const minSize = Math.min(aTokens.size, bTokens.size);
  if (minSize === 0) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }
  return intersection / minSize;
}

function commonPrefixScore(a: string, b: string): number {
  if (!a || !b) return 0;
  const minLen = Math.min(a.length, b.length);
  if (minLen === 0) return 0;

  let same = 0;
  while (same < minLen && a[same] === b[same]) {
    same += 1;
  }
  return same / minLen;
}

export function shouldApplyFinalAssistantText(params: {
  streamedText: string;
  finalText: string;
  reasonCodes?: string[];
}): boolean {
  const streamedRaw = String(params.streamedText || "").trim();
  const finalRaw = String(params.finalText || "").trim();

  if (!finalRaw) return false;
  if (!streamedRaw) return true;
  if (streamedRaw === finalRaw) return true;

  const streamed = normalizeComparisonText(streamedRaw);
  const final = normalizeComparisonText(finalRaw);
  if (!streamed || !final) return true;
  if (streamed === final) return true;
  if (streamed.includes(final) || final.includes(streamed)) return true;

  const overlap = tokenOverlapScore(streamed, final);
  const prefix = commonPrefixScore(streamed, final);
  const lengthRatio = Math.min(streamed.length, final.length) / Math.max(streamed.length, final.length);
  const rewriteReason = (params.reasonCodes || []).some((code) => REWRITE_REASON_CODES.has(String(code || "").trim()));
  const finalLooksLikeFallbackOverride = FALLBACK_OVERRIDE_MARKER.test(finalRaw);
  const finalLooksLikeTemplateBlock = TEMPLATE_BLOCK_MARKER.test(finalRaw);
  const streamedLooksLikeTemplateBlock = TEMPLATE_BLOCK_MARKER.test(streamedRaw);
  const finalLooksLikeClarifyingReply = CLARIFYING_REPLY_MARKER.test(finalRaw);
  const streamedLooksLikeShortlist = SHORTLIST_REPLY_MARKER.test(streamedRaw);
  const finalLooksLikeShortlist = SHORTLIST_REPLY_MARKER.test(finalRaw);
  const streamedLooksLikeCapabilities = CAPABILITIES_REPLY_MARKER.test(streamedRaw);
  const streamedLooksComplete = /[.!?…]$/u.test(streamedRaw) || streamedRaw.length >= 120;

  // If stream contains a shortlist but final payload contains clarifying questions,
  // prefer final payload: this is usually the server quality-gate correction.
  if (finalLooksLikeClarifyingReply && streamedLooksLikeShortlist) {
    return true;
  }

  // Keep stable UX for "what can you do" prompts:
  // if stream already produced capabilities answer, don't overwrite it with late shortlist payload.
  if (streamedLooksLikeCapabilities && finalLooksLikeShortlist && overlap < 0.72) {
    return false;
  }

  const hardDivergence = overlap < 0.32 && prefix < 0.2 && lengthRatio < 0.68;
  if (hardDivergence) return false;

  // Prevent late "template" done payload from overwriting a complete non-template stream reply.
  if (
    finalLooksLikeTemplateBlock &&
    !streamedLooksLikeTemplateBlock &&
    streamedLooksComplete &&
    overlap < 0.72 &&
    prefix < 0.55
  ) {
    return false;
  }

  if (
    (rewriteReason || finalLooksLikeFallbackOverride) &&
    !finalLooksLikeClarifyingReply &&
    streamedLooksComplete &&
    overlap < 0.5 &&
    prefix < 0.35
  ) {
    return false;
  }

  return true;
}
