import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";
import { normalizeMultiline, normalizeOneLine, sendLeadRequestEmail } from "@/lib/leadRequests/email";

export const runtime = "nodejs";

type AdRequestBody = {
  companyName?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  message?: string;
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
  const rl = rateLimit({ key: `lead:ad-request:${ip}`, limit: 15, windowMs: 60 * 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RateLimited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let body: AdRequestBody;
  try {
    body = (await request.json()) as AdRequestBody;
  } catch {
    return badRequest("Invalid JSON");
  }

  const companyName = normalizeOneLine(body.companyName);
  const contactPerson = normalizeOneLine(body.contactPerson);
  const phone = normalizeOneLine(body.phone);
  const email = normalizeOneLine(body.email).toLowerCase();
  const message = normalizeMultiline(body.message);

  if (!companyName || !contactPerson || !phone || !email) {
    return badRequest("Missing required fields");
  }
  if (!email.includes("@")) {
    return badRequest("Invalid email");
  }

  try {
    const submittedAt = new Date().toISOString();
    await sendLeadRequestEmail({
      subject: "Новая заявка на рекламу — Biznesinfo.by",
      replyTo: email,
      lines: [
        "Новая заявка из формы /ad-request",
        "",
        `Время: ${submittedAt}`,
        `IP: ${label(ip)}`,
        "",
        `Название компании: ${label(companyName)}`,
        `Контактное лицо: ${label(contactPerson)}`,
        `Телефон: ${label(phone)}`,
        `Email: ${label(email)}`,
        "",
        "Сообщение:",
        message || "—",
      ],
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "InternalError" }, { status: 500 });
  }
}
