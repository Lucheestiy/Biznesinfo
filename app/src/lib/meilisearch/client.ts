import { MeiliSearch, Index } from "meilisearch";
import type { MeiliCompanyDocument } from "./types";

const MEILI_HOST = process.env.MEILI_HOST || "http://localhost:7700";
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY || "";

let clientInstance: MeiliSearch | null = null;

export function getMeiliClient(): MeiliSearch {
  if (!clientInstance) {
    clientInstance = new MeiliSearch({
      host: MEILI_HOST,
      apiKey: MEILI_MASTER_KEY,
    });
  }
  return clientInstance;
}

export const COMPANIES_INDEX = "companies";

export function getCompaniesIndex(): Index<MeiliCompanyDocument> {
  return getMeiliClient().index<MeiliCompanyDocument>(COMPANIES_INDEX);
}

export async function isMeiliHealthy(): Promise<boolean> {
  try {
    const client = getMeiliClient();
    await client.health();
    return true;
  } catch {
    return false;
  }
}
