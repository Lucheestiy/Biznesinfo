import { NextResponse } from "next/server";
import { ibizGetRubricCompanies } from "@/lib/ibiz/store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = (searchParams.get("slug") || "").trim();
  if (!slug) {
    return NextResponse.json({ error: "missing_slug" }, { status: 400 });
  }

  const region = searchParams.get("region");
  const query = searchParams.get("q");
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const limit = parseInt(searchParams.get("limit") || "24", 10);

  try {
    const data = await ibizGetRubricCompanies({
      slug,
      region,
      query,
      offset: Number.isFinite(offset) ? offset : 0,
      limit: Number.isFinite(limit) ? limit : 24,
    });
    return NextResponse.json(data);
  } catch (e) {
    const msg = String((e as Error)?.message || "");
    if (msg.startsWith("rubric_not_found:")) {
      return NextResponse.json({ error: "rubric_not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

