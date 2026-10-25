import * as vscode from 'vscode';
import {
  VoiceState,
  TranscriptEntry,
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  GoalStatus,
  GoalTask,
  PlanData,
  WorkspaceDelta,
  DevServerInfo
} from './types';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'talking-to-antigravity.sidebarView';
  private _view?: vscode.WebviewView;

  // Event callbacks for commands initiated from the webview UI
  public onStartRequested?: () => void;
  public onStopRequested?: () => void;
  public onToggleMuteRequested?: () => void;
  public onInterruptRequested?: () => void;
  public onTextPromptRequested?: (text: string) => void;
  public onTerminalCommandRequested?: (command: string) => void;
  public onMicChunkReceived?: (pcmB64: string, rms: number) => void;
  public onClearTranscriptRequested?: () => void;

  // Pillar Callbacks
  public onGetGoalRequested?: () => void;
  public onUpdateTaskStatusRequested?: (taskIdOrText: string, status: GoalTask['status']) => void;
  public onAddTaskRequested?: (text: string, milestone?: string) => void;
  public onGetPlanRequested?: () => void;
  public onApprovePlanStepRequested?: (stepId: number) => void;
  public onGetTeamworkRequested?: () => void;
  public onOpenDiffRequested?: (filePath: string) => void;
  public onScanDevServersRequested?: () => void;
  public onRunBoostRequested?: (prompt: string, model?: 'pro' | 'flash') => void;
  public onOpenExternalRequested?: (url: string) => void;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      switch (message.type) {
        case 'startSession':
          this.onStartRequested?.();
          break;
        case 'stopSession':
          this.onStopRequested?.();
          break;
        case 'toggleMute':
          this.onToggleMuteRequested?.();
          break;
        case 'interrupt':
          this.onInterruptRequested?.();
          break;
        case 'sendTextMessage':
          if (message.text.trim()) {
            this.onTextPromptRequested?.(message.text.trim());
          }
          break;
        case 'executeTerminalCommand':
          if (message.command.trim()) {
            this.onTerminalCommandRequested?.(message.command.trim());
          }
          break;
        case 'micPcmChunk':
          this.onMicChunkReceived?.(message.data, message.rms);
          break;
        case 'clearTranscript':
          this.onClearTranscriptRequested?.();
          break;
        case 'getGoal':
          this.onGetGoalRequested?.();
          break;
        case 'updateTaskStatus':
          this.onUpdateTaskStatusRequested?.(message.taskIdOrText, message.status);
          break;
        case 'addTask':
          this.onAddTaskRequested?.(message.text, message.milestone);
          break;
        case 'getPlan':
          this.onGetPlanRequested?.();
          break;
        case 'approvePlanStep':
          this.onApprovePlanStepRequested?.(message.stepId);
          break;
        case 'getTeamworkPreview':
          this.onGetTeamworkRequested?.();
          break;
        case 'openDiff':
          this.onOpenDiffRequested?.(message.filePath);
          break;
        case 'scanDevServers':
          this.onScanDevServersRequested?.();
          break;
        case 'runBoost':
          this.onRunBoostRequested?.(message.prompt, message.model);
          break;
        case 'openExternal':
          this.onOpenExternalRequested?.(message.url);
          break;
        case 'switchTab':
          this.switchTab(message.tab);
          break;
      }
    });

    // Request initial data on mount
    setTimeout(() => {
      this.onGetGoalRequested?.();
      this.onGetPlanRequested?.();
      this.onGetTeamworkRequested?.();
      this.onScanDevServersRequested?.();
    }, 500);
  }

  public postMessage(message: ExtensionToWebviewMessage): void {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  public updateState(state: VoiceState, details?: string): void {
    this.postMessage({ type: 'stateChange', state, details });
  }

  public sendAudioChunk(b64Data: string): void {
    this.postMessage({ type: 'audioChunk', data: b64Data });
  }

  public sendMicRms(rms: number): void {
    this.postMessage({ type: 'micRms', rms });
  }

  public sendTranscript(entry: TranscriptEntry): void {
    this.postMessage({ type: 'transcript', entry });
  }

  public updateTranscript(
    id: string,
    partialText?: string,
    toolResult?: any,
    status?: 'running' | 'success' | 'error'
  ): void {
    this.postMessage({ type: 'transcriptUpdate', id, partialText, toolResult, status });
  }

  public notifyInterrupted(): void {
    this.postMessage({ type: 'interrupted' });
  }

  public startWebviewMic(): void {
    this.postMessage({ type: 'startWebviewMic' });
  }

  public stopWebviewMic(): void {
    this.postMessage({ type: 'stopWebviewMic' });
  }

  public sendGoalUpdate(data: GoalStatus): void {
    this.postMessage({ type: 'goalUpdate', data });
  }

  public sendPlanUpdate(data: PlanData | null): void {
    this.postMessage({ type: 'planUpdate', data });
  }

  public sendTeamworkUpdate(delta: WorkspaceDelta, walkthrough?: string): void {
    this.postMessage({ type: 'teamworkUpdate', delta, walkthrough });
  }

  public sendDevServersUpdate(servers: DevServerInfo[]): void {
    this.postMessage({ type: 'devServersUpdate', servers });
  }

  public sendBoostProgress(message: string): void {
    this.postMessage({ type: 'boostProgress', message });
  }

  public sendBoostComplete(result: string): void {
    this.postMessage({ type: 'boostComplete', result });
  }

  public sendUserCaption(text: string): void {
    this.postMessage({ type: 'userCaption', text });
  }

  public sendModelCaption(text: string): void {
    this.postMessage({ type: 'modelCaption', text });
  }

  public switchTab(tab: string): void {
    this.postMessage({ type: 'activeTab', tab });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Antigravity Voice Companion</title>
  <style>
    :root {
      --bg-color: var(--vscode-editor-background, #1e1e1e);
      --card-bg: var(--vscode-sideBar-background, #252526);
      --text-color: var(--vscode-editor-foreground, #d4d4d4);
      --accent-color: #3b82f6;
      --accent-hover: #2563eb;
      --border-color: var(--vscode-panel-border, #3c3c3c);
      --danger-color: #ef4444;
      --success-color: #10b981;
      --warning-color: #f59e0b;
      --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background-color: var(--bg-color);
      color: var(--text-color);
      font-family: var(--font-family);
      font-size: var(--vscode-font-size, 13px);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* Tab Navigation */
    .tab-nav {
      display: flex;
      background: var(--card-bg);
      border-bottom: 1px solid var(--border-color);
      overflow-x: auto;
      scrollbar-width: none;
      flex-shrink: 0;
    }
    .tab-nav::-webkit-scrollbar { display: none; }

    .tab-btn {
      flex: 1;
      padding: 9px 8px;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-color);
      opacity: 0.7;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      text-align: center;
      transition: all 0.15s ease;
    }
    .tab-btn:hover { opacity: 1; background: rgba(255, 255, 255, 0.04); }
    .tab-btn.active {
      opacity: 1;
      color: #60a5fa;
      border-bottom-color: #3b82f6;
      background: rgba(59, 130, 246, 0.08);
    }

    .tab-content {
      display: none;
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      flex-direction: column;
      gap: 12px;
    }
    .tab-content.active {
      display: flex;
    }

    /* Generative UI Card */
    .gen-card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      padding-bottom: 6px;
    }

    .card-title {
      font-weight: 700;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Progress bar */
    .progress-bar-container {
      width: 100%;
      height: 8px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      overflow: hidden;
      margin: 4px 0;
    }
    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #10b981);
      width: 0%;
      transition: width 0.3s ease;
    }

    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: 9999px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-completed { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .badge-progress { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
    .badge-pending { background: rgba(156, 163, 175, 0.2); color: #9ca3af; }
    .badge-blocked { background: rgba(239, 68, 68, 0.2); color: #f87171; }

    /* Interactive List Items */
    .task-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.05);
      cursor: pointer;
      transition: background 0.15s;
    }
    .task-item:hover { background: rgba(255, 255, 255, 0.06); }
    .task-checkbox {
      width: 15px;
      height: 15px;
      cursor: pointer;
    }
    .task-text {
      flex: 1;
      font-size: 12px;
      word-break: break-word;
    }
    .task-text.completed {
      text-decoration: line-through;
      opacity: 0.6;
    }

    /* Voice Tab Components */
    .top-panel {
      padding: 10px;
      background: var(--card-bg);
      border-radius: 8px;
      border: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border-radius: 9999px;
      font-weight: 600;
      font-size: 11px;
      background: rgba(255, 255, 255, 0.08);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #9ca3af;
    }

    .state-listening .status-dot { background: #10b981; box-shadow: 0 0 8px #10b981; }
    .state-speaking .status-dot { background: #06b6d4; box-shadow: 0 0 8px #06b6d4; }
    .state-thinking .status-dot { background: #a855f7; box-shadow: 0 0 8px #a855f7; }

    .visualizer-container {
      width: 100%;
      height: 44px;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 6px;
      overflow: hidden;
    }
    canvas#visualizer { width: 100%; height: 100%; display: block; }

    .controls-row {
      display: flex;
      gap: 6px;
    }

    button.btn {
      flex: 1;
      padding: 7px 10px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      transition: all 0.15s;
    }
    .btn-primary { background: var(--accent-color); color: #fff; }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-danger { background: var(--danger-color); color: #fff; }
    .btn-secondary { background: rgba(255, 255, 255, 0.1); color: var(--text-color); flex: 0 0 auto; }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.18); }
    .btn-secondary.active { background: rgba(239, 68, 68, 0.25); color: #ef4444; border: 1px solid #ef4444; }

    .transcript-container {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .message-card {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-width: 95%;
    }
    .message-card.user { align-self: flex-end; }
    .message-card.model { align-self: flex-start; }
    .message-card.tool { align-self: stretch; max-width: 100%; }

    .message-bubble {
      padding: 7px 11px;
      border-radius: 8px;
      line-height: 1.4;
      font-size: 12px;
    }
    .message-card.user .message-bubble { background: #1e3a8a; color: #e0e7ff; }
    .message-card.model .message-bubble { background: #1f2937; color: #f3f4f6; border: 1px solid rgba(255, 255, 255, 0.06); }

    .tool-card {
      background: #111827;
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: 6px;
      padding: 7px 9px;
      font-family: monospace;
      font-size: 11px;
    }

    .input-bar {
      padding: 8px 12px;
      background: var(--card-bg);
      border-top: 1px solid var(--border-color);
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }
    .input-bar input, .form-input {
      flex: 1;
      padding: 6px 10px;
      border-radius: 4px;
      border: 1px solid var(--border-color);
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #fff);
      outline: none;
      font-size: 12px;
    }
    .input-bar input:focus, .form-input:focus { border-color: var(--accent-color); }
  </style>
</head>
<body class="state-idle">
  <!-- Top Tab Navigation -->
  <div class="tab-nav">
    <button class="tab-btn active" data-tab="voice">🎙️ Voice</button>
    <button class="tab-btn" data-tab="goal">🎯 Goal</button>
    <button class="tab-btn" data-tab="plan">📋 Plan</button>
    <button class="tab-btn" data-tab="teamwork">👥 Teamwork</button>
    <button class="tab-btn" data-tab="browser">🌐 Browser</button>
    <button class="tab-btn" data-tab="boost">⚡ Boost</button>
  </div>

  <!-- TAB 1: Voice -->
  <div id="tab-voice" class="tab-content active">
    <div class="top-panel">
      <div class="status-row">
        <div id="statusBadge" class="status-badge">
          <div class="status-dot"></div>
          <span id="statusText">Idle</span>
        </div>
        <span style="font-size: 11px; opacity: 0.6;">Gemini 2.5 Live</span>
      </div>

      <div class="visualizer-container">
        <canvas id="visualizer"></canvas>
      </div>

      <div class="controls-row">
        <button id="toggleBtn" class="btn btn-primary">
          <span id="toggleText">Start Voice</span>
        </button>
        <button id="muteBtn" class="btn btn-secondary" title="Mute Microphone">🔇</button>
        <button id="interruptBtn" class="btn btn-secondary" title="Interrupt Assistant">⏹️</button>
        <button id="clearBtn" class="btn btn-secondary" title="Clear Transcript">🗑️</button>
      </div>
    </div>

    <div id="transcript" class="transcript-container">
      <div class="message-card model">
        <div class="message-bubble">
          👋 Ready! Click <strong>Start Voice</strong> to begin speaking with Antigravity / Gemini Live. Use slash commands like <code>/goal</code>, <code>/plan</code>, <code>/teamwork-preview</code>, <code>/browser</code>, <code>/boost</code>.
        </div>
      </div>
    </div>
  </div>

  <!-- TAB 2: Goal (/goal) -->
  <div id="tab-goal" class="tab-content">
    <div class="gen-card">
      <div class="card-header">
        <div class="card-title">🎯 Goal & Progress Tracking</div>
        <button id="refreshGoalBtn" class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;">🔄 Refresh</button>
      </div>
      <div>
        <div style="font-size: 11px; opacity: 0.7;">Active Milestone:</div>
        <div id="goalMilestone" style="font-weight: 600; font-size: 13px; margin-top: 2px;">Loading...</div>
      </div>
      <div>
        <div style="display: flex; justify-content: space-between; font-size: 11px;">
          <span>Completion</span>
          <span id="goalPercentText">0%</span>
        </div>
        <div class="progress-bar-container">
          <div id="goalProgressBar" class="progress-bar-fill"></div>
        </div>
        <div id="goalMetricCounts" style="font-size: 10px; opacity: 0.6; margin-top: 3px;">0/0 tasks completed</div>
      </div>
      <div id="activeTaskBanner" style="background: rgba(59, 130, 246, 0.15); border-left: 3px solid #3b82f6; padding: 6px 8px; border-radius: 4px; font-size: 12px;">
        <strong>Active Task:</strong> <span id="activeTaskText">None</span>
      </div>
    </div>

    <div class="gen-card" style="flex: 1;">
      <div class="card-header">
        <div class="card-title">Checklist Items</div>
        <span id="goalSourcePath" style="font-size: 10px; opacity: 0.5;">task.md</span>
      </div>
      <div id="taskListContainer" style="display: flex; flex-direction: column; gap: 6px; overflow-y: auto; flex: 1;"></div>
      <div style="display: flex; gap: 6px; margin-top: 8px;">
        <input type="text" id="newTaskInput" class="form-input" placeholder="Add a new task..." />
        <button id="addTaskBtn" class="btn btn-primary" style="flex: 0 0 auto; padding: 6px 12px;">+ Add</button>
      </div>
    </div>
  </div>

  <!-- TAB 3: Plan (/plan) -->
  <div id="tab-plan" class="tab-content">
    <div class="gen-card">
      <div class="card-header">
        <div class="card-title">📋 Phased Implementation Plan</div>
        <button id="refreshPlanBtn" class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;">🔄 Refresh</button>
      </div>
      <div>
        <div style="font-size: 11px; opacity: 0.7;">Plan Objective:</div>
        <div id="planObjective" style="font-weight: 600; font-size: 13px; margin-top: 2px;">No active plan</div>
      </div>
      <div id="planGatingBanner" style="padding: 6px 8px; border-radius: 4px; font-size: 11px; background: rgba(245, 158, 11, 0.15); border-left: 3px solid #f59e0b;">
        🔒 Execution Gated: Awaiting Step Approvals
      </div>
    </div>

    <div class="gen-card">
      <div class="card-title">Proposed Changes</div>
      <div id="proposedChangesContainer" style="display: flex; flex-direction: column; gap: 6px;"></div>
    </div>

    <div class="gen-card" style="flex: 1;">
      <div class="card-title">Approval Steps</div>
      <div id="planStepsContainer" style="display: flex; flex-direction: column; gap: 6px; overflow-y: auto; flex: 1;"></div>
    </div>
  </div>

  <!-- TAB 4: Teamwork Preview (/teamwork-preview) -->
  <div id="tab-teamwork" class="tab-content">
    <div class="gen-card">
      <div class="card-header">
        <div class="card-title">👥 Teamwork Preview & Git Delta</div>
        <button id="refreshTeamworkBtn" class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;">🔄 Refresh</button>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 12px;">
        <span>Branch: <code id="gitBranch">main</code></span>
        <span id="gitSyncStat" style="opacity: 0.8;">Ahead: 0 | Behind: 0</span>
      </div>
      <div style="display: flex; gap: 12px; font-size: 11px; margin-top: 4px;">
        <span style="color: #10b981;">Lines Added: +<span id="gitInsertions">0</span></span>
        <span style="color: #ef4444;">Lines Removed: -<span id="gitDeletions">0</span></span>
      </div>
    </div>

    <div class="gen-card" style="flex: 1;">
      <div class="card-header">
        <div class="card-title">Working Tree Changes</div>
      </div>
      <div id="gitFilesContainer" style="display: flex; flex-direction: column; gap: 6px; overflow-y: auto; flex: 1;"></div>
      <button id="generateWalkthroughBtn" class="btn btn-primary" style="margin-top: 8px;">
        📝 Generate Walkthrough.md
      </button>
    </div>
  </div>

  <!-- TAB 5: Browser (/browser) -->
  <div id="tab-browser" class="tab-content">
    <div class="gen-card">
      <div class="card-header">
        <div class="card-title">🌐 Dev Server Discovery</div>
        <button id="scanDevServersBtn" class="btn btn-primary" style="padding: 4px 10px; font-size: 11px;">🔍 Scan Localhost</button>
      </div>
      <div style="font-size: 11px; opacity: 0.7;">
        Sniffs terminal stdout and probes loopback ports (3000, 5173, 8080, etc.).
      </div>
    </div>

    <div class="gen-card" style="flex: 1;">
      <div class="card-title">Detected Servers</div>
      <div id="devServersList" style="display: flex; flex-direction: column; gap: 8px; overflow-y: auto; flex: 1;">
        <div style="font-size: 12px; opacity: 0.6; text-align: center; padding: 20px 0;">No active dev servers detected yet.</div>
      </div>
    </div>
  </div>

  <!-- TAB 6: Boost (/boost) -->
  <div id="tab-boost" class="tab-content">
    <div class="gen-card">
      <div class="card-header">
        <div class="card-title">⚡ Turbocharged Deep-Reasoning</div>
        <span class="badge badge-progress">Antigravity Pro</span>
      </div>
      <div style="font-size: 11px; opacity: 0.8;">
        Delegates heavy reasoning to Antigravity native <code>agentapi.bat --model=pro</code> or Claude Code CLI while keeping Gemini Live voice responsive.
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
        <label style="font-size: 11px;">Model Tier:</label>
        <select id="boostModelSelect" class="form-input">
          <option value="pro">Antigravity Pro (agentapi --model=pro)</option>
          <option value="flash">Antigravity Flash (agentapi --model=flash)</option>
        </select>
        <textarea id="boostPromptInput" class="form-input" rows="3" placeholder="Enter deep architecture or codebase reasoning prompt..."></textarea>
        <button id="runBoostBtn" class="btn btn-primary">🚀 Run Boost Reasoning</button>
      </div>
    </div>

    <div class="gen-card" style="flex: 1;">
      <div class="card-title">Reasoning Output</div>
      <div id="boostStatus" style="font-size: 11px; opacity: 0.7;">Idle</div>
      <pre id="boostOutput" style="background: rgba(0,0,0,0.3); border-radius: 4px; padding: 8px; font-size: 11px; overflow-y: auto; flex: 1; white-space: pre-wrap; font-family: monospace;">Awaiting query...</pre>
    </div>
  </div>

  <!-- Input Bar (Active across all tabs) -->
  <div class="input-bar">
    <input type="text" id="textInput" placeholder="Type prompt or /command (/goal, /plan, /browser)..." />
    <button id="sendBtn" class="btn btn-secondary" style="padding: 6px 12px;">Send</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // Tab Switching
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    function setActiveTab(tabName) {
      tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
      });
      tabContents.forEach(content => {
        content.classList.toggle('active', content.id === 'tab-' + tabName);
      });
    }

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        setActiveTab(tab);
        if (tab === 'goal') vscode.postMessage({ type: 'getGoal' });
        if (tab === 'plan') vscode.postMessage({ type: 'getPlan' });
        if (tab === 'teamwork') vscode.postMessage({ type: 'getTeamworkPreview' });
        if (tab === 'browser') vscode.postMessage({ type: 'scanDevServers' });
      });
    });

    // Voice UI elements
    const statusText = document.getElementById('statusText');
    const toggleBtn = document.getElementById('toggleBtn');
    const toggleText = document.getElementById('toggleText');
    const muteBtn = document.getElementById('muteBtn');
    const interruptBtn = document.getElementById('interruptBtn');
    const clearBtn = document.getElementById('clearBtn');
    const transcript = document.getElementById('transcript');
    const textInput = document.getElementById('textInput');
    const sendBtn = document.getElementById('sendBtn');
    const canvas = document.getElementById('visualizer');
    const ctx = canvas.getContext('2d');

    let currentState = 'idle';
    let isMuted = false;
    let isInterrupted = false;

    // Web Audio Player (24kHz Gemini playback)
    let audioCtx = null;
    let nextAudioStartTime = 0;
    let activeSources = [];
    let analyser = null;
    let micRmsLevel = 0;

    function initAudioContext() {
      if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass({ sampleRate: 24000 });
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.8;
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    }

    function stopAllAudio() {
      isInterrupted = true;
      for (const src of activeSources) {
        try {
          src.stop(0);
          src.disconnect();
        } catch (e) {}
      }
      activeSources = [];
      if (audioCtx) {
        nextAudioStartTime = audioCtx.currentTime;
      }
    }

    function playPcmChunk(base64Pcm) {
      if (isInterrupted) return;
      initAudioContext();
      if (!audioCtx) return;

      const binaryStr = window.atob(base64Pcm);
      const len = binaryStr.length;
      if (len < 2) return;

      const evenLen = len - (len % 2);
      const bytes = new Uint8Array(evenLen);
      for (let i = 0; i < evenLen; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const int16Array = new Int16Array(bytes.buffer, 0, evenLen / 2);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const audioBuffer = audioCtx.createBuffer(1, float32Array.length, 24000);
      audioBuffer.copyToChannel(float32Array, 0);

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);

      const now = audioCtx.currentTime;
      const startTime = Math.max(now, nextAudioStartTime);
      source.start(startTime);
      nextAudioStartTime = startTime + audioBuffer.duration;

      activeSources.push(source);
      source.onended = () => {
        const idx = activeSources.indexOf(source);
        if (idx !== -1) activeSources.splice(idx, 1);
      };
    }

    // Visualizer Canvas
    function resizeCanvas() {
      canvas.width = canvas.clientWidth * window.devicePixelRatio;
      canvas.height = canvas.clientHeight * window.devicePixelRatio;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    function renderVisualizer() {
      requestAnimationFrame(renderVisualizer);
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const dataArray = new Uint8Array(analyser ? analyser.frequencyBinCount : 32);
      if (analyser && activeSources.length > 0) {
        analyser.getByteFrequencyData(dataArray);
      } else if (micRmsLevel > 0) {
        for (let i = 0; i < dataArray.length; i++) {
          const factor = Math.sin((i / dataArray.length) * Math.PI);
          dataArray[i] = Math.min(255, Math.floor(micRmsLevel * 255 * factor * (0.8 + Math.random() * 0.4)));
        }
      }

      const barWidth = (width / dataArray.length) * 1.5;
      let x = 0;

      for (let i = 0; i < dataArray.length; i++) {
        const barHeight = (dataArray[i] / 255.0) * (height * 0.85);
        let strokeStyle = '#3b82f6';
        if (currentState === 'speaking') strokeStyle = '#06b6d4';
        else if (currentState === 'listening') strokeStyle = '#10b981';
        else if (currentState === 'thinking') strokeStyle = '#a855f7';

        ctx.fillStyle = strokeStyle;
        const y = height / 2 - barHeight / 2;
        ctx.fillRect(x, y, Math.max(2, barWidth - 2), Math.max(2, barHeight));
        x += barWidth;
      }
    }
    renderVisualizer();

    // Voice control clicks
    toggleBtn.addEventListener('click', () => {
      initAudioContext();
      if (currentState === 'idle' || currentState === 'error') {
        vscode.postMessage({ type: 'startSession' });
      } else {
        vscode.postMessage({ type: 'stopSession' });
      }
    });

    muteBtn.addEventListener('click', () => {
      isMuted = !isMuted;
      muteBtn.classList.toggle('active', isMuted);
      vscode.postMessage({ type: 'toggleMute' });
    });

    interruptBtn.addEventListener('click', () => {
      stopAllAudio();
      vscode.postMessage({ type: 'interrupt' });
    });

    clearBtn.addEventListener('click', () => {
      transcript.innerHTML = '';
      vscode.postMessage({ type: 'clearTranscript' });
    });

    function sendText() {
      const text = textInput.value.trim();
      if (!text) return;
      textInput.value = '';

      if (text.startsWith('>') || text.startsWith('$ ')) {
        const cmd = text.replace(/^[>$]\s*/, '');
        vscode.postMessage({ type: 'executeTerminalCommand', command: cmd });
      } else {
        vscode.postMessage({ type: 'sendTextMessage', text });
      }
    }

    sendBtn.addEventListener('click', sendText);
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendText();
    });

    // Goal Buttons
    document.getElementById('refreshGoalBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'getGoal' });
    });

    document.getElementById('addTaskBtn').addEventListener('click', () => {
      const input = document.getElementById('newTaskInput');
      const text = input.value.trim();
      if (text) {
        input.value = '';
        vscode.postMessage({ type: 'addTask', text });
      }
    });

    // Plan Buttons
    document.getElementById('refreshPlanBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'getPlan' });
    });

    // Teamwork Buttons
    document.getElementById('refreshTeamworkBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'getTeamworkPreview' });
    });

    document.getElementById('generateWalkthroughBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'sendTextMessage', text: '/teamwork-preview walkthrough' });
    });

    // Browser Buttons
    document.getElementById('scanDevServersBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'scanDevServers' });
    });

    // Boost Buttons
    document.getElementById('runBoostBtn').addEventListener('click', () => {
      const prompt = document.getElementById('boostPromptInput').value.trim();
      const model = document.getElementById('boostModelSelect').value;
      if (prompt) {
        document.getElementById('boostStatus').textContent = 'Running Boost reasoning...';
        vscode.postMessage({ type: 'runBoost', prompt, model });
      }
    });

    // Message Handler from Extension Host
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'stateChange':
          currentState = msg.state;
          if (msg.state !== 'speaking' && msg.state !== 'interrupted') isInterrupted = false;
          document.body.className = 'state-' + msg.state;
          statusText.textContent = msg.details || (msg.state.charAt(0).toUpperCase() + msg.state.slice(1));
          if (msg.state === 'idle' || msg.state === 'error') {
            toggleBtn.className = 'btn btn-primary';
            toggleText.textContent = 'Start Voice';
          } else {
            toggleBtn.className = 'btn btn-danger';
            toggleText.textContent = 'Stop Voice';
          }
          break;

        case 'audioChunk':
          playPcmChunk(msg.data);
          break;

        case 'micRms':
          micRmsLevel = msg.rms;
          break;

        case 'interrupted':
          stopAllAudio();
          break;

        case 'transcript':
          appendTranscript(msg.entry);
          break;

        case 'transcriptUpdate':
          updateTranscriptEntry(msg.id, msg.partialText, msg.toolResult, msg.status);
          break;

        case 'goalUpdate':
          renderGoalUI(msg.data);
          break;

        case 'planUpdate':
          renderPlanUI(msg.data);
          break;

        case 'teamworkUpdate':
          renderTeamworkUI(msg.delta, msg.walkthrough);
          break;

        case 'devServersUpdate':
          renderDevServersUI(msg.servers);
          break;

        case 'boostProgress':
          document.getElementById('boostStatus').textContent = msg.message;
          break;

        case 'boostComplete':
          document.getElementById('boostStatus').textContent = 'Completed';
          document.getElementById('boostOutput').textContent = msg.result;
          break;

        case 'userCaption':
          renderLiveCaption('You: ' + msg.text, 'user');
          break;

        case 'modelCaption':
          renderLiveCaption('Antigravity: ' + msg.text, 'model');
          break;

        case 'activeTab':
          setActiveTab(msg.tab);
          break;
      }
    });

    // Request initial data immediately on script load
    vscode.postMessage({ type: 'getGoal' });
    vscode.postMessage({ type: 'getPlan' });
    vscode.postMessage({ type: 'getTeamworkPreview' });
    vscode.postMessage({ type: 'scanDevServers' });

    let liveCaptionEl = null;
    function renderLiveCaption(text, role) {
      if (!liveCaptionEl) {
        liveCaptionEl = document.createElement('div');
        liveCaptionEl.style.cssText = 'padding:6px 10px;font-size:11px;background:rgba(59,130,246,0.15);border-left:3px solid #3b82f6;border-radius:4px;margin-bottom:6px;font-style:italic;';
        transcript.parentNode.insertBefore(liveCaptionEl, transcript);
      }
      liveCaptionEl.textContent = text;
      liveCaptionEl.style.display = 'block';
      clearTimeout(liveCaptionEl._timer);
      liveCaptionEl._timer = setTimeout(() => {
        if (liveCaptionEl) liveCaptionEl.style.display = 'none';
      }, 4000);
    }

    function appendTranscript(entry) {
      const div = document.createElement('div');
      div.id = 'entry-' + entry.id;
      div.className = 'message-card ' + entry.role;

      if (entry.role === 'tool' && entry.toolCall) {
        div.innerHTML = \`
          <div class="tool-card">
            <div style="display:flex;justify-content:space-between;color:#60a5fa;margin-bottom:4px;font-weight:bold;">
              <span>🔧 \${entry.toolCall.name}</span>
              <span id="tool-status-\${entry.id}">\${entry.toolCall.status}</span>
            </div>
            <div style="color:#9ca3af;margin-bottom:4px;">\${JSON.stringify(entry.toolCall.args)}</div>
            <div id="tool-out-\${entry.id}" style="background:#000;padding:6px;border-radius:4px;color:#a7f3d0;display:none;white-space:pre-wrap;"></div>
          </div>
        \`;
      } else {
        div.innerHTML = \`
          <div class="message-bubble">
            \${escapeHtml(entry.text || '')}
          </div>
        \`;
      }

      transcript.appendChild(div);
      transcript.scrollTop = transcript.scrollHeight;
    }

    function updateTranscriptEntry(id, partialText, toolResult, status) {
      const el = document.getElementById('entry-' + id);
      if (!el) return;

      if (partialText !== undefined) {
        const bubble = el.querySelector('.message-bubble');
        if (bubble) bubble.textContent += partialText;
      }

      if (toolResult !== undefined) {
        const out = document.getElementById('tool-out-' + id);
        if (out) {
          out.style.display = 'block';
          out.textContent = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2);
        }
      }

      if (status) {
        const st = document.getElementById('tool-status-' + id);
        if (st) st.textContent = status;
      }

      transcript.scrollTop = transcript.scrollHeight;
    }

    // Render Pillar UIs
    function renderGoalUI(goal) {
      if (!goal) return;
      document.getElementById('goalMilestone').textContent = goal.milestone || 'Default Milestone';
      document.getElementById('goalPercentText').textContent = goal.percentDone + '%';
      document.getElementById('goalProgressBar').style.width = goal.percentDone + '%';
      document.getElementById('goalMetricCounts').textContent = \`\${goal.completedTasks}/\${goal.totalTasks} completed | \${goal.inProgressTasks} in progress\`;
      document.getElementById('goalSourcePath').textContent = goal.sourcePath ? goal.sourcePath.split(/[\\\\/]/).pop() : 'task.md';

      if (goal.activeTask) {
        document.getElementById('activeTaskText').textContent = goal.activeTask.text;
      } else {
        document.getElementById('activeTaskText').textContent = 'All tasks completed!';
      }

      const listContainer = document.getElementById('taskListContainer');
      listContainer.innerHTML = '';

      goal.tasks.forEach(task => {
        const item = document.createElement('div');
        item.className = 'task-item';
        item.style.marginLeft = (task.indent * 12) + 'px';

        const isChecked = task.status === 'completed';
        const badgeClass = 'badge-' + (task.status === 'in_progress' ? 'progress' : task.status);

        item.innerHTML = \`
          <input type="checkbox" class="task-checkbox" \${isChecked ? 'checked' : ''} />
          <span class="task-text \${isChecked ? 'completed' : ''}">\${escapeHtml(task.text)}</span>
          <span class="badge \${badgeClass}">\${task.status}</span>
        \`;

        const checkbox = item.querySelector('.task-checkbox');
        checkbox.addEventListener('change', () => {
          const nextStatus = checkbox.checked ? 'completed' : 'pending';
          vscode.postMessage({
            type: 'updateTaskStatus',
            taskIdOrText: task.id,
            status: nextStatus
          });
        });

        listContainer.appendChild(item);
      });
    }

    function renderPlanUI(plan) {
      if (!plan) {
        document.getElementById('planObjective').textContent = 'No active implementation plan found.';
        return;
      }
      document.getElementById('planObjective').textContent = plan.objective;
      const gating = document.getElementById('planGatingBanner');
      if (plan.allApproved) {
        gating.style.background = 'rgba(16, 185, 129, 0.15)';
        gating.style.borderLeftColor = '#10b981';
        gating.textContent = '✅ All Steps Approved: Tool Execution Permitted';
      } else {
        gating.style.background = 'rgba(245, 158, 11, 0.15)';
        gating.style.borderLeftColor = '#f59e0b';
        gating.textContent = '🔒 Execution Gated: Awaiting Step Approvals';
      }

      const changesContainer = document.getElementById('proposedChangesContainer');
      changesContainer.innerHTML = '';
      plan.proposedChanges.forEach(ch => {
        const div = document.createElement('div');
        div.style.background = 'rgba(0,0,0,0.2)';
        div.style.padding = '6px 8px';
        div.style.borderRadius = '4px';
        div.style.fontSize = '11px';
        div.innerHTML = \`
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:2px;">
            <span class="badge \${ch.action === 'CREATE' ? 'badge-completed' : 'badge-progress'}">\${ch.action}</span>
            <code style="color:#60a5fa;">\${escapeHtml(ch.path)}</code>
          </div>
          <div style="opacity:0.8;">\${escapeHtml(ch.rationale)}</div>
        \`;
        changesContainer.appendChild(div);
      });

      const stepsContainer = document.getElementById('planStepsContainer');
      stepsContainer.innerHTML = '';
      plan.steps.forEach(step => {
        const div = document.createElement('div');
        div.className = 'task-item';
        div.innerHTML = \`
          <input type="checkbox" class="task-checkbox" \${step.approved ? 'checked disabled' : ''} />
          <span class="task-text \${step.approved ? 'completed' : ''}">\${step.id}. \${escapeHtml(step.text)}</span>
          <span class="badge \${step.approved ? 'badge-completed' : 'badge-pending'}">\${step.approved ? 'Approved' : 'Pending'}</span>
        \`;
        const cb = div.querySelector('.task-checkbox');
        cb.addEventListener('change', () => {
          if (cb.checked) {
            vscode.postMessage({ type: 'approvePlanStep', stepId: step.id });
          }
        });
        stepsContainer.appendChild(div);
      });
    }

    function renderTeamworkUI(delta, walkthrough) {
      if (!delta) return;
      document.getElementById('gitBranch').textContent = delta.branch;
      document.getElementById('gitSyncStat').textContent = \`Ahead: \${delta.ahead} | Behind: \${delta.behind}\`;
      document.getElementById('gitInsertions').textContent = delta.insertions;
      document.getElementById('gitDeletions').textContent = delta.deletions;

      const container = document.getElementById('gitFilesContainer');
      container.innerHTML = '';

      const allFiles = [
        ...delta.modifiedFiles.map(f => ({ path: f, type: 'Modified' })),
        ...delta.stagedFiles.map(f => ({ path: f, type: 'Staged' })),
        ...delta.untrackedFiles.map(f => ({ path: f, type: 'Untracked' }))
      ];

      if (allFiles.length === 0) {
        container.innerHTML = '<div style="font-size:12px;opacity:0.6;padding:12px 0;text-align:center;">Working tree clean. No uncommitted changes.</div>';
        return;
      }

      allFiles.forEach(file => {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.style.padding = '5px 8px';
        item.style.background = 'rgba(0,0,0,0.2)';
        item.style.borderRadius = '4px';
        item.style.fontSize = '11px';

        item.innerHTML = \`
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px;">
            <span class="badge badge-pending" style="margin-right:6px;">\${file.type}</span>
            <code>\${escapeHtml(file.path)}</code>
          </div>
          <button class="btn btn-secondary diff-btn" style="padding:2px 6px;font-size:10px;">Diff</button>
        \`;

        item.querySelector('.diff-btn').addEventListener('click', () => {
          vscode.postMessage({ type: 'openDiff', filePath: file.path });
        });

        container.appendChild(item);
      });
    }

    function renderDevServersUI(servers) {
      const container = document.getElementById('devServersList');
      container.innerHTML = '';
      if (!servers || servers.length === 0) {
        container.innerHTML = '<div style="font-size: 12px; opacity: 0.6; text-align: center; padding: 20px 0;">No active dev servers detected on localhost.</div>';
        return;
      }

      servers.forEach(srv => {
        const card = document.createElement('div');
        card.style.background = 'rgba(0,0,0,0.25)';
        card.style.border = '1px solid rgba(16,185,129,0.3)';
        card.style.borderRadius = '6px';
        card.style.padding = '8px 10px';
        card.style.display = 'flex';
        card.style.justifyContent = 'space-between';
        card.style.alignItems = 'center';

        card.innerHTML = \`
          <div>
            <div style="font-weight:600;font-size:12px;color:#34d399;">\${escapeHtml(srv.title || 'Dev Server')}</div>
            <div style="font-size:11px;opacity:0.8;font-family:monospace;">\${escapeHtml(srv.url)}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <button class="btn btn-secondary open-srv-btn" style="padding:2px 8px;font-size:10px;">Open ↗</button>
            <span class="badge badge-completed">Running</span>
          </div>
        \`;

        const openBtn = card.querySelector('.open-srv-btn');
        if (openBtn) {
          openBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'openExternal', url: srv.url });
          });
        }

        container.appendChild(card);
      });
    }

    function escapeHtml(str) {
      return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>`;
  }
}
