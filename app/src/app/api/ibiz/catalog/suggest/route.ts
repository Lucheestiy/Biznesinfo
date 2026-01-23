import { NextResponse } from "next/server";
import { ibizGetCatalog } from "@/lib/ibiz/store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";
  const region = searchParams.get("region") || null;
  
  const q = query.trim().toLowerCase();
  if (q.length < 2) {
    return NextResponse.json({ query, suggestions: [] });
  }

  const catalog = await ibizGetCatalog(region);
  const categories = catalog.categories || [];
  
  const suggestions = [];
  
  // Search categories
  for (const cat of categories) {
    if (safeLower(cat.name || "").includes(q)) {
      suggestions.push({
        type: "category",
        slug: cat.slug,
        name: cat.name || cat.slug,
        url: `/catalog/${cat.slug}`,
        icon: null,
        count: cat.company_count,
      });
    }
  }
  
  // Search rubrics within matching categories
  const catalogRubrics = catalog.rubrics || [];
  for (const rubric of catalogRubrics) {
    if (safeLower(rubric.name || "").includes(q)) {
      // Only include if parent category matched or we want all rubrics
      suggestions.push({
        type: "rubric",
        slug: rubric.slug,
        name: rubric.name || rubric.slug,
        url: `/catalog/${rubric.category_slug}/${rubric.slug.split("/").slice(1).join("/")}`,
        icon: null,
        category_name: rubric.category_name,
        count: rubric.company_count,
      });
    }
  }

  return NextResponse.json({
    query,
    suggestions: suggestions.slice(0, 8),
  });
}

// Helper function (same as in store.ts)
function safeLower(s: string): string {
  return (s || "").toLowerCase();
}
