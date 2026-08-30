import { DashboardContent } from "./dashboard-content";
import { getDashboardData } from "../../lib/api/server";

export type DashboardSection = "overview" | "profile" | "services" | "areas" | "availability";

export async function DashboardPage({ section }: { section: DashboardSection }) {
  const data = await getDashboardData();
  return <DashboardContent section={section} data={data} />;
}
