import type { BiznesinfoCompany, BiznesinfoCompanyResponse } from "./types";
import { buildCompanyShortDescription, getCompanyOgImagePath } from "./preview";
import { companySlugForUrl } from "./slug";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  process.env.SITE_URL?.trim() ||
  "https://biznesinfo.lucheestiy.com";

function toAbsolute(path: string): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

function buildAddress(company: BiznesinfoCompany) {
  const parts: Record<string, string> = { "@type": "PostalAddress" };
  if (company.country) parts.addressCountry = company.country;
  if (company.region) parts.addressRegion = company.region;
  if (company.city) parts.addressLocality = company.city;
  if (company.address) parts.streetAddress = company.address;
  return parts;
}

function buildGeo(company: BiznesinfoCompany) {
  const lat = company.extra?.lat;
  const lng = company.extra?.lng;
  if (lat == null || lng == null) return null;
  return {
    "@type": "GeoCoordinates",
    latitude: lat,
    longitude: lng,
  };
}

function parseOpeningHours(company: BiznesinfoCompany): string[] | null {
  const wt = company.work_hours?.work_time;
  if (!wt) return null;

  const dayMap: Record<string, string> = {
    "пн": "Mo", "вт": "Tu", "ср": "We", "чт": "Th",
    "пт": "Fr", "сб": "Sa", "вс": "Su",
    "понедельник": "Mo", "вторник": "Tu", "среда": "We",
    "четверг": "Th", "пятница": "Fr", "суббота": "Sa",
    "воскресенье": "Su",
  };

  const specs: string[] = [];

  const lines = wt.split(/[;\n]/);
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (!trimmed) continue;

    const timeMatch = trimmed.match(/(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/);
    if (!timeMatch) continue;

    const open = timeMatch[1].replace(".", ":");
    const close = timeMatch[2].replace(".", ":");

    const days: string[] = [];
    for (const [ru, en] of Object.entries(dayMap)) {
      if (trimmed.includes(ru)) days.push(en);
    }

    if (days.length > 0) {
      specs.push(`${days.join(",")} ${open}-${close}`);
    } else {
      specs.push(`Mo,Tu,We,Th,Fr ${open}-${close}`);
    }
  }

  return specs.length > 0 ? specs : null;
}

export function buildCompanyJsonLd(data: BiznesinfoCompanyResponse): Record<string, unknown> {
  const company = data.company;
  const canonicalId = companySlugForUrl(data.id);
  const url = `${SITE_URL}/company/${encodeURIComponent(canonicalId)}`;
  const description = buildCompanyShortDescription(company);

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: company.name,
    url,
  };

  if (description) schema.description = description;
  if (company.unp) schema.taxID = company.unp;

  const imagePath = getCompanyOgImagePath(company);
  if (imagePath) schema.image = toAbsolute(imagePath);

  schema.address = buildAddress(company);

  const geo = buildGeo(company);
  if (geo) schema.geo = geo;

  const phone = company.phones?.[0] || company.phones_ext?.[0]?.number;
  if (phone) schema.telephone = phone;

  const email = company.emails?.[0];
  if (email) schema.email = email;

  const website = company.websites?.[0];
  if (website) schema.sameAs = website;

  const hours = parseOpeningHours(company);
  if (hours) schema.openingHours = hours;

  return schema;
}

export function buildCompanyBreadcrumbJsonLd(
  data: BiznesinfoCompanyResponse,
): Record<string, unknown> {
  const company = data.company;
  const canonicalId = companySlugForUrl(data.id);

  const items: Array<{ name: string; url: string }> = [
    { name: "Главная", url: SITE_URL },
  ];

  const cat = company.categories?.[0];
  if (cat) {
    items.push({
      name: cat.name,
      url: `${SITE_URL}/catalog/${encodeURIComponent(cat.slug)}`,
    });
  }

  const rubric = company.rubrics?.[0];
  if (rubric) {
    items.push({
      name: rubric.name,
      url: `${SITE_URL}/catalog/${encodeURIComponent(rubric.slug)}`,
    });
  }

  items.push({
    name: company.name,
    url: `${SITE_URL}/company/${encodeURIComponent(canonicalId)}`,
  });

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function buildWebsiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Biznesinfo.by",
    url: SITE_URL,
    description:
      "Каталог предприятий, организаций и фирм Беларуси. Поиск компаний по категориям и регионам.",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}
