import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { inDatabaseTransaction, type DatabaseClient } from '../../database/connection.js';
import { ChannelMediaService } from './channel-media.service.js';

test('purge discards expired bytes without releasing a quarantined Inbox or creating a notice',async()=>{
  const statements:string[]=[];
  const db={query:async(sql:string)=>{
    statements.push(sql);
    if(sql.includes('INSERT INTO channel_outbound_messages')) throw new Error('unexpected_outbound');
    if(sql.includes('SELECT *,expires_at')) return {rows:[{id:randomUUID(),inbound_id:randomUUID(),expired:true}]};
    if(sql.includes('FROM channel_inbound_messages')) return {rows:[{
      status:'received',recovery_state:'quarantined',media_pending:true,provider:'synthetic',phone_e164:'+5566991234567',
    }]};
    return {rows:[]};
  }} as DatabaseClient;
  assert.deepEqual(await inDatabaseTransaction(db,()=>new ChannelMediaService().purge()),{purged:1});
  assert.ok(statements.some(sql=>sql.includes("status='quarantined'") && sql.includes('media_bytes=NULL')));
  assert.ok(statements.every(sql=>!sql.includes('UPDATE channel_inbound_messages')));
});
