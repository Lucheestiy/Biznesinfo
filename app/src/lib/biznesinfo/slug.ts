const DASH_VARIANTS_RE = /[‐‑‒–—―]/gu;
const COMPANY_PATH_SEGMENT_RE = /\/company\/([^/?#]+)/iu;
const DOMAIN_PREFIX_ID_RE = /^biznesinfo(?:[.-]?[a-z0-9]+)+-(\d+)$/iu;

export function companySlugForUrl(id: string): string {
  const raw = (id || "").trim();
  if (!raw) return "";

  let value = raw;
  try {
    value = decodeURIComponent(value);
  } catch {
    value = raw;
  }

  const companyPathMatch = value.match(COMPANY_PATH_SEGMENT_RE);
  if (companyPathMatch?.[1]) value = companyPathMatch[1];

  value = value
    .replace(DASH_VARIANTS_RE, "-")
    .replace(/^[`"'«»“”‘’()[\]{}<>]+/gu, "")
    .replace(/[`"'«»“”‘’()[\]{}<>.,;:!?]+$/gu, "")
    .trim();
  if (!value) return "";

  const domainPrefixed = value.match(DOMAIN_PREFIX_ID_RE);
  if (domainPrefixed?.[1]) return `biznesinfo-${domainPrefixed[1]}`;

  const safe = value.replace(/[^\p{L}\p{N}-]/gu, "");
  if (!safe) return "";
  if (safe.includes("-")) return safe;

  const match = safe.match(/^([A-Za-zА-Яа-я]+)(\d+)$/);
  if (match) return `${match[1]}-${match[2]}`;
  return safe;
}
