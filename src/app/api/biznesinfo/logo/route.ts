import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { NextRequest } from "next/server";

type CachedMeta = {
  contentType: string;
  url: string;
  fetchedAt: string;
};

const CACHE_DIR = process.env.BIZNESINFO_LOGO_CACHE_DIR?.trim() || path.join(os.tmpdir(), "biznesinfo-logo-cache");
const UPSTREAM_SUFFIX = process.env.BIZNESINFO_LOGO_UPSTREAM_SUFFIX?.trim() || "";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;

const inflight = new Map<string, Promise<{ body: Uint8Array; contentType: string }>>();

function asArrayBuffer(body: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(body.byteLength);
  new Uint8Array(buf).set(body);
  return buf;
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
  u.protocol = "https:";
  return u;
}

function cacheKey(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex");
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

  const isFresh = now - stat.mtimeMs < CACHE_TTL_MS;
  let contentType = "application/octet-stream";
  try {
    const meta = JSON.parse(await fs.readFile(metaPath, "utf-8")) as Partial<CachedMeta>;
    if (meta?.contentType && typeof meta.contentType === "string") contentType = meta.contentType;
  } catch {
    // ignore
  }

  try {
    const body = await fs.readFile(filePath);
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
      redirect: "follow",
      headers: {
        "user-agent": "biznesinfo.lucheestiy.com/logo-proxy",
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

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength <= 0) {
    throw new Error("upstream_empty");
  }
  if (buf.byteLength > MAX_BYTES) {
    throw new Error("upstream_too_large");
  }

  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(filePath, buf);
  const meta: CachedMeta = { contentType, url: normalizedUrl, fetchedAt: new Date().toISOString() };
  await fs.writeFile(metaPath, JSON.stringify(meta), "utf-8");

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

    const rawUrl = request.nextUrl.searchParams.get("url") || request.nextUrl.searchParams.get("u") || "";
    return normalizeTargetUrl(rawUrl);
  })();

  if (!target) return new Response("bad_url", { status: 400 });

  const normalizedUrl = target.toString();
  const key = cacheKey(normalizedUrl);
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

  let p = inflight.get(key);
  if (!p) {
    p = fetchAndCache(normalizedUrl, filePath, metaPath).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }

  try {
    const fresh = await p;
    return new Response(asArrayBuffer(fresh.body), {
      headers: {
        "content-type": fresh.contentType,
        "cache-control": "public, max-age=31536000, immutable",
        etag: key,
      },
    });
  } catch {
    if (cached) {
      return new Response(asArrayBuffer(cached.body), {
        headers: {
          "content-type": cached.contentType,
          "cache-control": "public, max-age=3600",
          etag: key,
        },
      });
    }
    return new Response("upstream_error", { status: 502 });
  }
}
