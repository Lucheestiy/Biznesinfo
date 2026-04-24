import HomePageClient from "./HomePageClient";
import { biznesinfoGetCatalogStats } from "@/lib/biznesinfo/store";

export const dynamic = "force-dynamic";

export default async function Page() {
  let stats = null;
  try {
    stats = await biznesinfoGetCatalogStats(null);
  } catch {
    // The client can refresh the stats after render if the server-side fetch misses.
  }

  return <HomePageClient initialStats={stats} />;
}
