import { randomUUID } from "node:crypto";
import { getDbPool } from "./db";

export type PartnerDomainRow = {
  id: string;
  domain: string;
  ai_requests_per_day: number | null;
  created_at: Date;
};

export async function findPartnerDomain(domain: string): Promise<PartnerDomainRow | null> {
  const pool = getDbPool();
  const normalized = domain.trim().toLowerCase();
  const res = await pool.query<PartnerDomainRow>(
    "SELECT * FROM partner_domains WHERE domain = $1 LIMIT 1",
    [normalized],
  );
  return res.rows[0] || null;
}

export async function listPartnerDomains(params?: { limit?: number; offset?: number }): Promise<PartnerDomainRow[]> {
  const pool = getDbPool();
  const limit = Math.max(1, Math.min(500, Math.floor(params?.limit ?? 100)));
  const offset = Math.max(0, Math.floor(params?.offset ?? 0));
  const res = await pool.query<PartnerDomainRow>(
    "SELECT * FROM partner_domains ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset],
  );
  return res.rows;
}

export async function upsertPartnerDomain(params: { domain: string; aiRequestsPerDay?: number | null }): Promise<void> {
  const pool = getDbPool();
  const id = randomUUID();
  const domain = params.domain.trim().toLowerCase();
  const limit = typeof params.aiRequestsPerDay === "number" ? Math.floor(params.aiRequestsPerDay) : null;
  await pool.query(
    `INSERT INTO partner_domains (id, domain, ai_requests_per_day)
     VALUES ($1, $2, $3)
     ON CONFLICT (domain) DO UPDATE SET ai_requests_per_day = EXCLUDED.ai_requests_per_day`,
    [id, domain, limit],
  );
}

export async function deletePartnerDomain(domain: string): Promise<boolean> {
  const pool = getDbPool();
  const normalized = domain.trim().toLowerCase();
  const res = await pool.query("DELETE FROM partner_domains WHERE domain = $1", [normalized]);
  return (res.rowCount || 0) > 0;
}
