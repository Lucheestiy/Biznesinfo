import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { NextRequest } from "next/server";

import { biznesinfoGetCompany } from "@/lib/biznesinfo/store";

export const runtime = "nodejs";

const DEFAULT_CACHE_DIR = path.join(
  os.tmpdir(),
  `biznesinfo-company-media-cache-${typeof process.getuid === "function" ? process.getuid() : "app"}`,
);
const CACHE_DIR = process.env.BIZNESINFO_COMPANY_MEDIA_CACHE_DIR?.trim() || DEFAULT_CACHE_DIR;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_BYTES = 15 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 7_000;

const inflight = new Map<string, Promise<{ body: Uint8Array; contentType: string }>>();
const failedUntil = new Map<string, number>();
const companyMediaAllowCache = new Map<string, { expiresAt: number; allowed: Set<string> }>();
const COMPANY_ALLOW_CACHE_TTL_MS = 10 * 60 * 1000;

function asArrayBuffer(body: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(body.byteLength);
  new Uint8Array(buf).set(body);
  return buf;
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath || "").toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

function normalizeRemoteImageUrl(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }

  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.username = "";
  u.password = "";
  u.hash = "";
  return u.toString();
}

function cacheKeyFromUrl(normalizedUrl: string): string {
  return crypto.createHash("sha256").update(normalizedUrl).digest("hex");
}

function cachePaths(key: string, normalizedUrl: string): { filePath: string; metaPath: string } {
  let ext = "";
  try {
    ext = path.extname(new URL(normalizedUrl).pathname || "").toLowerCase();
  } catch {
    ext = "";
  }
  const safeExt = ext && ext.length <= 8 && /^[.a-z0-9]+$/.test(ext) ? ext : "";
  return {
    filePath: path.join(CACHE_DIR, `${key}${safeExt}`),
    metaPath: path.join(CACHE_DIR, `${key}.json`),
  };
}

async function readCached(
  filePath: string,
  metaPath: string,
  now: number,
): Promise<{ body: Uint8Array; contentType: string; isFresh: boolean } | null> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }

  if (!stat.isFile() || stat.size <= 0) {
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore
    }
    try {
      await fs.unlink(metaPath);
    } catch {
      // ignore
    }
    return null;
  }

  const isFresh = now - stat.mtimeMs < CACHE_TTL_MS;
  let contentType = guessContentType(filePath);
  try {
    const meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as { contentType?: string };
    if (typeof meta.contentType === "string" && meta.contentType.trim()) {
      contentType = meta.contentType.trim();
    }
  } catch {
    // ignore
  }

  try {
    const body = await fs.readFile(filePath);
    if (body.byteLength <= 0) return null;
    return { body, contentType, isFresh };
  } catch {
    return null;
  }
}

async function fetchAndCache(
  normalizedUrl: string,
  filePath: string,
  metaPath: string,
): Promise<{ body: Uint8Array; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(normalizedUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "biznesinfo.by/company-media-proxy",
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`upstream_status:${res.status}`);
  }

  const contentType = (res.headers.get("content-type") || "").trim() || "application/octet-stream";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error("upstream_not_image");
  }

  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength <= 0) throw new Error("upstream_empty");
  if (body.byteLength > MAX_BYTES) throw new Error("upstream_too_large");

  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(filePath, body);
    await fs.writeFile(metaPath, JSON.stringify({ contentType, url: normalizedUrl, fetchedAt: new Date().toISOString() }), "utf8");
  } catch {
    // ignore cache write errors
  }

  return { body, contentType };
}

async function getAllowedCompanyMediaUrls(companyId: string): Promise<Set<string>> {
  const cached = companyMediaAllowCache.get(companyId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.allowed;
  }

  const data = await biznesinfoGetCompany(companyId);
  const allowed = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const normalized = normalizeRemoteImageUrl(raw || "");
    if (normalized) allowed.add(normalized);
  };

  add(data.company.logo_url);
  add(data.company.hero_image);
  for (const photo of data.company.photos || []) add(photo?.url);
  for (const item of data.company.services_list || []) add(item?.image_url);
  for (const item of data.company.products || []) add(item?.image_url);

  companyMediaAllowCache.set(companyId, {
    allowed,
    expiresAt: now + COMPANY_ALLOW_CACHE_TTL_MS,
  });

  return allowed;
}

export async function GET(request: NextRequest) {
  const companyId = String(request.nextUrl.searchParams.get("id") || "").trim();
  const normalizedUrl = normalizeRemoteImageUrl(request.nextUrl.searchParams.get("url") || request.nextUrl.searchParams.get("u") || "");

  if (!companyId || !normalizedUrl) {
    return new Response("bad_request", { status: 400 });
  }

  let allowed: Set<string>;
  try {
    allowed = await getAllowedCompanyMediaUrls(companyId);
  } catch {
    return new Response("company_not_found", { status: 404 });
  }

  if (!allowed.has(normalizedUrl)) {
    return new Response("forbidden_media", { status: 403 });
  }

  const key = cacheKeyFromUrl(normalizedUrl);
  const { filePath, metaPath } = cachePaths(key, normalizedUrl);
  const now = Date.now();
  const cached = await readCached(filePath, metaPath, now);
  if (cached?.isFresh) {
    return new Response(asArrayBuffer(cached.body), {
      headers: {
        "content-type": cached.contentType,
        "cache-control": "public, max-age=31536000, immutable",
        etag: key,
      },
    });
  }

  const failureUntil = failedUntil.get(key) || 0;
  if (!cached && failureUntil > now) {
    return new Response("upstream_temporarily_unavailable", { status: 502 });
  }

  let promise = inflight.get(key);
  if (!promise) {
    promise = fetchAndCache(normalizedUrl, filePath, metaPath)
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
  }

  try {
    const fresh = await promise;
    failedUntil.delete(key);
    return new Response(asArrayBuffer(fresh.body), {
      headers: {
        "content-type": fresh.contentType,
        "cache-control": "public, max-age=31536000, immutable",
        etag: key,
      },
    });
  } catch {
    if (!cached) {
      failedUntil.set(key, now + FAILURE_CACHE_TTL_MS);
      return new Response("upstream_unavailable", { status: 502 });
    }
    return new Response(asArrayBuffer(cached.body), {
      headers: {
        "content-type": cached.contentType,
        "cache-control": "public, max-age=3600",
        etag: key,
      },
    });
  }
}
