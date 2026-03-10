import { AIAssistantRequest } from "@/app/api/ai-assistant/route";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

export interface TelegramNotification {
  type: "new_request" | "company_response" | "daily_summary";
  requestId: string;
  sender: string;
  contact: string;
  phone: string;
  message: string;
  matchedCompanies: number;
  intent?: string[];
}

/**
 * Отправляет уведомление администратору в Telegram
 */
export async function sendTelegramNotification(
  notification: TelegramNotification
): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) {
    console.warn("Telegram not configured");
    return false;
  }

  try {
    const message = formatNotificationMessage(notification);
    
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_ADMIN_CHAT_ID,
          text: message,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "📋 Подробности",
                  callback_data: `request:${notification.requestId}`,
                },
                {
                  text: "✅ Обработано",
                  callback_data: `done:${notification.requestId}`,
                },
              ],
            ],
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error("Failed to send Telegram notification:", error);
    return false;
  }
}

/**
 * Отправляет уведомление компании (если у неё есть Telegram)
 */
export async function sendTelegramToCompany(
  companyTelegramId: string,
  requestData: AIAssistantRequest,
  requestId: string
): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) return false;

  try {
    const message = formatCompanyNotification(requestData);
    
    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: companyTelegramId,
          text: message,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "✅ Ответить на заявку",
                  url: `https://biznesinfo.lucheestiy.com/cabinet/requests/${requestId}`,
                },
              ],
            ],
          },
        }),
      }
    );

    return true;
  } catch (error) {
    console.error("Failed to send Telegram to company:", error);
    return false;
  }
}

/**
 * Отправляет подтверждение пользователю (если есть его Telegram)
 */
export async function sendConfirmationToUser(
  userTelegramId: string,
  requestId: string,
  matchedCompanies: number
): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) return false;

  try {
    const message = `
✅ <b>Ваша заявка принята!</b>

🔍 Номер заявки: <code>${requestId}</code>
📬 Отправлено компаний: ${matchedCompanies}
⏰ Ожидайте ответа в течение 15-30 минут

Вы получите уведомление, когда компании ответят.
    `.trim();

    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: userTelegramId,
          text: message,
          parse_mode: "HTML",
        }),
      }
    );

    return true;
  } catch (error) {
    console.error("Failed to send confirmation:", error);
    return false;
  }
}

// ===== Форматирование сообщений =====

function formatNotificationMessage(notification: TelegramNotification): string {
  const { type, requestId, sender, contact, phone, message, matchedCompanies, intent } = notification;
  
  if (type === "new_request") {
    return `
🤖 <b>Новая AI-заявка!</b>

🏢 <b>От:</b> ${escapeHtml(sender)}
👤 <b>Контакт:</b> ${escapeHtml(contact)}
📞 <b>Телефон:</b> <code>${phone}</code>

💬 <b>Сообщение:</b>
<i>${escapeHtml(message)}</i>

${intent ? `🔑 <b>Ключевые слова:</b> ${intent.join(", ")}` : ""}
📊 <b>Найдено компаний:</b> ${matchedCompanies}

⏰ ${new Date().toLocaleString("ru-RU")}
    `.trim();
  }
  
  return "Уведомление";
}

function formatCompanyNotification(requestData: AIAssistantRequest): string {
  return `
📨 <b>Новый запрос от клиента!</b>

🏢 <b>Компания клиента:</b> ${escapeHtml(requestData.senderCompanyName)}
👤 <b>Контактное лицо:</b> ${escapeHtml(requestData.contactPerson)}
📞 <b>Телефон:</b> <code>${requestData.phone}</code>
💼 <b>Должность:</b> ${escapeHtml(requestData.position)}

💬 <b>Запрос:</b>
<i>${escapeHtml(requestData.message)}</i>

✅ Нажмите кнопку ниже, чтобы ответить клиенту.
  `.trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
