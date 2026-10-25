import * as vscode from 'vscode';
import { GeminiLiveClient } from './geminiClient';
import { AudioCaptureEngine } from './audioCapture';
import { TerminalIntegrationManager } from './terminalIntegration';
import { ToolExecutor, GEMINI_TOOLS } from './toolExecutor';
import { SidebarProvider } from './sidebarProvider';
import { VoicePanelProvider } from './voicePanelProvider';
import { WhisperCaptionEngine } from './whisperEngine';
import { AmbientTelemetry } from './ambientTelemetry';
import { GoalManager } from './goalManager';
import { PlanManager } from './planManager';
import { TeamworkPreviewManager } from './teamworkPreviewManager';
import { BrowserManager } from './browserManager';
import { BoostManager } from './boostManager';
import { VoiceState, TranscriptEntry } from './types';

let geminiClient: GeminiLiveClient | null = null;
let audioCapture: AudioCaptureEngine | null = null;
let terminalManager: TerminalIntegrationManager | null = null;
let toolExecutor: ToolExecutor | null = null;
let sidebarProvider: SidebarProvider | null = null;
let whisperEngine: WhisperCaptionEngine | null = null;
let statusBarItem: vscode.StatusBarItem;

let ambientTelemetry: AmbientTelemetry | null = null;
let goalManager: GoalManager | null = null;
let planManager: PlanManager | null = null;
let teamworkManager: TeamworkPreviewManager | null = null;
let browserManager: BrowserManager | null = null;
let boostManager: BoostManager | null = null;

let currentState: VoiceState = 'idle';
let currentTurnModelEntryId: string | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('Talking to Antigravity extension activating...');

  const config = vscode.workspace.getConfiguration('talkingToAntigravity');
  const pythonPath = config.get<string>('pythonPath') || 'C:\\Python311\\python.exe';
  const claudePath = config.get<string>('claudeCliPath') || 'C:\\Users\\Karthik\\AppData\\Roaming\\npm\\claude.cmd';
  const antigravityPath = config.get<string>('antigravityCliPath') || 'C:\\Users\\Karthik\\.gemini\\antigravity\\bin\\agentapi.bat';

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  // Instantiate Pillar Engines
  terminalManager = new TerminalIntegrationManager(claudePath, antigravityPath);
  ambientTelemetry = new AmbientTelemetry(workspaceRoot);
  goalManager = new GoalManager(workspaceRoot);
  planManager = new PlanManager(workspaceRoot);
  teamworkManager = new TeamworkPreviewManager(workspaceRoot);
  browserManager = new BrowserManager();
  boostManager = new BoostManager(antigravityPath, claudePath, workspaceRoot);

  toolExecutor = new ToolExecutor(
    terminalManager,
    goalManager,
    planManager,
    teamworkManager,
    browserManager,
    boostManager,
    ambientTelemetry
  );

  audioCapture = new AudioCaptureEngine({ pythonPath });
  whisperEngine = new WhisperCaptionEngine(pythonPath, context.extensionUri.fsPath);

  sidebarProvider = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider)
  );

  // Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'talking-to-antigravity.openVoicePanel';
  updateStatusBar('idle');
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Register ambient telemetry watchers (terminals, editor, saves)
  ambientTelemetry.registerWatchers(context);

  // Wire Webview callbacks
  sidebarProvider.onStartRequested = () => startVoiceSession();
  sidebarProvider.onStopRequested = () => stopVoiceSession();
  sidebarProvider.onToggleMuteRequested = () => toggleMute();
  sidebarProvider.onInterruptRequested = () => triggerInterrupt();
  sidebarProvider.onTextPromptRequested = (text: string) => handleTextPrompt(text);
  sidebarProvider.onTerminalCommandRequested = (cmd: string) => {
    const entryId = 'cmd-' + Date.now();
    sidebarProvider?.sendTranscript({
      id: entryId,
      role: 'user',
      text: `> ${cmd}`,
      timestamp: Date.now()
    });
    if (terminalManager) {
      terminalManager.sendCommandToTerminal(cmd, true, true);
    }
  };
  sidebarProvider.onMicChunkReceived = (pcmB64: string, rms: number) => {
    if (audioCapture) {
      audioCapture.feedPcmChunk(pcmB64, rms);
    }
  };
  sidebarProvider.onClearTranscriptRequested = () => {
    currentTurnModelEntryId = null;
  };

  // Wire Pillar UI callbacks
  sidebarProvider.onGetGoalRequested = async () => {
    if (goalManager) {
      const status = await goalManager.getGoalStatus();
      sidebarProvider?.sendGoalUpdate(status);
    }
  };

  sidebarProvider.onUpdateTaskStatusRequested = async (taskIdOrText, status) => {
    if (goalManager) {
      const updated = await goalManager.updateTaskStatus(taskIdOrText, status);
      sidebarProvider?.sendGoalUpdate(updated);
    }
  };

  sidebarProvider.onAddTaskRequested = async (text, milestone) => {
    if (goalManager) {
      const updated = await goalManager.addTask(text, milestone);
      sidebarProvider?.sendGoalUpdate(updated);
    }
  };

  sidebarProvider.onGetPlanRequested = async () => {
    if (planManager) {
      const plan = await planManager.getPlan();
      sidebarProvider?.sendPlanUpdate(plan);
    }
  };

  sidebarProvider.onApprovePlanStepRequested = async (stepId) => {
    if (planManager) {
      const plan = await planManager.approveStep(stepId);
      sidebarProvider?.sendPlanUpdate(plan);
    }
  };

  sidebarProvider.onGetTeamworkRequested = async () => {
    if (teamworkManager) {
      const delta = await teamworkManager.getWorkspaceDelta();
      sidebarProvider?.sendTeamworkUpdate(delta);
    }
  };

  sidebarProvider.onOpenDiffRequested = async (filePath) => {
    if (teamworkManager) {
      await teamworkManager.openDiffViewer(filePath);
    }
  };

  sidebarProvider.onScanDevServersRequested = async () => {
    if (browserManager) {
      const servers = await browserManager.scanDevServers();
      sidebarProvider?.sendDevServersUpdate(servers);
      if (ambientTelemetry) {
        ambientTelemetry.setDevServers(servers.map((s) => s.url));
      }
    }
  };

  sidebarProvider.onRunBoostRequested = async (prompt, model) => {
    if (boostManager) {
      try {
        const result = await boostManager.runBoostQuery(prompt, {
          model,
          onProgress: (msg) => sidebarProvider?.sendBoostProgress(msg)
        });
        sidebarProvider?.sendBoostComplete(result);
      } catch (err: any) {
        sidebarProvider?.sendBoostComplete(`Boost failed: ${err.message}`);
      }
    }
  };

  sidebarProvider.onOpenExternalRequested = (targetUrl: string) => {
    try {
      vscode.env.openExternal(vscode.Uri.parse(targetUrl));
    } catch {
      // Ignore
    }
  };

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('talking-to-antigravity.openVoicePanel', () => {
      VoicePanelProvider.createOrShow(context.extensionUri);
      const panel = VoicePanelProvider.currentPanel;
      if (panel) {
        panel.onStartRequested = () => startVoiceSession();
        panel.onStopRequested = () => stopVoiceSession();
        panel.onToggleMuteRequested = () => toggleMute();
        panel.onInterruptRequested = () => triggerInterrupt();
        panel.onMicChunkReceived = (pcmB64: string, rms: number) => {
          if (audioCapture) audioCapture.feedPcmChunk(pcmB64, rms);
        };
        panel.updateState(currentState);
      }
    }),
    vscode.commands.registerCommand('talking-to-antigravity.startVoice', () => startVoiceSession()),
    vscode.commands.registerCommand('talking-to-antigravity.stopVoice', () => stopVoiceSession()),
    vscode.commands.registerCommand('talking-to-antigravity.toggleVoice', () => {
      if (currentState === 'idle' || currentState === 'error') {
        startVoiceSession();
      } else {
        stopVoiceSession();
      }
    }),
    vscode.commands.registerCommand('talking-to-antigravity.toggleMute', () => toggleMute()),
    vscode.commands.registerCommand('talking-to-antigravity.interrupt', () => triggerInterrupt()),
    vscode.commands.registerCommand('talking-to-antigravity.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'talkingToAntigravity');
    }),
    // 5 Pillar VS Code Commands
    vscode.commands.registerCommand('talking-to-antigravity.showGoal', async () => {
      vscode.commands.executeCommand('talking-to-antigravity.sidebarView.focus');
      sidebarProvider?.switchTab('goal');
      if (goalManager) {
        const status = await goalManager.getGoalStatus();
        sidebarProvider?.sendGoalUpdate(status);
      }
    }),
    vscode.commands.registerCommand('talking-to-antigravity.showPlan', async () => {
      vscode.commands.executeCommand('talking-to-antigravity.sidebarView.focus');
      sidebarProvider?.switchTab('plan');
      if (planManager) {
        const plan = await planManager.getPlan();
        sidebarProvider?.sendPlanUpdate(plan);
      }
    }),
    vscode.commands.registerCommand('talking-to-antigravity.teamworkPreview', async () => {
      vscode.commands.executeCommand('talking-to-antigravity.sidebarView.focus');
      sidebarProvider?.switchTab('teamwork');
      if (teamworkManager) {
        const delta = await teamworkManager.getWorkspaceDelta();
        sidebarProvider?.sendTeamworkUpdate(delta);
      }
    }),
    vscode.commands.registerCommand('talking-to-antigravity.openBrowserPreview', async () => {
      vscode.commands.executeCommand('talking-to-antigravity.sidebarView.focus');
      sidebarProvider?.switchTab('browser');
      if (browserManager) {
        const servers = await browserManager.scanDevServers();
        sidebarProvider?.sendDevServersUpdate(servers);
      }
    }),
    vscode.commands.registerCommand('talking-to-antigravity.toggleBoost', () => {
      vscode.commands.executeCommand('talking-to-antigravity.sidebarView.focus');
      sidebarProvider?.switchTab('boost');
    })
  );

  // Configuration change listener
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('talkingToAntigravity')) {
        const updatedConfig = vscode.workspace.getConfiguration('talkingToAntigravity');
        const updatedClaude = updatedConfig.get<string>('claudeCliPath');
        const updatedAntigravity = updatedConfig.get<string>('antigravityCliPath');
        if (terminalManager) {
          terminalManager.updatePaths(updatedClaude, updatedAntigravity);
        }
        if (boostManager) {
          boostManager.updatePaths(updatedAntigravity, updatedClaude);
        }
        if (audioCapture) {
          audioCapture.updateOptions({
            pythonPath: updatedConfig.get<string>('pythonPath')
          });
        }
      }
    })
  );
}

function updateStatusBar(state: VoiceState, details?: string) {
  currentState = state;
  sidebarProvider?.updateState(state, details);
  VoicePanelProvider.currentPanel?.updateState(state, details);

  switch (state) {
    case 'idle':
      statusBarItem.text = '$(mic) Voice: Idle';
      statusBarItem.tooltip = 'Click to open Antigravity Voice Bridge';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'connecting':
      statusBarItem.text = '$(loading~spin) Voice: Connecting';
      statusBarItem.tooltip = 'Connecting to Gemini Multimodal Live...';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'listening':
      statusBarItem.text = '$(record) Voice: Listening';
      statusBarItem.tooltip = 'Microphone live - Click to stop';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      break;
    case 'thinking':
      statusBarItem.text = '$(sync~spin) Voice: Thinking';
      statusBarItem.tooltip = 'Gemini processing / executing tools...';
      statusBarItem.backgroundColor = undefined;
      break;
    case 'speaking':
      statusBarItem.text = '$(unmute) Voice: Speaking';
      statusBarItem.tooltip = 'Gemini speaking - Click to interrupt';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
      break;
    case 'interrupted':
      statusBarItem.text = '$(debug-stop) Voice: Interrupted';
      statusBarItem.tooltip = 'Barge-in activated';
      break;
    case 'error':
      statusBarItem.text = '$(error) Voice: Error';
      statusBarItem.tooltip = details || 'An error occurred';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      break;
  }
}

export async function startVoiceSession(): Promise<void> {
  if (currentState !== 'idle' && currentState !== 'error') {
    return;
  }

  updateStatusBar('connecting', 'Connecting...');

  const config = vscode.workspace.getConfiguration('talkingToAntigravity');
  const apiKey = config.get<string>('apiKey') || process.env.GEMINI_API_KEY || '';
  const model = config.get<string>('model') || 'models/gemini-2.5-flash-native-audio-latest';
  const voiceName = config.get<string>('voiceName') || 'Puck';

  const telemetryHeader = ambientTelemetry ? ambientTelemetry.getPromptContext() : '';

  const systemInstruction =
    'You are Antigravity Voice Pair Programmer, an interactive AI voice companion inside VS Code / Cursor / Antigravity. ' +
    'You have direct voice and tool control over goals (/goal), implementation plans (/plan), teamwork diff previews (/teamwork-preview), dev servers (/browser), and deep boost reasoning (/boost). ' +
    (telemetryHeader ? `\n\n${telemetryHeader}\n` : '') +
    'Keep your spoken responses natural, direct, and concise (1-3 sentences when possible). ' +
    'When the user asks you to read or check code, inspect files, check goals, run commands, or review diffs, invoke the appropriate function call.';

  geminiClient = new GeminiLiveClient({
    apiKey,
    model,
    voiceName,
    systemInstruction,
    tools: GEMINI_TOOLS
  });

  // Audio capture event listeners
  if (audioCapture) {
    audioCapture.removeAllListeners();

    audioCapture.on('pcm', (base64Pcm: string) => {
      if (geminiClient && geminiClient.ready) {
        geminiClient.sendAudioChunk(base64Pcm);
      }
      if (whisperEngine) {
        whisperEngine.feedPcmChunk(base64Pcm);
      }
    });

    audioCapture.on('rms', (rms: number) => {
      sidebarProvider?.sendMicRms(rms);
      VoicePanelProvider.currentPanel?.sendAudioLevel(rms);
    });

    audioCapture.on('error', (err: Error) => {
      vscode.window.showErrorMessage(`Microphone capture error: ${err.message}`);
    });
  }

  // Gemini client event listeners
  geminiClient.on('setupComplete', () => {
    updateStatusBar('listening', 'Listening');
    vscode.window.showInformationMessage('Antigravity Voice Bridge connected!');
  });

  const checkSpokenSlashCommand = (caption: string) => {
    const trimmed = caption.trim();
    if (trimmed.startsWith('/') || /^\s*\/(?:goal|plan|teamwork|browser|boost)/i.test(trimmed)) {
      handleTextPrompt(trimmed);
    }
  };

  if (whisperEngine) {
    whisperEngine.start();
    whisperEngine.removeAllListeners('caption');
    whisperEngine.on('caption', (text: string) => {
      VoicePanelProvider.currentPanel?.sendUserCaption(text);
      sidebarProvider?.sendUserCaption(text);
      checkSpokenSlashCommand(text);
    });
  }

  geminiClient.on('userCaption', (text: string) => {
    VoicePanelProvider.currentPanel?.sendUserCaption(text);
    sidebarProvider?.sendUserCaption(text);
    checkSpokenSlashCommand(text);
  });

  geminiClient.on('modelCaption', (text: string) => {
    VoicePanelProvider.currentPanel?.sendModelCaption(text);
    sidebarProvider?.sendModelCaption(text);
  });

  geminiClient.on('audioChunk', (pcmB64: string) => {
    updateStatusBar('speaking', 'Speaking');
    sidebarProvider?.sendAudioChunk(pcmB64);
    VoicePanelProvider.currentPanel?.sendAudioChunk(pcmB64);
  });

  geminiClient.on('textChunk', (text: string) => {
    if (!currentTurnModelEntryId) {
      currentTurnModelEntryId = 'model-' + Date.now();
      const entry: TranscriptEntry = {
        id: currentTurnModelEntryId,
        role: 'model',
        text: text,
        timestamp: Date.now()
      };
      sidebarProvider?.sendTranscript(entry);
      VoicePanelProvider.currentPanel?.sendTranscriptEntry(entry);
    } else {
      sidebarProvider?.updateTranscript(currentTurnModelEntryId, text);
      VoicePanelProvider.currentPanel?.updateTranscript(currentTurnModelEntryId, text);
    }
  });

  geminiClient.on('turnComplete', () => {
    currentTurnModelEntryId = null;
    updateStatusBar('listening', 'Listening');
  });

  geminiClient.on('interrupted', () => {
    currentTurnModelEntryId = null;
    updateStatusBar('interrupted', 'Barge-in');
    sidebarProvider?.notifyInterrupted();
    VoicePanelProvider.currentPanel?.notifyInterrupted();
    if (whisperEngine) {
      whisperEngine.interrupt();
    }
    setTimeout(() => {
      if (currentState === 'interrupted') {
        updateStatusBar('listening', 'Listening');
      }
    }, 600);
  });

  geminiClient.on('toolCall', async (calls) => {
    updateStatusBar('thinking', 'Executing tools...');

    const responses = [];
    for (const call of calls) {
      const entryId = 'tool-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
      const entry: TranscriptEntry = {
        id: entryId,
        role: 'tool',
        timestamp: Date.now(),
        toolCall: {
          id: call.id,
          name: call.name,
          args: call.args,
          status: 'running'
        }
      };
      sidebarProvider?.sendTranscript(entry);
      VoicePanelProvider.currentPanel?.sendTranscriptEntry(entry);

      if (toolExecutor) {
        const res = await toolExecutor.executeToolCall(call);
        responses.push(res);

        const hasError = Boolean(res.response.output?.error);
        const status = hasError ? 'error' : 'success';
        sidebarProvider?.updateTranscript(
          entryId,
          undefined,
          res.response.output,
          status
        );
        VoicePanelProvider.currentPanel?.updateTranscript(
          entryId,
          undefined,
          res.response.output,
          status
        );

        // Sync UI updates for pillar tool responses
        if (call.name === 'get_goal_status' || call.name === 'update_goal') {
          sidebarProvider?.sendGoalUpdate(res.response.output);
        } else if (call.name === 'get_plan' || call.name === 'create_or_update_plan' || call.name === 'approve_plan_step') {
          sidebarProvider?.sendPlanUpdate(res.response.output);
        } else if (call.name === 'get_git_diff') {
          sidebarProvider?.sendTeamworkUpdate(res.response.output);
        } else if (call.name === 'detect_dev_servers') {
          sidebarProvider?.sendDevServersUpdate(res.response.output);
        }
      }
    }

    if (geminiClient && responses.length > 0) {
      geminiClient.sendToolResponses(responses);
    }
  });

  geminiClient.on('toolCallCancellation', (ids) => {
    console.log('Gemini Live tool call cancelled:', ids);
    updateStatusBar('listening', 'Listening');
  });

  geminiClient.on('error', (err: Error) => {
    vscode.window.showErrorMessage(`Gemini Live error: ${err.message}`);
    updateStatusBar('error', err.message);
  });

  geminiClient.on('close', (code, reason) => {
    console.log(`Gemini Live closed: ${code} ${reason}`);
    if (currentState !== 'idle') {
      stopVoiceSession();
      if (code !== 1000) {
        vscode.window.showWarningMessage(`Gemini Live connection ended (${code}): ${reason || 'Disconnected'}`);
      }
    }
  });

  try {
    await geminiClient.connect();

    const captureMethod = config.get<string>('audioCaptureMethod') || 'auto';
    if (captureMethod === 'webview') {
      sidebarProvider?.startWebviewMic();
    } else {
      try {
        if (audioCapture) {
          await audioCapture.start();
        }
      } catch (micErr: any) {
        if (captureMethod === 'auto') {
          console.warn('Native Python mic failed, falling back to Webview mic:', micErr);
          sidebarProvider?.startWebviewMic();
        } else {
          throw micErr;
        }
      }
    }
  } catch (err: any) {
    updateStatusBar('error', err.message);
    vscode.window.showErrorMessage(`Failed to start Voice Session: ${err.message}`);
    if (audioCapture) {
      audioCapture.stop();
    }
    if (geminiClient) {
      geminiClient.disconnect();
      geminiClient = null;
    }
    sidebarProvider?.stopWebviewMic();
  }
}

export function stopVoiceSession(): void {
  if (audioCapture) {
    audioCapture.stop();
  }
  if (whisperEngine) {
    whisperEngine.stop();
  }
  if (geminiClient) {
    geminiClient.disconnect();
    geminiClient = null;
  }
  sidebarProvider?.stopWebviewMic();
  currentTurnModelEntryId = null;
  updateStatusBar('idle');
}

export function toggleMute(): void {
  if (audioCapture) {
    const isMuted = audioCapture.toggleMute();
    vscode.window.showInformationMessage(isMuted ? 'Microphone Muted' : 'Microphone Unmuted');
  }
}

export function triggerInterrupt(): void {
  if (geminiClient) {
    geminiClient.interruptTurn();
  }
  sidebarProvider?.notifyInterrupted();
  updateStatusBar('interrupted', 'Barge-in');
  setTimeout(() => {
    if (currentState === 'interrupted') {
      updateStatusBar('listening', 'Listening');
    }
  }, 400);
}

export async function handleTextPrompt(text: string): Promise<void> {
  const trimmed = text.trim();

  // Intercept Slash Commands
  if (trimmed.startsWith('/goal')) {
    sidebarProvider?.switchTab('goal');
    if (goalManager) {
      const status = await goalManager.getGoalStatus();
      sidebarProvider?.sendGoalUpdate(status);
      sidebarProvider?.sendTranscript({
        id: 'cmd-' + Date.now(),
        role: 'user',
        text: trimmed,
        timestamp: Date.now()
      });
      sidebarProvider?.sendTranscript({
        id: 'model-' + Date.now(),
        role: 'model',
        text: `🎯 **Milestone**: ${status.milestone}\nProgress: **${status.percentDone}%** (${status.completedTasks}/${status.totalTasks} completed)\nActive Task: ${status.activeTask?.text || 'None'}`,
        timestamp: Date.now()
      });
    }
    return;
  }

  if (trimmed.startsWith('/plan')) {
    sidebarProvider?.switchTab('plan');
    if (planManager) {
      const plan = await planManager.getPlan();
      sidebarProvider?.sendPlanUpdate(plan);
      sidebarProvider?.sendTranscript({
        id: 'cmd-' + Date.now(),
        role: 'user',
        text: trimmed,
        timestamp: Date.now()
      });
      sidebarProvider?.sendTranscript({
        id: 'model-' + Date.now(),
        role: 'model',
        text: plan
          ? `📋 **Objective**: ${plan.objective}\nSteps: ${plan.steps.length} (${plan.allApproved ? 'All Approved' : 'Awaiting Approval'})`
          : '📋 No active plan found.',
        timestamp: Date.now()
      });
    }
    return;
  }

  if (trimmed.startsWith('/teamwork-preview')) {
    sidebarProvider?.switchTab('teamwork');
    if (teamworkManager) {
      if (trimmed.includes('walkthrough')) {
        const md = await teamworkManager.generateWalkthrough(
          ['Implementation and verification completed'],
          'All test suites passed.'
        );
        sidebarProvider?.sendTranscript({
          id: 'model-' + Date.now(),
          role: 'model',
          text: `📝 Walkthrough generated:\n\n${md}`,
          timestamp: Date.now()
        });
      } else {
        const delta = await teamworkManager.getWorkspaceDelta();
        sidebarProvider?.sendTeamworkUpdate(delta);
        sidebarProvider?.sendTranscript({
          id: 'cmd-' + Date.now(),
          role: 'user',
          text: trimmed,
          timestamp: Date.now()
        });
        sidebarProvider?.sendTranscript({
          id: 'model-' + Date.now(),
          role: 'model',
          text: `👥 **Branch**: \`${delta.branch}\` (+${delta.insertions} / -${delta.deletions})\nModified: ${delta.modifiedFiles.length} | Staged: ${delta.stagedFiles.length}`,
          timestamp: Date.now()
        });
      }
    }
    return;
  }

  if (trimmed.startsWith('/browser')) {
    sidebarProvider?.switchTab('browser');
    if (browserManager) {
      const servers = await browserManager.scanDevServers();
      sidebarProvider?.sendDevServersUpdate(servers);
      sidebarProvider?.sendTranscript({
        id: 'cmd-' + Date.now(),
        role: 'user',
        text: trimmed,
        timestamp: Date.now()
      });
      sidebarProvider?.sendTranscript({
        id: 'model-' + Date.now(),
        role: 'model',
        text: servers.length > 0
          ? `🌐 Found ${servers.length} dev server(s):\n${servers.map((s) => `- ${s.url} (${s.title})`).join('\n')}`
          : '🌐 No active dev servers found on localhost.',
        timestamp: Date.now()
      });
    }
    return;
  }

  if (trimmed.startsWith('/boost')) {
    sidebarProvider?.switchTab('boost');
    const prompt = trimmed.replace(/^\/boost\s*/i, '');
    if (boostManager && prompt) {
      sidebarProvider?.sendTranscript({
        id: 'cmd-' + Date.now(),
        role: 'user',
        text: trimmed,
        timestamp: Date.now()
      });
      sidebarProvider?.sendBoostProgress('Running Boost deep reasoning...');
      boostManager
        .runBoostQuery(prompt, {
          onProgress: (m) => sidebarProvider?.sendBoostProgress(m)
        })
        .then((result) => {
          sidebarProvider?.sendBoostComplete(result);
          sidebarProvider?.sendTranscript({
            id: 'model-' + Date.now(),
            role: 'model',
            text: `⚡ **Boost Reasoning Result**:\n\n${result}`,
            timestamp: Date.now()
          });
        })
        .catch((err) => {
          sidebarProvider?.sendBoostComplete(`Boost failed: ${err.message}`);
        });
    }
    return;
  }

  // Regular prompt sent to Gemini Live
  const entryId = 'user-' + Date.now();
  sidebarProvider?.sendTranscript({
    id: entryId,
    role: 'user',
    text: trimmed,
    timestamp: Date.now()
  });

  if (geminiClient && geminiClient.ready) {
    updateStatusBar('thinking', 'Thinking...');
    const contextHeader = ambientTelemetry ? ambientTelemetry.getPromptContext() : '';
    const fullPrompt = contextHeader ? `${contextHeader}\n\n${trimmed}` : trimmed;
    geminiClient.sendTextMessage(fullPrompt);
  } else {
    vscode.window.showWarningMessage('Start voice session before sending prompt.');
  }
}

export function deactivate() {
  stopVoiceSession();
}
