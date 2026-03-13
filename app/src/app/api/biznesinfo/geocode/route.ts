import { NextResponse } from "next/server";

export const runtime = "nodejs";

const GEOCODER_TIMEOUT_MS = 5000;
const GEOCODER_RESULTS_LIMIT = "20";
type GeocoderKind = "house" | "street" | null;

interface GeocodeCandidate {
  lat: number;
  lng: number;
  address: string;
  kind: string;
  precision: string;
}

function parseCoordinate(value: string | null): number | null {
  const parsed = Number(value || "");
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normalizeQuery(raw: string): string {
  const query = (raw || "").trim();
  if (!query) return "";
  const lower = query.toLowerCase();
  if (lower.includes("беларус")) return query;
  if (lower.includes("belarus")) return query;
  return `Беларусь, ${query}`;
}

function parseCoordinates(rawPos: string): { lat: number; lng: number } | null {
  const normalized = String(rawPos || "").trim();
  if (!normalized) return null;
  const parts = normalized.split(/\s+/u);
  if (parts.length < 2) return null;
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function extractCandidates(payload: any): GeocodeCandidate[] {
  const featureMembers = payload?.response?.GeoObjectCollection?.featureMember;
  if (!Array.isArray(featureMembers)) return [];

  const out: GeocodeCandidate[] = [];
  for (const member of featureMembers) {
    const geoObject = member?.GeoObject;
    const metadata = geoObject?.metaDataProperty?.GeocoderMetaData;
    const coords = parseCoordinates(geoObject?.Point?.pos);
    if (!coords) continue;
    const address = String(metadata?.Address?.formatted || metadata?.text || "").trim();
    out.push({
      lat: coords.lat,
      lng: coords.lng,
      address,
      kind: String(metadata?.kind || "").trim(),
      precision: String(metadata?.precision || "").trim(),
    });
  }
  return out;
}

function buildEndpoint(apiKey: string, query: string, kind: GeocoderKind): URL {
  const endpoint = new URL("https://geocode-maps.yandex.ru/1.x/");
  endpoint.searchParams.set("apikey", apiKey);
  endpoint.searchParams.set("geocode", query);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("lang", "ru_RU");
  endpoint.searchParams.set("results", GEOCODER_RESULTS_LIMIT);
  if (kind) endpoint.searchParams.set("kind", kind);
  return endpoint;
}

async function requestCandidates(apiKey: string, query: string, kind: GeocoderKind): Promise<GeocodeCandidate[]> {
  const endpoint = buildEndpoint(apiKey, query, kind);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODER_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint.toString(), {
      signal: controller.signal,
      headers: {
        "user-agent": "biznesinfo.lucheestiy.com/geocode",
      },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`geocoder_status:${response.status}`);
    }
    const payload = await response.json();
    return extractCandidates(payload);
  } finally {
    clearTimeout(timer);
  }
}

function candidateMatchesKind(candidate: GeocodeCandidate, kind: GeocoderKind): boolean {
  if (!kind) return true;
  return candidate.kind === kind;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceMeters(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const earthRadiusMeters = 6_371_000;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function pickBestCandidate(
  candidates: GeocodeCandidate[],
  kind: GeocoderKind,
  nearbyHint: { lat: number; lng: number } | null,
): GeocodeCandidate | null {
  if (!candidates.length) return null;
  const kindFiltered = candidates.filter((candidate) => candidateMatchesKind(candidate, kind));
  const base = kindFiltered.length > 0 ? kindFiltered : candidates;
  if (!nearbyHint) return base[0];

  return base
    .slice()
    .sort((a, b) => {
      const distA = distanceMeters(nearbyHint.lat, nearbyHint.lng, a.lat, a.lng);
      const distB = distanceMeters(nearbyHint.lat, nearbyHint.lng, b.lat, b.lng);
      if (distA !== distB) return distA - distB;
      return (a.address || "").localeCompare(b.address || "", "ru");
    })[0];
}

async function resolveCoordinates(
  apiKey: string,
  query: string,
  nearbyHint: { lat: number; lng: number } | null,
): Promise<GeocodeCandidate | null> {
  const houseFirst = /\d/u.test(query);
  const attempts: GeocoderKind[] = houseFirst ? ["house", "street", null] : ["street", "house", null];

  for (const kind of attempts) {
    try {
      const candidates = await requestCandidates(apiKey, query, kind);
      if (!candidates.length) continue;
      const best = pickBestCandidate(candidates, kind, nearbyHint);
      if (best) return best;
    } catch {
      // Try next precision level.
    }
  }

  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get("q") || searchParams.get("query") || "";
  const query = normalizeQuery(rawQuery);
  const nearbyLat = parseCoordinate(searchParams.get("lat"));
  const nearbyLng = parseCoordinate(searchParams.get("lng"));
  const nearbyHint =
    nearbyLat != null && nearbyLng != null
      ? { lat: nearbyLat, lng: nearbyLng }
      : null;

  if (!query || query.length < 2) {
    return NextResponse.json({ error: "invalid_query", coords: null, address: null }, { status: 400 });
  }

  const apiKey = (
    process.env.YANDEX_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY ||
    ""
  ).trim();

  if (!apiKey) {
    return NextResponse.json(
      { error: "missing_api_key", coords: null, address: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const candidate = await resolveCoordinates(apiKey, query, nearbyHint);
    if (!candidate) {
      return NextResponse.json(
        { error: "not_found", coords: null, address: null },
        { status: 404, headers: { "Cache-Control": "public, max-age=120" } },
      );
    }

    return NextResponse.json(
      {
        coords: { lat: candidate.lat, lng: candidate.lng },
        address: candidate.address || null,
        kind: candidate.kind || null,
        precision: candidate.precision || null,
      },
      { headers: { "Cache-Control": "public, max-age=120" } },
    );
  } catch {
    return NextResponse.json(
      { error: "lookup_failed", coords: null, address: null },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
