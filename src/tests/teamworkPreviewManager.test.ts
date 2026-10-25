import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as fs from 'fs';
import { TeamworkPreviewManager } from '../teamworkPreviewManager';

describe('TeamworkPreviewManager Tests', () => {
  it('extracts workspace git delta', async () => {
    const manager = new TeamworkPreviewManager(process.cwd());
    const delta = await manager.getWorkspaceDelta();

    assert.ok(delta.branch);
    assert.strictEqual(typeof delta.branch, 'string');
    assert.strictEqual(typeof delta.ahead, 'number');
    assert.strictEqual(typeof delta.behind, 'number');
    assert.strictEqual(typeof delta.insertions, 'number');
    assert.strictEqual(typeof delta.deletions, 'number');
    assert.ok(Array.isArray(delta.modifiedFiles));
    assert.ok(Array.isArray(delta.stagedFiles));
    assert.ok(Array.isArray(delta.untrackedFiles));
  });

  it('generates walkthrough.md document', async () => {
    const testDir = path.join('dist', 'test_teamwork_tmp');
    fs.mkdirSync(testDir, { recursive: true });

    const manager = new TeamworkPreviewManager(testDir);
    const accomplishments = [
      'Implemented AmbientTelemetry engine',
      'Added hierarchical GoalManager',
      'Wired 15 Gemini Live tools'
    ];
    const verification = 'All 12 test suites passed successfully.';

    const md = await manager.generateWalkthrough(accomplishments, verification);

    assert.ok(md.includes('# Antigravity Walkthrough & Verification Record'));
    assert.ok(md.includes('Implemented AmbientTelemetry engine'));
    assert.ok(md.includes('All 12 test suites passed successfully.'));

    const savedFile = path.join(testDir, '.antigravity', 'walkthrough.md');
    assert.ok(fs.existsSync(savedFile));

    fs.rmSync(testDir, { recursive: true, force: true });
  });
});
