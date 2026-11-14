import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../donna/app.js', import.meta.url), 'utf8');

test('recognition callbacks ignore replaced sessions and other views', () => {
  assert.match(source, /recognition!==activeRecognition\|\|state\.view!==recognitionView/);
  assert.match(source, /recognition!==activeRecognition\|\|e\.error==='aborted'\|\|state\.view!==recognitionView/);
});

test('empty transcripts do not enter message submission', () => {
  assert.match(source, /if\(!text\)\{emptyTranscript=true;/);
  assert.match(source, /No words recognized\. Please try again or type your question\./);
  assert.match(source, /if\(state\.view==='voice'&&input\.closest\('#chat-form'\)&&!state\.sending&&!state\.busy\)/);
});

test('browser speech processing is disclosed before microphone permission', () => {
  assert.match(source, /browser or operating system may process audio using its speech service/);
  assert.match(source, /data-action="confirm-mic"/);
});

test('speech playback is cancellable and stale callbacks cannot alter status', () => {
  assert.match(source, /function cancelSpeech\(\)\{activeUtterance=null;window\.speechSynthesis\?\.cancel\(\);\}/);
  assert.match(source, /u\.onend=\(\)=>\{if\(activeUtterance!==u\)return;/);
  assert.match(source, /u\.onerror=e=>\{if\(activeUtterance!==u\)return;/);
});
