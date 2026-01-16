import { NextResponse } from "next/server";
import { ibizGetCatalog } from "@/lib/ibiz/store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get("region");
  const data = await ibizGetCatalog(region);
  return NextResponse.json(data);
}

