export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import AiRequestsClient from "./AiRequestsClient";

export default async function AdminAiRequestsPage() {
  if (!isAuthEnabled()) redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/ai-requests");
  if (user.role !== "admin") redirect("/cabinet");
  return <AiRequestsClient />;
}

