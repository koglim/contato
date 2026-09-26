import { DashboardContent } from "./dashboard-content";
import { getDashboardData } from "../../lib/api/server";
import { ProfileSelector } from "./profile-selector";

export type DashboardSection = "overview" | "profile" | "services" | "areas" | "availability";

export async function DashboardPage({ section }: { section: DashboardSection }) {
  try { const data = await getDashboardData(); return <>{data.profiles&&data.profiles.length>1?<ProfileSelector profiles={data.profiles} current={data.professional.id}/>:null}<DashboardContent section={section} data={data} /></>; }
  catch(error){if(error instanceof Error&&error.message==="no_professional_profiles")return <section><h1>Nenhum perfil profissional está vinculado a esta conta.</h1></section>;throw error;}
}
