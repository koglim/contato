"use client";
import { useState } from "react";
import type { DashboardProfile } from "../../lib/api/server";
export function ProfileSelector({profiles,current}:{profiles:DashboardProfile[];current:string}){const[pending,setPending]=useState(false);return <label>Perfil profissional <select value={current} disabled={pending} onChange={async event=>{setPending(true);const response=await fetch("/api/dashboard/profile",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:event.target.value})});if(response.ok)window.location.reload();else setPending(false);}}>{profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.display_name}</option>)}</select></label>;}
