import * as path from 'path';
import * as child_process from 'child_process';
import { AmbientSnapshot } from './types';

let vscode: any;
try {
  vscode = require('vscode');
} catch {
  vscode = null;
}

export class AmbientTelemetry {
  private workspaceRoot?: string;
  private recentTerminalOutput: string = '';
  private detectedDevServers: Set<string> = new Set();
  private gitBranch?: string;
  private gitStatusSummary?: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot;
    if (this.workspaceRoot) {
      this.refreshGitInfo().catch(() => {});
    }
  }

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
    this.refreshGitInfo().catch(() => {});
  }

  public setGitInfo(branch: string, statusSummary: string): void {
    this.gitBranch = branch;
    this.gitStatusSummary = statusSummary;
  }

  public async refreshGitInfo(): Promise<void> {
    if (!this.workspaceRoot) return;
    try {
      const branchPromise = new Promise<string>((resolve) => {
        child_process.exec('git rev-parse --abbrev-ref HEAD', { cwd: this.workspaceRoot, timeout: 3000 }, (err, stdout) => {
          resolve(err ? '' : (stdout || '').trim());
        });
      });
      const statusPromise = new Promise<string>((resolve) => {
        child_process.exec('git status --porcelain', { cwd: this.workspaceRoot, timeout: 3000 }, (err, stdout) => {
          resolve(err ? '' : (stdout || '').trim());
        });
      });

      const [branch, status] = await Promise.all([branchPromise, statusPromise]);
      if (branch) {
        this.gitBranch = branch;
      }
      if (status !== undefined) {
        const lines = status.split('\n').map((l) => l.trim()).filter(Boolean);
        this.gitStatusSummary = lines.length === 0 ? 'clean' : `${lines.length} changed`;
      }
    } catch {
      // Ignore git errors
    }
  }

  public setDevServers(servers: string[]): void {
    servers.forEach((s) => this.detectedDevServers.add(s));
  }

  public updateTerminalOutput(text: string): void {
    // Keep last 1500 chars of terminal output
    this.recentTerminalOutput = (this.recentTerminalOutput + '\n' + text).slice(-1500);

    // Sniff for dev-server URLs: e.g. http://localhost:3000, http://127.0.0.1:5173, http://0.0.0.0:8000
    const serverRegex = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/gi;
    let match: RegExpExecArray | null;
    while ((match = serverRegex.exec(text)) !== null) {
      const url = match[0].replace('0.0.0.0', 'localhost');
      this.detectedDevServers.add(url);
    }
  }

  public registerWatchers(context?: any): void {
    this.registerTerminalWatcher();
    if (!vscode) return;

    try {
      if (vscode.workspace && vscode.workspace.onDidSaveTextDocument) {
        const disposable = vscode.workspace.onDidSaveTextDocument(() => {
          this.refreshGitInfo().catch(() => {});
        });
        if (context && context.subscriptions) {
          context.subscriptions.push(disposable);
        }
      }
    } catch {
      // Ignore
    }
  }

  public registerTerminalWatcher(terminal?: any): void {
    if (!vscode) return;

    try {
      if (vscode.window.onDidWriteTerminalData) {
        vscode.window.onDidWriteTerminalData((e: any) => {
          if (!terminal || e.terminal === terminal) {
            this.updateTerminalOutput(e.data);
          }
        });
      }
    } catch {
      // In older VS Code or restricted sandbox, terminal data sniffer may not be available
    }
  }

  public getSnapshot(): AmbientSnapshot {
    let activeFile: string | undefined;
    let languageId: string | undefined;
    let cursorLine: number | undefined;
    let errors = 0;
    let warnings = 0;

    if (vscode && vscode.window && vscode.window.activeTextEditor) {
      const editor = vscode.window.activeTextEditor;
      const doc = editor.document;
      languageId = doc.languageId;
      cursorLine = editor.selection?.active ? editor.selection.active.line + 1 : undefined;

      const root = this.workspaceRoot || (vscode.workspace?.workspaceFolders?.[0]?.uri.fsPath);
      activeFile = root ? path.relative(root, doc.fileName) : doc.fileName;
    }

    if (vscode && vscode.languages && vscode.languages.getDiagnostics) {
      try {
        const diags = vscode.languages.getDiagnostics();
        for (const [, fileDiags] of diags) {
          for (const d of fileDiags) {
            if (d.severity === 0) errors++; // DiagnosticSeverity.Error = 0
            else if (d.severity === 1) warnings++; // DiagnosticSeverity.Warning = 1
          }
        }
      } catch {
        // Fallback
      }
    }

    return {
      activeFile,
      languageId,
      cursorLine,
      diagnosticsCount: { errors, warnings },
      gitBranch: this.gitBranch,
      gitStatusSummary: this.gitStatusSummary,
      detectedDevServers: Array.from(this.detectedDevServers),
      recentTerminalOutput: this.recentTerminalOutput.trim() || undefined
    };
  }

  /**
   * Generates a compact prompt context header (<120 tokens) for Gemini Live.
   */
  public getPromptContext(): string {
    const snap = this.getSnapshot();
    const parts: string[] = [];

    if (snap.activeFile) {
      const lineStr = snap.cursorLine ? `:${snap.cursorLine}` : '';
      const langStr = snap.languageId ? ` (${snap.languageId})` : '';
      parts.push(`File: ${snap.activeFile}${lineStr}${langStr}`);
    }

    parts.push(`Diag: ${snap.diagnosticsCount.errors} err/${snap.diagnosticsCount.warnings} warn`);

    if (snap.gitBranch) {
      const stat = snap.gitStatusSummary ? ` (${snap.gitStatusSummary})` : '';
      parts.push(`Git: ${snap.gitBranch}${stat}`);
    }

    if (snap.detectedDevServers.length > 0) {
      parts.push(`Dev: ${snap.detectedDevServers.slice(0, 2).join(', ')}`);
    }

    return `[Context: ${parts.join(' | ')}]`;
  }
}
