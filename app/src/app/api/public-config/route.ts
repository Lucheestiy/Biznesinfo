import { NextResponse } from "next/server";

export async function GET() {
  const yandexMapsApiKey = (
    process.env.YANDEX_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY ||
    ""
  ).trim();

  return NextResponse.json(
    { yandexMapsApiKey: yandexMapsApiKey || null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

