import { describe, it } from 'node:test';
import assert from 'node:assert';
import { WhisperCaptionEngine } from '../whisperEngine';

describe('WhisperCaptionEngine', () => {
  it('instantiates and feeds PCM chunk', () => {
    const engine = new WhisperCaptionEngine('python', '/fake/workspace');
    
    // Mock the pythonProcess
    let receivedChunks: string[] = [];
    (engine as any).pythonProcess = {
      stdin: {
        write: (data: string) => {
          receivedChunks.push(data);
        }
      }
    };
    
    engine.feedPcmChunk('AQID');
    assert.strictEqual(receivedChunks.length, 1);
    const parsed = JSON.parse(receivedChunks[0]);
    assert.strictEqual(parsed.type, 'pcm');
    assert.strictEqual(parsed.data, 'AQID');
    
    engine.interrupt();
    assert.strictEqual(receivedChunks.length, 2);
    const parsed2 = JSON.parse(receivedChunks[1]);
    assert.strictEqual(parsed2.command, 'interrupt');
  });
});
