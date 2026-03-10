import { NextRequest, NextResponse } from "next/server";
import { analyzeRequestIntent, findMatchingCompanies } from "@/lib/ai-assistant/matcher";
import { sendTelegramNotification } from "@/lib/ai-assistant/notifications";
import { saveAIRequest } from "@/lib/ai-assistant/storage";

export interface AIAssistantRequest {
  senderCompanyName: string;
  contactPerson: string;
  position: string;
  phone: string;
  message: string;
  targetCompanyId?: string;  // Если запрос конкретной компании
  targetCompanyName?: string;
  files?: {
    name: string;
    size: number;
    type: string;
    url?: string;
  }[];
}

export interface AIAssistantResponse {
  success: boolean;
  requestId: string;
  matchedCompanies: number;
  notificationsSent: number;
  estimatedResponseTime: string;
  message: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const data: AIAssistantRequest = await request.json();

    // Валидация
    if (!data.senderCompanyName || !data.contactPerson || !data.phone || !data.message) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // 1. Сохраняем заявку
    const requestId = await saveAIRequest(data);

    // 2. Анализируем запрос с помощью AI
    const intent = await analyzeRequestIntent(data.message);

    // 3. Ищем подходящие компании
    const matchedCompanies = await findMatchingCompanies(intent, {
      targetCompanyId: data.targetCompanyId,
      limit: 10,
    });

    // 4. Отправляем уведомления компаниям
    const notificationsSent = await sendNotificationsToCompanies(
      matchedCompanies,
      data,
      requestId
    );

    // 5. Отправляем уведомление админу в Telegram
    await sendTelegramNotification({
      type: "new_request",
      requestId,
      sender: data.senderCompanyName,
      contact: data.contactPerson,
      phone: data.phone,
      message: data.message,
      matchedCompanies: matchedCompanies.length,
      intent: intent.keywords,
    });

    const response: AIAssistantResponse = {
      success: true,
      requestId,
      matchedCompanies: matchedCompanies.length,
      notificationsSent,
      estimatedResponseTime: "15-30 минут",
      message: `Заявка отправлена ${matchedCompanies.length} компаниям. Ожидайте ответа!`,
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error("AI Assistant API Error:", error);
    return NextResponse.json(
      { error: "Failed to process request", details: String(error) },
      { status: 500 }
    );
  }
}

async function sendNotificationsToCompanies(
  companies: any[],
  requestData: AIAssistantRequest,
  requestId: string
): Promise<number> {
  let sent = 0;
  
  for (const company of companies) {
    try {
      // Отправка email (если есть)
      if (company.emails?.length > 0) {
        await sendEmailNotification(company, requestData, requestId);
        sent++;
      }
      
      // Отправка в Telegram (если компания подключена)
      if (company.telegramChatId) {
        await sendTelegramToCompany(company, requestData, requestId);
        sent++;
      }
      
      // Сохраняем в личный кабинет компании
      await saveNotificationToCompanyCabinet(company.id, requestData, requestId);
      
    } catch (error) {
      console.error(`Failed to notify company ${company.id}:`, error);
    }
  }
  
  return sent;
}

async function sendEmailNotification(
  company: any,
  requestData: AIAssistantRequest,
  requestId: string
) {
  // Реализация отправки email
  console.log(`Sending email to ${company.emails[0]} for request ${requestId}`);
}

async function sendTelegramToCompany(
  company: any,
  requestData: AIAssistantRequest,
  requestId: string
) {
  // Реализация отправки в Telegram компании
  console.log(`Sending Telegram to company ${company.id} for request ${requestId}`);
}

async function saveNotificationToCompanyCabinet(
  companyId: string,
  requestData: AIAssistantRequest,
  requestId: string
) {
  // Сохранение в БД для отображения в личном кабинете
  console.log(`Saving to cabinet for company ${companyId}`);
}

// Получение статуса заявки
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestId = searchParams.get("id");
  
  if (!requestId) {
    return NextResponse.json({ error: "Request ID required" }, { status: 400 });
  }
  
  // Получаем статус из БД
  const status = await getRequestStatus(requestId);
  
  return NextResponse.json(status);
}

async function getRequestStatus(requestId: string) {
  // Заглушка — реальная реализация будет читать из БД
  return {
    requestId,
    status: "processing",
    companiesResponded: 0,
    totalCompanies: 5,
    createdAt: new Date().toISOString(),
  };
}
