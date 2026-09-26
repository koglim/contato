import assert from "node:assert/strict";
import { randomBytes,randomUUID } from "node:crypto";
import { after,test } from "node:test";
import { closeDatabaseConnection,inDatabaseTransaction,query,withTransaction } from "../src/database/connection.js";
import {
  decryptAuthMessage,
  PROFESSIONAL_AUTH_REFERENCE_PATTERN,
  resolvePublicChallengeReference,
  hashSessionToken,
} from "../src/modules/professional-auth/professional-auth.crypto.js";
import { PostgresProfessionalAuthRepository } from "../src/modules/professional-auth/professional-auth.repository.js";
import { ProfessionalAuthService } from "../src/modules/professional-auth/professional-auth.service.js";
import { ProfessionalAccessService } from "../src/modules/professional-access/professional-access.service.js";
import { PostgresChannelOutboundMessageRepository } from "../src/modules/channel-outbox/channel-outbox.repository.js";

after(closeDatabaseConnection);
const pepper="integration-pepper-with-at-least-thirty-two-bytes";
async function rolledBack(operation:()=>Promise<void>){const marker=new Error("professional_auth_test_rollback");try{await withTransaction(client=>inDatabaseTransaction(client,async()=>{await operation();throw marker;}));}catch(error){if(error!==marker)throw error;}}

test("concurrent challenge and verification create one outbound and exactly one session",async()=>{
 const accountId=randomUUID(),identifierId=randomUUID(),phone=`+5565${String(Date.now()).slice(-9)}`;const outboundIds:string[]=[];
 await query("INSERT INTO accounts(id) VALUES($1)",[accountId]);await query("INSERT INTO account_identifiers(id,account_id,kind,normalized_value,verified_at) VALUES($1,$2,'phone',$3,NOW())",[identifierId,accountId,phone]);
 try{
  const service=new ProfessionalAuthService(new PostgresProfessionalAuthRepository(),pepper);
  const requests=await Promise.all([service.requestChallenge(phone),service.requestChallenge(phone)]);
  assert.notEqual(requests[0].challenge_reference,requests[1].challenge_reference);
  assert.equal(resolvePublicChallengeReference(pepper,requests[0].challenge_reference),resolvePublicChallengeReference(pepper,requests[1].challenge_reference));
  assert.equal(requests[0].challenge_reference.includes(resolvePublicChallengeReference(pepper,requests[0].challenge_reference)),false);
  const rows=(await query<{id:string;text_content:string}>("SELECT o.id,o.text_content FROM channel_outbound_messages o JOIN professional_auth_challenges c ON c.outbound_id=o.id WHERE c.account_identifier_id=$1",[identifierId])).rows;assert.equal(rows.length,1);outboundIds.push(rows[0]!.id);assert.equal(rows[0]!.text_content.includes("código ContatoCerto"),false);
  const message=decryptAuthMessage(pepper,rows[0]!.text_content),code=/\b(\d{6})\b/u.exec(message)?.[1];assert.ok(code);
  const verified=await Promise.all([service.verify(requests[0].challenge_reference,code),service.verify(requests[0].challenge_reference,code)]);assert.equal(verified.filter(item=>item.ok).length,1);const success=verified.find(item=>item.ok);assert.ok(success?.ok);
  assert.ok(await service.authenticate(success.session_token));await service.revoke(success.session_token);assert.equal(await service.authenticate(success.session_token),null);
  assert.equal((await query<{count:number}>("SELECT count(*)::int count FROM professional_sessions WHERE account_id=$1",[accountId])).rows[0]!.count,1);
 }finally{await query("DELETE FROM professional_sessions WHERE account_id=$1",[accountId]);await query("DELETE FROM professional_auth_challenges WHERE account_identifier_id=$1",[identifierId]);if(outboundIds.length)await query("DELETE FROM channel_outbound_messages WHERE id=ANY($1::uuid[])",[outboundIds]);await query("DELETE FROM account_identifiers WHERE id=$1",[identifierId]);await query("DELETE FROM accounts WHERE id=$1",[accountId]);}
});

test("unknown, blocked and unverified phones keep indistinguishable randomized references without durable work",async()=>{
 const service=new ProfessionalAuthService(new PostgresProfessionalAuthRepository(),pepper);
 const unknown=await service.requestChallenge("+5565000000001"),unknownAgain=await service.requestChallenge("+5565000000001");
 assert.equal(unknown.accepted,true);assert.match(unknown.challenge_reference,PROFESSIONAL_AUTH_REFERENCE_PATTERN);assert.notEqual(unknown.challenge_reference,unknownAgain.challenge_reference);
 const blockedAccount=randomUUID(),blockedIdentifier=randomUUID(),blockedPhone="+5565000000002";
 const unverifiedAccount=randomUUID(),unverifiedIdentifier=randomUUID(),unverifiedPhone="+5565000000003";
 await query("INSERT INTO accounts(id,status) VALUES($1,'blocked'),($2,'active')",[blockedAccount,unverifiedAccount]);
 await query("INSERT INTO account_identifiers(id,account_id,kind,normalized_value,verified_at) VALUES($1,$2,'phone',$3,NOW()),($4,$5,'phone',$6,NULL)",[blockedIdentifier,blockedAccount,blockedPhone,unverifiedIdentifier,unverifiedAccount,unverifiedPhone]);
 try{
  const blocked=await service.requestChallenge(blockedPhone),unverified=await service.requestChallenge(unverifiedPhone);
  for(const response of [unknown,unknownAgain,blocked,unverified]){assert.deepEqual(Object.keys(response).sort(),["accepted","challenge_reference","expires_in_seconds"]);assert.match(response.challenge_reference,PROFESSIONAL_AUTH_REFERENCE_PATTERN);}
  assert.equal((await query<{count:number}>("SELECT count(*)::int count FROM professional_auth_challenges WHERE account_identifier_id=ANY($1::uuid[])",[[blockedIdentifier,unverifiedIdentifier]])).rows[0]!.count,0);
 }finally{await query("DELETE FROM account_identifiers WHERE id=ANY($1::uuid[])",[[blockedIdentifier,unverifiedIdentifier]]);await query("DELETE FROM accounts WHERE id=ANY($1::uuid[])",[[blockedAccount,unverifiedAccount]]);}
});

test("a new challenge invalidates the old OTP and terminalizes its unsent outbound with audit",async()=>{
 await rolledBack(async()=>{
  const accountId=randomUUID(),identifierId=randomUUID(),phone=`+5564${String(Date.now()).slice(-9)}`;
  await query("INSERT INTO accounts(id) VALUES($1)",[accountId]);await query("INSERT INTO account_identifiers(id,account_id,kind,normalized_value,verified_at) VALUES($1,$2,'phone',$3,NOW())",[identifierId,accountId,phone]);
  const service=new ProfessionalAuthService(new PostgresProfessionalAuthRepository(),pepper);
  const first=await service.requestChallenge(phone);const firstId=resolvePublicChallengeReference(pepper,first.challenge_reference);
  const firstRow=(await query<{outbound_id:string;text_content:string}>("SELECT c.outbound_id,o.text_content FROM professional_auth_challenges c JOIN channel_outbound_messages o ON o.id=c.outbound_id WHERE c.id=$1",[firstId])).rows[0]!;
  const oldCode=/\b(\d{6})\b/u.exec(decryptAuthMessage(pepper,firstRow.text_content))?.[1];assert.ok(oldCode);
  await query("UPDATE professional_auth_challenges SET created_at=NOW()-INTERVAL '61 seconds' WHERE id=$1",[firstId]);
  const second=await service.requestChallenge(phone);const secondId=resolvePublicChallengeReference(pepper,second.challenge_reference);
  assert.notEqual(secondId,firstId);
  assert.ok((await query<{invalidated_at:Date|null}>("SELECT invalidated_at FROM professional_auth_challenges WHERE id=$1",[firstId])).rows[0]!.invalidated_at);
  assert.deepEqual((await query<{status:string;last_error_code:string}>("SELECT status,last_error_code FROM channel_outbound_messages WHERE id=$1",[firstRow.outbound_id])).rows[0],{status:"failed",last_error_code:"auth_challenge_superseded"});
  assert.equal((await query<{count:number}>("SELECT count(*)::int count FROM channel_transport_events WHERE outbound_id=$1 AND reason='auth_challenge_superseded'",[firstRow.outbound_id])).rows[0]!.count,1);
  assert.equal(await new PostgresChannelOutboundMessageRepository().claim(firstRow.outbound_id,randomUUID(),60),null);
  assert.equal((await service.verify(first.challenge_reference,oldCode)).ok,false);
 });
});

test("a superseded processing auth delivery cannot be reclaimed after lease expiry while its original token can confirm",async()=>{
 await rolledBack(async()=>{
  const accountId=randomUUID(),identifierId=randomUUID(),phone=`+5559${String(Date.now()).slice(-9)}`;
  await query("INSERT INTO accounts(id) VALUES($1)",[accountId]);
  await query("INSERT INTO account_identifiers(id,account_id,kind,normalized_value,verified_at) VALUES($1,$2,'phone',$3,NOW())",[identifierId,accountId,phone]);
  const service=new ProfessionalAuthService(new PostgresProfessionalAuthRepository(),pepper);
  const outbox=new PostgresChannelOutboundMessageRepository();
  const first=await service.requestChallenge(phone),firstId=resolvePublicChallengeReference(pepper,first.challenge_reference);
  const firstOutbound=(await query<{outbound_id:string}>("SELECT outbound_id FROM professional_auth_challenges WHERE id=$1",[firstId])).rows[0]!.outbound_id;
  const originalToken=randomUUID(),claimed=await outbox.claim(firstOutbound,originalToken,60);
  assert.equal(claimed?.status,"processing");assert.equal(claimed?.processingToken,originalToken);assert.equal(claimed?.attemptCount,1);
  await query("UPDATE professional_auth_challenges SET created_at=NOW()-INTERVAL '61 seconds' WHERE id=$1",[firstId]);
  const second=await service.requestChallenge(phone),secondId=resolvePublicChallengeReference(pepper,second.challenge_reference);
  const secondOutbound=(await query<{outbound_id:string}>("SELECT outbound_id FROM professional_auth_challenges WHERE id=$1",[secondId])).rows[0]!.outbound_id;
  assert.ok((await query<{invalidated_at:Date|null}>("SELECT invalidated_at FROM professional_auth_challenges WHERE id=$1",[firstId])).rows[0]!.invalidated_at);
  assert.deepEqual((await query<{invalidated_at:Date|null;consumed_at:Date|null}>("SELECT invalidated_at,consumed_at FROM professional_auth_challenges WHERE id=$1",[secondId])).rows[0],{invalidated_at:null,consumed_at:null});
  const preserved=(await query<{status:string;processing_token:string;attempt_count:number}>("SELECT status,processing_token,attempt_count FROM channel_outbound_messages WHERE id=$1",[firstOutbound])).rows[0]!;
  assert.deepEqual(preserved,{status:"processing",processing_token:originalToken,attempt_count:1});
  await query("UPDATE channel_outbound_messages SET processing_started_at=NOW()-INTERVAL '2 minutes' WHERE id=$1",[firstOutbound]);
  assert.equal(await outbox.claim(firstOutbound,randomUUID(),60),null);
  const next=await outbox.claimNextPending(randomUUID(),60);assert.equal(next?.id,secondOutbound);assert.notEqual(next?.id,firstOutbound);
  const afterReclaimAttempts=(await query<{processing_token:string;attempt_count:number}>("SELECT processing_token,attempt_count FROM channel_outbound_messages WHERE id=$1",[firstOutbound])).rows[0]!;
  assert.deepEqual(afterReclaimAttempts,{processing_token:originalToken,attempt_count:1});
  assert.equal(await outbox.holdDelivery(firstOutbound,{processing_token:originalToken,reason:"confirmation_pending",provider_message_id:"superseded-provider-proof"}),true);
  assert.equal(await outbox.markSent(firstOutbound,{processing_token:originalToken,provider_message_id:"superseded-provider-proof"}),true);
  assert.deepEqual((await query<{status:string;provider_message_id:string}>("SELECT status,provider_message_id FROM channel_outbound_messages WHERE id=$1",[firstOutbound])).rows[0],{status:"sent",provider_message_id:"superseded-provider-proof"});
 });
});

test("a consumed auth challenge cannot grant a new claim after lease expiry",async()=>{
 await rolledBack(async()=>{
  const accountId=randomUUID(),identifierId=randomUUID(),phone=`+5558${String(Date.now()).slice(-9)}`;
  await query("INSERT INTO accounts(id) VALUES($1)",[accountId]);
  await query("INSERT INTO account_identifiers(id,account_id,kind,normalized_value,verified_at) VALUES($1,$2,'phone',$3,NOW())",[identifierId,accountId,phone]);
  const service=new ProfessionalAuthService(new PostgresProfessionalAuthRepository(),pepper),outbox=new PostgresChannelOutboundMessageRepository();
  const challenge=await service.requestChallenge(phone),challengeId=resolvePublicChallengeReference(pepper,challenge.challenge_reference);
  const outbound=(await query<{outbound_id:string;text_content:string}>("SELECT c.outbound_id,o.text_content FROM professional_auth_challenges c JOIN channel_outbound_messages o ON o.id=c.outbound_id WHERE c.id=$1",[challengeId])).rows[0]!;
  const code=/\b(\d{6})\b/u.exec(decryptAuthMessage(pepper,outbound.text_content))?.[1];assert.ok(code);
  const originalToken=randomUUID(),claimed=await outbox.claim(outbound.outbound_id,originalToken,60);assert.equal(claimed?.attemptCount,1);
  assert.equal((await service.verify(challenge.challenge_reference,code)).ok,true);
  assert.ok((await query<{consumed_at:Date|null}>("SELECT consumed_at FROM professional_auth_challenges WHERE id=$1",[challengeId])).rows[0]!.consumed_at);
  await query("UPDATE channel_outbound_messages SET processing_started_at=NOW()-INTERVAL '2 minutes' WHERE id=$1",[outbound.outbound_id]);
  assert.equal(await outbox.claim(outbound.outbound_id,randomUUID(),60),null);
  assert.equal(await outbox.claimNextPending(randomUUID(),60),null);
  assert.deepEqual((await query<{processing_token:string;attempt_count:number}>("SELECT processing_token,attempt_count FROM channel_outbound_messages WHERE id=$1",[outbound.outbound_id])).rows[0],{processing_token:originalToken,attempt_count:1});
  assert.equal(await outbox.markSent(outbound.outbound_id,{processing_token:originalToken,provider_message_id:"consumed-provider-proof"}),true);
 });
});

test("session stays authenticated with zero profiles while exact membership revocation is immediate",async()=>{
 await rolledBack(async()=>{
  const accountId=randomUUID(),identifierId=randomUUID(),profileA=randomUUID(),profileB=randomUUID();
  const token=randomBytes(32).toString("base64url");
  await query("INSERT INTO accounts(id) VALUES($1)",[accountId]);
  await query("INSERT INTO account_identifiers(id,account_id,kind,normalized_value,verified_at) VALUES($1,$2,'phone',$3,NOW())",[identifierId,accountId,`+5563${String(Date.now()).slice(-9)}`]);
  await query("INSERT INTO professionals(id,display_name,slug,phone_e164,status) VALUES($1,'Profile A',$2,$3,'active'),($4,'Profile B',$5,$6,'active')",[profileA,`auth-a-${profileA}`,`+5562${String(Date.now()).slice(-9)}`,profileB,`auth-b-${profileB}`,`+5561${String(Date.now()).slice(-9)}`]);
  await query("INSERT INTO professional_memberships(account_id,professional_id,role,status) VALUES($1,$2,'owner','active')",[accountId,profileA]);
  await query("INSERT INTO professional_sessions(account_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '7 days')",[accountId,hashSessionToken(token)]);
  const auth=new ProfessionalAuthService(new PostgresProfessionalAuthRepository(),pepper),access=new ProfessionalAccessService();
  assert.ok(await auth.authenticate(token));
  assert.deepEqual(await access.resolveProfessionalAccess({accountId,professionalId:profileA}),{status:"authorized",role:"owner"});
  assert.equal((await access.resolveProfessionalAccess({accountId,professionalId:profileB})).status,"not_member");
  assert.deepEqual((await new PostgresProfessionalAuthRepository().listProfiles(accountId)).map(item=>item.id),[profileA]);
  await query("UPDATE professional_memberships SET status='revoked' WHERE account_id=$1 AND professional_id=$2",[accountId,profileA]);
  assert.ok(await auth.authenticate(token));
  assert.equal((await access.resolveProfessionalAccess({accountId,professionalId:profileA})).status,"membership_revoked");
  assert.deepEqual(await new PostgresProfessionalAuthRepository().listProfiles(accountId),[]);
  await query("UPDATE accounts SET status='blocked' WHERE id=$1",[accountId]);
  assert.equal(await auth.authenticate(token),null);
  assert.equal((await access.resolveProfessionalAccess({accountId,professionalId:profileA})).status,"account_blocked");
 });
});

test("hourly limiting stays generic and creates no sixth durable challenge",async()=>{
 await rolledBack(async()=>{
  const accountId=randomUUID(),identifierId=randomUUID(),phone=`+5560${String(Date.now()).slice(-9)}`;
  await query("INSERT INTO accounts(id) VALUES($1)",[accountId]);
  await query("INSERT INTO account_identifiers(id,account_id,kind,normalized_value,verified_at) VALUES($1,$2,'phone',$3,NOW())",[identifierId,accountId,phone]);
  for(let index=0;index<5;index+=1)await query("INSERT INTO professional_auth_challenges(account_identifier_id,code_hash,expires_at,invalidated_at) VALUES($1,$2,NOW()+INTERVAL '5 minutes',NOW())",[identifierId,String(index).padStart(64,"a").slice(-64).replace(/[^a-f0-9]/gu,"a")]);
  const response=await new ProfessionalAuthService(new PostgresProfessionalAuthRepository(),pepper).requestChallenge(phone);
  assert.deepEqual(Object.keys(response).sort(),["accepted","challenge_reference","expires_in_seconds"]);
  assert.match(response.challenge_reference,PROFESSIONAL_AUTH_REFERENCE_PATTERN);
  assert.equal((await query<{count:number}>("SELECT count(*)::int count FROM professional_auth_challenges WHERE account_identifier_id=$1",[identifierId])).rows[0]!.count,5);
 });
});

test("30-second delivery margin terminalizes unsent auth outbound but preserves sent evidence",async()=>{
 await rolledBack(async()=>{
  const outbound=(await query<{id:string}>(`INSERT INTO channel_outbound_messages(
    purpose,provider,recipient_phone_e164,text_content,business_key,expires_at
  ) VALUES('professional_auth_challenge','evolution','+556599990030','enc:v1:test:test:test',$1,NOW()+INTERVAL '20 seconds') RETURNING id`,[`margin-${randomUUID()}`])).rows[0]!;
  assert.equal(await new PostgresChannelOutboundMessageRepository().claim(outbound.id,randomUUID(),60),null);
  assert.deepEqual((await query<{status:string;last_error_code:string}>("SELECT status,last_error_code FROM channel_outbound_messages WHERE id=$1",[outbound.id])).rows[0],{status:"failed",last_error_code:"auth_challenge_expired"});
  assert.equal((await query<{count:number}>("SELECT count(*)::int count FROM channel_transport_events WHERE outbound_id=$1 AND reason='auth_challenge_expired'",[outbound.id])).rows[0]!.count,1);

  const accountId=randomUUID(),identifierId=randomUUID(),phone=`+5569${String(Date.now()).slice(-9)}`;
  await query("INSERT INTO accounts(id) VALUES($1)",[accountId]);
  await query("INSERT INTO account_identifiers(id,account_id,kind,normalized_value,verified_at) VALUES($1,$2,'phone',$3,NOW())",[identifierId,accountId,phone]);
  const service=new ProfessionalAuthService(new PostgresProfessionalAuthRepository(),pepper),first=await service.requestChallenge(phone);
  const firstId=resolvePublicChallengeReference(pepper,first.challenge_reference);
  const sentId=(await query<{outbound_id:string}>("SELECT outbound_id FROM professional_auth_challenges WHERE id=$1",[firstId])).rows[0]!.outbound_id;
  await query("UPDATE channel_outbound_messages SET status='sent',provider_message_id='provider-proof',sent_at=NOW() WHERE id=$1",[sentId]);
  await query("UPDATE professional_auth_challenges SET created_at=NOW()-INTERVAL '61 seconds' WHERE id=$1",[firstId]);
  await service.requestChallenge(phone);
  assert.deepEqual((await query<{status:string;provider_message_id:string}>("SELECT status,provider_message_id FROM channel_outbound_messages WHERE id=$1",[sentId])).rows[0],{status:"sent",provider_message_id:"provider-proof"});
 });
});
