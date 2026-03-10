import { AIAssistantRequest } from "@/app/api/ai-assistant/route";

// Временное хранилище (заменить на БД в продакшене)
const requestsStore = new Map<string, StoredRequest>();

interface StoredRequest {
  id: string;
  data: AIAssistantRequest;
  status: "pending" | "processing" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  matchedCompanies: string[];
  responses: CompanyResponse[];
}

interface CompanyResponse {
  companyId: string;
  companyName: string;
  status: "sent" | "viewed" | "replied" | "declined";
  repliedAt?: string;
  message?: string;
  price?: string;
}

/**
 * Сохраняет новую AI-заявку
 */
export async function saveAIRequest(
  data: AIAssistantRequest
): Promise<string> {
  const requestId = generateRequestId();
  
  const stored: StoredRequest = {
    id: requestId,
    data,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    matchedCompanies: [],
    responses: [],
  };
  
  requestsStore.set(requestId, stored);
  
  // TODO: Сохранить в реальную БД (PostgreSQL/MongoDB)
  console.log(`Request ${requestId} saved`);
  
  return requestId;
}

/**
 * Обновляет статус заявки
 */
export async function updateRequestStatus(
  requestId: string,
  status: StoredRequest["status"],
  matchedCompanies?: string[]
): Promise<boolean> {
  const request = requestsStore.get(requestId);
  if (!request) return false;
  
  request.status = status;
  request.updatedAt = new Date().toISOString();
  
  if (matchedCompanies) {
    request.matchedCompanies = matchedCompanies;
  }
  
  requestsStore.set(requestId, request);
  return true;
}

/**
 * Добавляет ответ компании
 */
export async function addCompanyResponse(
  requestId: string,
  response: CompanyResponse
): Promise<boolean> {
  const request = requestsStore.get(requestId);
  if (!request) return false;
  
  request.responses.push(response);
  request.updatedAt = new Date().toISOString();
  
  // Если все компании ответили — обновляем статус
  const allReplied = request.responses.length >= request.matchedCompanies.length;
  if (allReplied) {
    request.status = "completed";
  }
  
  requestsStore.set(requestId, request);
  return true;
}

/**
 * Получает заявку по ID
 */
export async function getRequest(
  requestId: string
): Promise<StoredRequest | null> {
  return requestsStore.get(requestId) || null;
}

/**
 * Получает все заявки пользователя (по телефону)
 */
export async function getUserRequests(
  phone: string
): Promise<StoredRequest[]> {
  const requests: StoredRequest[] = [];
  
  for (const request of requestsStore.values()) {
    if (request.data.phone === phone) {
      requests.push(request);
    }
  }
  
  return requests.sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Получает заявки для компании
 */
export async function getCompanyRequests(
  companyId: string
): Promise<StoredRequest[]> {
  const requests: StoredRequest[] = [];
  
  for (const request of requestsStore.values()) {
    if (request.matchedCompanies.includes(companyId)) {
      requests.push(request);
    }
  }
  
  return requests.sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Получает статистику за период
 */
export async function getRequestsStats(
  startDate: Date,
  endDate: Date
): Promise<{
  total: number;
  byStatus: Record<string, number>;
  avgResponseTime: number;
}> {
  let total = 0;
  const byStatus: Record<string, number> = {};
  let totalResponseTime = 0;
  let completedCount = 0;
  
  for (const request of requestsStore.values()) {
    const createdAt = new Date(request.createdAt);
    if (createdAt >= startDate && createdAt <= endDate) {
      total++;
      byStatus[request.status] = (byStatus[request.status] || 0) + 1;
      
      if (request.status === "completed" && request.responses.length > 0) {
        const firstResponse = request.responses[0];
        if (firstResponse.repliedAt) {
          const responseTime = new Date(firstResponse.repliedAt).getTime() - createdAt.getTime();
          totalResponseTime += responseTime;
          completedCount++;
        }
      }
    }
  }
  
  return {
    total,
    byStatus,
    avgResponseTime: completedCount > 0 ? totalResponseTime / completedCount / 1000 / 60 : 0, // в минутах
  };
}

// ===== Вспомогательные функции =====

function generateRequestId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `AI-${date}-${random}`;
}
