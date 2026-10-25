import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as fs from 'fs';
import { ToolExecutor, GEMINI_TOOLS } from '../toolExecutor';
import { TerminalIntegrationManager } from '../terminalIntegration';
import { GoalManager } from '../goalManager';
import { PlanManager } from '../planManager';

describe('ToolExecutor Tests', () => {
  const terminalManager = new TerminalIntegrationManager();
  const executor = new ToolExecutor(terminalManager);

  it('exposes all pillar tools in GEMINI_TOOLS (at least 15 tools)', () => {
    assert.ok(GEMINI_TOOLS.length >= 15);
    const toolNames = GEMINI_TOOLS.map((t) => t.name);

    // Pillar 1: Base editor tools
    assert.ok(toolNames.includes('read_file'));
    assert.ok(toolNames.includes('write_file'));
    assert.ok(toolNames.includes('get_workspace_tree'));
    assert.ok(toolNames.includes('get_active_editor'));
    assert.ok(toolNames.includes('run_terminal_command'));

    // Pillar 2: Goal tracking (/goal)
    assert.ok(toolNames.includes('get_goal_status'));
    assert.ok(toolNames.includes('update_goal'));

    // Pillar 3: Implementation planning (/plan)
    assert.ok(toolNames.includes('get_plan'));
    assert.ok(toolNames.includes('create_or_update_plan'));
    assert.ok(toolNames.includes('approve_plan_step'));

    // Pillar 4: Teamwork Preview (/teamwork-preview)
    assert.ok(toolNames.includes('get_git_diff'));
    assert.ok(toolNames.includes('open_diff_editor'));
    assert.ok(toolNames.includes('generate_walkthrough'));

    // Pillar 5: Browser Dev-Server (/browser)
    assert.ok(toolNames.includes('detect_dev_servers'));
    assert.ok(toolNames.includes('browser_inspect'));
    assert.ok(toolNames.includes('web_search'));

    // Pillar 6: Boost Deep Reasoning (/boost)
    assert.ok(toolNames.includes('run_boost_reasoning'));
    assert.ok(toolNames.includes('get_symbol_graph'));
  });

  it('reads an existing file with line numbers', async () => {
    const res = await executor.readFile('package.json', 1, 5);
    assert.strictEqual(res.path, 'package.json');
    assert.strictEqual(res.startLine, 1);
    assert.strictEqual(res.endLine, 5);
    assert.ok(res.content.includes('talking-to-antigravity'));
  });

  it('returns error when reading non-existent file', async () => {
    const res = await executor.readFile('non_existent_file_xyz123.txt');
    assert.ok(res.error);
    assert.ok(res.error.includes('File not found'));
  });

  it('gets workspace file tree', async () => {
    const res = await executor.getWorkspaceTree(2);
    assert.ok(Array.isArray(res.tree));
    const names = res.tree.map((e: any) => e.name);
    assert.ok(names.includes('src'));
    assert.ok(names.includes('package.json'));
    assert.strictEqual(names.includes('node_modules'), false);
  });

  it('runs terminal shell command and captures output', async () => {
    const res = await executor.runTerminalCommand('node -e "console.log(\'hello-voice-test\')"');
    assert.strictEqual(res.exitCode, 0);
    assert.ok(res.stdout.includes('hello-voice-test'));
  });

  it('dispatches executeToolCall properly with snake_case and camelCase parameters', async () => {
    const call1 = {
      id: 'test-call-1',
      name: 'read_file',
      args: { path: 'package.json', start_line: 1, end_line: 3 }
    };
    const response1 = await executor.executeToolCall(call1);
    assert.strictEqual(response1.id, 'test-call-1');
    assert.ok(response1.response.output.content);

    const call2 = {
      id: 'test-call-2',
      name: 'read_file',
      args: { path: 'package.json', startLine: '1', endLine: '2' }
    };
    const response2 = await executor.executeToolCall(call2);
    assert.strictEqual(response2.id, 'test-call-2');
    assert.strictEqual(response2.response.output.startLine, 1);
    assert.strictEqual(response2.response.output.endLine, 2);
  });

  it('writes and creates files via write_file', async () => {
    const testFilePath = path.join('dist', 'test_tmp', 'sample.txt');
    const testContent = 'Hello Antigravity Voice Pair Programmer!\nLine 2';

    const writeRes = await executor.writeFile(testFilePath, testContent, true);
    assert.strictEqual(writeRes.success, true);
    assert.ok(writeRes.bytesWritten > 0);

    const readRes = await executor.readFile(testFilePath);
    assert.ok(readRes.content.includes('Antigravity Voice Pair Programmer!'));

    fs.rmSync(path.join('dist', 'test_tmp'), { recursive: true, force: true });
  });

  it('dispatches get_goal_status and update_goal calls', async () => {
    const tmpGoalDir = path.join('dist', 'test_tool_goal_tmp');
    fs.mkdirSync(tmpGoalDir, { recursive: true });
    const gm = new GoalManager(tmpGoalDir);
    const localExecutor = new ToolExecutor(terminalManager, gm);

    const goalRes = await localExecutor.executeToolCall({
      id: 'call-goal-1',
      name: 'get_goal_status',
      args: {}
    });
    assert.strictEqual(goalRes.id, 'call-goal-1');
    assert.ok(goalRes.response.output);
    assert.strictEqual(typeof goalRes.response.output.percentDone, 'number');

    const updateRes = await localExecutor.executeToolCall({
      id: 'call-goal-2',
      name: 'update_goal',
      args: { new_task_text: 'Verify pillar tests', milestone: 'Testing' }
    });
    assert.strictEqual(updateRes.id, 'call-goal-2');
    assert.ok(updateRes.response.output.tasks);

    fs.rmSync(tmpGoalDir, { recursive: true, force: true });
  });

  it('dispatches get_plan, create_or_update_plan, and approve_plan_step calls', async () => {
    const tmpPlanDir = path.join('dist', 'test_tool_plan_tmp');
    fs.mkdirSync(tmpPlanDir, { recursive: true });
    const pm = new PlanManager(tmpPlanDir);
    const localExecutor = new ToolExecutor(terminalManager, undefined, pm);

    const createRes = await localExecutor.executeToolCall({
      id: 'call-plan-1',
      name: 'create_or_update_plan',
      args: {
        objective: 'Test Objective via Tool',
        proposed_changes: [{ action: 'CREATE', path: 'src/dummy.ts', rationale: 'Dummy file' }]
      }
    });
    assert.strictEqual(createRes.id, 'call-plan-1');
    assert.strictEqual(createRes.response.output.objective, 'Test Objective via Tool');

    const approveRes = await localExecutor.executeToolCall({
      id: 'call-plan-2',
      name: 'approve_plan_step',
      args: { step_id: 1 }
    });
    assert.strictEqual(approveRes.id, 'call-plan-2');
    assert.ok(approveRes.response.output.steps);

    fs.rmSync(tmpPlanDir, { recursive: true, force: true });
  });

  it('dispatches get_git_diff and generate_walkthrough calls', async () => {
    const diffRes = await executor.executeToolCall({
      id: 'call-diff-1',
      name: 'get_git_diff',
      args: {}
    });
    assert.strictEqual(diffRes.id, 'call-diff-1');
    assert.ok(diffRes.response.output.branch);

    const wtRes = await executor.executeToolCall({
      id: 'call-wt-1',
      name: 'generate_walkthrough',
      args: {
        accomplishments: ['Feature complete'],
        verification_results: 'All tests passed'
      }
    });
    assert.strictEqual(wtRes.id, 'call-wt-1');
    assert.ok(wtRes.response.output.content.includes('Accomplishments'));
  });

  it('dispatches detect_dev_servers and browser_inspect calls', async () => {
    const srvRes = await executor.executeToolCall({
      id: 'call-srv-1',
      name: 'detect_dev_servers',
      args: {}
    });
    assert.strictEqual(srvRes.id, 'call-srv-1');
    assert.ok(Array.isArray(srvRes.response.output));

    const inspectRes = await executor.executeToolCall({
      id: 'call-ins-1',
      name: 'browser_inspect',
      args: { url: 'http://localhost:59999' }
    });
    assert.strictEqual(inspectRes.id, 'call-ins-1');
    assert.ok(inspectRes.response.output);
  });

  it('dispatches run_boost_reasoning and get_symbol_graph calls', async () => {
    const boostRes = await executor.executeToolCall({
      id: 'call-boost-1',
      name: 'run_boost_reasoning',
      args: { prompt: 'How does the architecture work?' }
    });
    assert.strictEqual(boostRes.id, 'call-boost-1');
    assert.ok(typeof boostRes.response.output === 'string');

    const symRes = await executor.executeToolCall({
      id: 'call-sym-1',
      name: 'get_symbol_graph',
      args: { query: 'Tool' }
    });
    assert.strictEqual(symRes.id, 'call-sym-1');
    assert.ok(Array.isArray(symRes.response.output));
  });

  it('dispatches web_search call', async () => {
    const res = await executor.executeToolCall({
      id: 'call-web-1',
      name: 'web_search',
      args: { query: 'nodejs events' }
    });
    assert.strictEqual(res.id, 'call-web-1');
    assert.ok(res.response.output);
  });

  it('enforces plan approval gating on write_file', async () => {
    const planDir = path.join('dist', 'test_gate_tmp');
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(
      path.join(planDir, 'implementation_plan.md'),
      '# Plan: Gated\n\n## Execution Steps\n1. [ ] Step 1\n'
    );

    const pm = new PlanManager(planDir);
    const tm = new TerminalIntegrationManager();
    const gateExecutor = new ToolExecutor(tm, undefined, pm);

    // Should be gated
    const gatedRes = await gateExecutor.writeFile(path.join(planDir, 'foo.txt'), 'bar');
    assert.ok(gatedRes.error);
    assert.ok(gatedRes.error.includes('Execution gated'));

    // Force bypass should work
    const forceRes = await gateExecutor.writeFile(path.join(planDir, 'foo.txt'), 'bar', true);
    assert.strictEqual(forceRes.success, true);

    // After approval, should be permitted
    await pm.approveStep(1);
    const afterApprovalRes = await gateExecutor.writeFile(path.join(planDir, 'foo.txt'), 'bar2');
    assert.strictEqual(afterApprovalRes.success, true);

    fs.rmSync(planDir, { recursive: true, force: true });
  });
});
