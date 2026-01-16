import { NextResponse } from "next/server";

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

async function fetchImageFromPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)",
      },
    });
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

async function fetchRSS(): Promise<NewsItem[]> {
  const now = Date.now();
  if (cachedNews.length > 0 && now - lastFetch < CACHE_TTL) {
    return cachedNews;
  }

  try {
    const response = await fetch("https://www.belta.by/rss/all", {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)",
      },
      next: { revalidate: 600 },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xml = await response.text();
    const newsWithoutImages = parseRSS(xml);

    // Fetch images for first 5 news items in parallel
    const newsWithImages = await Promise.all(
      newsWithoutImages.slice(0, 5).map(async (item) => {
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
  const limit = Math.min(parseInt(searchParams.get("limit") || "3", 10), 10);

  const news = await fetchRSS();

  return NextResponse.json({
    success: true,
    news: news.slice(0, limit),
    source: "belta.by",
    cached: Date.now() - lastFetch < 1000,
  });
}
