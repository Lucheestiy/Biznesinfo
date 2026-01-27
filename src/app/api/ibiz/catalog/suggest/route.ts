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
  
  // Search categories and their nested rubrics
  for (const cat of categories) {
    // Check if category name matches
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
    
    // Check nested rubrics within this category
    const rubrics = cat.rubrics || [];
    for (const rubric of rubrics) {
      if (safeLower(rubric.name || "").includes(q)) {
        suggestions.push({
          type: "rubric",
          slug: rubric.slug,
          name: rubric.name || rubric.slug,
          url: `/catalog/${cat.slug}/${rubric.slug.split("/").slice(1).join("/")}`,
          icon: null,
          category_name: cat.name,
          count: rubric.count,
        });
      }
    }
  }

  return NextResponse.json({
    query,
    suggestions: suggestions.slice(0, 8),
  });
}

function safeLower(s: string): string {
  return (s || "").toLowerCase();
}
