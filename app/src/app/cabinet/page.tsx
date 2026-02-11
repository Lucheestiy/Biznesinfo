import { redirect } from "next/navigation";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import CabinetClient from "./CabinetClient";

export default async function CabinetPage() {
  if (!isAuthEnabled()) redirect("/");

  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/cabinet");

  return (
    <CabinetClient
      user={{
        email: user.email,
        name: user.name,
        plan: user.plan,
        role: user.role,
      }}
    />
  );
}

