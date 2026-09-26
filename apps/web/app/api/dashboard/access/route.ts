import { NextResponse } from "next/server";
import { dashboardCookieName, professionalAuthEnabled } from "../../../../lib/auth/dashboard";
import { createDashboardSession, dashboardSessionDurationSeconds, hasMatchingDemoPassword } from "../../../../lib/auth/session";
import { sameOriginError } from "../../../../lib/auth/same-origin";

export async function POST(request: Request) {
  const originError=sameOriginError(request);if(originError)return originError;
  const body = await request.json().catch(() => ({}));
  if(professionalAuthEnabled()){
    const base=process.env.CONTATOCERTO_API_URL,key=process.env.INTERNAL_API_KEY;if(!base||!key)return NextResponse.json({error:"unavailable"},{status:503});
    const action=body.action==="verify"?"verify":"challenge";
    const response=await fetch(`${base}/internal/professional-auth/${action}`,{method:"POST",headers:{"content-type":"application/json","x-internal-key":key},body:JSON.stringify(action==="verify"?{challenge_reference:body.challenge_reference,code:body.code}:{phone_e164:body.phone_e164}),cache:"no-store"});
    const result=await response.json().catch(()=>({error:"invalid_or_expired_code"}));if(!response.ok)return NextResponse.json(result,{status:response.status});
    if(action==="challenge")return NextResponse.json(result);
    const output=NextResponse.json({ok:true});output.cookies.set(dashboardCookieName,result.session_token,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:result.expires_in_seconds});return output;
  }
  const { password } = body;
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (!secret || !hasMatchingDemoPassword(password, process.env.DASHBOARD_DEMO_PASSWORD)) return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(dashboardCookieName, createDashboardSession(secret), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: dashboardSessionDurationSeconds });
  return response;
}
