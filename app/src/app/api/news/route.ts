import { NextResponse } from "next/server";
import {
  localizeTextByUiLanguage,
  normalizeUiLanguage,
  type BiznesinfoUiLanguage,
} from "@/lib/biznesinfo/translation";

interface NewsItem {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  description: string;
  image: string | null;
  category: string;
}

// Cache for RSS data with images
let cachedNews: NewsItem[] = [];
let lastFetch = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const RSS_TIMEOUT_MS = 2500;
const IMAGE_TIMEOUT_MS = 1200;
const LOCALIZED_NEWS_CACHE_TTL_MS = 10 * 60 * 1000;
const NEWS_TRANSLATE_ITEM_CONCURRENCY = 2;

type LocalizedNewsCacheEntry = {
  value: NewsItem[];
  expiresAt: number;
  sourceStamp: number;
};

const localizedNewsCache = new Map<BiznesinfoUiLanguage, LocalizedNewsCacheEntry>();

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchImageFromPage(url: string): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)",
      },
    }, IMAGE_TIMEOUT_MS);
    if (!response.ok) return null;

    const html = await response.text();

    // Try og:image first
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogMatch) return ogMatch[1];

    // Try twitter:image
    const twitterMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    if (twitterMatch) return twitterMatch[1];

    // Try first article image
    const imgMatch = html.match(/<div[^>]+class="[^"]*news_main_img[^"]*"[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch) return imgMatch[1];

    // Any large image in article
    const anyImg = html.match(/<img[^>]+src=["'](https:\/\/img\.belta\.by[^"']+)["']/i);
    if (anyImg) return anyImg[1];

    return null;
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (_item: T, _index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), items.length) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) break;
        out[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

function getLocalizedNewsCache(language: BiznesinfoUiLanguage): NewsItem[] | null {
  const cached = localizedNewsCache.get(language);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now() || cached.sourceStamp !== lastFetch) {
    localizedNewsCache.delete(language);
    return null;
  }
  return cached.value;
}

function setLocalizedNewsCache(language: BiznesinfoUiLanguage, value: NewsItem[]): void {
  localizedNewsCache.set(language, {
    value,
    expiresAt: Date.now() + LOCALIZED_NEWS_CACHE_TTL_MS,
    sourceStamp: lastFetch,
  });
}

async function localizeNewsItems(
  news: NewsItem[],
  language: BiznesinfoUiLanguage,
): Promise<NewsItem[]> {
  if (!Array.isArray(news) || news.length === 0) return news;
  if (language === "ru") return news;

  const cached = getLocalizedNewsCache(language);
  if (cached) return cached;

  const localized = await mapWithConcurrency(
    news,
    NEWS_TRANSLATE_ITEM_CONCURRENCY,
    async (item) => {
      const [title, description, categoryTranslated] = await Promise.all([
        localizeTextByUiLanguage(item.title, language),
        localizeTextByUiLanguage(item.description, language),
        localizeTextByUiLanguage(item.category || "", language),
      ]);
      return {
        ...item,
        title: title || item.title,
        description: description || item.description,
        category: categoryTranslated || item.category,
      };
    },
  );

  setLocalizedNewsCache(language, localized);
  return localized;
}

async function fetchRSS(): Promise<NewsItem[]> {
  const now = Date.now();
  if (cachedNews.length > 0 && now - lastFetch < CACHE_TTL) {
    return cachedNews;
  }

  try {
    const response = await fetchWithTimeout("https://www.belta.by/rss/all", {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)",
      },
      next: { revalidate: 600 },
    }, RSS_TIMEOUT_MS);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xml = await response.text();
    const newsWithoutImages = parseRSS(xml);

    // Fetch images for first 6 news items in parallel
    const newsWithImages = await Promise.all(
      newsWithoutImages.slice(0, 6).map(async (item) => {
        const image = await fetchImageFromPage(item.link);
        return { ...item, image };
      })
    );

    cachedNews = newsWithImages;
    lastFetch = now;

    return newsWithImages;
  } catch (error) {
    console.error("RSS fetch error:", error);
    return cachedNews.length > 0 ? cachedNews : [];
  }
}

function parseRSS(xml: string): NewsItem[] {
  const items: NewsItem[] = [];

  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  let id = 0;

  while ((match = itemRegex.exec(xml)) !== null && id < 10) {
    const itemXml = match[1];

    const title = extractTag(itemXml, "title");
    const link = extractTag(itemXml, "link");
    const pubDate = extractTag(itemXml, "pubDate");
    const description = extractTag(itemXml, "description");
    const category = extractTag(itemXml, "category") || "Новости";

    if (title && link) {
      items.push({
        id: `news-${id++}`,
        title: cleanHtml(title),
        link,
        pubDate,
        description: cleanHtml(description).slice(0, 200),
        image: null,
        category,
      });
    }
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i");
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) {
    return cdataMatch[1].trim();
  }

  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}

function cleanHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const language = normalizeUiLanguage(searchParams.get("lang") || searchParams.get("language"));
  const limit = Math.min(parseInt(searchParams.get("limit") || "3", 10), 10);

  const news = await fetchRSS();
  const localizedNews = await localizeNewsItems(news, language);

  return NextResponse.json({
    success: true,
    news: localizedNews.slice(0, limit),
    source: "belta.by",
    language,
    cached: Date.now() - lastFetch < 1000,
  });
}
