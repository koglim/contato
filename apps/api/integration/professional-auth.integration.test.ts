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
import { PostgresMatchingRepository } from "../src/modules/matching/matching.repository.js";

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

test("anti-enumeration: new, existing verified, existing unverified and blocked keep indistinguishable shape while blocked prevents durable work", async () => {
  await rolledBack(async () => {
    const service = new ProfessionalAuthService(new PostgresProfessionalAuthRepository(), pepper);
    const verifiedAccount = randomUUID(), verifiedIdentifier = randomUUID(), verifiedPhone = `+5565${String(Date.now()).slice(-9)}`;
    const unverifiedAccount = randomUUID(), unverifiedIdentifier = randomUUID(), unverifiedPhone = `+5564${String(Date.now()).slice(-9)}`;
    const blockedAccount = randomUUID(), blockedIdentifier = randomUUID(), blockedPhone = `+5563${String(Date.now()).slice(-9)}`;
    const newPhone = `+5562${String(Date.now()).slice(-9)}`;

    await query("INSERT INTO accounts(id,status) VALUES($1,'active'),($2,'active'),($3,'blocked')", [verifiedAccount, unverifiedAccount, blockedAccount]);
    await query("INSERT INTO account_identifiers(id,account_id,kind,normalized_value,verified_at) VALUES($1,$2,'phone',$3,NOW()),($4,$5,'phone',$6,NULL),($7,$8,'phone',$9,NOW())", [
      verifiedIdentifier, verifiedAccount, verifiedPhone,
      unverifiedIdentifier, unverifiedAccount, unverifiedPhone,
      blockedIdentifier, blockedAccount, blockedPhone,
    ]);

    const verifiedRes = await service.requestChallenge(verifiedPhone);
    const unverifiedRes = await service.requestChallenge(unverifiedPhone);
    const blockedRes = await service.requestChallenge(blockedPhone);
    const newRes = await service.requestChallenge(newPhone);

    for (const res of [verifiedRes, unverifiedRes, blockedRes, newRes]) {
      assert.deepEqual(Object.keys(res).sort(), ["accepted", "challenge_reference", "expires_in_seconds"]);
      assert.equal(res.accepted, true);
      assert.equal(res.expires_in_seconds, 300);
      assert.match(res.challenge_reference, PROFESSIONAL_AUTH_REFERENCE_PATTERN);
    }

    assert.equal((await query<{ count: number }>("SELECT count(*)::int count FROM professional_auth_challenges WHERE account_identifier_id = $1", [blockedIdentifier])).rows[0]!.count, 0);
    assert.equal((await query<{ count: number }>("SELECT count(*)::int count FROM accounts a JOIN account_identifiers i ON i.account_id = a.id WHERE i.normalized_value = $1", [blockedPhone])).rows[0]!.count, 1);

    const newAccountRows = (await query<{ id: string; verified_at: Date | null }>("SELECT a.id, i.verified_at FROM accounts a JOIN account_identifiers i ON i.account_id = a.id WHERE i.normalized_value = $1", [newPhone])).rows;
    assert.equal(newAccountRows.length, 1);
    assert.equal(newAccountRows[0]!.verified_at, null);

    const unverifiedAccountRows = (await query<{ id: string }>("SELECT a.id FROM accounts a JOIN account_identifiers i ON i.account_id = a.id WHERE i.normalized_value = $1", [unverifiedPhone])).rows;
    assert.equal(unverifiedAccountRows.length, 1);
    assert.equal((await query<{ count: number }>("SELECT count(*)::int count FROM professional_auth_challenges WHERE account_identifier_id = $1", [unverifiedIdentifier])).rows[0]!.count, 1);
  });
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

test("signup flow: provisional account, unverified identifier, challenge creation, wrong OTP keeps unverified, correct OTP verifies and creates session", async () => {
  await rolledBack(async () => {
    const service = new ProfessionalAuthService(new PostgresProfessionalAuthRepository(), pepper);
    const newPhone = `+5568${String(Date.now()).slice(-9)}`;

    const challenge = await service.requestChallenge(newPhone);
    assert.equal(challenge.accepted, true);

    const identifierRows = (await query<{ id: string; account_id: string; verified_at: Date | null }>(
      "SELECT id, account_id, verified_at FROM account_identifiers WHERE normalized_value = $1",
      [newPhone],
    )).rows;
    assert.equal(identifierRows.length, 1);
    const identifier = identifierRows[0]!;
    assert.equal(identifier.verified_at, null);

    const accountRows = (await query<{ id: string; status: string }>(
      "SELECT id, status FROM accounts WHERE id = $1",
      [identifier.account_id],
    )).rows;
    assert.equal(accountRows.length, 1);
    assert.equal(accountRows[0]!.status, "active");

    const outboundRows = (await query<{ id: string; text_content: string }>(
      "SELECT o.id, o.text_content FROM channel_outbound_messages o JOIN professional_auth_challenges c ON c.outbound_id = o.id WHERE c.account_identifier_id = $1",
      [identifier.id],
    )).rows;
    assert.equal(outboundRows.length, 1);

    const invalidResult = await service.verify(challenge.challenge_reference, "000000");
    assert.equal(invalidResult.ok, false);
    const afterInvalidIdentifier = (await query<{ verified_at: Date | null }>(
      "SELECT verified_at FROM account_identifiers WHERE id = $1",
      [identifier.id],
    )).rows[0]!;
    assert.equal(afterInvalidIdentifier.verified_at, null);

    const message = decryptAuthMessage(pepper, outboundRows[0]!.text_content);
    const code = /\b(\d{6})\b/u.exec(message)?.[1];
    assert.ok(code);

    const validResult = await service.verify(challenge.challenge_reference, code);
    assert.equal(validResult.ok, true);
    if (!validResult.ok) return;

    const afterValidIdentifier = (await query<{ verified_at: Date | null }>(
      "SELECT verified_at FROM account_identifiers WHERE id = $1",
      [identifier.id],
    )).rows[0]!;
    assert.ok(afterValidIdentifier.verified_at);

    const session = await service.authenticate(validResult.session_token);
    assert.ok(session);
    assert.equal(session.accountId, identifier.account_id);
  });
});

test("concurrent signup for the same new phone results in exactly 1 account and 1 identifier", async () => {
  const service = new ProfessionalAuthService(new PostgresProfessionalAuthRepository(), pepper);
  const concurrentPhone = `+5567${String(Date.now()).slice(-9)}`;

  try {
    const [res1, res2] = await Promise.all([
      service.requestChallenge(concurrentPhone),
      service.requestChallenge(concurrentPhone),
    ]);

    assert.equal(res1.accepted, true);
    assert.equal(res2.accepted, true);

    const accounts = (await query<{ id: string }>(
      "SELECT a.id FROM accounts a JOIN account_identifiers i ON i.account_id = a.id WHERE i.normalized_value = $1",
      [concurrentPhone],
    )).rows;
    assert.equal(accounts.length, 1);

    const identifiers = (await query<{ id: string }>(
      "SELECT id FROM account_identifiers WHERE normalized_value = $1",
      [concurrentPhone],
    )).rows;
    assert.equal(identifiers.length, 1);
  } finally {
    const ident = (await query<{ id: string; account_id: string }>(
      "SELECT id, account_id FROM account_identifiers WHERE normalized_value = $1",
      [concurrentPhone],
    )).rows[0];
    if (ident) {
      await query("DELETE FROM professional_auth_challenges WHERE account_identifier_id = $1", [ident.id]);
      await query("DELETE FROM channel_outbound_messages WHERE recipient_phone_e164 = $1", [concurrentPhone]);
      await query("DELETE FROM account_identifiers WHERE id = $1", [ident.id]);
      await query("DELETE FROM accounts WHERE id = $1", [ident.account_id]);
    }
  }
});

test("claim discovery: listClaimableProfiles finds legacy unmanaged profiles matching verified phone and excludes invalid candidates", async () => {
  await rolledBack(async () => {
    const service = new ProfessionalAuthService(new PostgresProfessionalAuthRepository(), pepper);
    const accountId = randomUUID();
    const verifiedPhone = `+5566${String(Date.now()).slice(-9)}`;
    const unverifiedPhone = `+5565${String(Date.now()).slice(-9)}`;

    await query("INSERT INTO accounts(id, status) VALUES($1, 'active')", [accountId]);
    await query("INSERT INTO account_identifiers(account_id, kind, normalized_value, verified_at) VALUES($1, 'phone', $2, NOW()), ($1, 'phone', $3, NULL)", [
      accountId,
      verifiedPhone,
      unverifiedPhone,
    ]);

    const prof1 = randomUUID();
    await query("INSERT INTO professionals(id, display_name, slug, phone_e164, status, management_mode) VALUES($1, 'Prof 1', $2, $3, 'active', 'legacy_unmanaged')", [
      prof1,
      `claimable-1-${prof1}`,
      verifiedPhone,
    ]);

    const prof2 = randomUUID();
    await query("INSERT INTO professionals(id, display_name, slug, phone_e164, status, management_mode) VALUES($1, 'Prof 2', $2, $3, 'active', 'legacy_unmanaged')", [
      prof2,
      `claimable-2-${prof2}`,
      unverifiedPhone,
    ]);

    const prof3 = randomUUID();
    const otherAccount = randomUUID();
    await query("INSERT INTO accounts(id, status) VALUES($1, 'active')", [otherAccount]);
    await query("INSERT INTO professionals(id, display_name, slug, phone_e164, status, management_mode) VALUES($1, 'Prof 3', $2, $3, 'active', 'legacy_unmanaged')", [
      prof3,
      `claimable-3-${prof3}`,
      verifiedPhone,
    ]);
    await query("INSERT INTO professional_memberships(account_id, professional_id, role, status) VALUES($1, $2, 'owner', 'active')", [
      otherAccount,
      prof3,
    ]);

    const prof4 = randomUUID();
    await query("INSERT INTO professionals(id, display_name, slug, phone_e164, status, management_mode) VALUES($1, 'Prof 4', $2, $3, 'active', 'account_managed')", [
      prof4,
      `claimable-4-${prof4}`,
      verifiedPhone,
    ]);

    const claimable = await service.listClaimableProfiles(accountId);
    assert.equal(claimable.length, 1);
    assert.equal(claimable[0]!.id, prof1);
    assert.equal(claimable[0]!.display_name, "Prof 1");
  });
});

test("claim transaction: claimProfile updates management_mode atomically, creates owner membership with legacy_claim audit, and handles idempotency and conflicts", async () => {
  await rolledBack(async () => {
    const repository = new PostgresProfessionalAuthRepository();
    const accountId = randomUUID();
    const phone = `+5564${String(Date.now()).slice(-9)}`;

    await query("INSERT INTO accounts(id, status) VALUES($1, 'active')", [accountId]);
    await query("INSERT INTO account_identifiers(account_id, kind, normalized_value, verified_at) VALUES($1, 'phone', $2, NOW())", [
      accountId,
      phone,
    ]);

    const profId = randomUUID();
    await query("INSERT INTO professionals(id, display_name, slug, phone_e164, status, management_mode) VALUES($1, 'Prof Legacy', $2, $3, 'active', 'legacy_unmanaged')", [
      profId,
      `legacy-${profId}`,
      phone,
    ]);

    const result = await repository.claimProfile(accountId, profId);
    assert.equal(result.claimed, true);
    assert.equal(result.professional.id, profId);

    const updatedProf = (await query<{ management_mode: string }>("SELECT management_mode FROM professionals WHERE id = $1", [profId])).rows[0]!;
    assert.equal(updatedProf.management_mode, "account_managed");

    const membership = (await query<{ role: string; status: string }>(
      "SELECT role, status FROM professional_memberships WHERE account_id = $1 AND professional_id = $2",
      [accountId, profId],
    )).rows[0]!;
    assert.deepEqual(membership, { role: "owner", status: "active" });

    const event = (await query<{ action: string; new_role: string; new_status: string; actor_account_id: string; source: string }>(
      "SELECT action, new_role, new_status, actor_account_id, source FROM professional_membership_events WHERE account_id = $1 AND professional_id = $2",
      [accountId, profId],
    )).rows[0]!;
    assert.deepEqual(event, {
      action: "created",
      new_role: "owner",
      new_status: "active",
      actor_account_id: accountId,
      source: "legacy_claim",
    });

    const secondClaim = await repository.claimProfile(accountId, profId);
    assert.equal(secondClaim.claimed, true);
    assert.equal(secondClaim.professional.id, profId);
    const membershipCount = (await query<{ count: number }>(
      "SELECT count(*)::int count FROM professional_memberships WHERE professional_id = $1",
      [profId],
    )).rows[0]!.count;
    assert.equal(membershipCount, 1);

    const competitorId = randomUUID();
    const competitorPhone = `+5563${String(Date.now()).slice(-9)}`;
    await query("INSERT INTO accounts(id, status) VALUES($1, 'active')", [competitorId]);
    await query("INSERT INTO account_identifiers(account_id, kind, normalized_value, verified_at) VALUES($1, 'phone', $2, NOW())", [
      competitorId,
      competitorPhone,
    ]);
    await assert.rejects(
      repository.claimProfile(competitorId, profId),
      /claim_conflict/u,
    );

    await assert.rejects(
      repository.claimProfile(accountId, randomUUID()),
      /professional_not_found/u,
    );
  });
});

test("selective matching guard: legacy_unmanaged with zero memberships matched; account_managed requires active membership and verified identity; claimed legacy transitions cleanly", async () => {
  await rolledBack(async () => {
    const matching = new PostgresMatchingRepository();
    const categoryId = randomUUID(), serviceId = randomUUID();
    await query("INSERT INTO service_categories(id, name, slug) VALUES($1, 'Guard category', $2)", [categoryId, `cat-${categoryId}`]);
    await query("INSERT INTO services(id, category_id, name, slug) VALUES($1, $2, 'Guard service', $3)", [serviceId, categoryId, `srv-${serviceId}`]);

    const search = () => matching.search({
      raw_text: "serviço guard",
      service_id: serviceId,
      latitude: -11.8,
      longitude: -55.5,
      city: "Sinop",
      state: "MT",
      limit: 10,
    });

    const legacyProfId = randomUUID();
    await query("INSERT INTO professionals(id, display_name, slug, phone_e164, status, management_mode) VALUES($1, 'Legacy Unmanaged', $2, '+5566999990001', 'active', 'legacy_unmanaged')", [
      legacyProfId,
      `slug-leg-${legacyProfId}`,
    ]);
    await query("INSERT INTO professional_services(professional_id, service_id) VALUES($1, $2)", [legacyProfId, serviceId]);
    await query("INSERT INTO professional_service_areas(professional_id, city, state, country_code, center, radius_meters, is_primary) VALUES($1, 'Sinop', 'MT', 'BR', ST_SetSRID(ST_MakePoint(-55.5, -11.8), 4326)::geography, 50000, TRUE)", [legacyProfId]);

    const res1 = await search();
    assert.equal(res1.kind, "success");
    if (res1.kind === "success") {
      assert.ok(res1.response.matches.some(m => m.professional.id === legacyProfId));
    }

    const managedProfId = randomUUID();
    await query("INSERT INTO professionals(id, display_name, slug, phone_e164, status, management_mode) VALUES($1, 'Managed Profile', $2, '+5566999990002', 'active', 'account_managed')", [
      managedProfId,
      `slug-man-${managedProfId}`,
    ]);
    await query("INSERT INTO professional_services(professional_id, service_id) VALUES($1, $2)", [managedProfId, serviceId]);
    await query("INSERT INTO professional_service_areas(professional_id, city, state, country_code, center, radius_meters, is_primary) VALUES($1, 'Sinop', 'MT', 'BR', ST_SetSRID(ST_MakePoint(-55.5, -11.8), 4326)::geography, 50000, TRUE)", [managedProfId]);

    const res2 = await search();
    assert.equal(res2.kind, "success");
    if (res2.kind === "success") {
      assert.equal(res2.response.matches.some(m => m.professional.id === managedProfId), false);
    }

    const accountId = randomUUID();
    await query("INSERT INTO accounts(id, status) VALUES($1, 'active')", [accountId]);
    await query("INSERT INTO account_identifiers(account_id, kind, normalized_value, verified_at) VALUES($1, 'phone', '+5566999990002', NOW())", [accountId]);
    await query("INSERT INTO professional_memberships(account_id, professional_id, role, status) VALUES($1, $2, 'owner', 'active')", [accountId, managedProfId]);

    const res3 = await search();
    assert.equal(res3.kind, "success");
    if (res3.kind === "success") {
      assert.ok(res3.response.matches.some(m => m.professional.id === managedProfId));
    }

    await query("UPDATE accounts SET status = 'blocked' WHERE id = $1", [accountId]);
    const res4 = await search();
    assert.equal(res4.kind, "success");
    if (res4.kind === "success") {
      assert.equal(res4.response.matches.some(m => m.professional.id === managedProfId), false);
    }

    const account2Id = randomUUID();
    await query("INSERT INTO accounts(id, status) VALUES($1, 'active')", [account2Id]);
    await query("INSERT INTO account_identifiers(account_id, kind, normalized_value, verified_at) VALUES($1, 'phone', '+5566999990003', NOW())", [account2Id]);
    await query("INSERT INTO professional_memberships(account_id, professional_id, role, status) VALUES($1, $2, 'admin', 'active')", [account2Id, managedProfId]);

    const res5 = await search();
    assert.equal(res5.kind, "success");
    if (res5.kind === "success") {
      assert.ok(res5.response.matches.some(m => m.professional.id === managedProfId));
    }

    await query("UPDATE professional_memberships SET status = 'revoked' WHERE account_id = $1 AND professional_id = $2", [account2Id, managedProfId]);
    const res6 = await search();
    assert.equal(res6.kind, "success");
    if (res6.kind === "success") {
      assert.equal(res6.response.matches.some(m => m.professional.id === managedProfId), false);
    }

    const claimedProfId = randomUUID();
    const claimPhone = `+5566${String(Date.now()).slice(-9)}`;
    await query("INSERT INTO professionals(id, display_name, slug, phone_e164, status, management_mode) VALUES($1, 'Claim Transition', $2, $3, 'active', 'legacy_unmanaged')", [
      claimedProfId,
      `slug-claim-${claimedProfId}`,
      claimPhone,
    ]);
    await query("INSERT INTO professional_services(professional_id, service_id) VALUES($1, $2)", [claimedProfId, serviceId]);
    await query("INSERT INTO professional_service_areas(professional_id, city, state, country_code, center, radius_meters, is_primary) VALUES($1, 'Sinop', 'MT', 'BR', ST_SetSRID(ST_MakePoint(-55.5, -11.8), 4326)::geography, 50000, TRUE)", [claimedProfId]);

    const res7 = await search();
    assert.equal(res7.kind, "success");
    if (res7.kind === "success") {
      assert.ok(res7.response.matches.some(m => m.professional.id === claimedProfId));
    }

    const claimAccount = randomUUID();
    await query("INSERT INTO accounts(id, status) VALUES($1, 'active')", [claimAccount]);
    await query("INSERT INTO account_identifiers(account_id, kind, normalized_value, verified_at) VALUES($1, 'phone', $2, NOW())", [claimAccount, claimPhone]);
    const repo = new PostgresProfessionalAuthRepository();
    const claimRes = await repo.claimProfile(claimAccount, claimedProfId);
    assert.equal(claimRes.claimed, true);

    const res8 = await search();
    assert.equal(res8.kind, "success");
    if (res8.kind === "success") {
      assert.ok(res8.response.matches.some(m => m.professional.id === claimedProfId));
    }

    await query("UPDATE professional_memberships SET status = 'revoked' WHERE account_id = $1 AND professional_id = $2", [claimAccount, claimedProfId]);
    const res9 = await search();
    assert.equal(res9.kind, "success");
    if (res9.kind === "success") {
      assert.equal(res9.response.matches.some(m => m.professional.id === claimedProfId), false);
    }
  });
});
