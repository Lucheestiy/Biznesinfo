/**
 * Russian plural forms helper
 * 1 компания, 2 компании, 5 компаний
 */
export function pluralize(n: number, forms: [string, string, string]): string {
  const absN = Math.abs(n);
  const mod10 = absN % 10;
  const mod100 = absN % 100;

  if (mod100 >= 11 && mod100 <= 19) {
    return forms[2]; // 11-19 компаний
  }
  if (mod10 === 1) {
    return forms[0]; // 1 компания
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return forms[1]; // 2-4 компании
  }
  return forms[2]; // 5+ компаний
}

/**
 * Format number with proper Russian pluralization
 */
export function formatCompanyCount(n: number): string {
  return `${n} ${pluralize(n, ["компания", "компании", "компаний"])}`;
}
