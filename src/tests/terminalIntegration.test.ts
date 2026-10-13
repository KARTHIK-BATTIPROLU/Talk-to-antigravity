import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TerminalIntegrationManager } from '../terminalIntegration';

describe('TerminalIntegrationManager Tests', () => {
  const manager = new TerminalIntegrationManager();

  it('executes a command with stdout output and exitCode 0', async () => {
    const result = await manager.executeCommandWithOutput('node -e "process.stdout.write(\'stdout-check\')"');
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout, 'stdout-check');
    assert.strictEqual(result.stderr, '');
    assert.ok(result.durationMs >= 0);
  });

  it('captures exit code and stderr for failing commands', async () => {
    const result = await manager.executeCommandWithOutput('node -e "process.stderr.write(\'fail-err\'); process.exit(3)"');
    assert.strictEqual(result.exitCode, 3);
    assert.strictEqual(result.stderr, 'fail-err');
  });

  it('updates CLI paths dynamically', () => {
    manager.updatePaths('C:\\custom\\claude.cmd', 'C:\\custom\\agy.cmd');
    assert.strictEqual((manager as any).claudeCliPath, 'C:\\custom\\claude.cmd');
    assert.strictEqual((manager as any).antigravityCliPath, 'C:\\custom\\agy.cmd');
  });
});
