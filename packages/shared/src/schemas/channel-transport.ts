import { z } from 'zod';
import { phoneE164Schema, normalizeBrazilianMobilePhone } from './phone.js';

export const mediaAdmissionSchema = z.object({
  provider: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/u),
  provider_message_id: z.string().min(1).max(255), phone_e164: phoneE164Schema.transform(normalizeBrazilianMobilePhone),
  country_code: z.string().regex(/^[A-Z]{2}$/u).default('BR'), limit: z.number().int().min(1).max(10).default(3),
  audio_base64: z.string().max(5*1024*1024), mime_type: z.string().max(100),
  duration_seconds: z.number().nonnegative().nullable(),
}).strict();
export const mediaResultSchema = z.object({
  processing_token: z.string().uuid(), media_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  result: z.discriminatedUnion('status', [
    z.object({ status: z.literal('transcribed'), provider: z.enum(['groq','openai']), text: z.string().trim().min(1).max(500) }).strict(),
    z.object({ status: z.literal('failed'), error_code: z.literal('transcription_unavailable') }).strict(),
  ]),
}).strict();
export const mediaSummarySchema = z.object({ id: z.string().uuid(), status: z.enum(['pending','processing','completed','failed','quarantined']), duplicate: z.boolean() }).strict();
export const mediaClaimSchema = z.object({ id:z.string().uuid(),processing_token:z.string().uuid(),media_hash:z.string().regex(/^[a-f0-9]{64}$/u),
  audio_base64:z.string().min(1).max(4*1024*1024),mime_type:z.enum(['audio/ogg','audio/mpeg','audio/mp4','audio/wav','audio/webm']) }).strict();
export const outboundDispositionSchema = z.object({
  request_id:z.string().uuid(), operator_id:z.string().uuid(),
  action:z.enum(['confirm','retry','close','retain']),
  reason:z.enum(['delivery_proven','non_delivery_proven','delivery_impossible','evidence_insufficient']),
  evidence_hash:z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  provider_message_id:z.string().trim().min(1).max(255).optional(),
}).strict().superRefine((value,ctx)=>{
  const expected = {confirm:'delivery_proven',retry:'non_delivery_proven',close:'delivery_impossible',retain:'evidence_insufficient'};
  if (value.reason!==expected[value.action] || (value.action!=='retain' && !value.evidence_hash)
    || (value.action==='confirm' && !value.provider_message_id) || (value.action!=='confirm' && value.provider_message_id))
    ctx.addIssue({code:'custom',message:'Disposition requires consistent evidence'});
});
export const outboundDispositionResponseSchema = z.object({id:z.string().uuid(),action:z.enum(['confirm','retry','close','retain']),
  status:z.enum(['sent','pending','failed','processing']),duplicate:z.boolean()}).strict();
const count=z.number().int().nonnegative(), age=z.number().nonnegative().nullable();
export const transportDiagnosticsSchema=z.object({
  holds:z.object({transport_outcome_unknown:count,confirmation_pending:count,oldest_seconds:age,awaiting_reconciliation:count}).strict(),
  dispositions:z.object({confirm:count,retry:count,close:count,conflict:count}).strict(),
  audio:z.object({notices_pending:count,pending:count,failed:count,quarantined:count,oldest_media_seconds:age,purged_by_retention:count}).strict(),
}).strict();
export type MediaAdmission=z.infer<typeof mediaAdmissionSchema>;
export type MediaResult=z.infer<typeof mediaResultSchema>;
export type OutboundDisposition=z.infer<typeof outboundDispositionSchema>;
