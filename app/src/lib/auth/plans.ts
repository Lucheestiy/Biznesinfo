import { getDbPool } from "./db";
import type { UserPlan, UserRow } from "./users";
import { findPartnerDomain } from "./partnerDomains";

export type PlanLimits = {
  plan: UserPlan;
  ai_requests_per_day: number;
};

export async function listPlanLimits(): Promise<PlanLimits[]> {
  const pool = getDbPool();
  const res = await pool.query<PlanLimits>(
    "SELECT plan, ai_requests_per_day FROM plan_limits ORDER BY plan",
  );
  return res.rows;
}

export async function upsertPlanLimits(params: { plan: UserPlan; aiRequestsPerDay: number }): Promise<void> {
  const pool = getDbPool();
  const limit = Math.max(0, Math.floor(params.aiRequestsPerDay));
  await pool.query(
    `INSERT INTO plan_limits (plan, ai_requests_per_day, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (plan) DO UPDATE
       SET ai_requests_per_day = EXCLUDED.ai_requests_per_day,
           updated_at = now()`,
    [params.plan, limit],
  );
}

export async function getPlanLimits(plan: UserPlan): Promise<PlanLimits> {
  const pool = getDbPool();
  const res = await pool.query<PlanLimits>(
    "SELECT plan, ai_requests_per_day FROM plan_limits WHERE plan = $1 LIMIT 1",
    [plan],
  );
  const row = res.rows[0];
  if (row) return row;
  // Fallback defaults if DB not seeded.
  if (plan === "free") return { plan, ai_requests_per_day: 1 };
  if (plan === "paid") return { plan, ai_requests_per_day: 10 };
  return { plan, ai_requests_per_day: 10 };
}

export async function getUserEffectivePlan(user: UserRow): Promise<{ plan: UserPlan; aiRequestsPerDay: number }> {
  const email = (user.email || "").trim().toLowerCase();
  const domain = email.includes("@") ? email.split("@").pop() || "" : "";
  if (domain) {
    const partner = await findPartnerDomain(domain);
    if (partner) {
      const partnerLimits = await getPlanLimits("partner");
      const limit = typeof partner.ai_requests_per_day === "number" ? partner.ai_requests_per_day : partnerLimits.ai_requests_per_day;
      return { plan: "partner", aiRequestsPerDay: limit };
    }
  }

  const limits = await getPlanLimits(user.plan);
  return { plan: user.plan, aiRequestsPerDay: limits.ai_requests_per_day };
}
