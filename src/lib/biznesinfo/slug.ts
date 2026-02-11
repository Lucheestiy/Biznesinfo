export function companySlugForUrl(id: string): string {
  const raw = (id || "").trim();
  if (!raw) return raw;
  if (raw.includes("-")) return raw;
  const match = raw.match(/^([A-Za-zА-Яа-я]+)(\d+)$/);
  if (match) return `${match[1]}-${match[2]}`;
  return raw;
}

