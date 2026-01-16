"use client";

import { useEffect, useState } from "react";
import { useLanguage, Language } from "@/contexts/LanguageContext";

interface NewsItem {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  description: string;
  image: string | null;
  category?: string;
}

const localeMap: Record<Language, string> = {
  ru: "ru-RU",
  en: "en-US",
  be: "be-BY",
  zh: "zh-CN",
};

// Fallback placeholder image
const PLACEHOLDER_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='200' viewBox='0 0 400 200'%3E%3Crect fill='%23820251' width='400' height='200'/%3E%3Ctext fill='%23fff' font-family='sans-serif' font-size='16' x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle'%3E%D0%9D%D0%BE%D0%B2%D0%BE%D1%81%D1%82%D0%B8%3C/text%3E%3C/svg%3E";

export default function NewsBlock() {
  const { language } = useLanguage();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchNews() {
      try {
        const res = await fetch("/api/news?limit=6");
        if (!res.ok) throw new Error("Failed to fetch news");
        const data = await res.json();
        if (isMounted && data.news) {
          setNews(data.news);
        }
      } catch (err) {
        if (isMounted) {
          setError("Не удалось загрузить новости");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchNews();
    return () => {
      isMounted = false;
    };
  }, []);

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(localeMap[language], {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  if (loading) {
    return (
      <div id="news" className="container mx-auto py-12 px-4">
        <h2 className="text-2xl font-bold text-gray-800 mb-2 flex items-center gap-2">
          <span className="w-1 h-8 bg-[#820251] rounded"></span>
          Новости партнёров
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden animate-pulse">
              <div className="bg-gray-200 h-48 w-full"></div>
              <div className="p-5">
                <div className="h-4 bg-gray-200 rounded mb-3 w-3/4"></div>
                <div className="h-3 bg-gray-200 rounded mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-5/6"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || news.length === 0) {
    return null;
  }

  return (
    <div id="news" className="container mx-auto py-12 px-4">
      <h2 className="text-2xl font-bold text-gray-800 mb-2 flex items-center gap-2">
        <span className="w-1 h-8 bg-[#820251] rounded"></span>
        Новости партнёров
      </h2>
      <p className="text-gray-600 mb-8 ml-3">
        Актуальные новости от БелТА
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {news.map((item) => (
          <a
            key={item.id}
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="block group relative"
          >
            {/* Animated running border */}
            <div className="absolute inset-0 rounded-2xl p-[2px] overflow-hidden">
              <div
                className="absolute inset-[-100%] animate-[spin_3s_linear_infinite]"
                style={{
                  background: 'conic-gradient(from 0deg, transparent 0%, #facc15 10%, #fef08a 20%, transparent 30%, transparent 70%, #facc15 80%, #fef08a 90%, transparent 100%)',
                }}
              />
              <div className="absolute inset-[2px] bg-white rounded-[14px]" />
            </div>

            <article className="relative bg-white rounded-2xl shadow-lg overflow-hidden
              hover:shadow-2xl hover:scale-[1.02] transition-all duration-300 cursor-pointer h-[420px] flex flex-col">
              {/* News Image */}
              <div className="relative w-full h-48 bg-gray-100 overflow-hidden flex-shrink-0">
                <img
                  src={item.image || PLACEHOLDER_IMAGE}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = PLACEHOLDER_IMAGE;
                  }}
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="absolute top-3 left-3 flex gap-2">
                  <span className="bg-[#820251] text-white text-xs px-3 py-1.5 rounded-full font-medium shadow-lg">
                    {item.category || "БелТА"}
                  </span>
                </div>
              </div>

              <div className="p-5 flex-grow flex flex-col">
                {/* Date */}
                <time className="text-xs text-gray-500 mb-2 font-medium">
                  {formatDate(item.pubDate)}
                </time>

                {/* Title */}
                <h3 className="font-bold text-gray-800 mb-3 line-clamp-2 leading-tight group-hover:text-[#820251] transition-colors">
                  {item.title}
                </h3>

                {/* Description */}
                <p className="text-gray-600 text-sm line-clamp-3 flex-grow">
                  {item.description}
                </p>

                {/* Read more link */}
                <div className="mt-4 text-[#820251] text-sm font-semibold flex items-center gap-1
                  group-hover:gap-2 transition-all">
                  Читать далее
                  <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
              </div>
            </article>
          </a>
        ))}
      </div>

      {/* Source attribution */}
      <div className="mt-6 text-center">
        <a
          href="https://www.belta.by"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-gray-500 hover:text-[#820251] transition-colors"
        >
          Источник: БелТА — Белорусское телеграфное агентство
        </a>
      </div>
    </div>
  );
}
