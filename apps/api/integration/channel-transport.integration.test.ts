import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { buildApp } from '../src/app.js';
import { query,withTransaction,closeDatabaseConnection,inDatabaseTransaction } from '../src/database/connection.js';
import { ChannelMediaService } from '../src/modules/channel-media/channel-media.service.js';
import { PostgresChannelOutboundMessageRepository } from '../src/modules/channel-outbox/channel-outbox.repository.js';
import { PostgresChannelInboundMessageRepository } from '../src/modules/channel-inbox/channel-inbox.repository.js';
import { mediaSummarySchema,transportDiagnosticsSchema } from '@contatocerto/shared';
import { rollbackThrough } from './rollback-helper.js';
import { transcriptionDecision } from '../../../workflows/n8n/gateway-contract.mjs';
import { claimDecision,transportDecision } from '../../../workflows/n8n/delivery-contract.mjs';

after(closeDatabaseConnection);
const headers={'x-internal-key':'transport-fixture'};
const media=new ChannelMediaService(),outbox=new PostgresChannelOutboundMessageRepository(),inbox=new PostgresChannelInboundMessageRepository();
async function fixture(){
  const provider=`media-${randomUUID()}`,phone=`+5566${BigInt('0x'+randomUUID().replaceAll('-','').slice(0,8)).toString().padStart(10,'0')}`;
  const input={provider,provider_message_id:randomUUID(),phone_e164:phone,country_code:'BR',limit:3,
    audio_base64:Buffer.from('OggS synthetic audio').toString('base64'),mime_type:'audio/ogg',duration_seconds:10};
  const app=buildApp({internalApiKey:headers['x-internal-key']});
  const post=(path:string,payload?:unknown)=>app.inject({method:'POST',url:'/internal/channel'+path,headers,payload});
  const state=async(id:string)=>(await query('SELECT * FROM channel_media_events WHERE id=$1',[id])).rows[0];
  const cleanup=async()=>{
    await app.close();
    await withTransaction(async db=>{
      // Append-only evidence is never deleted by the API. Serial disposable CI fixture teardown uses TRUNCATE.
      await db.query('TRUNCATE channel_transport_events');
      await db.query('DELETE FROM channel_media_events WHERE inbound_id IN (SELECT id FROM channel_inbound_messages WHERE provider=$1)',[provider]);
      await db.query('DELETE FROM channel_inbound_recovery_events WHERE inbound_id IN (SELECT id FROM channel_inbound_messages WHERE provider=$1)',[provider]);
      await db.query('DELETE FROM channel_inbound_messages WHERE provider=$1',[provider]);
      await db.query('DELETE FROM channel_outbound_messages WHERE provider=$1',[provider]);
      await db.query('DELETE FROM customers WHERE phone_e164=$1',[phone]);
    });
  };
  return {input,app,post,state,cleanup,provider,phone};
}

for(const [label,changes,reason] of [
  ['long',{duration_seconds:121},'audio_too_long'],['base64',{audio_base64:'@@@='},'media_invalid'],
  ['MIME',{mime_type:'text/html'},'unsupported_format'],['signature',{audio_base64:Buffer.from('not ogg').toString('base64')},'media_invalid'],
] as const) test(`durable ${label} notice survives webhook replay, lost ACK and concurrent admission`,async()=>{
  const f=await fixture();try{
    const payload={...f.input,...changes};
    const responses=await Promise.all([f.post('/media/events',payload),f.post('/media/events',payload)]);
    for(const r of responses){assert.equal(r.statusCode,200,r.body);mediaSummarySchema.parse(r.json());}
    assert.equal(responses[0].json().id,responses[1].json().id);
    assert.equal(responses.filter(r=>r.json().duplicate).length,1);
    const again=await f.post('/media/events',payload);assert.equal(again.json().duplicate,true);
    const row=await f.state(again.json().id);assert.equal(row.last_error_code,reason);assert.equal(row.media_bytes,null);
    const messages=(await query('SELECT * FROM channel_outbound_messages WHERE provider=$1',[f.provider])).rows;
    assert.equal(messages.length,1);assert.equal(messages[0].purpose,'channel_notice');assert.equal(messages[0].id,row.notice_outbound_id);
    const inbound=(await query('SELECT status,recovery_state,result FROM channel_inbound_messages WHERE provider=$1',[f.provider])).rows;
    assert.deepEqual(inbound,[{status:'failed',recovery_state:'closed',result:null}]);
    assert.equal(await inbox.claimNext(60),null);assert.equal(await media.claimNext(),null);
    const claim=await f.post(`/outbound/${row.notice_outbound_id}/claim`);assert.equal(claim.statusCode,200,claim.body);
    const authorized=claimDecision({statusCode:200,body:claim.body},f.provider);assert.equal(authorized.action,'send');
    const outcome=transportDecision({error:'timeout'},authorized.message);assert.equal(outcome.action,'hold');
    assert.equal((await f.post(`/outbound/${row.notice_outbound_id}/hold`,outcome.payload)).statusCode,200);
    assert.equal(await outbox.claimNextPending(randomUUID(),60),null);
  }finally{await f.cleanup();}
});

test('audio persistence rolls back on crash before commit and resumes after commit without webhook',async()=>{
  const f=await fixture();try{
    await assert.rejects(withTransaction(db=>inDatabaseTransaction(db,async()=>{await media.admit(f.input);throw new Error('synthetic crash');})),/synthetic crash/);
    assert.equal((await query('SELECT id FROM channel_inbound_messages WHERE provider=$1',[f.provider])).rows.length,0);
    const admitted=await media.admit(f.input);assert.ok(admitted.response);
    const id=admitted.response.id;
    const claimed=await media.claimNext();assert.equal(claimed?.id,id);
    assert.equal((await media.admit(f.input)).response?.duplicate,true);
    const outcome=transcriptionDecision({statusCode:200,body:{text:'ajuda'}},claimed,false);
    await assert.rejects(withTransaction(db=>inDatabaseTransaction(db,async()=>{await media.complete(id,outcome.payload);throw new Error('crash');})),/crash/);
    assert.equal((await f.state(id)).status,'processing');
    assert.equal((await media.complete(id,outcome.payload)).response?.status,'completed');
    assert.equal((await media.complete(id,outcome.payload)).response?.duplicate,true);
    assert.equal((await f.state(id)).media_bytes,null);
    // Consumer crash after commit: recovery executes the real Inbox once, independently of webhook/transcription.
    const processed=await f.post('/inbound/next/process');assert.equal(processed.statusCode,200,processed.body);assert.equal(processed.json().status,'processed');
    assert.equal((await f.post('/inbound/next/process')).statusCode,204);
    assert.equal((await query('SELECT id FROM channel_outbound_messages WHERE provider=$1',[f.provider])).rows.length,1);
    assert.equal((await media.admit(f.input)).response?.duplicate,true);
  }finally{await f.cleanup();}
});

test('two media consumers cannot hold the same lease; expiry resumes and old token is fenced',async()=>{
  const f=await fixture();try{
    const id=(await media.admit(f.input)).response!.id;
    const claims=await Promise.all([media.claimNext(),media.claimNext()]);assert.equal(claims.filter(Boolean).length,1);
    const first=claims.find(Boolean)!;
    await query("UPDATE channel_media_events SET lease_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",[id]);
    const next=await media.claimNext();assert.equal(next?.id,id);assert.notEqual(next?.processing_token,first.processing_token);
    const complete=(claim:typeof first,text='ajuda')=>media.complete(id,transcriptionDecision({statusCode:200,body:{text}},claim,false).payload);
    assert.equal((await complete(first)).error,'media_claim_invalid');
    assert.equal((await complete(next!)).response?.status,'completed');
    assert.equal((await complete(first,'cancelar')).error,'media_result_conflict');
    const row=await f.state(id);assert.equal(row.status,'quarantined');assert.equal(row.transcript,'ajuda');
    assert.equal(await inbox.claimNext(60),null);
    const persisted=(await query('SELECT raw_text,recovery_state FROM channel_inbound_messages WHERE id=$1',[row.inbound_id])).rows[0];
    assert.deepEqual(persisted,{raw_text:'ajuda',recovery_state:'quarantined'});
    assert.equal((await f.post('/media/events',{...f.input,audio_base64:Buffer.from('OggS different').toString('base64')})).statusCode,409);
  }finally{await f.cleanup();}
});

test('parallel consumers claim different media while Inbox preserves admission order',async()=>{
  const f=await fixture();try{
    const first=(await media.admit(f.input)).response!.id;
    const second=(await media.admit({...f.input,provider_message_id:randomUUID()})).response!.id;
    const claims=await Promise.all([media.claimNext(),media.claimNext()]);
    assert.deepEqual(claims.map(c=>c!.id).sort(),[first,second].sort());
    assert.equal(new Set(claims.map(c=>c!.processing_token)).size,2);
    const later=claims.find(c=>c!.id===second)!;
    await media.complete(second,transcriptionDecision({statusCode:200,body:{text:'ajuda'}},later,false).payload);
    assert.equal(await inbox.claimNext(60),null);
    const earlier=claims.find(c=>c!.id===first)!;
    await media.complete(first,transcriptionDecision({statusCode:200,body:{text:'ajuda'}},earlier,false).payload);
    const row=await inbox.claimNext(60);assert.equal(row?.id,(await f.state(first)).inbound_id);
  }finally{await f.cleanup();}
});

for(const fallbackWorks of [true,false]) test(`durable transcription primary failure, fallback ${fallbackWorks?'success':'failure'}`,async()=>{
  const f=await fixture();try{
    const id=(await media.admit(f.input)).response!.id,claim=await media.claimNext();
    assert.equal(transcriptionDecision({error:'timeout'},claim,false).action,'fallback');
    const result=transcriptionDecision(fallbackWorks?{statusCode:200,body:{text:'ajuda'}}:{statusCode:503},claim,true);
    const response=await f.post(`/media/${id}/result`,result.payload);assert.equal(response.statusCode,200,response.body);
    assert.equal((await f.post(`/media/${id}/result`,result.payload)).json().duplicate,true);
    const row=await f.state(id);assert.equal(row.status,fallbackWorks?'completed':'failed');assert.equal(row.media_bytes,null);
    assert.equal(row.transcription_provider,fallbackWorks?'openai':null);
    assert.equal((await query('SELECT id FROM channel_outbound_messages WHERE provider=$1',[f.provider])).rows.length,fallbackWorks?0:1);
  }finally{await f.cleanup();}
});

test('retention purges bytes and creates one notice; pending audio blocks later Inbox and notices preserve outbound FIFO',async()=>{
  const f=await fixture();try{
    const id=(await media.admit(f.input)).response!.id;
    const later=await inbox.createOrFind({...f.input,provider_message_id:randomUUID(),raw_text:'ajuda'});
    assert.equal(await inbox.claim(later.record.id,randomUUID(),60),null);
    await query("UPDATE channel_media_events SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",[id]);
    assert.deepEqual(await media.purge(),{purged:1});assert.deepEqual(await media.purge(),{purged:0});
    const row=await f.state(id);assert.equal(row.purge_reason,'retention');assert.equal(row.media_bytes,null);
    assert.equal((await f.post('/inbound/next/process')).json().status,'processed');
    const laterOutbound=(await query("SELECT id FROM channel_outbound_messages WHERE provider=$1 AND purpose='customer_reply'",[f.provider])).rows[0];
    assert.equal(await outbox.claim(laterOutbound.id,randomUUID(),60),null);
    const first=await outbox.claim(row.notice_outbound_id,randomUUID(),60);assert.ok(first);
    await outbox.markSent(first.id,{processing_token:first.processingToken!,provider_message_id:'notice-delivered'});
    assert.ok(await outbox.claim(laterOutbound.id,randomUUID(),60));
    const diagnostics=await f.app.inject({method:'GET',url:'/internal/channel/transport/diagnostics',headers});
    assert.equal(diagnostics.statusCode,200,diagnostics.body);transportDiagnosticsSchema.parse(diagnostics.json());
    assert.equal(diagnostics.json().audio.purged_by_retention,1);
    assert.doesNotMatch(diagnostics.body,/phone|raw_text|audio_base64|token|OggS|ajuda/);
  }finally{await f.cleanup();}
});

test('abandoned media is bounded by three claims and retires with one notice',async()=>{
  const f=await fixture();try{
    const id=(await media.admit(f.input)).response!.id;
    for(let i=0;i<3;i++){assert.equal((await media.claimNext())?.id,id);await query("UPDATE channel_media_events SET lease_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",[id]);}
    assert.equal(await media.claimNext(),null);assert.equal((await f.state(id)).attempt_count,3);
    assert.equal((await f.state(id)).status,'failed');assert.equal((await f.state(id)).media_bytes,null);
  }finally{await f.cleanup();}
});

for(const action of ['confirm','retry','close','retain'] as const) test(`administrative ${action} is evidenced, immutable, idempotent, fenced and not consent`,async()=>{
  const f=await fixture();try{
    const mediaId=(await media.admit({...f.input,duration_seconds:121})).response!.id;
    const id=(await f.state(mediaId)).notice_outbound_id;
    const claim=await outbox.claim(id,randomUUID(),60);assert.ok(claim);
    const receipt=action==='confirm'?'verified-provider-id':undefined;
    await outbox.holdDelivery(id,{processing_token:claim.processingToken!,reason:receipt?'confirmation_pending':'transport_outcome_unknown',provider_message_id:receipt});
    const laterMedia=(await media.admit({...f.input,provider_message_id:randomUUID(),duration_seconds:121})).response!.id;
    const laterId=(await f.state(laterMedia)).notice_outbound_id;
    assert.equal(await outbox.claim(laterId,randomUUID(),60),null);
    const payload={request_id:randomUUID(),operator_id:randomUUID(),action,reason:{confirm:'delivery_proven',retry:'non_delivery_proven',close:'delivery_impossible',retain:'evidence_insufficient'}[action],
      ...(action==='retain'?{}:{evidence_hash:'a'.repeat(64)}),...(receipt?{provider_message_id:receipt}:{})};
    const results=await Promise.all([f.post(`/outbound/${id}/disposition`,payload),f.post(`/outbound/${id}/disposition`,payload)]);
    for(const r of results)assert.equal(r.statusCode,200,r.body);
    assert.equal(results.filter(r=>r.json().duplicate).length,1);
    assert.equal(await outbox.markFailed(id,{processing_token:claim.processingToken!,error_code:'transport_failure'}),false);
    assert.equal(await outbox.markSent(id,{processing_token:claim.processingToken!,provider_message_id:receipt??'stale'}),false);
    assert.equal((await f.post(`/outbound/${id}/disposition`,{...payload,operator_id:randomUUID()})).statusCode,409);
    const row=(await query('SELECT * FROM channel_outbound_messages WHERE id=$1',[id])).rows[0];
    assert.equal(row.text_content,claim.textContent);assert.equal(row.recipient_phone_e164,f.phone);assert.equal(row.attempt_count,1);
    assert.equal(row.status,{confirm:'sent',retry:'pending',close:'failed',retain:'processing'}[action]);
    assert.equal(await outbox.claim(id,randomUUID(),60),null);
    const laterClaim=await outbox.claim(laterId,randomUUID(),60);
    assert.equal(Boolean(laterClaim),action==='confirm'||action==='close');
    if(action==='retry'){
      assert.ok(row.next_attempt_at>Date.now());
      await query("UPDATE channel_outbound_messages SET next_attempt_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",[id]);
      const retry=await outbox.claim(id,randomUUID(),60);assert.equal(retry?.attemptCount,2);
      await query("UPDATE channel_outbound_messages SET delivery_held_at=clock_timestamp()-INTERVAL '1 hour' WHERE id=$1",[id]);
      await outbox.holdDelivery(id,{processing_token:retry!.processingToken!,reason:'transport_outcome_unknown'});
      const age=(await query('SELECT extract(epoch FROM clock_timestamp()-delivery_held_at)::float8 AS seconds FROM channel_outbound_messages WHERE id=$1',[id])).rows[0].seconds;
      assert.ok(age<10,'a new hold measures its own age, while the prior hold remains in immutable audit');
    }
    const history=(await query('SELECT * FROM channel_transport_events WHERE outbound_id=$1 AND action=$2',[id,action])).rows;
    assert.equal(history.length,1);assert.equal(history[0].operator_id,payload.operator_id);
    await assert.rejects(query('UPDATE channel_transport_events SET reason=reason WHERE id=$1',[history[0].id]),/TRANSPORT_EVENT_IMMUTABLE/);
    await assert.rejects(query('DELETE FROM channel_transport_events WHERE id=$1',[history[0].id]),/TRANSPORT_EVENT_IMMUTABLE/);
  }finally{await f.cleanup();}
});

test('admin retry rejects missing evidence, exhausted attempts and recorded delivery receipts',async()=>{
  const f=await fixture();try{
    const m=(await media.admit({...f.input,duration_seconds:121})).response!,id=(await f.state(m.id)).notice_outbound_id;
    const claim=await outbox.claim(id,randomUUID(),60);await outbox.holdDelivery(id,{processing_token:claim!.processingToken!,reason:'transport_outcome_unknown'});
    const payload={request_id:randomUUID(),operator_id:randomUUID(),action:'retry',reason:'non_delivery_proven'};
    assert.equal((await f.post(`/outbound/${id}/disposition`,payload)).statusCode,400);
    await query('UPDATE channel_outbound_messages SET attempt_count=5 WHERE id=$1',[id]);
    assert.equal((await f.post(`/outbound/${id}/disposition`,{...payload,evidence_hash:'a'.repeat(64)})).json().error,'outbound_retry_unsafe');
    await query("UPDATE channel_outbound_messages SET attempt_count=1,provider_message_id='known-receipt' WHERE id=$1",[id]);
    assert.equal((await f.post(`/outbound/${id}/disposition`,{...payload,evidence_hash:'a'.repeat(64)})).json().error,'outbound_retry_unsafe');
  }finally{await f.cleanup();}
});

test('migration 020 refuses destructive rollback and preserves media, audit and schema',async()=>{
  const f=await fixture();try{
    const id=(await media.admit(f.input)).response!.id;
    await media.claimNext();
    const snapshot=async()=>(await query(`SELECT (SELECT md5(jsonb_agg(to_jsonb(m) ORDER BY id)::text) FROM channel_media_events m) media,
      (SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY id)::text) FROM channel_transport_events e) audit,
      (SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY id)::text) FROM pgmigrations p) migrations`)).rows;
    const before=await snapshot();
    await assert.rejects(rollbackThrough('020_add_durable_channel_media'),(e:unknown)=>{assert.ok(e instanceof Error && 'stderr' in e);assert.match(String(e.stderr),/P0020/);return true;});
    assert.deepEqual(await snapshot(),before);assert.ok((await f.state(id)).media_bytes);
  }finally{await f.cleanup();}
});
