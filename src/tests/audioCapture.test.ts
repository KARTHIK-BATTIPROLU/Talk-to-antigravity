import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AudioCaptureEngine } from '../audioCapture';

describe('AudioCaptureEngine Tests', () => {
  it('manages mute and unmute states', () => {
    const engine = new AudioCaptureEngine();
    assert.strictEqual(engine.muted, false);

    engine.setMute(true);
    assert.strictEqual(engine.muted, true);

    engine.toggleMute();
    assert.strictEqual(engine.muted, false);
  });

  it('handles feedPcmChunk when unmuted', (t, done) => {
    const engine = new AudioCaptureEngine();
    const testPcm = 'BASE64PCMTEST';

    engine.on('pcm', (data) => {
      assert.strictEqual(data, testPcm);
    });

    engine.on('rms', (rms) => {
      assert.strictEqual(rms, 0.42);
      done();
    });

    engine.feedPcmChunk(testPcm, 0.42);
  });

  it('does not emit pcm when muted', () => {
    const engine = new AudioCaptureEngine();
    engine.setMute(true);

    let emitted = false;
    engine.on('pcm', () => {
      emitted = true;
    });

    engine.feedPcmChunk('TESTDATA', 0.5);
    assert.strictEqual(emitted, false);
  });

  it('parses JSON stdout lines with PCM and RMS', (t, done) => {
    const engine = new AudioCaptureEngine();
    let count = 0;

    engine.on('pcm', (data) => {
      assert.strictEqual(data, 'CHUNKDATA');
      count++;
    });

    engine.on('rms', (rms) => {
      assert.strictEqual(rms, 0.15);
      if (count === 1) {
        done();
      }
    });

    // Simulate stdout chunk containing a newline-delimited JSON
    (engine as any).handleStdoutChunk('{"type":"pcm","data":"CHUNKDATA","rms":0.15}\n');
  });
});
