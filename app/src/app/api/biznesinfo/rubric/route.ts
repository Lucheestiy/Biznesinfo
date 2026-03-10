import { NextResponse } from "next/server";
import { biznesinfoGetRubricCompanies } from "@/lib/biznesinfo/store";
import {
  filterOutKnownLiquidatedByKartoteka,
  filterOutLiquidatedByKartoteka,
} from "@/lib/biznesinfo/kartoteka";
import type { BiznesinfoRubricResponse } from "@/lib/biznesinfo/types";

export const runtime = "nodejs";

function filterRubricCompaniesByPrimaryProfile(data: BiznesinfoRubricResponse): {
  items: BiznesinfoRubricResponse["companies"];
  removed: number;
} {
  const rubricSlug = String(data?.rubric?.slug || "").trim().toLowerCase();
  const categorySlug = String(data?.rubric?.category_slug || "").trim().toLowerCase();
  const companies = data?.companies || [];
  if (!rubricSlug || !categorySlug || companies.length === 0) {
    return { items: companies, removed: 0 };
  }

  const items: BiznesinfoRubricResponse["companies"] = [];
  let removed = 0;

  for (const company of companies) {
    const primaryRubricSlug = String(company?.primary_rubric_slug || "").trim().toLowerCase();
    const primaryCategorySlug = String(company?.primary_category_slug || "").trim().toLowerCase();
    const hasPrimaryProfile = Boolean(primaryRubricSlug || primaryCategorySlug);

    const keep =
      primaryRubricSlug === rubricSlug ||
      primaryCategorySlug === categorySlug ||
      !hasPrimaryProfile;

    if (keep) items.push(company);
    else removed += 1;
  }

  return { items, removed };
}

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
    const relevanceFiltered = filterRubricCompaniesByPrimaryProfile(data);

    // Keep rubric responses fast: hide already known liquidated companies synchronously,
    // and refresh Kartoteka status for the current page in background.
    const filtered = await filterOutKnownLiquidatedByKartoteka(relevanceFiltered.items || []);
    void filterOutLiquidatedByKartoteka(relevanceFiltered.items || []).catch(() => {
      // non-blocking warm-up for future requests
    });

    return NextResponse.json({
      ...data,
      rubric: {
        ...data.rubric,
        count: Math.max(0, (data.rubric?.count || 0) - relevanceFiltered.removed - filtered.removed),
      },
      companies: filtered.items,
      page: {
        ...data.page,
        total: Math.max(0, data.page.total - relevanceFiltered.removed - filtered.removed),
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
