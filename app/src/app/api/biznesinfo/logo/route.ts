import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { NextRequest } from "next/server";

export const runtime = "nodejs";

type CachedMeta = {
  contentType: string;
  url: string;
  fetchedAt: string;
};

const DEFAULT_CACHE_DIR = path.join(
  os.tmpdir(),
  `biznesinfo-logo-cache-${typeof process.getuid === "function" ? process.getuid() : "app"}`,
);
const CACHE_DIR = process.env.BIZNESINFO_LOGO_CACHE_DIR?.trim() || DEFAULT_CACHE_DIR;
const DEFAULT_UPSTREAM_SUFFIX = "i" + "biz.by";
const UPSTREAM_SUFFIX = process.env.BIZNESINFO_LOGO_UPSTREAM_SUFFIX?.trim() || DEFAULT_UPSTREAM_SUFFIX;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 4_000;

const inflight = new Map<string, Promise<{ body: Uint8Array; contentType: string }>>();
const failedUntil = new Map<string, number>();

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
    default:
      return "application/octet-stream";
  }
}

function isAllowedHost(hostname: string): boolean {
  if (!UPSTREAM_SUFFIX) return false;
  const h = (hostname || "").toLowerCase();
  const suffix = UPSTREAM_SUFFIX.toLowerCase();
  return h === suffix || h.endsWith(`.${suffix}`);
}

function normalizeTargetUrl(raw: string): URL | null {
  const s = (raw || "").trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!isAllowedHost(u.hostname)) return null;
  if (!u.pathname.startsWith("/images/")) return null;
  u.username = "";
  u.password = "";
  return u;
}

function cacheKeyFromHostPath(hostname: string, pathname: string): string {
  const host = (hostname || "").trim().toLowerCase();
  const pathPart = (pathname || "").trim();
  return crypto.createHash("sha256").update(`${host}${pathPart}`).digest("hex");
}

function cachePaths(key: string, pathname: string): { filePath: string; metaPath: string } {
  const ext = path.extname(pathname || "").toLowerCase();
  const safeExt = ext && ext.length <= 8 && /^[.a-z0-9]+$/.test(ext) ? ext : "";
  const filePath = path.join(CACHE_DIR, `${key}${safeExt}`);
  const metaPath = path.join(CACHE_DIR, `${key}.json`);
  return { filePath, metaPath };
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
    // Corrupted cache entry (e.g., 0-byte file). Ignore and allow refetch.
    // Best-effort cleanup to avoid serving empty responses forever.
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
    const meta = JSON.parse(await fs.readFile(metaPath, "utf-8")) as Partial<CachedMeta>;
    if (meta?.contentType && typeof meta.contentType === "string") contentType = meta.contentType;
  } catch {
    // ignore
  }

  try {
    const body = await fs.readFile(filePath);
    if (body.byteLength <= 0) {
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
    return { body, contentType, isFresh };
  } catch {
    return null;
  }
}

async function fetchAndCache(normalizedUrl: string, filePath: string, metaPath: string): Promise<{ body: Uint8Array; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(normalizedUrl, {
      signal: controller.signal,
      redirect: "manual",
      headers: {
        "user-agent": "biznesinfo.lucheestiy.com/logo-proxy",
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (res.status >= 300 && res.status < 400) {
    throw new Error(`upstream_redirect:${res.status}`);
  }

  if (!res.ok) {
    throw new Error(`upstream_status:${res.status}`);
  }

  const contentType = (res.headers.get("content-type") || "").trim() || "application/octet-stream";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error("upstream_not_image");
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength <= 0) {
    throw new Error("upstream_empty");
  }
  if (buf.byteLength > MAX_BYTES) {
    throw new Error("upstream_too_large");
  }

  // Cache is best-effort only. If filesystem permissions are restricted,
  // still return the fetched logo bytes instead of failing to a redirect.
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(filePath, buf);
    const meta: CachedMeta = { contentType, url: normalizedUrl, fetchedAt: new Date().toISOString() };
    await fs.writeFile(metaPath, JSON.stringify(meta), "utf-8");
  } catch {
    // ignore cache write errors
  }

  return { body: buf, contentType };
}

export async function GET(request: NextRequest) {
  const id = (request.nextUrl.searchParams.get("id") || "").trim();
  const logoPath = (request.nextUrl.searchParams.get("path") || request.nextUrl.searchParams.get("p") || "").trim();

  const isValidCompanyId = (value: string): boolean => {
    const v = (value || "").trim().toLowerCase();
    if (!v || v.length > 63) return false;
    return /^[a-z0-9-]+$/u.test(v);
  };

  const isValidLogoPath = (value: string): boolean => {
    const v = (value || "").trim();
    if (!v.startsWith("/images/")) return false;
    if (v.includes("..")) return false;
    if (v.includes("\\")) return false;
    return true;
  };

  const target = (() => {
    if (id && logoPath) {
      if (!UPSTREAM_SUFFIX) return null;
      if (!isValidCompanyId(id) || !isValidLogoPath(logoPath)) return null;
      return new URL(`https://${id.toLowerCase()}.${UPSTREAM_SUFFIX}${logoPath}`);
    }

    // Legacy mode: full URL provided by caller.
    const rawUrl = request.nextUrl.searchParams.get("url") || request.nextUrl.searchParams.get("u") || "";
    return normalizeTargetUrl(rawUrl);
  })();

  if (!target) return new Response("bad_url", { status: 400 });

  const httpsUrl = (() => {
    try {
      const u = new URL(target.toString());
      u.protocol = "https:";
      return u.toString();
    } catch {
      return "";
    }
  })();

  const httpUrl = (() => {
    try {
      const u = new URL(target.toString());
      u.protocol = "http:";
      return u.toString();
    } catch {
      return "";
    }
  })();

  const candidates = (id && logoPath ? [httpsUrl] : [httpsUrl, httpUrl]).filter(Boolean);

  const key = cacheKeyFromHostPath(target.hostname, target.pathname);
  const { filePath, metaPath } = cachePaths(key, target.pathname);

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
    return new Response(null, {
      status: 302,
      headers: {
        location: httpsUrl || httpUrl,
        "cache-control": "public, max-age=3600",
      },
    });
  }

  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      let lastError: unknown = null;
      for (const url of candidates) {
        try {
          return await fetchAndCache(url, filePath, metaPath);
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }

  try {
    const fresh = await p;
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
    }
    if (cached) {
      return new Response(asArrayBuffer(cached.body), {
        headers: {
          "content-type": cached.contentType,
          "cache-control": "public, max-age=3600",
          etag: key,
        },
      });
    }
    // Fallback: if upstream fetch fails (DNS / outbound network / upstream downtime),
    // redirect the client to the upstream image URL. This restores logos in the UI even
    // when the server cannot fetch/cached them.
    return new Response(null, {
      status: 302,
      headers: {
        location: httpsUrl || httpUrl,
        "cache-control": "public, max-age=3600",
      },
    });
  }
}
