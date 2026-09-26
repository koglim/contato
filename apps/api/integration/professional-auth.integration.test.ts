import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after,test } from "node:test";
import { closeDatabaseConnection,query } from "../src/database/connection.js";
import { decryptAuthMessage } from "../src/modules/professional-auth/professional-auth.crypto.js";
import { PostgresProfessionalAuthRepository } from "../src/modules/professional-auth/professional-auth.repository.js";
import { ProfessionalAuthService } from "../src/modules/professional-auth/professional-auth.service.js";

after(closeDatabaseConnection);
const pepper="integration-pepper-with-at-least-thirty-two-bytes";

test("concurrent challenge and verification create one outbound and exactly one session",async()=>{
 const accountId=randomUUID(),identifierId=randomUUID(),phone=`+5565${String(Date.now()).slice(-9)}`;const outboundIds:string[]=[];
 await query("INSERT INTO accounts(id) VALUES($1)",[accountId]);await query("INSERT INTO account_identifiers(id,account_id,kind,normalized_value,verified_at) VALUES($1,$2,'phone',$3,NOW())",[identifierId,accountId,phone]);
 try{
  const service=new ProfessionalAuthService(new PostgresProfessionalAuthRepository(),pepper);
  const requests=await Promise.all([service.requestChallenge(phone),service.requestChallenge(phone)]);assert.equal(requests[0].challenge_reference,requests[1].challenge_reference);
  const rows=(await query<{id:string;text_content:string}>("SELECT o.id,o.text_content FROM channel_outbound_messages o JOIN professional_auth_challenges c ON c.outbound_id=o.id WHERE c.account_identifier_id=$1",[identifierId])).rows;assert.equal(rows.length,1);outboundIds.push(rows[0]!.id);assert.equal(rows[0]!.text_content.includes("código ContatoCerto"),false);
  const message=decryptAuthMessage(pepper,rows[0]!.text_content),code=/\b(\d{6})\b/u.exec(message)?.[1];assert.ok(code);
  const verified=await Promise.all([service.verify(requests[0].challenge_reference,code),service.verify(requests[0].challenge_reference,code)]);assert.equal(verified.filter(item=>item.ok).length,1);const success=verified.find(item=>item.ok);assert.ok(success?.ok);
  assert.ok(await service.authenticate(success.session_token));await service.revoke(success.session_token);assert.equal(await service.authenticate(success.session_token),null);
  assert.equal((await query<{count:number}>("SELECT count(*)::int count FROM professional_sessions WHERE account_id=$1",[accountId])).rows[0]!.count,1);
 }finally{await query("DELETE FROM professional_sessions WHERE account_id=$1",[accountId]);await query("DELETE FROM professional_auth_challenges WHERE account_identifier_id=$1",[identifierId]);if(outboundIds.length)await query("DELETE FROM channel_outbound_messages WHERE id=ANY($1::uuid[])",[outboundIds]);await query("DELETE FROM account_identifiers WHERE id=$1",[identifierId]);await query("DELETE FROM accounts WHERE id=$1",[accountId]);}
});

test("unknown, blocked and unverified phones keep the generic accepted contract without durable work",async()=>{
 const service=new ProfessionalAuthService(new PostgresProfessionalAuthRepository(),pepper);const unknown=await service.requestChallenge("+5565000000001");assert.equal(unknown.accepted,true);assert.match(unknown.challenge_reference,/^[0-9a-f-]{36}$/u);
 const accountId=randomUUID(),identifierId=randomUUID(),phone="+5565000000002";await query("INSERT INTO accounts(id,status) VALUES($1,'blocked')",[accountId]);await query("INSERT INTO account_identifiers(id,account_id,kind,normalized_value) VALUES($1,$2,'phone',$3)",[identifierId,accountId,phone]);
 try{const blocked=await service.requestChallenge(phone);assert.deepEqual(Object.keys(blocked).sort(),Object.keys(unknown).sort());assert.equal((await query<{count:number}>("SELECT count(*)::int count FROM professional_auth_challenges WHERE account_identifier_id=$1",[identifierId])).rows[0]!.count,0);}finally{await query("DELETE FROM account_identifiers WHERE id=$1",[identifierId]);await query("DELETE FROM accounts WHERE id=$1",[accountId]);}
});
