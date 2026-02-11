import { redirect } from "next/navigation";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import LoginClient from "./LoginClient";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { next?: string };
}) {
  if (!isAuthEnabled()) {
    // Auth disabled: send user to home.
    redirect("/");
  }

  const user = await getCurrentUser();
  if (user) redirect("/cabinet");

  return <LoginClient nextPath={searchParams?.next || null} />;
}

