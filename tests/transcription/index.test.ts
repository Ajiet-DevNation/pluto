import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAudio } from '../../src/transcription/index.js';

function fakeWhisperResponse(text: string, status = 200) {
  return new Response(JSON.stringify({ success: true, result: { text } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('transcription', () => {
  it('transcribes audio via Whisper and returns text', async () => {
    const originalFetch = global.fetch;
    const originalAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const originalAiToken = process.env.CLOUDFLARE_AI_TOKEN;

    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
    process.env.CLOUDFLARE_AI_TOKEN = 'test-token';
    global.fetch = async () => fakeWhisperResponse('Hello world, this is a test transcript.') as unknown as typeof fetch;

    try {
      const result = await transcribeAudio(Buffer.from('fake-audio-bytes'), 'meeting.mp3');
      assert.equal(result.text, 'Hello world, this is a test transcript.');
    } finally {
      global.fetch = originalFetch;
      if (originalAccountId) process.env.CLOUDFLARE_ACCOUNT_ID = originalAccountId;
      else delete process.env.CLOUDFLARE_ACCOUNT_ID;
      if (originalAiToken) process.env.CLOUDFLARE_AI_TOKEN = originalAiToken;
      else delete process.env.CLOUDFLARE_AI_TOKEN;
    }
  });

  it('throws TranscriptionError on non-2xx response', async () => {
    const originalFetch = global.fetch;
    const originalAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const originalAiToken = process.env.CLOUDFLARE_AI_TOKEN;

    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
    process.env.CLOUDFLARE_AI_TOKEN = 'test-token';
    global.fetch = async () => fakeWhisperResponse('error', 500) as unknown as typeof fetch;

    try {
      await assert.rejects(
        () => transcribeAudio(Buffer.from('fake-audio-bytes'), 'meeting.mp3'),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.name, 'TranscriptionError');
          return true;
        },
      );
    } finally {
      global.fetch = originalFetch;
      if (originalAccountId) process.env.CLOUDFLARE_ACCOUNT_ID = originalAccountId;
      else delete process.env.CLOUDFLARE_ACCOUNT_ID;
      if (originalAiToken) process.env.CLOUDFLARE_AI_TOKEN = originalAiToken;
      else delete process.env.CLOUDFLARE_AI_TOKEN;
    }
  });

  it('sends the audio file and authorization header', async () => {
    let capturedUrl = '';
    let capturedAuth = '';
    let capturedMethod = '';
    let capturedBody = false;

    const originalFetch = global.fetch;
    const originalAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const originalAiToken = process.env.CLOUDFLARE_AI_TOKEN;

    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
    process.env.CLOUDFLARE_AI_TOKEN = 'test-token';
    global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = init?.headers;
      capturedAuth = headers?.get?.('Authorization') ?? headers?.Authorization ?? '';
      capturedMethod = init?.method ?? '';
      capturedBody = !!init?.body;
      return fakeWhisperResponse('test') as unknown as Response;
    };

    try {
      await transcribeAudio(Buffer.from('audio-bytes'), 'meeting.wav');
      assert.equal(capturedMethod, 'POST');
      assert.ok(capturedAuth.startsWith('Bearer '));
      assert.ok(capturedBody);
      assert.ok(capturedUrl.includes('/ai/run/@cf/openai/whisper-large-v3-turbo'));
    } finally {
      global.fetch = originalFetch;
      if (originalAccountId) process.env.CLOUDFLARE_ACCOUNT_ID = originalAccountId;
      else delete process.env.CLOUDFLARE_ACCOUNT_ID;
      if (originalAiToken) process.env.CLOUDFLARE_AI_TOKEN = originalAiToken;
      else delete process.env.CLOUDFLARE_AI_TOKEN;
    }
  });
});
