import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { mediaAdmissionSchema, mediaResultSchema, outboundDispositionSchema } from '@contatocerto/shared';
import { createInternalKeyGuard } from '../internal/internal-auth.js';
import type { ChannelMediaService } from './channel-media.service.js';
import type { OutboundDispositionService } from '../channel-outbox/outbound-disposition.service.js';

export const channelTransportRoutes:FastifyPluginAsync<{internalApiKey?:string;media:ChannelMediaService;admin:OutboundDispositionService}>=async(app,options)=>{
  const preHandler=createInternalKeyGuard(options.internalApiKey??process.env.INTERNAL_API_KEY);
  app.addHook('onSend',async(_request,reply,payload)=>{reply.header('cache-control','no-store');return payload;});
  app.setErrorHandler((_error,_request,reply)=>reply.code(500).send({error:'transport_internal_error'}));
  app.post('/media/events',{preHandler,bodyLimit:5*1024*1024},async(request,reply)=>{
    const body=mediaAdmissionSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({error:'media_input_invalid'});
    const result=await options.media.admit(body.data);
    return result.error?reply.code(409).send({error:result.error}):reply.send(result.response);
  });
  app.post('/media/next/claim',{preHandler},async(_request,reply)=>{
    const result=await options.media.claimNext();return result?reply.send(result):reply.code(204).send();
  });
  app.post('/media/purge',{preHandler},()=>options.media.purge());
  app.post('/media/:id/result',{preHandler},async(request,reply)=>{
    const params=z.object({id:z.string().uuid()}).safeParse(request.params),body=mediaResultSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({error:'media_result_invalid'});
    const result=await options.media.complete(params.data.id,body.data);
    return result.error?reply.code(result.error==='media_not_found'?404:409).send({error:result.error}):reply.send(result.response);
  });
  app.post('/outbound/:id/disposition',{preHandler},async(request,reply)=>{
    const params=z.object({id:z.string().uuid()}).safeParse(request.params),body=outboundDispositionSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({error:'disposition_input_invalid'});
    const result=await options.admin.dispose(params.data.id,body.data);
    return result.error?reply.code(result.error==='outbound_message_not_found'?404:409).send({error:result.error}):reply.send(result.response);
  });
  app.get('/transport/diagnostics',{preHandler},()=>options.admin.diagnostics());
};
