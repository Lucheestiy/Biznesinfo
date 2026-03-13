import HomePageClient from "./HomePageClient";
import LoginPageShell from "./login/LoginPageShell";
import { biznesinfoGetCatalog } from "@/lib/biznesinfo/store";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";

export const dynamic = "force-dynamic";

// Optional: you can set revalidation if you want the page to update periodically
// export const revalidate = 3600; 

export default async function Page() {
  if (isAuthEnabled()) {
    const user = await getCurrentUser();
    if (!user) {
      return <LoginPageShell nextPath="/" />;
    }
  }

  let catalog = null;
  try {
    catalog = await biznesinfoGetCatalog(null);
  } catch (error) {
    console.error("Failed to fetch catalog for home page:", error);
  }
  
  return <HomePageClient initialCatalog={catalog} />;
}
