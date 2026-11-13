import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../donna/app.js',import.meta.url),'utf8');

test('voice microphone exposes toggle state and status relationship',()=>{
  assert.match(source,/data-action="mic" aria-pressed="\$\{state\.listening\?'true':'false'\}" aria-controls="voice-status"/);
  assert.match(source,/aria-label="\$\{state\.listening\?'Finish voice input':'Start voice input'\}"/);
  assert.match(source,/id="voice-status" role="status"/);
});
test('voice mute and speech stop remain distinct controls',()=>{
  assert.match(source,/data-action="toggle-voice-mute" aria-pressed=/);
  assert.match(source,/data-action="stop-speech"/);
  assert.match(source,/function cancelSpeech\(\)/);
});
