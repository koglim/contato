import { randomUUID } from 'node:crypto';
import { mediaClaimSchema, mediaSummarySchema, type MediaAdmission, type MediaResult } from '@contatocerto/shared';
import { withTransaction, type DatabaseClient } from '../../database/connection.js';
import { createIndependentOutbound } from '../channel-outbox/channel-outbox.repository.js';
import { classifyMedia, fingerprint, MEDIA_LEASE_SECONDS, MEDIA_MAX_ATTEMPTS, MEDIA_NOTICES } from './channel-media.policy.js';

type MediaRow={id:string;inbound_id:string;event_fingerprint:string;media_hash:string;status:string;media_bytes:Buffer|null;
  mime_type:string;processing_token:string|null;lease_expires_at:Date|null;transcript:string|null;transcription_provider:string|null;
  result_token_hash:string|null;notice_outbound_id:string|null};
const summary=(row:MediaRow,duplicate=false)=>mediaSummarySchema.parse({id:row.id,status:row.status,duplicate});

async function quarantine(db:DatabaseClient,row:MediaRow,reason:'payload_conflict'|'transcript_conflict',hash:string) {
  await db.query(`UPDATE channel_media_events SET status='quarantined',processing_token=NULL,lease_expires_at=NULL,
    media_bytes=NULL,purged_at=COALESCE(purged_at,clock_timestamp()),purge_reason=COALESCE(purge_reason,'quarantined'),last_error_code=$2 WHERE id=$1`,[row.id,reason]);
  await db.query(`UPDATE channel_inbound_messages SET recovery_state='quarantined',quarantined_at=clock_timestamp(),
    recovery_reason=$2,next_attempt_at=NULL WHERE id=$1`,[row.inbound_id,reason]);
  await db.query(`INSERT INTO channel_transport_events(media_id,event_key,action,reason,payload_hash,result)
    VALUES($1,$2,$3,$3,$4,'{}') ON CONFLICT(media_id,event_key) DO NOTHING`,[row.id,`${reason}_${hash}`,reason,hash]);
}

async function notice(db:DatabaseClient,row:MediaRow,reason:keyof typeof MEDIA_NOTICES,purgeReason='completed') {
  const inbound=(await db.query<{provider:string;phone_e164:string}>(`SELECT provider,phone_e164 FROM channel_inbound_messages WHERE id=$1`,[row.inbound_id])).rows[0];
  const outbound=await createIndependentOutbound(db,{businessKey:`channel-media:${row.id}`,purpose:'channel_notice',provider:inbound.provider,
    recipientPhoneE164:inbound.phone_e164,textContent:MEDIA_NOTICES[reason]});
  await db.query(`UPDATE channel_media_events SET status='failed',notice_outbound_id=$2,last_error_code=$3,media_bytes=NULL,
    purged_at=COALESCE(purged_at,clock_timestamp()),purge_reason=COALESCE(purge_reason,$4),processing_token=NULL,lease_expires_at=NULL,completed_at=clock_timestamp() WHERE id=$1`,[row.id,outbound.id,reason,purgeReason]);
  // A channel notice closes the placeholder, never calls the router or fabricates a domain result.
  await db.query(`UPDATE channel_inbound_messages SET media_pending=FALSE,status='failed',recovery_state='closed',
    recovery_reason=$2,quarantined_at=clock_timestamp(),next_attempt_at=NULL WHERE id=$1`,[row.inbound_id,reason]);
  return summary({...row,status:'failed'});
}

export class ChannelMediaService {
  constructor(private readonly contextualEnabled=false) {}
  async admit(input:MediaAdmission) {
    const media=classifyMedia(input);
    const hash=fingerprint(JSON.stringify([input.provider,input.provider_message_id,input.phone_e164,input.country_code,input.limit,media.hash,media.mime,input.duration_seconds]));
    return withTransaction(async db=>{
      const inserted=await db.query<{id:string}>(`INSERT INTO channel_inbound_messages(provider,provider_message_id,phone_e164,raw_text,country_code,limit_value,media_pending,contextual_queue)
        VALUES($1,$2,$3,'[audio pending]',$4,$5,TRUE,$6) ON CONFLICT(provider,provider_message_id) DO NOTHING RETURNING id`,
      [input.provider,input.provider_message_id,input.phone_e164,input.country_code,input.limit,this.contextualEnabled]);
      if (!inserted.rows[0]) {
        const existing=(await db.query<MediaRow>(`SELECT m.* FROM channel_media_events m JOIN channel_inbound_messages i ON i.id=m.inbound_id
          WHERE i.provider=$1 AND i.provider_message_id=$2 FOR UPDATE OF m`,[input.provider,input.provider_message_id])).rows[0];
        if (!existing) return {error:'channel_message_payload_conflict'};
        if (existing.event_fingerprint!==hash) { await quarantine(db,existing,'payload_conflict',hash); return {error:'media_payload_conflict'}; }
        return {response:summary(existing,true)};
      }
      const row=(await db.query<MediaRow>(`INSERT INTO channel_media_events(inbound_id,event_fingerprint,media_hash,mime_type,duration_seconds,status,media_bytes)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[inserted.rows[0].id,hash,media.hash,media.mime,input.duration_seconds,
        media.reason?'failed':'pending',media.bytes])).rows[0];
      return {response:media.reason?await notice(db,row,media.reason,'invalid'):summary(row)};
    });
  }

  async claimNext() {
    await this.purge();
    return withTransaction(async db=>{
      const row=(await db.query<MediaRow>(`SELECT * FROM channel_media_events WHERE expires_at>clock_timestamp() AND attempt_count<$1
        AND (status='pending' OR (status='processing' AND lease_expires_at<=clock_timestamp()))
        ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,[MEDIA_MAX_ATTEMPTS])).rows[0];
      if (!row) return null;
      const token=randomUUID();
      await db.query(`UPDATE channel_media_events SET status='processing',processing_token=$2,
        lease_expires_at=clock_timestamp()+($3*INTERVAL '1 second'),attempt_count=attempt_count+1 WHERE id=$1`,[row.id,token,MEDIA_LEASE_SECONDS]);
      const tokenHash=fingerprint(token);
      await db.query(`INSERT INTO channel_transport_events(media_id,event_key,action,reason,payload_hash,result)
        VALUES($1,$2,'media_claim','lease_reserved',$3,'{}')`,[row.id,`claim_${tokenHash}`,tokenHash]);
      return mediaClaimSchema.parse({id:row.id,processing_token:token,media_hash:row.media_hash,mime_type:row.mime_type,audio_base64:row.media_bytes!.toString('base64')});
    });
  }

  async complete(id:string,input:MediaResult) {
    return withTransaction(async db=>{
      const row=(await db.query<MediaRow>('SELECT * FROM channel_media_events WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (!row) return {error:'media_not_found'};
      const tokenHash=fingerprint(input.processing_token);
      const known=(await db.query('SELECT id FROM channel_transport_events WHERE media_id=$1 AND event_key=$2',[id,`claim_${tokenHash}`])).rows.length>0;
      if (!known || input.media_hash!==row.media_hash) return {error:'media_claim_invalid'};
      if (row.result_token_hash) {
        const identical=input.result.status==='transcribed' ? row.transcript===input.result.text && row.transcription_provider===input.result.provider
          : row.transcript===null && row.notice_outbound_id!==null;
        if (!identical) {await quarantine(db,row,'transcript_conflict',fingerprint(JSON.stringify(input.result))); return {error:'media_result_conflict'};}
        return {response:summary(row,true)};
      }
      if (row.status!=='processing' || row.processing_token!==input.processing_token || !row.lease_expires_at || row.lease_expires_at.getTime()<=Date.now()) return {error:'media_claim_invalid'};
      await db.query('UPDATE channel_media_events SET result_token_hash=$2 WHERE id=$1',[id,tokenHash]);
      if (input.result.status==='failed') return {response:await notice(db,row,'transcription_unavailable')};
      const changed=await db.query(`UPDATE channel_inbound_messages SET raw_text=$2,media_pending=FALSE WHERE id=$1 AND media_pending AND status='received' AND recovery_state='active' RETURNING id`,[row.inbound_id,input.result.text]);
      if (!changed.rows.length) throw new Error('media_placeholder_invalid');
      await db.query(`UPDATE channel_media_events SET status='completed',transcript=$2,transcription_provider=$3,media_bytes=NULL,
        purged_at=clock_timestamp(),purge_reason='completed',processing_token=NULL,lease_expires_at=NULL,completed_at=clock_timestamp() WHERE id=$1`,[id,input.result.text,input.result.provider]);
      return {response:summary({...row,status:'completed'})};
    });
  }

  async purge() {
    return withTransaction(async db=>{
      const rows=(await db.query<MediaRow & {expired:boolean}>(`SELECT *,expires_at<=clock_timestamp() AS expired FROM channel_media_events
        WHERE media_bytes IS NOT NULL AND (expires_at<=clock_timestamp() OR (status='processing' AND lease_expires_at<=clock_timestamp() AND attempt_count>=$1))
        ORDER BY expires_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`,[MEDIA_MAX_ATTEMPTS])).rows;
      for (const row of rows) await notice(db,row,row.expired?'media_expired':'transcription_unavailable',row.expired?'retention':'completed');
      return {purged:rows.length};
    });
  }
}
