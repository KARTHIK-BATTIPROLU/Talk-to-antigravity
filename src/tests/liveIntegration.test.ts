import { describe, it } from 'node:test';
import assert from 'node:assert';
import { GeminiLiveClient } from '../geminiClient';
import { GEMINI_TOOLS } from '../toolExecutor';

describe('Gemini Live API End-to-End Integration', () => {
  it.skip('successfully connects to Google Live WebSocket, sends setup, and receives setupComplete', async () => {
    const apiKey = process.env.GEMINI_API_KEY || '';
    const client = new GeminiLiveClient({
      apiKey,
      model: 'models/gemini-2.5-flash-native-audio-latest',
      tools: GEMINI_TOOLS
    });

    try {
      await client.connect();
      assert.strictEqual(client.ready, true);
    } finally {
      client.disconnect();
    }
  });
});
