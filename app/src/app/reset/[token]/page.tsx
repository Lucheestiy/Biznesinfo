import { redirect } from "next/navigation";
import { isAuthEnabled } from "@/lib/auth/currentUser";
import ResetConfirmClient from "./ResetConfirmClient";

export const dynamic = "force-dynamic";

export default async function ResetTokenPage({ params }: { params: { token: string } }) {
  if (!isAuthEnabled()) redirect("/");
  const token = (params?.token || "").trim();
  if (!token) redirect("/reset");
  return <ResetConfirmClient token={token} />;
}
