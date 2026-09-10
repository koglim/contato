import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyMedia, MEDIA_NOTICES } from './channel-media.policy.js';

const audio = { audio_base64: Buffer.from('OggS synthetic audio').toString('base64'), mime_type: 'audio/ogg', duration_seconds: 10 };
test('media policy admits bounded audio and owns every notice', () => {
  assert.equal(classifyMedia(audio).reason, null);
  for (const [input, reason] of [
    [{...audio,duration_seconds:121},'audio_too_long'],
    [{...audio,audio_base64:'@@@='},'media_invalid'],
    [{...audio,mime_type:'text/html'},'unsupported_format'],
    [{...audio,audio_base64:Buffer.from('fake ogg').toString('base64')},'media_invalid'],
    [{...audio,audio_base64:'A'.repeat(4*1024*1024+4)},'media_invalid'],
  ] as const) assert.equal(classifyMedia(input).reason,reason);
  for (const text of Object.values(MEDIA_NOTICES)) assert.ok(text.length>0 && text.length<500);
});
