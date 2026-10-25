import { describe, it } from 'node:test';
import assert from 'node:assert';
import { BoostManager } from '../boostManager';

describe('BoostManager Tests', () => {
  it('indexes workspace symbol graph statically', async () => {
    const manager = new BoostManager(undefined, undefined, process.cwd());
    const symbols = await manager.getSymbolGraph('Manager');

    assert.ok(Array.isArray(symbols));
    assert.ok(symbols.length > 0);

    const names = symbols.map((s) => s.name);
    assert.ok(
      names.includes('GoalManager') ||
      names.includes('PlanManager') ||
      names.includes('BoostManager') ||
      names.includes('BrowserManager')
    );
  });

  it('runs boost query with simulated/cli fallback and progress reporting', async () => {
    // Non-existent CLI to trigger clean fallback
    const manager = new BoostManager('C:\\non_existent\\agentapi.bat', 'C:\\non_existent\\claude.cmd');

    const progressMessages: string[] = [];
    const result = await manager.runBoostQuery('How should we structure audio streaming?', {
      model: 'pro',
      onProgress: (msg) => progressMessages.push(msg)
    });

    assert.ok(progressMessages.length > 0);
    assert.ok(result.includes('Deep architectural analysis'));
  });

  it('supports updating CLI paths and process cancellation', () => {
    const manager = new BoostManager();
    manager.updatePaths('C:\\new_path\\agentapi.bat', 'C:\\new_path\\claude.cmd');
    assert.strictEqual(manager['antigravityCliPath'], 'C:\\new_path\\agentapi.bat');
    assert.strictEqual(manager['claudeCliPath'], 'C:\\new_path\\claude.cmd');

    // cancelBoost should be safe when no process is running
    assert.doesNotThrow(() => manager.cancelBoost());
  });

  it('handles reasoning prompts containing shell special characters (&, |, quotes) safely', async () => {
    const manager = new BoostManager('C:\\non_existent\\agentapi.bat', 'C:\\non_existent\\claude.cmd');
    const result = await manager.runBoostQuery('How do service A & service B | C "interact"?', {
      model: 'pro'
    });
    assert.ok(result.includes('Deep architectural analysis'));
  });
});
