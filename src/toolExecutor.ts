import * as path from 'path';
import * as fs from 'fs';
import { ToolDeclaration, GeminiFunctionCall, GeminiFunctionResponse } from './types';
import { TerminalIntegrationManager } from './terminalIntegration';

let vscode: any;
try {
  vscode = require('vscode');
} catch {
  vscode = null;
}

export const GEMINI_TOOLS: ToolDeclaration[] = [
  {
    name: 'read_file',
    description: 'Read contents of a file in the workspace. Supports specifying line ranges.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative or absolute file path to read'
        },
        start_line: {
          type: 'integer',
          description: 'Optional starting line (1-indexed)'
        },
        end_line: {
          type: 'integer',
          description: 'Optional ending line (1-indexed)'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'get_workspace_tree',
    description: 'Explore the workspace directory structure and file tree.',
    parameters: {
      type: 'object',
      properties: {
        depth: {
          type: 'integer',
          description: 'Maximum traversal depth (default: 2, max: 4)'
        },
        sub_dir: {
          type: 'string',
          description: 'Optional subfolder path within workspace'
        }
      }
    }
  },
  {
    name: 'get_active_editor',
    description: 'Get the currently active editor file path, language, visible code, and user selection.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'run_terminal_command',
    description: 'Execute a shell command (or CLI tool such as git, npm, claude, agy-node). Set interactive=true to run visibly in the VS Code terminal.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command string to run'
        },
        interactive: {
          type: 'boolean',
          description: 'If true, opens and runs the command inside the visible VS Code integrated terminal instead of headless background'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to write (relative to workspace or absolute)'
        },
        content: {
          type: 'string',
          description: 'Text content to write to the file'
        }
      },
      required: ['path', 'content']
    }
  }
];

export class ToolExecutor {
  private terminalManager: TerminalIntegrationManager;

  constructor(terminalManager: TerminalIntegrationManager) {
    this.terminalManager = terminalManager;
  }

  public async executeToolCall(call: GeminiFunctionCall): Promise<GeminiFunctionResponse> {
    const { id, name, args } = call;
    let output: any;

    try {
      switch (name) {
        case 'read_file':
          output = await this.readFile(
            args.path,
            args.start_line ?? args.startLine,
            args.end_line ?? args.endLine
          );
          break;
        case 'get_workspace_tree':
          output = await this.getWorkspaceTree(
            args.depth,
            args.sub_dir ?? args.subDir ?? args.subDirectory
          );
          break;
        case 'get_active_editor':
          output = await this.getActiveEditor();
          break;
        case 'run_terminal_command':
          output = await this.runTerminalCommand(
            args.command,
            Boolean(args.interactive)
          );
          break;
        case 'write_file':
          output = await this.writeFile(args.path, args.content);
          break;
        default:
          output = { error: `Unknown tool name: ${name}` };
      }
    } catch (err: any) {
      output = { error: `Tool execution failed: ${err.message || String(err)}` };
    }

    return {
      id,
      response: { output }
    };
  }

  public async readFile(filePath: string, startLine?: number, endLine?: number): Promise<any> {
    const root = this.terminalManager.getWorkspaceRoot() || process.cwd();
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);

    if (!fs.existsSync(resolvedPath)) {
      return { error: `File not found: ${filePath}` };
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      return { error: `Path is a directory, not a file: ${filePath}` };
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    const normalized = content.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const totalLines = lines.length;

    let sLine = 1;
    let eLine = totalLines;

    const numStart = startLine !== undefined ? Number(startLine) : undefined;
    const numEnd = endLine !== undefined ? Number(endLine) : undefined;

    if (numStart !== undefined && numStart > 0) {
      sLine = Math.min(numStart, totalLines);
    }
    if (numEnd !== undefined && numEnd >= sLine) {
      eLine = Math.min(numEnd, totalLines);
    }

    let selectedLines = lines.slice(sLine - 1, eLine);

    // Limit to 500 lines to avoid blowing context
    if (selectedLines.length > 500) {
      selectedLines = selectedLines.slice(0, 500);
      return {
        path: filePath,
        startLine: sLine,
        endLine: sLine + 499,
        totalLines,
        truncated: true,
        content: selectedLines.map((l, i) => `${sLine + i}: ${l}`).join('\n')
      };
    }

    return {
      path: filePath,
      startLine: sLine,
      endLine: eLine,
      totalLines,
      content: selectedLines.map((l, i) => `${sLine + i}: ${l}`).join('\n')
    };
  }

  public async writeFile(filePath: string, content: string): Promise<any> {
    try {
      const root = this.terminalManager.getWorkspaceRoot() || process.cwd();
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);

      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, content, 'utf8');

      return {
        path: filePath,
        bytesWritten: Buffer.byteLength(content, 'utf8'),
        success: true
      };
    } catch (err: any) {
      return { error: `Failed to write file ${filePath}: ${err.message}` };
    }
  }

  public async getWorkspaceTree(depth: number = 2, subDir?: string): Promise<any> {
    const root = this.terminalManager.getWorkspaceRoot() || process.cwd();
    const baseDir = subDir ? path.resolve(root, subDir) : root;

    if (!fs.existsSync(baseDir)) {
      return { error: `Directory not found: ${subDir || '.'}` };
    }

    const numDepth = depth !== undefined ? Number(depth) : 2;
    const maxDepth = Math.min(Math.max(numDepth, 1), 4);
    const ignoreSet = new Set(['node_modules', '.git', '.vscode', 'dist', '__pycache__', '.system_generated']);

    function walk(dir: string, currentDepth: number): any[] {
      if (currentDepth > maxDepth) return [];
      const entries: any[] = [];
      try {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const f of files) {
          if (ignoreSet.has(f.name)) continue;
          if (f.name.startsWith('.') && f.name !== '.env.example') continue;

          if (f.isDirectory()) {
            entries.push({
              name: f.name,
              type: 'dir',
              children: walk(path.join(dir, f.name), currentDepth + 1)
            });
          } else {
            entries.push({
              name: f.name,
              type: 'file'
            });
          }
        }
      } catch (err: any) {
        entries.push({ error: err.message });
      }
      return entries;
    }

    const tree = walk(baseDir, 1);
    return {
      baseDir: path.relative(root, baseDir) || '.',
      tree
    };
  }

  public async getActiveEditor(): Promise<any> {
    if (!vscode || !vscode.window || !vscode.window.activeTextEditor) {
      return { status: 'No active text editor tab open (or running outside VS Code)' };
    }

    const editor = vscode.window.activeTextEditor;
    const document = editor.document;
    const selection = editor.selection;
    const selectedText = document.getText(selection);

    const root = this.terminalManager.getWorkspaceRoot();
    const relPath = root ? path.relative(root, document.fileName) : document.fileName;

    let visibleSnippet = '';
    if (editor.visibleRanges && editor.visibleRanges.length > 0) {
      visibleSnippet = document.getText(editor.visibleRanges[0]);
    }
    if (!visibleSnippet) {
      visibleSnippet = document.getText().substring(0, 2000);
    }

    return {
      filePath: relPath,
      languageId: document.languageId,
      lineCount: document.lineCount,
      cursorPosition: editor.selection && editor.selection.active ? {
        line: editor.selection.active.line + 1,
        character: editor.selection.active.character + 1
      } : null,
      hasSelection: !selection.isEmpty,
      selectedLineRange: !selection.isEmpty ? {
        start: selection.start.line + 1,
        end: selection.end.line + 1
      } : null,
      selectedText: selectedText ? (selectedText.length > 2000 ? selectedText.substring(0, 2000) + '...' : selectedText) : null,
      visibleSnippet
    };
  }

  public async runTerminalCommand(command: string, interactive: boolean = false): Promise<any> {
    if (interactive) {
      this.terminalManager.sendCommandToTerminal(command, true, true);
      return {
        command,
        interactive: true,
        status: 'Command sent to integrated terminal session'
      };
    }

    const res = await this.terminalManager.executeCommandWithOutput(command);
    return {
      command: res.command,
      exitCode: res.exitCode,
      durationMs: res.durationMs,
      stdout: res.stdout,
      stderr: res.stderr
    };
  }
}
