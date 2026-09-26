import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { dashboardCookieName,professionalAuthEnabled } from "../../../../lib/auth/dashboard";
import { sameOriginError } from "../../../../lib/auth/same-origin";
export async function POST(request:Request){const originError=sameOriginError(request);if(originError)return originError;const token=(await cookies()).get(dashboardCookieName)?.value;if(professionalAuthEnabled()&&token&&process.env.CONTATOCERTO_API_URL&&process.env.INTERNAL_API_KEY)await fetch(`${process.env.CONTATOCERTO_API_URL}/internal/professional-auth/logout`,{method:"POST",headers:{"x-internal-key":process.env.INTERNAL_API_KEY,authorization:`Bearer ${token}`}}).catch(()=>null);const response=NextResponse.json({ok:true});for(const name of [dashboardCookieName,"contatocerto_dashboard_profile"])response.cookies.set(name,"",{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:0});return response;}
