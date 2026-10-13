import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import * as fs from 'fs';
import { ToolExecutor } from '../toolExecutor';
import { TerminalIntegrationManager } from '../terminalIntegration';

describe('ToolExecutor Tests', () => {
  const terminalManager = new TerminalIntegrationManager();
  const executor = new ToolExecutor(terminalManager);

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
    // Should filter out node_modules
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

    // camelCase & string numbers
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

    const writeRes = await executor.writeFile(testFilePath, testContent);
    assert.strictEqual(writeRes.success, true);
    assert.ok(writeRes.bytesWritten > 0);

    const readRes = await executor.readFile(testFilePath);
    assert.ok(readRes.content.includes('Antigravity Voice Pair Programmer!'));

    fs.rmSync(path.join('dist', 'test_tmp'), { recursive: true, force: true });
  });

  it('runs interactive terminal command through dispatch', async () => {
    const res = await executor.runTerminalCommand('echo test', true);
    assert.strictEqual(res.interactive, true);
    assert.strictEqual(res.command, 'echo test');
  });
});
