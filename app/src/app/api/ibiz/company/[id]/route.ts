import { NextRequest, NextResponse } from "next/server";
import { ibizGetCompany } from "@/lib/ibiz/store";

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const companyId = (id || "").trim();
  if (!companyId) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }

  try {
    const data = await ibizGetCompany(companyId);
    return NextResponse.json(data);
  } catch (e) {
    const msg = String((e as Error)?.message || "");
    if (msg.startsWith("company_not_found:")) {
      return NextResponse.json({ error: "company_not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
