import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as fs from 'fs';
import { GoalManager } from '../goalManager';

describe('GoalManager Tests', () => {
  const testDir = path.join('dist', 'test_goal_tmp');
  const testTaskFile = path.join(testDir, 'task.md');

  it('parses checklist states, indentation, and calculates accurate metrics', () => {
    const markdown = `# Antigravity Voice Project

## Milestone 1: Core Architecture
- [x] Step 1: Design schemas
  - [x] Subtask 1.1: Types
- [/] Step 2: Implement GoalManager
- [ ] Step 3: Implement PlanManager
- [!] Step 4: Verify blocked task
`;
    const manager = new GoalManager();
    const status = manager.parseTaskContent(markdown, 'task.md');

    assert.strictEqual(status.milestone, 'Milestone 1: Core Architecture');
    assert.strictEqual(status.totalTasks, 5);
    assert.strictEqual(status.completedTasks, 2);
    assert.strictEqual(status.inProgressTasks, 1);
    assert.strictEqual(status.blockedTasks, 1);
    assert.strictEqual(status.percentDone, 40); // 2/5 * 100 = 40%

    assert.ok(status.activeTask);
    assert.strictEqual(status.activeTask.text, 'Step 2: Implement GoalManager');
    assert.strictEqual(status.activeTask.status, 'in_progress');

    // Verify indentation
    const subtask = status.tasks.find((t) => t.text.includes('Subtask 1.1'));
    assert.ok(subtask);
    assert.ok(subtask.indent > 0);
  });

  it('handles edge cases: empty content and all completed tasks', () => {
    const manager = new GoalManager();
    const emptyStatus = manager.parseTaskContent('', 'task.md');
    assert.strictEqual(emptyStatus.totalTasks, 0);
    assert.strictEqual(emptyStatus.percentDone, 0);
    assert.strictEqual(emptyStatus.activeTask, undefined);

    const allDoneMd = `# Done
- [x] Task 1
- [X] Task 2
`;
    const doneStatus = manager.parseTaskContent(allDoneMd, 'task.md');
    assert.strictEqual(doneStatus.totalTasks, 2);
    assert.strictEqual(doneStatus.completedTasks, 2);
    assert.strictEqual(doneStatus.percentDone, 100);
    assert.strictEqual(doneStatus.activeTask, undefined);
  });

  it('performs atomic task updates on disk', async () => {
    fs.mkdirSync(testDir, { recursive: true });
    const initialContent = `# Test Tasks\n\n## Milestone 1\n- [ ] Task A\n- [ ] Task B\n`;
    fs.writeFileSync(testTaskFile, initialContent, 'utf8');

    const manager = new GoalManager(testDir);
    // Explicitly set source path or let it resolve
    const statusBefore = await manager.getGoalStatus();
    assert.strictEqual(statusBefore.completedTasks, 0);

    // Update Task A to completed
    const statusAfter = await manager.updateTaskStatus('Task A', 'completed');
    assert.strictEqual(statusAfter.completedTasks, 1);
    assert.strictEqual(statusAfter.percentDone, 50);

    // Verify written file
    const fileContent = fs.readFileSync(testTaskFile, 'utf8');
    assert.ok(fileContent.includes('- [x] Task A'));
    assert.ok(fileContent.includes('- [ ] Task B'));

    // Update Task B to in_progress by ID (task-2)
    const statusAfter2 = await manager.updateTaskStatus('task-2', 'in_progress');
    assert.strictEqual(statusAfter2.inProgressTasks, 1);
    const fileContent2 = fs.readFileSync(testTaskFile, 'utf8');
    assert.ok(fileContent2.includes('- [/] Task B'));

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('adds new tasks under milestones', async () => {
    fs.mkdirSync(testDir, { recursive: true });
    const initialContent = `# Project\n\n## Milestone 1\n- [ ] Task 1\n`;
    fs.writeFileSync(testTaskFile, initialContent, 'utf8');

    const manager = new GoalManager(testDir);
    await manager.addTask('New Task 2', 'Milestone 1');

    const updatedContent = fs.readFileSync(testTaskFile, 'utf8');
    assert.ok(updatedContent.includes('- [ ] New Task 2'));

    const status = await manager.getGoalStatus();
    assert.strictEqual(status.totalTasks, 2);

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('matches Antigravity brain sessions with URL-encoded workspace paths', () => {
    const manager = new GoalManager();
    const wsBaseName = 'talikng to antigravity';
    const wsNormalized = 'c:/users/karthik/onedrive/desktop/talikng to antigravity';

    const testSessionDir = path.join('dist', 'test_brain_session_goal');
    fs.mkdirSync(testSessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(testSessionDir, 'session_task.md'),
      '# Tasks\nFile: file:///c:/users/karthik/onedrive/desktop/talikng%20to%20antigravity/package.json\n'
    );

    const matches = manager['sessionMatchesWorkspace'](testSessionDir, wsBaseName, wsNormalized);
    assert.strictEqual(matches, true, 'Should match URL-encoded workspace path');

    fs.rmSync(testSessionDir, { recursive: true, force: true });
  });

  it('does not falsely match tasks on very short or empty query', async () => {
    fs.mkdirSync(testDir, { recursive: true });
    const initialContent = `# Project\n- [ ] Task First Item\n- [ ] Task Second Item\n`;
    fs.writeFileSync(testTaskFile, initialContent, 'utf8');

    const manager = new GoalManager(testDir);
    // Updating with a non-matching query like "xyz" should not update first task
    const status = await manager.updateTaskStatus('xyz_non_existent', 'completed');
    assert.strictEqual(status.completedTasks, 0);

    fs.rmSync(testDir, { recursive: true, force: true });
  });
});
