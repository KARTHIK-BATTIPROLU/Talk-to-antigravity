import * as vscode from 'vscode';
import { GeminiLiveClient } from './geminiClient';
import { AudioCaptureEngine } from './audioCapture';
import { TerminalIntegrationManager } from './terminalIntegration';
import { ToolExecutor, GEMINI_TOOLS } from './toolExecutor';
import { SidebarProvider } from './sidebarProvider';
import { VoicePanelProvider } from './voicePanelProvider';
import { WhisperCaptionEngine } from './whisperEngine';
import { VoiceState, TranscriptEntry } from './types';

let geminiClient: GeminiLiveClient | null = null;
let audioCapture: AudioCaptureEngine | null = null;
let terminalManager: TerminalIntegrationManager | null = null;
let toolExecutor: ToolExecutor | null = null;
let sidebarProvider: SidebarProvider | null = null;
let whisperEngine: WhisperCaptionEngine | null = null;
let statusBarItem: vscode.StatusBarItem;

let currentState: VoiceState = 'idle';
let currentTurnModelEntryId: string | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('Talking to Antigravity extension activating...');

  const config = vscode.workspace.getConfiguration('talkingToAntigravity');
  const apiKey = config.get<string>('apiKey') || process.env.GEMINI_API_KEY || '';
  const model = config.get<string>('model') || 'models/gemini-2.5-flash-native-audio-latest';
  const voiceName = config.get<string>('voiceName') || 'Puck';
  const pythonPath = config.get<string>('pythonPath') || 'C:\\Python311\\python.exe';
  const claudePath = config.get<string>('claudeCliPath') || 'C:\\Users\\Karthik\\AppData\\Roaming\\npm\\claude.cmd';
  const antigravityPath = config.get<string>('antigravityCliPath') || 'C:\\Users\\Karthik\\AppData\\Roaming\\Antigravity\\bin\\agy-node.cmd';

  terminalManager = new TerminalIntegrationManager(claudePath, antigravityPath);
  toolExecutor = new ToolExecutor(terminalManager);
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
    })
  );

  // Configuration change listener
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('talkingToAntigravity')) {
        const updatedConfig = vscode.workspace.getConfiguration('talkingToAntigravity');
        if (terminalManager) {
          terminalManager.updatePaths(
            updatedConfig.get<string>('claudeCliPath'),
            updatedConfig.get<string>('antigravityCliPath')
          );
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

  const systemInstruction =
    'You are Antigravity Voice Pair Programmer, an interactive AI voice assistant inside VS Code / Cursor / Antigravity. ' +
    'You can read workspace files, inspect directory trees, execute terminal commands, and inspect active editor tabs. ' +
    'Keep your spoken responses natural, direct, and concise (1-3 sentences when possible). ' +
    'When the user asks you to read or check code, inspect files, or run commands, invoke the appropriate function call.';

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

  if (whisperEngine) {
    whisperEngine.start();
    whisperEngine.removeAllListeners('caption');
    whisperEngine.on('caption', (text: string) => {
      VoicePanelProvider.currentPanel?.sendUserCaption(text);
    });
  }

  geminiClient.on('userCaption', (text: string) => {
    VoicePanelProvider.currentPanel?.sendUserCaption(text);
  });

  geminiClient.on('modelCaption', (text: string) => {
    VoicePanelProvider.currentPanel?.sendModelCaption(text);
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

export function handleTextPrompt(text: string): void {
  const entryId = 'user-' + Date.now();
  sidebarProvider?.sendTranscript({
    id: entryId,
    role: 'user',
    text: text,
    timestamp: Date.now()
  });

  if (geminiClient && geminiClient.ready) {
    updateStatusBar('thinking', 'Thinking...');
    geminiClient.sendTextMessage(text);
  } else {
    vscode.window.showWarningMessage('Start voice session before sending prompt.');
  }
}

export function deactivate() {
  stopVoiceSession();
}
