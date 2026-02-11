import { NextResponse } from "next/server";

export const runtime = "nodejs";

const GEOCODER_TIMEOUT_MS = 5000;
const GEOCODER_RESULTS_LIMIT = "5";

type GeocoderKind = "house" | "street" | null;

function parseCoordinate(value: string | null): number | null {
  const parsed = Number(value || "");
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function extractAddress(payload: any, preferHousePrecision: boolean): string {
  const featureMembers = payload?.response?.GeoObjectCollection?.featureMember;
  if (!Array.isArray(featureMembers)) return "";

  const candidates = featureMembers
    .map((member) => {
      const metadata = member?.GeoObject?.metaDataProperty?.GeocoderMetaData;
      const fromAddress = metadata?.Address?.formatted;
      const fromText = metadata?.text;

      return {
        address: String(fromAddress || fromText || "").trim(),
        kind: String(metadata?.kind || "").trim(),
        precision: String(metadata?.precision || "").trim(),
      };
    })
    .filter((candidate) => candidate.address.length > 0);

  if (!candidates.length) return "";

  if (preferHousePrecision) {
    const preciseCandidate = candidates.find(
      (candidate) =>
        candidate.kind === "house" ||
        candidate.precision === "exact" ||
        candidate.precision === "number",
    );

    if (preciseCandidate) {
      return preciseCandidate.address;
    }
  }

  return candidates[0]?.address || "";
}

function buildEndpoint(apiKey: string, lat: number, lng: number, kind: GeocoderKind): URL {
  const endpoint = new URL("https://geocode-maps.yandex.ru/1.x/");
  endpoint.searchParams.set("apikey", apiKey);
  endpoint.searchParams.set("geocode", `${lng},${lat}`);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("lang", "ru_RU");
  endpoint.searchParams.set("sco", "longlat");
  endpoint.searchParams.set("results", GEOCODER_RESULTS_LIMIT);
  if (kind) {
    endpoint.searchParams.set("kind", kind);
  }
  return endpoint;
}

async function requestAddress(
  apiKey: string,
  lat: number,
  lng: number,
  kind: GeocoderKind,
): Promise<string> {
  const endpoint = buildEndpoint(apiKey, lat, lng, kind);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODER_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint.toString(), {
      signal: controller.signal,
      headers: {
        "user-agent": "biznesinfo.lucheestiy.com/reverse-geocode",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`geocoder_status:${response.status}`);
    }

    const payload = await response.json();
    return extractAddress(payload, kind === "house");
  } finally {
    clearTimeout(timer);
  }
}

async function resolveAddress(apiKey: string, lat: number, lng: number): Promise<string | null> {
  const attempts: GeocoderKind[] = ["house", "street", null];

  for (const kind of attempts) {
    try {
      const address = await requestAddress(apiKey, lat, lng, kind);
      if (address) {
        return address;
      }
    } catch {
      // Try next precision level.
    }
  }

  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = parseCoordinate(searchParams.get("lat"));
  const lng = parseCoordinate(searchParams.get("lng"));

  if (lat == null || lng == null) {
    return NextResponse.json({ error: "invalid_coordinates", address: null }, { status: 400 });
  }

  const apiKey = (
    process.env.YANDEX_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY ||
    ""
  ).trim();

  if (!apiKey) {
    return NextResponse.json(
      { error: "missing_api_key", address: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const address = await resolveAddress(apiKey, lat, lng);

    return NextResponse.json(
      { address: address || null },
      { headers: { "Cache-Control": "public, max-age=120" } },
    );
  } catch {
    return NextResponse.json(
      { error: "lookup_failed", address: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
