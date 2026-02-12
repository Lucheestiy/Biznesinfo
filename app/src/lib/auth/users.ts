import { randomUUID } from "node:crypto";
import { getDbPool } from "./db";

export type UserRole = "user" | "admin";
export type UserPlan = "free" | "paid" | "partner";

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  role: UserRole;
  plan: UserPlan;
  created_at: Date;
  updated_at: Date;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const pool = getDbPool();
  const normalized = normalizeEmail(email);
  const res = await pool.query<UserRow>(
    "SELECT * FROM users WHERE email = $1 LIMIT 1",
    [normalized],
  );
  return res.rows[0] || null;
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  name?: string | null;
  role?: UserRole;
  plan?: UserPlan;
}): Promise<UserRow> {
  const pool = getDbPool();
  const id = randomUUID();
  const email = normalizeEmail(input.email);
  const passwordHash = input.passwordHash;
  const name = input.name ?? null;
  const role = input.role ?? "user";
  const plan = input.plan ?? "free";

  const res = await pool.query<UserRow>(
    `INSERT INTO users (id, email, password_hash, name, role, plan)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [id, email, passwordHash, name, role, plan],
  );
  return res.rows[0];
}

export async function upsertUserFromTrustedLogin(input: {
  email: string;
  passwordHash: string;
  name?: string | null;
  role: UserRole;
  plan: UserPlan;
}): Promise<UserRow> {
  const pool = getDbPool();
  const id = randomUUID();
  const email = normalizeEmail(input.email);
  const passwordHash = input.passwordHash;
  const name = input.name ?? null;

  const res = await pool.query<UserRow>(
    `INSERT INTO users (id, email, password_hash, name, role, plan)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       plan = EXCLUDED.plan,
       updated_at = now()
     RETURNING *`,
    [id, email, passwordHash, name, input.role, input.plan],
  );
  return res.rows[0];
}

export async function updateUserName(userId: string, name: string | null): Promise<UserRow> {
  const pool = getDbPool();
  const res = await pool.query<UserRow>(
    "UPDATE users SET name = $1, updated_at = now() WHERE id = $2 RETURNING *",
    [name, userId],
  );
  return res.rows[0];
}

export async function updateUserPasswordHash(userId: string, passwordHash: string): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    "UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2",
    [passwordHash, userId],
  );
}

export async function listUsers(params: { limit?: number; offset?: number } = {}): Promise<UserRow[]> {
  const pool = getDbPool();
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const offset = Math.max(0, params.offset ?? 0);
  const res = await pool.query<UserRow>(
    "SELECT * FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset],
  );
  return res.rows;
}

export async function setUserPlan(userId: string, plan: UserPlan): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    "UPDATE users SET plan = $1, updated_at = now() WHERE id = $2",
    [plan, userId],
  );
}

export async function setUserRole(userId: string, role: UserRole): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    "UPDATE users SET role = $1, updated_at = now() WHERE id = $2",
    [role, userId],
  );
}

export async function setUserRoleByEmail(email: string, role: UserRole): Promise<boolean> {
  const pool = getDbPool();
  const normalized = normalizeEmail(email);
  const res = await pool.query(
    "UPDATE users SET role = $1, updated_at = now() WHERE email = $2",
    [role, normalized],
  );
  return (res.rowCount || 0) > 0;
}
