import { getSessionCookieToken, getUserBySessionToken } from "./sessions";
import type { UserRow } from "./users";

export function isAuthEnabled(): boolean {
  const raw = (process.env.AUTH_ENABLED || "").trim();
  if (!raw) return false;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

export async function getCurrentUser(): Promise<UserRow | null> {
  if (!isAuthEnabled()) return null;
  const token = await getSessionCookieToken();
  if (!token) return null;
  return getUserBySessionToken(token);
}

export async function requireUser(): Promise<UserRow> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export function isAdmin(user: UserRow | null): boolean {
  return Boolean(user && user.role === "admin");
}

export async function requireAdminUser(): Promise<UserRow> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("FORBIDDEN");
  return user;
}
