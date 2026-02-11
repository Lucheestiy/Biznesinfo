import type { KeywordFallbackMode, KeywordGenerationOptions } from "./keywords";
import { createVolumeLookup, loadKeywordVolumeMapFromFiles, parseStatsPaths } from "./keywordStats";

interface CachedRuntimeOptions {
  signature: string;
  options: KeywordGenerationOptions;
}

let cache: CachedRuntimeOptions | null = null;

function parseBool(raw: string | null | undefined): boolean {
  const value = (raw || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function parseFallbackMode(raw: string | null | undefined): KeywordFallbackMode {
  return (raw || "").trim().toLowerCase() === "short" ? "short" : "rubrics";
}

function collectStatsPathsFromEnv(): string[] {
  const unique = new Set<string>();

  const chunks = [
    process.env.KEYWORDS_STATS_FILES,
    process.env.KEYWORD_STATS_FILES,
    process.env.KEYWORDS_WORDSTAT_CSV,
    process.env.KEYWORDS_ANALYTICS_CSV,
    process.env.KEYWORDS_GA_CSV,
    process.env.KEYWORDS_GSC_CSV,
    process.env.KEYWORDS_METRIKA_CSV,
  ];

  for (const chunk of chunks) {
    for (const item of parseStatsPaths(chunk)) {
      unique.add(item);
    }
  }

  return Array.from(unique);
}

function runtimeSignature(): string {
  return [
    process.cwd(),
    process.env.KEYWORDS_STATS_FILES || "",
    process.env.KEYWORD_STATS_FILES || "",
    process.env.KEYWORDS_WORDSTAT_CSV || "",
    process.env.KEYWORDS_ANALYTICS_CSV || "",
    process.env.KEYWORDS_GA_CSV || "",
    process.env.KEYWORDS_GSC_CSV || "",
    process.env.KEYWORDS_METRIKA_CSV || "",
    process.env.KEYWORDS_STRICT_STATS || "",
    process.env.KEYWORD_STRICT_STATS || "",
    process.env.KEYWORDS_FALLBACK_MODE || "",
    process.env.KEYWORD_FALLBACK_MODE || "",
  ].join("||");
}

export function getServerKeywordGenerationOptions(): KeywordGenerationOptions {
  const signature = runtimeSignature();
  if (cache && cache.signature === signature) return cache.options;

  const strictStats =
    parseBool(process.env.KEYWORDS_STRICT_STATS)
    || parseBool(process.env.KEYWORD_STRICT_STATS);

  const fallbackMode = parseFallbackMode(
    process.env.KEYWORDS_FALLBACK_MODE || process.env.KEYWORD_FALLBACK_MODE,
  );

  const statsPaths = collectStatsPathsFromEnv();
  const volumeMap = loadKeywordVolumeMapFromFiles(statsPaths, {
    skipMissing: true,
    onWarning: (message) => {
      process.stderr.write(`[keywords] ${message}\n`);
    },
  });

  const options: KeywordGenerationOptions = {
    strictStats,
    fallbackMode,
    volumeMap,
    volumeLookup: volumeMap.size > 0 ? createVolumeLookup(volumeMap) : undefined,
  };

  cache = { signature, options };
  return options;
}
