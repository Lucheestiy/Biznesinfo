import { redirect } from "next/navigation";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import LoginPageShell from "./LoginPageShell";

export const dynamic = "force-dynamic";

type SearchParamsValue = {
  next?: string;
  error?: string;
};

type SearchParamsInput = SearchParamsValue | Promise<SearchParamsValue>;

async function resolveSearchParams(searchParams?: SearchParamsInput): Promise<SearchParamsValue> {
  if (!searchParams) return {};
  if (typeof (searchParams as Promise<SearchParamsValue>).then === "function") {
    return searchParams as Promise<SearchParamsValue>;
  }
  return searchParams as SearchParamsValue;
}

function normalizeNextPath(raw?: string): string {
  if (!raw) return "/cabinet";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/cabinet";
  return trimmed;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  if (!isAuthEnabled()) {
    redirect("/");
  }

  const user = await getCurrentUser();
  if (user) redirect("/cabinet");

  const params = await resolveSearchParams(searchParams);
  const nextPath = normalizeNextPath(params.next);
  return <LoginPageShell nextPath={nextPath} errorCode={params.error} />;
}
