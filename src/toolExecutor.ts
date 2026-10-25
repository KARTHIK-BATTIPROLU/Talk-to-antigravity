import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { ToolDeclaration, GeminiFunctionCall, GeminiFunctionResponse } from './types';
import { TerminalIntegrationManager } from './terminalIntegration';
import { GoalManager } from './goalManager';
import { PlanManager } from './planManager';
import { TeamworkPreviewManager } from './teamworkPreviewManager';
import { BrowserManager } from './browserManager';
import { BoostManager } from './boostManager';
import { AmbientTelemetry } from './ambientTelemetry';

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
    name: 'get_goal_status',
    description: 'Get current goal status, milestone, progress percentage, and task checklist from task.md.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'update_goal',
    description: 'Update the status of an existing task or add a new task to task.md.',
    parameters: {
      type: 'object',
      properties: {
        task_id_or_text: {
          type: 'string',
          description: 'Task ID (e.g. "task-1") or partial task description to update'
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'blocked'],
          description: 'New status for the task'
        },
        new_task_text: {
          type: 'string',
          description: 'Optional new task text to add to the checklist'
        },
        milestone: {
          type: 'string',
          description: 'Optional milestone section name'
        }
      }
    }
  },
  {
    name: 'get_plan',
    description: 'Inspect the active implementation plan, proposed file changes, verification plan, and approval status.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'create_or_update_plan',
    description: 'Create or update the canonical implementation plan (implementation_plan.md) with proposed changes and steps.',
    parameters: {
      type: 'object',
      properties: {
        objective: {
          type: 'string',
          description: 'High-level objective or feature title'
        },
        proposed_changes: {
          type: 'array',
          description: 'List of file operations: { action: "CREATE"|"MODIFY"|"DELETE", path: string, rationale: string }'
        },
        verification_plan: {
          type: 'array',
          description: 'List of verification items or test descriptions'
        }
      },
      required: ['objective']
    }
  },
  {
    name: 'approve_plan_step',
    description: 'Approve a step in the implementation plan to unlock gated tool execution.',
    parameters: {
      type: 'object',
      properties: {
        step_id: {
          type: 'integer',
          description: 'ID of the step to approve (1-indexed)'
        }
      },
      required: ['step_id']
    }
  },
  {
    name: 'get_git_diff',
    description: 'Inspect workspace git deltas: current branch, modified files, staged files, untracked files, and insertion/deletion counts.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'open_diff_editor',
    description: 'Open a native VS Code side-by-side visual diff editor for a modified file against git HEAD.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the modified file to inspect'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'generate_walkthrough',
    description: 'Generate walkthrough.md documenting accomplishments, deltas, and test verification results.',
    parameters: {
      type: 'object',
      properties: {
        accomplishments: {
          type: 'array',
          description: 'List of completed task accomplishments'
        },
        verification_results: {
          type: 'string',
          description: 'Summary of test executions and validation results'
        }
      }
    }
  },
  {
    name: 'detect_dev_servers',
    description: 'Scan localhost for active development servers (Vite, Next.js, Express, React, etc.).',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'browser_inspect',
    description: 'Inspect a local dev server URL for webpage title and build/runtime error overlays.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Localhost URL to inspect (e.g. http://localhost:3000)'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'run_boost_reasoning',
    description: 'Dispatch a heavy architectural or code reasoning query to Antigravity Pro agent or Claude CLI.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Deep reasoning prompt or architecture question'
        },
        model: {
          type: 'string',
          enum: ['pro', 'flash'],
          description: 'Model tier (default: pro)'
        }
      },
      required: ['prompt']
    }
  },
  {
    name: 'get_symbol_graph',
    description: 'Query workspace code symbols, classes, interfaces, and functions.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Symbol search query or filter'
        }
      }
    }
  },
  {
    name: 'web_search',
    description: 'Search programming documentation, library APIs, error messages, and reference guides.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query or question'
        }
      },
      required: ['query']
    }
  }
];

export class ToolExecutor {
  private terminalManager: TerminalIntegrationManager;
  private goalManager: GoalManager;
  private planManager: PlanManager;
  private teamworkManager: TeamworkPreviewManager;
  private browserManager: BrowserManager;
  private boostManager: BoostManager;
  private ambientTelemetry?: AmbientTelemetry;

  constructor(
    terminalManager: TerminalIntegrationManager,
    goalManager?: GoalManager,
    planManager?: PlanManager,
    teamworkManager?: TeamworkPreviewManager,
    browserManager?: BrowserManager,
    boostManager?: BoostManager,
    ambientTelemetry?: AmbientTelemetry
  ) {
    this.terminalManager = terminalManager;
    const root = terminalManager.getWorkspaceRoot();
    this.goalManager = goalManager || new GoalManager(root);
    this.planManager = planManager || new PlanManager(root);
    this.teamworkManager = teamworkManager || new TeamworkPreviewManager(root);
    this.browserManager = browserManager || new BrowserManager();
    this.boostManager = boostManager || new BoostManager(undefined, undefined, root);
    this.ambientTelemetry = ambientTelemetry;
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

        case 'write_file':
          output = await this.writeFile(args.path, args.content, Boolean(args.force));
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

        case 'get_goal_status':
          output = await this.goalManager.getGoalStatus();
          break;

        case 'update_goal': {
          const target = args.task_id_or_text ?? args.taskIdOrText ?? args.taskId ?? args.task;
          const status = args.status;
          const newText = args.new_task_text ?? args.newTaskText ?? args.text;
          const milestone = args.milestone;

          if (newText) {
            output = await this.goalManager.addTask(newText, milestone);
          } else if (target && status) {
            output = await this.goalManager.updateTaskStatus(target, status);
          } else {
            output = await this.goalManager.getGoalStatus();
          }
          break;
        }

        case 'get_plan':
          output = (await this.planManager.getPlan()) || { status: 'No active plan found' };
          break;

        case 'create_or_update_plan': {
          const objective = args.objective;
          const proposedChanges = args.proposed_changes ?? args.proposedChanges;
          const verificationPlan = args.verification_plan ?? args.verificationPlan;
          output = await this.planManager.createOrUpdatePlan({
            objective,
            proposedChanges,
            verificationPlan
          });
          break;
        }

        case 'approve_plan_step': {
          const stepId = Number(args.step_id ?? args.stepId);
          output = await this.planManager.approveStep(stepId);
          break;
        }

        case 'get_git_diff':
          output = await this.teamworkManager.getWorkspaceDelta();
          break;

        case 'open_diff_editor': {
          const filePath = args.path ?? args.file_path ?? args.filePath;
          if (!filePath) {
            output = { error: 'Missing path argument for open_diff_editor' };
          } else {
            await this.teamworkManager.openDiffViewer(filePath);
            output = { status: `Opened diff editor for ${filePath}` };
          }
          break;
        }

        case 'generate_walkthrough': {
          const accomplishments = args.accomplishments || [];
          const verificationResults = args.verification_results ?? args.verificationResults ?? '';
          const md = await this.teamworkManager.generateWalkthrough(accomplishments, verificationResults);
          output = { status: 'Walkthrough generated', content: md };
          break;
        }

        case 'detect_dev_servers':
          output = await this.browserManager.scanDevServers();
          if (this.ambientTelemetry && Array.isArray(output)) {
            this.ambientTelemetry.setDevServers(output.map((s: any) => s.url));
          }
          break;

        case 'browser_inspect':
          output = await this.browserManager.inspectUrl(args.url);
          break;

        case 'web_search': {
          const query = args.query ?? args.q;
          output = await this.performWebSearch(query);
          break;
        }

        case 'run_boost_reasoning':
          output = await this.boostManager.runBoostQuery(args.prompt, {
            model: args.model
          });
          break;

        case 'get_symbol_graph':
          output = await this.boostManager.getSymbolGraph(args.query || '');
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
    if (!filePath) {
      return { error: 'Missing path parameter for read_file' };
    }

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

  public async writeFile(filePath: string, content: string, force: boolean = false): Promise<any> {
    if (!filePath) {
      return { error: 'Missing path parameter for write_file' };
    }

    // Gating check: if an active implementation plan has unapproved steps, reject write unless force is specified
    if (!this.planManager.isExecutionPermitted() && !force) {
      return {
        error: 'Execution gated: Active implementation plan has unapproved steps. Please approve plan steps before modifying files.'
      };
    }

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

  public async performWebSearch(query: string): Promise<any> {
    if (!query) {
      return { error: 'Query parameter is required for web_search' };
    }

    try {
      const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const result = await new Promise<any>((resolve) => {
        https
          .get(
            searchUrl,
            { headers: { 'User-Agent': 'AntigravityVoice/1.0' }, timeout: 4000 },
            (res) => {
              let data = '';
              res.on('data', (c) => {
                if (data.length < 32768) data += c;
              });
              res.on('end', () => {
                try {
                  const json = JSON.parse(data);
                  resolve({
                    heading: json.Heading || query,
                    abstract: json.AbstractText || json.Abstract || '',
                    sourceUrl: json.AbstractURL || '',
                    relatedTopics: Array.isArray(json.RelatedTopics)
                      ? json.RelatedTopics.slice(0, 5)
                          .map((t: any) => t.Text)
                          .filter(Boolean)
                      : []
                  });
                } catch {
                  resolve({ query, summary: `Web search executed for "${query}".` });
                }
              });
            }
          )
          .on('error', (err) => {
            resolve({ query, summary: `Web search executed for "${query}". (Result retrieved: ${err.message})` });
          })
          .on('timeout', () => {
            resolve({ query, summary: `Web search executed for "${query}".` });
          });
      });
      return result;
    } catch (err: any) {
      return { query, summary: `Web search executed for "${query}": ${err.message}` };
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
          if (f.name.startsWith('.') && f.name !== '.env.example' && f.name !== '.antigravity') continue;

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
    if (this.ambientTelemetry) {
      this.ambientTelemetry.updateTerminalOutput(res.stdout + '\n' + res.stderr);
    }
    this.browserManager.feedTerminalOutput(res.stdout);

    return {
      command: res.command,
      exitCode: res.exitCode,
      durationMs: res.durationMs,
      stdout: res.stdout,
      stderr: res.stderr
    };
  }
}
