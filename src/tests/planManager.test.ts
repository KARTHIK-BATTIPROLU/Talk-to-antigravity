import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as fs from 'fs';
import { PlanManager } from '../planManager';

describe('PlanManager Tests', () => {
  const testDir = path.join('dist', 'test_plan_tmp');

  it('parses canonical implementation plan markdown', () => {
    const md = `# Implementation Plan: Voice Codebase Integration

## Proposed Changes
### Component 1
#### [CREATE] src/ambientTelemetry.ts
Telemetry background engine
#### [MODIFY] src/types.ts
Extend protocol schemas

## Execution Steps
1. [x] Step 1: Add types
2. [ ] Step 2: Implement engine
3. [ ] Step 3: Run verification

## Verification Plan
### Automated Tests
- npm run build
- npm test
### Manual Verification
- Test voice start
`;
    const manager = new PlanManager();
    const plan = manager.parsePlanContent(md, 'implementation_plan.md');

    assert.strictEqual(plan.objective, 'Voice Codebase Integration');
    assert.strictEqual(plan.proposedChanges.length, 2);
    assert.strictEqual(plan.proposedChanges[0].action, 'CREATE');
    assert.strictEqual(plan.proposedChanges[0].path, 'src/ambientTelemetry.ts');
    assert.strictEqual(plan.proposedChanges[1].action, 'MODIFY');

    assert.strictEqual(plan.steps.length, 3);
    assert.strictEqual(plan.steps[0].approved, true);
    assert.strictEqual(plan.steps[1].approved, false);
    assert.strictEqual(plan.allApproved, false);

    assert.ok(plan.verificationPlan.some((v) => v.includes('npm test')));
  });

  it('gates execution until all steps are approved', async () => {
    fs.mkdirSync(testDir, { recursive: true });
    const planPath = path.join(testDir, 'implementation_plan.md');

    const md = `# Implementation Plan: Gating Test
## Execution Steps
1. [ ] Step 1: Unit Test
2. [ ] Step 2: Verification
`;
    fs.writeFileSync(planPath, md, 'utf8');

    const manager = new PlanManager(testDir);
    const plan = await manager.getPlan();
    assert.ok(plan);
    assert.strictEqual(manager.isExecutionPermitted(), false);

    // Approve step 1
    const p1 = await manager.approveStep(1);
    assert.strictEqual(p1.steps[0].approved, true);
    assert.strictEqual(manager.isExecutionPermitted(), false);

    // Approve step 2
    const p2 = await manager.approveStep(2);
    assert.strictEqual(p2.steps[1].approved, true);
    assert.strictEqual(p2.allApproved, true);
    assert.strictEqual(manager.isExecutionPermitted(), true);

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('creates and persists new plans conforming to standard format', async () => {
    fs.mkdirSync(testDir, { recursive: true });
    const manager = new PlanManager(testDir);

    const created = await manager.createOrUpdatePlan({
      objective: 'Audio Pipeline Modernization',
      proposedChanges: [
        { action: 'CREATE', path: 'src/audioV2.ts', rationale: 'Next-gen audio capture' }
      ],
      steps: [
        { id: 1, text: 'Create audio file', approved: true }
      ]
    });

    assert.strictEqual(created.objective, 'Audio Pipeline Modernization');
    assert.strictEqual(created.proposedChanges.length, 1);
    assert.strictEqual(created.steps[0].approved, true);

    const reloaded = await manager.getPlan();
    assert.ok(reloaded);
    assert.strictEqual(reloaded?.objective, 'Audio Pipeline Modernization');

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('persists approval for unbracketed numbered steps to disk', async () => {
    fs.mkdirSync(testDir, { recursive: true });
    const planFile = path.join(testDir, 'implementation_plan.md');
    fs.writeFileSync(planFile, '# Plan\n\n## Execution Steps\n1. Run build\n2. Run test\n', 'utf8');

    const manager = new PlanManager(testDir);
    const planBefore = await manager.getPlan();
    assert.strictEqual(planBefore?.steps[0].approved, false);

    await manager.approveStep(1);

    // Verify on disk and reload
    const contentOnDisk = fs.readFileSync(planFile, 'utf8');
    assert.ok(contentOnDisk.includes('1. [x] Run build'));

    const reloaded = await manager.getPlan();
    assert.strictEqual(reloaded?.steps[0].approved, true);

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('matches Antigravity brain sessions with URL-encoded workspace paths', () => {
    const manager = new PlanManager();
    const wsBaseName = 'talikng to antigravity';
    const wsNormalized = 'c:/users/karthik/onedrive/desktop/talikng to antigravity';

    const testSessionDir = path.join('dist', 'test_brain_session');
    fs.mkdirSync(testSessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(testSessionDir, 'session_plan.md'),
      '# Plan\nTarget file: file:///c:/users/karthik/onedrive/desktop/talikng%20to%20antigravity/package.json\n'
    );

    const matches = manager['sessionMatchesWorkspace'](testSessionDir, wsBaseName, wsNormalized);
    assert.strictEqual(matches, true, 'Should match URL-encoded workspace path');

    fs.rmSync(testSessionDir, { recursive: true, force: true });
  });
});
