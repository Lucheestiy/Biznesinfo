import { redirect } from "next/navigation";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import RegisterClient from "./RegisterClient";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams?: { next?: string };
}) {
  if (!isAuthEnabled()) {
    redirect("/");
  }

  const user = await getCurrentUser();
  if (user) redirect("/cabinet");

  return <RegisterClient nextPath={searchParams?.next || null} />;
}

