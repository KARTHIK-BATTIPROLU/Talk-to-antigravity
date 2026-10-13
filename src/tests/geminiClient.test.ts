import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { WebSocketServer } from 'ws';
import { GeminiLiveClient } from '../geminiClient';
import { GEMINI_TOOLS } from '../toolExecutor';

describe('GeminiLiveClient Protocol Tests', () => {
  let wss: WebSocketServer;
  let testPort: number = 9876;

  before(async () => {
    await new Promise<void>((resolve) => {
      wss = new WebSocketServer({ port: testPort }, () => resolve());
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  });

  it('connects to mock server and performs setup handshake', async () => {
    wss.once('connection', (ws) => {
      ws.once('message', (msg) => {
        const parsed = JSON.parse(msg.toString());
        assert.ok(parsed.setup, 'Setup payload sent');
        assert.strictEqual(parsed.setup.model, 'models/gemini-2.5-flash-native-audio-latest');
        assert.ok(Array.isArray(parsed.setup.tools[0].functionDeclarations));

        // Reply with setupComplete
        ws.send(JSON.stringify({ setupComplete: {} }));
      });
    });

    const client = new GeminiLiveClient({
      apiKey: 'test-key',
      model: 'models/gemini-2.5-flash-native-audio-latest',
      tools: GEMINI_TOOLS
    });

    // Override endpoint to point to local mock server
    (client as any).connect = function () {
      return new Promise<void>((resolve, reject) => {
        const WebSocket = require('ws');
        this.ws = new WebSocket(`ws://127.0.0.1:${testPort}`);
        this.ws.on('open', () => {
          this.sendSetup();
          this.emit('connected');
        });
        this.ws.on('message', (data: any) => {
          const message = JSON.parse(data.toString());
          this.handleServerMessage(message);
          if (message.setupComplete) {
            resolve();
          }
        });
        this.ws.on('error', reject);
      });
    };

    await client.connect();
    assert.strictEqual(client.ready, true);
    client.disconnect();
  });

  it('handles serverContent with audio and text chunks', async () => {
    const client = new GeminiLiveClient({ apiKey: 'fake' });
    let receivedAudio = false;
    let receivedText = false;

    client.on('audioChunk', (pcm: string) => {
      assert.strictEqual(pcm, 'AQIDBA==');
      receivedAudio = true;
    });

    client.on('textChunk', (text: string) => {
      assert.strictEqual(text, 'Hello from Gemini');
      receivedText = true;
    });

    (client as any).handleServerMessage({
      serverContent: {
        modelTurn: {
          parts: [
            { inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AQIDBA==' } },
            { text: 'Hello from Gemini' }
          ]
        },
        turnComplete: true
      }
    });

    assert.ok(receivedAudio);
    assert.ok(receivedText);
  });

  it('handles toolCall dispatch and responds', async () => {
    const client = new GeminiLiveClient({ apiKey: 'fake' });

    const callPromise = new Promise<void>((resolve) => {
      client.on('toolCall', (calls: any[]) => {
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].name, 'read_file');
        assert.strictEqual(calls[0].args.path, 'package.json');
        resolve();
      });
    });

    (client as any).handleServerMessage({
      toolCall: {
        functionCalls: [
          {
            id: 'call-42',
            name: 'read_file',
            args: { path: 'package.json' }
          }
        ]
      }
    });

    await callPromise;
  });

  it('handles interruption / barge-in event and suppresses subsequent chunks until turnComplete', async () => {
    const client = new GeminiLiveClient({ apiKey: 'fake' });
    let interruptedCount = 0;
    let audioChunkCount = 0;

    client.on('interrupted', () => {
      interruptedCount++;
    });

    client.on('audioChunk', () => {
      audioChunkCount++;
    });

    // 1. Initial chunk before interrupt
    (client as any).handleServerMessage({
      serverContent: {
        modelTurn: {
          parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AQID' } }]
        }
      }
    });
    assert.strictEqual(audioChunkCount, 1);

    // 2. Interruption event
    (client as any).handleServerMessage({
      serverContent: {
        interrupted: true
      }
    });
    assert.strictEqual(interruptedCount, 1);

    // 3. Chunks arriving after interrupt within the same turn should be dropped
    (client as any).handleServerMessage({
      serverContent: {
        modelTurn: {
          parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'BAUG' } }]
        }
      }
    });
    assert.strictEqual(audioChunkCount, 1, 'Audio chunk was correctly suppressed after interruption');

    // 4. Turn complete resets the interruption state
    (client as any).handleServerMessage({
      serverContent: {
        turnComplete: true
      }
    });

    // 5. Next turn chunks should be emitted normally
    (client as any).handleServerMessage({
      serverContent: {
        modelTurn: {
          parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'BwgJ' } }]
        }
      }
    });
    assert.strictEqual(audioChunkCount, 2, 'Audio chunk in new turn is processed normally');
  });

  it('supports client-side interruptTurn and toolCallCancellation', () => {
    const client = new GeminiLiveClient({ apiKey: 'fake' });
    let interruptedFired = false;
    let cancelledIds: string[] = [];

    client.on('interrupted', () => {
      interruptedFired = true;
    });

    client.on('toolCallCancellation', (ids) => {
      cancelledIds = ids;
    });

    client.interruptTurn();
    assert.strictEqual(interruptedFired, true);

    (client as any).handleServerMessage({
      toolCallCancellation: {
        ids: ['call-abc-123']
      }
    });
    assert.deepStrictEqual(cancelledIds, ['call-abc-123']);
  });

  it('handles inputAudioTranscription and outputAudioTranscription', () => {
    const client = new GeminiLiveClient({ apiKey: 'fake' });
    let userCap = '';
    let modelCap = '';

    client.on('userCaption', (text: string) => {
      userCap = text;
    });

    client.on('modelCaption', (text: string) => {
      modelCap = text;
    });

    (client as any).handleServerMessage({
      serverContent: {
        inputAudioTranscription: { text: 'user spoken text' },
        outputAudioTranscription: { text: 'model spoken text' }
      }
    });

    assert.strictEqual(userCap, 'user spoken text');
    assert.strictEqual(modelCap, 'model spoken text');
  });
});
