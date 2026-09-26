import { DashboardContent } from "./dashboard-content";
import { getDashboardData } from "../../lib/api/server";
import { ProfileSelector } from "./profile-selector";
import { ProfessionalOnboarding } from "./onboarding";
import { professionalAuthEnabled } from "../../lib/auth/dashboard";

export type DashboardSection = "overview" | "profile" | "services" | "areas" | "availability";

export async function DashboardPage({ section }: { section: DashboardSection }) {
  const selfServiceLifecycleEnabled = professionalAuthEnabled();
  const data = await getDashboardData();
  if(data.status==="no_profiles")return <ProfessionalOnboarding />;
  return <>{data.profiles&&data.profiles.length>1?<ProfileSelector profiles={data.profiles} current={data.professional.id}/>:null}<DashboardContent section={section} data={data} selfServiceLifecycleEnabled={selfServiceLifecycleEnabled} /></>;
}
