import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";
import { normalizeMultiline, normalizeOneLine, sendLeadRequestEmail } from "@/lib/leadRequests/email";

export const runtime = "nodejs";

type AddCompanyRequestBody = {
  companyName?: string;
  category?: string;
  subcategory?: string;
  region?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  description?: string;
  contactPerson?: string;
  contactPhone?: string;
};

function badRequest(message: string) {
  return NextResponse.json({ error: "BadRequest", message }, { status: 400 });
}

function label(value: string): string {
  return value || "—";
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "CSRF" }, { status: 403 });
  }

  const ip = getClientIp(request);
  const rl = rateLimit({ key: `lead:add-company:${ip}`, limit: 15, windowMs: 60 * 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RateLimited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let body: AddCompanyRequestBody;
  try {
    body = (await request.json()) as AddCompanyRequestBody;
  } catch {
    return badRequest("Invalid JSON");
  }

  const companyName = normalizeOneLine(body.companyName);
  const category = normalizeOneLine(body.category);
  const subcategory = normalizeOneLine(body.subcategory);
  const region = normalizeOneLine(body.region);
  const address = normalizeOneLine(body.address);
  const phone = normalizeOneLine(body.phone);
  const email = normalizeOneLine(body.email).toLowerCase();
  const website = normalizeOneLine(body.website);
  const description = normalizeMultiline(body.description);
  const contactPerson = normalizeOneLine(body.contactPerson);
  const contactPhone = normalizeOneLine(body.contactPhone);

  if (!companyName || !category || !subcategory || !region || !address || !phone || !email || !contactPerson || !contactPhone) {
    return badRequest("Missing required fields");
  }
  if (!email.includes("@")) {
    return badRequest("Invalid email");
  }

  try {
    const submittedAt = new Date().toISOString();
    await sendLeadRequestEmail({
      subject: "Новая заявка на добавление компании — Biznesinfo.by",
      replyTo: email,
      lines: [
        "Новая заявка из формы /add-company",
        "",
        `Время: ${submittedAt}`,
        `IP: ${label(ip)}`,
        "",
        `Название компании: ${label(companyName)}`,
        `Категория: ${label(category)}`,
        `Подкатегория: ${label(subcategory)}`,
        `Регион: ${label(region)}`,
        `Адрес: ${label(address)}`,
        "",
        `Телефон компании: ${label(phone)}`,
        `Email компании: ${label(email)}`,
        `Веб-сайт: ${label(website)}`,
        "",
        `Контактное лицо: ${label(contactPerson)}`,
        `Телефон для связи: ${label(contactPhone)}`,
        "",
        "Описание:",
        description || "—",
      ],
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "InternalError" }, { status: 500 });
  }
}
