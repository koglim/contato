import { DashboardContent } from "./dashboard-content";
import { getDashboardData } from "../../lib/api/server";
import { ProfileSelector } from "./profile-selector";

export type DashboardSection = "overview" | "profile" | "services" | "areas" | "availability";

export async function DashboardPage({ section }: { section: DashboardSection }) {
  const data = await getDashboardData();
  if(data.status==="no_profiles")return <section><h1>Nenhum perfil profissional está vinculado a esta conta.</h1></section>;
  return <>{data.profiles&&data.profiles.length>1?<ProfileSelector profiles={data.profiles} current={data.professional.id}/>:null}<DashboardContent section={section} data={data} /></>;
}
