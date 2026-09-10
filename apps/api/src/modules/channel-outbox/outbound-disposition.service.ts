import { randomUUID } from 'node:crypto';
import { outboundDispositionResponseSchema, transportDiagnosticsSchema, type OutboundDisposition } from '@contatocerto/shared';
import { withTransaction, query } from '../../database/connection.js';
import { fingerprint } from '../channel-media/channel-media.policy.js';
import { OUTBOX_MAX_ATTEMPTS, outboxRetryBackoffSeconds } from './channel-outbox.retry.js';

export class OutboundDispositionService {
  async dispose(id:string,input:OutboundDisposition) {
    const hash=fingerprint(JSON.stringify([input.action,input.reason,input.operator_id,input.evidence_hash??null,input.provider_message_id??null]));
    return withTransaction(async db=>{
      const row=(await db.query<{status:string;delivery_hold_reason:string|null;provider_message_id:string|null;attempt_count:number}>(
        'SELECT status,delivery_hold_reason,provider_message_id,attempt_count FROM channel_outbound_messages WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (!row) return {error:'outbound_message_not_found'};
      const prior=(await db.query<{payload_hash:string;result:unknown}>(
        'SELECT payload_hash,result FROM channel_transport_events WHERE outbound_id=$1 AND event_key=$2',[id,input.request_id])).rows[0];
      if (prior) {
        if (prior.payload_hash===hash) return {response:{...outboundDispositionResponseSchema.parse(prior.result),duplicate:true}};
        await db.query(`INSERT INTO channel_transport_events(outbound_id,event_key,action,reason,operator_id,payload_hash,result)
          VALUES($1,$2,'conflict','disposition_payload_conflict',$3,$4,'{}') ON CONFLICT(outbound_id,event_key) DO NOTHING`,[id,`conflict_${input.request_id}_${hash}`,input.operator_id,hash]);
        return {error:'disposition_payload_conflict'};
      }
      if (row.status!=='processing' || !row.delivery_hold_reason) return {error:'outbound_not_held'};
      if (input.action==='retry' && (row.provider_message_id || row.attempt_count>=OUTBOX_MAX_ATTEMPTS)) return {error:'outbound_retry_unsafe'};
      if (input.action==='confirm' && row.provider_message_id && row.provider_message_id!==input.provider_message_id) return {error:'outbound_receipt_conflict'};
      const status=input.action==='confirm'?'sent':input.action==='retry'?'pending':input.action==='close'?'failed':'processing';
      const response=outboundDispositionResponseSchema.parse({id,action:input.action,status,duplicate:false});
      // Fencing rotates even when retaining the hold. Old worker callbacks cannot override an operator decision.
      const token=randomUUID();
      if (input.action==='confirm') {
        await db.query(`UPDATE channel_outbound_messages SET status='sent',provider_message_id=$2,sent_at=clock_timestamp(),
          sent_token_hash=$3,delivery_hold_reason=NULL,next_attempt_at=NULL,processing_token=NULL,processing_started_at=NULL WHERE id=$1`,[id,input.provider_message_id,fingerprint(token)]);
        await db.query(`UPDATE matches SET shown_at=COALESCE(shown_at,clock_timestamp()) FROM channel_outbound_message_matches link
          WHERE link.channel_outbound_message_id=$1 AND matches.id=link.match_id`,[id]);
      } else if (input.action==='retain') {
        await db.query('UPDATE channel_outbound_messages SET processing_token=$2 WHERE id=$1',[id,token]);
      } else {
        await db.query(`UPDATE channel_outbound_messages SET status=$2,delivery_hold_reason=NULL,processing_token=NULL,processing_started_at=NULL,
          next_attempt_at=CASE WHEN $2='pending' THEN clock_timestamp()+($3*INTERVAL '1 second') ELSE NULL END,
          administrative_closed_at=CASE WHEN $2='failed' THEN clock_timestamp() ELSE NULL END WHERE id=$1`,[id,status,outboxRetryBackoffSeconds(row.attempt_count)]);
      }
      await db.query(`INSERT INTO channel_transport_events(outbound_id,event_key,action,reason,operator_id,payload_hash,evidence_hash,provider_message_id,result)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,[id,input.request_id,input.action,input.reason,input.operator_id,hash,input.evidence_hash??null,input.provider_message_id??null,JSON.stringify(response)]);
      return {response};
    });
  }

  async diagnostics() {
    const rows=await query(`SELECT
      (SELECT jsonb_build_object('transport_outcome_unknown',count(*) FILTER(WHERE delivery_hold_reason='transport_outcome_unknown'),
        'confirmation_pending',count(*) FILTER(WHERE delivery_hold_reason='confirmation_pending'),
        'awaiting_reconciliation',count(*),'oldest_seconds',max(GREATEST(0,extract(epoch FROM clock_timestamp()-delivery_held_at))))
        FROM channel_outbound_messages WHERE delivery_hold_reason IS NOT NULL) AS holds,
      (SELECT jsonb_build_object('confirm',count(*) FILTER(WHERE action='confirm'),'retry',count(*) FILTER(WHERE action='retry'),
        'close',count(*) FILTER(WHERE action='close'),'conflict',count(*) FILTER(WHERE action='conflict')) FROM channel_transport_events WHERE outbound_id IS NOT NULL) AS dispositions,
      (SELECT jsonb_build_object('notices_pending',(SELECT count(*) FROM channel_outbound_messages WHERE purpose='channel_notice' AND status IN ('pending','processing')),
        'pending',count(*) FILTER(WHERE status IN ('pending','processing')),'failed',count(*) FILTER(WHERE status='failed'),
        'quarantined',count(*) FILTER(WHERE status='quarantined'),
        'oldest_media_seconds',max(GREATEST(0,extract(epoch FROM clock_timestamp()-created_at))) FILTER(WHERE media_bytes IS NOT NULL),
        'purged_by_retention',count(*) FILTER(WHERE purge_reason='retention')) FROM channel_media_events) AS audio`);
    return transportDiagnosticsSchema.parse(rows.rows[0]);
  }
}
