import { NextRequest, NextResponse } from "next/server";
import { biznesinfoGetCompany } from "@/lib/biznesinfo/store";
import { isExcludedBiznesinfoCompanyId } from "@/lib/biznesinfo/exclusions";
import { isLiquidatedByKartoteka } from "@/lib/biznesinfo/kartoteka";
import { localizeCompanyResponse, normalizeUiLanguage } from "@/lib/biznesinfo/translation";

export const runtime = "nodejs";

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { searchParams } = new URL(request.url);
  const language = normalizeUiLanguage(searchParams.get("lang") || searchParams.get("language"));
  const { id } = await ctx.params;
  const companyId = (id || "").trim();
  if (!companyId) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  if (isExcludedBiznesinfoCompanyId(companyId)) {
    return NextResponse.json({ error: "company_not_found" }, { status: 404 });
  }

  try {
    const data = await biznesinfoGetCompany(companyId);
    if (
      await isLiquidatedByKartoteka({
        source_id: data.company?.source_id || "",
        unp: data.company?.unp || "",
        name: data.company?.name || "",
        city: data.company?.city || "",
        address: data.company?.address || "",
      })
    ) {
      return NextResponse.json({ error: "company_not_found" }, { status: 404 });
    }
    const localized = await localizeCompanyResponse(data, language);
    return NextResponse.json(localized);
  } catch (e) {
    const msg = String((e as Error)?.message || "");
    if (msg.startsWith("company_not_found:")) {
      return NextResponse.json({ error: "company_not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
