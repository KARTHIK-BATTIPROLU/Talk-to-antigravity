import * as child_process from 'child_process';
import * as path from 'path';

let vscode: any;
try {
  vscode = require('vscode');
} catch {
  vscode = null;
}

export interface TerminalExecutionResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class TerminalIntegrationManager {
  private bridgeTerminal: any = null;
  private claudeCliPath: string;
  private antigravityCliPath: string;

  constructor(claudePath?: string, antigravityPath?: string) {
    this.claudeCliPath = claudePath || 'C:\\Users\\Karthik\\AppData\\Roaming\\npm\\claude.cmd';
    this.antigravityCliPath = antigravityPath || 'C:\\Users\\Karthik\\AppData\\Roaming\\Antigravity\\bin\\agy-node.cmd';
  }

  public updatePaths(claudePath?: string, antigravityPath?: string): void {
    if (claudePath) this.claudeCliPath = claudePath;
    if (antigravityPath) this.antigravityCliPath = antigravityPath;
  }

  /**
   * Returns or creates a dedicated terminal for voice dev bridge operations.
   */
  public getOrCreateTerminal(show: boolean = true): any {
    if (!vscode) return null;

    if (this.bridgeTerminal && vscode.window.terminals.includes(this.bridgeTerminal)) {
      if (show) this.bridgeTerminal.show(true);
      return this.bridgeTerminal;
    }

    this.bridgeTerminal = vscode.window.createTerminal({
      name: 'Voice Dev Bridge',
      iconPath: new vscode.ThemeIcon('mic')
    });

    if (show) {
      this.bridgeTerminal.show(true);
    }
    return this.bridgeTerminal;
  }

  /**
   * Sends text directly to the interactive terminal.
   */
  public sendCommandToTerminal(command: string, addNewLine: boolean = true, show: boolean = true): void {
    const term = this.getOrCreateTerminal(show);
    if (term) {
      term.sendText(command, addNewLine);
    }
  }

  /**
   * Executes a command headlessly and captures stdout/stderr.
   * Runs in the current workspace folder.
   */
  public executeCommandWithOutput(
    command: string,
    cwd?: string,
    timeoutMs: number = 30000
  ): Promise<TerminalExecutionResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const workingDir = cwd || this.getWorkspaceRoot() || process.cwd();

      const isWin = process.platform === 'win32';
      const shell = isWin ? (process.env.ComSpec || 'cmd.exe') : '/bin/bash';

      child_process.exec(
        command,
        {
          cwd: workingDir,
          shell: shell,
          timeout: timeoutMs,
          maxBuffer: 5 * 1024 * 1024 // 5MB buffer
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - startTime;
          const exitCode = error && error.code !== undefined ? (typeof error.code === 'number' ? error.code : 1) : 0;

          // Limit output length so LLM context isn't overwhelmed
          const maxOutputChars = 8000;
          let truncatedStdout = stdout;
          let truncatedStderr = stderr;

          if (truncatedStdout.length > maxOutputChars) {
            truncatedStdout = truncatedStdout.substring(0, maxOutputChars) + `\n...[Output truncated, total ${stdout.length} chars]`;
          }
          if (truncatedStderr.length > maxOutputChars) {
            truncatedStderr = truncatedStderr.substring(0, maxOutputChars) + `\n...[Stderr truncated, total ${stderr.length} chars]`;
          }

          resolve({
            command,
            exitCode,
            stdout: truncatedStdout,
            stderr: truncatedStderr,
            durationMs
          });
        }
      );
    });
  }

  /**
   * Runs a prompt through Claude Code CLI
   */
  public runClaudePrompt(prompt: string, cwd?: string): Promise<TerminalExecutionResult> {
    const safePrompt = prompt.replace(/"/g, '\\"');
    const cmd = `"${this.claudeCliPath}" -p "${safePrompt}"`;
    return this.executeCommandWithOutput(cmd, cwd, 60000);
  }

  /**
   * Runs an Antigravity CLI command
   */
  public runAntigravityCommand(args: string, cwd?: string): Promise<TerminalExecutionResult> {
    const cmd = `"${this.antigravityCliPath}" ${args}`;
    return this.executeCommandWithOutput(cmd, cwd, 45000);
  }

  public getWorkspaceRoot(): string | undefined {
    if (vscode && vscode.workspace && Array.isArray(vscode.workspace.workspaceFolders) && vscode.workspace.workspaceFolders.length > 0) {
      return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
    return process.cwd();
  }
}
