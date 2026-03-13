const DEFAULT_LEAD_REQUEST_TO = "surdoe@yandex.ru";

export function normalizeOneLine(value: unknown, maxLength = 500): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function normalizeMultiline(value: unknown, maxLength = 5000): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

export function getLeadRequestRecipient(): string {
  return normalizeOneLine(process.env.LEAD_REQUEST_EMAIL_TO || "", 320) || DEFAULT_LEAD_REQUEST_TO;
}

export async function sendLeadRequestEmail(params: {
  subject: string;
  lines: string[];
  replyTo?: string;
}) {
  const smtpUrl = normalizeOneLine(process.env.SMTP_URL || "", 2000);
  if (!smtpUrl) {
    throw new Error("SMTP_NOT_CONFIGURED");
  }

  const from = normalizeOneLine(process.env.EMAIL_FROM || "", 320) || "no-reply@biznesinfo.lucheestiy.com";
  const to = getLeadRequestRecipient();
  const text = params.lines.join("\n");

  const { default: nodemailer } = await import("nodemailer");
  const transporter = nodemailer.createTransport(smtpUrl);
  await transporter.sendMail({
    from,
    to,
    replyTo: params.replyTo || undefined,
    subject: normalizeOneLine(params.subject, 250),
    text,
  });
}
