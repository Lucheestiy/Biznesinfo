import { NextRequest, NextResponse } from "next/server";
import { biznesinfoGetCompany } from "@/lib/biznesinfo/store";
import { isExcludedBiznesinfoCompanyId } from "@/lib/biznesinfo/exclusions";
import { isLiquidatedByKartoteka } from "@/lib/biznesinfo/kartoteka";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json(data);
  } catch (e) {
    const msg = String((e as Error)?.message || "");
    if (msg.startsWith("company_not_found:")) {
      return NextResponse.json({ error: "company_not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
