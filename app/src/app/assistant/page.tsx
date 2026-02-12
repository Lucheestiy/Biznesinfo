export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import { getUserEffectivePlan } from "@/lib/auth/plans";
import { getAiUsage } from "@/lib/auth/aiUsage";
import AssistantClient from "./AssistantClient";
import LoginPageShell from "../login/LoginPageShell";

export default async function AssistantPage() {
  if (!isAuthEnabled()) redirect("/");

  const user = await getCurrentUser();
  if (!user) return <LoginPageShell nextPath="/assistant" />;

  const effective = await getUserEffectivePlan(user);
  const usage = await getAiUsage({ userId: user.id });

  return (
    <AssistantClient
      user={{
        name: user.name,
        email: user.email,
        plan: effective.plan,
        aiRequestsPerDay: effective.aiRequestsPerDay,
      }}
      initialUsage={{ day: usage.day, used: usage.used, limit: effective.aiRequestsPerDay }}
    />
  );
}
