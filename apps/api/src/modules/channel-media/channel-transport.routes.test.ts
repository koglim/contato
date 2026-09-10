import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { buildApp } from '../../app.js';
import { outboundDispositionSchema, mediaAdmissionSchema } from '@contatocerto/shared';

test('all transport administration and media endpoints require the internal key before persistence',async()=>{
  const app=buildApp({internalApiKey:'transport-test'});
  try {
    for(const [method,url] of [['POST','/media/events'],['POST','/media/next/claim'],['POST','/media/purge'],['POST',`/media/${randomUUID()}/result`],
      ['POST',`/outbound/${randomUUID()}/disposition`],['GET','/transport/diagnostics']] as const) {
      const r=await app.inject({method,url:`/internal/channel${url}`,headers:{'x-internal-key':'wrong'}});
      assert.equal(r.statusCode,401,r.body);
    }
    const r=await app.inject({method:'POST',url:`/internal/channel/outbound/${randomUUID()}/disposition`,headers:{'x-internal-key':'transport-test'},
      payload:{request_id:randomUUID(),operator_id:randomUUID(),action:'retry',reason:'non_delivery_proven',text:'private'}});
    assert.equal(r.statusCode,400);assert.doesNotMatch(r.body,/private|text/);
  }finally{await app.close();}
});
test('dispositions require matching structured evidence and cannot change the recipient or consent',()=>{
  const base={request_id:randomUUID(),operator_id:randomUUID(),action:'retry',reason:'non_delivery_proven'};
  assert.equal(outboundDispositionSchema.safeParse(base).success,false);
  assert.equal(outboundDispositionSchema.safeParse({...base,evidence_hash:'a'.repeat(64)}).success,true);
  assert.equal(outboundDispositionSchema.safeParse({...base,evidence_hash:'a'.repeat(64),recipient_phone_e164:'+5566991234567'}).success,false);
  assert.equal(outboundDispositionSchema.safeParse({...base,action:'confirm',reason:'delivery_proven',evidence_hash:'a'.repeat(64)}).success,false);
  assert.equal(outboundDispositionSchema.safeParse({...base,action:'retain',reason:'evidence_insufficient'}).success,true);
  assert.equal(mediaAdmissionSchema.safeParse({reply_text:'invented'}).success,false);
});
