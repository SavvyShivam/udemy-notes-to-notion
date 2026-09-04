import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseGroqResponse, summarizeTranscript } from '../src/groq-client.js';

test('buildPrompt returns a system + user message pair containing the transcript', () => {
  const messages = buildPrompt('hello world transcript');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.match(messages[1].content, /hello world transcript/);
});

test('parseGroqResponse parses well-formed BRIEF/BULLETS output', () => {
  const raw = 'BRIEF: This lecture covers closures.\nBULLETS:\n- Closures capture scope\n- Used for data privacy\n- Common in callbacks';
  const result = parseGroqResponse(raw);
  assert.equal(result.brief, 'This lecture covers closures.');
  assert.deepEqual(result.bullets, ['Closures capture scope', 'Used for data privacy', 'Common in callbacks']);
});

test('parseGroqResponse handles missing BULLETS section', () => {
  const raw = 'BRIEF: Just a brief, no bullets.';
  const result = parseGroqResponse(raw);
  assert.equal(result.brief, 'Just a brief, no bullets.');
  assert.deepEqual(result.bullets, []);
});

test('parseGroqResponse falls back to whole text as brief when unformatted', () => {
  const raw = 'The model ignored instructions and just wrote prose.';
  const result = parseGroqResponse(raw);
  assert.equal(result.brief, 'The model ignored instructions and just wrote prose.');
  assert.deepEqual(result.bullets, []);
});

test('summarizeTranscript posts to Groq and returns parsed result', async () => {
  let capturedUrl, capturedOptions;
  const fakeFetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'BRIEF: b\nBULLETS:\n- one' } }] })
    };
  };

  const result = await summarizeTranscript('some transcript', 'test-key', fakeFetch);

  assert.equal(capturedUrl, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(capturedOptions.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(result, { brief: 'b', bullets: ['one'] });
});

test('summarizeTranscript throws with status and body on non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, text: async () => 'bad key' });
  await assert.rejects(
    () => summarizeTranscript('t', 'bad-key', fakeFetch),
    /Groq API error 401: bad key/
  );
});

test('summarizeTranscript throws with clear error on malformed response (empty choices)', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ choices: [] }) });
  await assert.rejects(
    () => summarizeTranscript('t', 'test-key', fakeFetch),
    /Groq API returned an unexpected response shape/
  );
});

test('summarizeTranscript throws with clear error on malformed response (missing message)', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ choices: [{}] }) });
  await assert.rejects(
    () => summarizeTranscript('t', 'test-key', fakeFetch),
    /Groq API returned an unexpected response shape/
  );
});
