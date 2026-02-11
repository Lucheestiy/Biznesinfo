import { NextResponse } from "next/server";
import { biznesinfoGetRubricCompanies } from "@/lib/biznesinfo/store";
import { filterOutLiquidatedByKartoteka } from "@/lib/biznesinfo/kartoteka";

export const runtime = "nodejs";

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
    const data = await biznesinfoGetRubricCompanies({
      slug,
      region,
      query,
      offset: Number.isFinite(offset) ? offset : 0,
      limit: Number.isFinite(limit) ? limit : 24,
    });
    const filtered = await filterOutLiquidatedByKartoteka(data.companies || []);
    return NextResponse.json({
      ...data,
      companies: filtered.items,
      page: {
        ...data.page,
        total: Math.max(0, data.page.total - filtered.removed),
      },
    });
  } catch (e) {
    const msg = String((e as Error)?.message || "");
    if (msg.startsWith("rubric_not_found:")) {
      return NextResponse.json({ error: "rubric_not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
