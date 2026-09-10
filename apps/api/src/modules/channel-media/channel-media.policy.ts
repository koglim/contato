import { createHash } from 'node:crypto';
export const MEDIA_MAX_BYTES=3*1024*1024;
export const MEDIA_LEASE_SECONDS=60;
export const MEDIA_MAX_ATTEMPTS=3;
export const MEDIA_NOTICES={
  audio_too_long:'Envie um áudio de até 2 minutos ou escreva o que você precisa.',
  media_invalid:'Não consegui ler esse áudio. Pode escrever o pedido ou enviar um novo áudio de até 2 minutos?',
  unsupported_format:'Esse formato de áudio não é suportado. Pode escrever o pedido ou enviar uma mensagem de voz?',
  transcription_unavailable:'Não consegui entender esse áudio. Pode escrever o pedido ou enviar um novo áudio de até 2 minutos?',
  media_expired:'Não foi possível processar seu áudio a tempo. Pode escrever o pedido ou enviar um novo áudio?',
} as const;
export const fingerprint=(value:string)=>createHash('sha256').update(value).digest('hex');
export function classifyMedia(input:{audio_base64:string;mime_type:string;duration_seconds:number|null}) {
  const base64=input.audio_base64;
  const mime=input.mime_type.split(';')[0].trim().toLowerCase();
  let reason:keyof typeof MEDIA_NOTICES|null=null;
  const bytes=base64.length<=4*1024*1024 && base64.length%4===0 && /^[A-Za-z0-9+/]+={0,2}$/u.test(base64) ? Buffer.from(base64,'base64') : null;
  const signature=bytes?.subarray(0,12);
  const valid={
    'audio/ogg':signature?.toString('ascii',0,4)==='OggS',
    'audio/wav':signature?.toString('ascii',0,4)==='RIFF' && signature?.toString('ascii',8,12)==='WAVE',
    'audio/webm':signature?.subarray(0,4).toString('hex')==='1a45dfa3',
    'audio/mp4':signature?.toString('ascii',4,8)==='ftyp',
    'audio/mpeg':signature?.toString('ascii',0,3)==='ID3' || (!!signature && signature[0]===255 && (signature[1]&224)===224),
  };
  if (!input.duration_seconds || input.duration_seconds>120) reason='audio_too_long';
  else if (!Object.hasOwn(valid,mime)) reason='unsupported_format';
  else if (!bytes || !bytes.length || bytes.length>MEDIA_MAX_BYTES || bytes.toString('base64')!==base64 || !valid[mime as keyof typeof valid]) reason='media_invalid';
  return {reason,mime,bytes:reason?null:bytes,hash:bytes?createHash('sha256').update(bytes).digest('hex'):fingerprint(base64)};
}
