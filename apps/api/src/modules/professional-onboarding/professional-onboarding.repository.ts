import type { CreateSelfServiceProfessionalInput, ProfessionalResponse } from "@contatocerto/shared";
import { withTransaction, type DatabaseClient } from "../../database/connection.js";
import { professionalSlugBase, professionalSlugCandidate } from "../professionals/professional-slug.js";
type Row = Omit<ProfessionalResponse,"available_now_updated_at"|"created_at"|"updated_at"> & {available_now_updated_at:Date|null;created_at:Date;updated_at:Date};
const columns=`id,display_name,slug,bio,phone_e164,email,profile_image_url,status,is_verified,is_available_now,available_now_updated_at,created_at,updated_at`;
function map(row:Row):ProfessionalResponse{return {...row,available_now_updated_at:row.available_now_updated_at?.toISOString()??null,created_at:row.created_at.toISOString(),updated_at:row.updated_at.toISOString()};}
export type OnboardingCreateOutcome={kind:"created";professional:ProfessionalResponse}|{kind:"account_unavailable"}|{kind:"identity_unverified"}|{kind:"slug_conflict"};
export class PostgresProfessionalOnboardingRepository{
 constructor(private readonly transaction:typeof withTransaction=withTransaction,private readonly afterProfessionalInsert?:(client:DatabaseClient)=>Promise<void>){}
 create(accountId:string,input:CreateSelfServiceProfessionalInput):Promise<OnboardingCreateOutcome>{return this.transaction(async client=>{
  const account=await client.query<{status:"active"|"blocked";verified:boolean}>(`SELECT a.status,EXISTS(SELECT 1 FROM account_identifiers i WHERE i.account_id=a.id AND i.verified_at IS NOT NULL) verified FROM accounts a WHERE a.id=$1 FOR UPDATE`,[accountId]);
  if(!account.rows[0]||account.rows[0].status!=="active")return {kind:"account_unavailable"};
  if(!account.rows[0].verified)return {kind:"identity_unverified"};
  const base=professionalSlugBase(input.display_name);await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,23))",[`professional-slug:${base}`]);
  let professional:Row|undefined;
  for(let suffix=1;suffix<=100;suffix+=1){const inserted=await client.query<Row>(`INSERT INTO professionals(display_name,slug,phone_e164,email,bio,profile_image_url,status,is_available_now,is_verified) VALUES($1,$2,$3,$4,$5,$6,'draft',FALSE,FALSE) ON CONFLICT(slug) DO NOTHING RETURNING ${columns}`,[input.display_name,professionalSlugCandidate(base,suffix),input.phone_e164,input.email??null,input.bio??null,input.profile_image_url??null]);if(inserted.rows[0]){professional=inserted.rows[0];break;}}
  if(!professional)return {kind:"slug_conflict"};await this.afterProfessionalInsert?.(client);
  await client.query("SELECT set_config('contatocerto.membership_actor_account_id',$1,true),set_config('contatocerto.membership_source','self_onboarding',true)",[accountId]);
  await client.query("INSERT INTO professional_memberships(account_id,professional_id,role,status) VALUES($1,$2,'owner','active')",[accountId,professional.id]);
  return {kind:"created",professional:map(professional)};
 });}
}
