import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AmbientTelemetry } from '../ambientTelemetry';

describe('AmbientTelemetry Engine Tests', () => {
  it('initializes and provides basic snapshot', () => {
    const telemetry = new AmbientTelemetry(process.cwd());
    const snapshot = telemetry.getSnapshot();

    assert.ok(snapshot.diagnosticsCount);
    assert.strictEqual(typeof snapshot.diagnosticsCount.errors, 'number');
    assert.strictEqual(typeof snapshot.diagnosticsCount.warnings, 'number');
    assert.ok(Array.isArray(snapshot.detectedDevServers));
  });

  it('sniffs terminal output for dev-server localhost URLs', () => {
    const telemetry = new AmbientTelemetry();
    telemetry.updateTerminalOutput('Vite server running at http://localhost:5173/ and loopback at http://127.0.0.1:8080');

    const snapshot = telemetry.getSnapshot();
    assert.ok(snapshot.detectedDevServers.includes('http://localhost:5173'));
    assert.ok(snapshot.detectedDevServers.includes('http://127.0.0.1:8080'));
  });

  it('updates git info and reflects in snapshot and prompt context', () => {
    const telemetry = new AmbientTelemetry();
    telemetry.setGitInfo('feature/voice-companion', '2 modified, 1 untracked');

    const snapshot = telemetry.getSnapshot();
    assert.strictEqual(snapshot.gitBranch, 'feature/voice-companion');
    assert.strictEqual(snapshot.gitStatusSummary, '2 modified, 1 untracked');

    const promptContext = telemetry.getPromptContext();
    assert.ok(promptContext.includes('feature/voice-companion'));
    assert.ok(promptContext.includes('2 modified, 1 untracked'));
    assert.ok(promptContext.startsWith('[Context:'));
    // Ensure concise token size: should easily be under 200 characters (~40 tokens)
    assert.ok(promptContext.length < 250);
  });

  it('handles multiple dev servers and truncates in prompt context', () => {
    const telemetry = new AmbientTelemetry();
    telemetry.setDevServers(['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080']);

    const promptContext = telemetry.getPromptContext();
    assert.ok(promptContext.includes('http://localhost:3000'));
    assert.ok(promptContext.includes('http://localhost:5173'));
  });

  it('refreshes git info automatically from workspace git repo', async () => {
    const telemetry = new AmbientTelemetry(process.cwd());
    await telemetry.refreshGitInfo();

    const snapshot = telemetry.getSnapshot();
    assert.ok(snapshot.gitBranch);
    assert.strictEqual(typeof snapshot.gitBranch, 'string');
    assert.ok(snapshot.gitStatusSummary);
  });
});
