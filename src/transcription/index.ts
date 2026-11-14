import dotenv from 'dotenv';
dotenv.config();

export class TranscriptionError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

export interface TranscriptionResult {
  text: string;
}

const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

function requireCloudflareEnv(): { accountId: string; aiToken: string } {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const aiToken = process.env.CLOUDFLARE_AI_TOKEN;
  if (!accountId) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID is not set');
  }
  if (!aiToken) {
    throw new Error('CLOUDFLARE_AI_TOKEN is not set');
  }
  return { accountId, aiToken };
}

export async function transcribeAudio(audioBuffer: Buffer, filename: string): Promise<TranscriptionResult> {
  const { accountId, aiToken } = requireCloudflareEnv();

  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' }), filename);

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${WHISPER_MODEL}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aiToken}`,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new TranscriptionError(
      `Whisper transcription failed: ${response.status} ${errorBody}`,
      response.status,
    );
  }

  const result = await response.json();
  if (!result.success || !result.result) {
    throw new TranscriptionError(
      `Whisper transcription returned unsuccessful result: ${JSON.stringify(result)}`,
    );
  }

  return { text: result.result.text };
}
