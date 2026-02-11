import { redirect } from "next/navigation";
import { isAuthEnabled } from "@/lib/auth/currentUser";
import ResetRequestClient from "./ResetRequestClient";

export default async function ResetPage() {
  if (!isAuthEnabled()) redirect("/");
  return <ResetRequestClient />;
}

