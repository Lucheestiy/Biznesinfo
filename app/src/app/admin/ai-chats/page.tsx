export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import { getAiInstanceId } from "@/lib/ai/instance";
import AiChatsAdminClient from "./AiChatsAdminClient";

export default async function AdminAiChatsPage() {
  if (!isAuthEnabled()) redirect("/");

  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/ai-chats");
  if (user.role !== "admin") redirect("/cabinet");

  return (
    <AiChatsAdminClient
      currentUser={{
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      }}
      instanceId={getAiInstanceId()}
    />
  );
}
