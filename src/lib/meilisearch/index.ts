export { getMeiliClient, getCompaniesIndex, COMPANIES_INDEX, isMeiliHealthy } from "./client";
export { configureCompaniesIndex } from "./config";
export { indexCompanies } from "./indexer";
export { meiliSearch, meiliSuggest } from "./search";
export type { MeiliCompanyDocument, MeiliSearchParams, MeiliSearchResult } from "./types";
