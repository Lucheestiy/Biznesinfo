import { redirect } from "next/navigation";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import FavoritesClient from "./FavoritesClient";

export default async function FavoritesPage() {
  if (!isAuthEnabled()) redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/favorites");
  return <FavoritesClient />;
}

