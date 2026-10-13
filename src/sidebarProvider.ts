import * as vscode from 'vscode';
import {
  VoiceState,
  TranscriptEntry,
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage
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
      }
    });
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

  public updateTranscript(id: string, partialText?: string, toolResult?: any, status?: 'running' | 'success' | 'error'): void {
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

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Antigravity Voice Bridge</title>
  <style>
    :root {
      --bg-color: var(--vscode-editor-background, #1e1e1e);
      --card-bg: var(--vscode-sideBar-background, #252526);
      --text-color: var(--vscode-editor-foreground, #d4d4d4);
      --accent-color: #3b82f6;
      --accent-hover: #2563eb;
      --speaking-glow: #06b6d4;
      --listening-glow: #10b981;
      --thinking-glow: #a855f7;
      --danger-color: #ef4444;
      --border-color: var(--vscode-panel-border, #3c3c3c);
      --user-bubble: #2d3748;
      --model-bubble: #1a202c;
      --tool-bubble: #1f2937;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-color);
      color: var(--text-color);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    .top-panel {
      padding: 12px;
      background: var(--card-bg);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      gap: 10px;
      flex-shrink: 0;
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
      padding: 4px 10px;
      border-radius: 9999px;
      font-weight: 600;
      font-size: 11px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      background: rgba(255, 255, 255, 0.08);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #9ca3af;
    }

    /* State Dot Animations */
    .state-idle .status-dot { background: #9ca3af; }
    .state-connecting .status-dot { background: #f59e0b; animation: pulse 1s infinite; }
    .state-listening .status-dot { background: #10b981; box-shadow: 0 0 8px #10b981; animation: pulse 1.2s infinite; }
    .state-thinking .status-dot { background: #a855f7; box-shadow: 0 0 8px #a855f7; animation: ping 1s infinite; }
    .state-speaking .status-dot { background: #06b6d4; box-shadow: 0 0 10px #06b6d4; animation: wave 0.8s infinite alternate; }
    .state-interrupted .status-dot { background: #f59e0b; }
    .state-error .status-dot { background: #ef4444; }

    @keyframes pulse {
      0% { opacity: 0.4; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.15); }
      100% { opacity: 0.4; transform: scale(0.9); }
    }

    @keyframes ping {
      0% { transform: scale(1); opacity: 1; }
      75%, 100% { transform: scale(1.6); opacity: 0; }
    }

    .visualizer-container {
      width: 100%;
      height: 52px;
      background: rgba(0, 0, 0, 0.25);
      border-radius: 6px;
      overflow: hidden;
      position: relative;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    canvas#visualizer {
      width: 100%;
      height: 100%;
      display: block;
    }

    .controls-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    button.btn {
      flex: 1;
      padding: 7px 12px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: background 0.15s ease, transform 0.05s;
    }

    button.btn:active {
      transform: scale(0.98);
    }

    .btn-primary {
      background: var(--accent-color);
      color: #fff;
    }
    .btn-primary:hover { background: var(--accent-hover); }

    .btn-danger {
      background: var(--danger-color);
      color: #fff;
    }
    .btn-danger:hover { opacity: 0.9; }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-color);
      flex: 0 0 auto;
      padding: 7px 10px;
    }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.18); }
    .btn-secondary.active {
      background: rgba(239, 68, 68, 0.25);
      color: #ef4444;
      border: 1px solid #ef4444;
    }

    .transcript-container {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .message-card {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-width: 95%;
      animation: fadeIn 0.2s ease-in-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .message-card.user {
      align-self: flex-end;
    }

    .message-card.model {
      align-self: flex-start;
    }

    .message-card.tool {
      align-self: stretch;
      max-width: 100%;
    }

    .message-bubble {
      padding: 8px 12px;
      border-radius: 8px;
      line-height: 1.4;
      word-break: break-word;
    }

    .message-card.user .message-bubble {
      background: #1e3a8a;
      color: #e0e7ff;
      border-bottom-right-radius: 2px;
    }

    .message-card.model .message-bubble {
      background: #1f2937;
      color: #f3f4f6;
      border-bottom-left-radius: 2px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .tool-card {
      background: #111827;
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: 6px;
      padding: 8px 10px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
    }

    .tool-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #60a5fa;
      margin-bottom: 4px;
      font-weight: bold;
    }

    .tool-args {
      color: #9ca3af;
      margin-bottom: 6px;
      word-break: break-all;
    }

    .tool-output {
      background: #000;
      padding: 6px 8px;
      border-radius: 4px;
      color: #a7f3d0;
      max-height: 120px;
      overflow-y: auto;
      white-space: pre-wrap;
    }

    .input-bar {
      padding: 8px 12px;
      background: var(--card-bg);
      border-top: 1px solid var(--border-color);
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }

    .input-bar input {
      flex: 1;
      padding: 6px 10px;
      border-radius: 4px;
      border: 1px solid var(--border-color);
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #fff);
      outline: none;
      font-size: 12px;
    }

    .input-bar input:focus {
      border-color: var(--accent-color);
    }
  </style>
</head>
<body class="state-idle">
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
        <svg id="micIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
        <span id="toggleText">Start Voice</span>
      </button>

      <button id="muteBtn" class="btn btn-secondary" title="Mute Microphone">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="1" y1="1" x2="23" y2="23"></line>
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
          <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
        </svg>
      </button>

      <button id="interruptBtn" class="btn btn-secondary" title="Interrupt Voice (Barge-in)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <rect x="9" y="9" width="6" height="6"></rect>
        </svg>
      </button>

      <button id="clearBtn" class="btn btn-secondary" title="Clear Transcript">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    </div>
  </div>

  <div id="transcript" class="transcript-container">
    <div class="message-card model">
      <div class="message-bubble">
        👋 Ready! Click <strong>Start Voice</strong> to begin speaking with Antigravity / Gemini Live.
      </div>
    </div>
  </div>

  <div class="input-bar">
    <input type="text" id="textInput" placeholder="Type prompt or command..." />
    <button id="sendBtn" class="btn btn-secondary" style="padding: 6px 10px;">Send</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // Elements
    const statusBadge = document.getElementById('statusBadge');
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

    // Webview Microphone Streamer (fallback / direct capture with AEC)
    let mediaStream = null;
    let micAudioCtx = null;
    let micSource = null;
    let micProcessor = null;

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

      // Convert 16-bit PCM (little-endian) to Float32Array
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

    async function startWebviewMic() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          console.warn('getUserMedia not supported in this webview environment');
          return;
        }

        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        micAudioCtx = new AudioContextClass({ sampleRate: 16000 });
        micSource = micAudioCtx.createMediaStreamSource(mediaStream);
        
        const workletCode = \`
          class MicProcessor extends AudioWorkletProcessor {
            process(inputs, outputs, parameters) {
              const input = inputs[0];
              if (input.length > 0) {
                const channelData = input[0];
                let rms = 0;
                for (let i = 0; i < channelData.length; i++) {
                  rms += channelData[i] * channelData[i];
                }
                rms = Math.sqrt(rms / channelData.length);
                
                const pcm16 = new Int16Array(channelData.length);
                for (let i = 0; i < channelData.length; i++) {
                  let s = Math.max(-1, Math.min(1, channelData[i]));
                  pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                
                this.port.postMessage({ pcm: pcm16, rms });
              }
              return true;
            }
          }
          registerProcessor('mic-processor', MicProcessor);
        \`;
        
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        await micAudioCtx.audioWorklet.addModule(URL.createObjectURL(blob));
        
        micProcessor = new AudioWorkletNode(micAudioCtx, 'mic-processor');
        micProcessor.port.onmessage = (e) => {
          if (isMuted || currentState === 'idle') return;
          const { pcm, rms } = e.data;
          micRmsLevel = rms;
          
          const buffer = new Uint8Array(pcm.buffer);
          let binary = '';
          for (let i = 0; i < buffer.byteLength; i++) {
            binary += String.fromCharCode(buffer[i]);
          }
          const b64 = window.btoa(binary);
          
          vscode.postMessage({
            type: 'micPcmChunk',
            data: b64,
            rms: Number(rms.toFixed(3))
          });
        };

        micSource.connect(micProcessor);
        micProcessor.connect(micAudioCtx.destination);
      } catch (err) {
        console.warn('Webview mic capture initialization failed:', err);
      }
    }

    function stopWebviewMic() {
      if (micProcessor) {
        micProcessor.disconnect();
        micProcessor = null;
      }
      if (micSource) {
        micSource.disconnect();
        micSource = null;
      }
      if (micAudioCtx) {
        micAudioCtx.close();
        micAudioCtx = null;
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
      }
    }

    // Visualizer Canvas Animation
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
        // Generate simulated dynamic frequency bars based on mic RMS
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
        if (currentState === 'speaking') {
          strokeStyle = '#06b6d4';
        } else if (currentState === 'listening') {
          strokeStyle = '#10b981';
        } else if (currentState === 'thinking') {
          strokeStyle = '#a855f7';
        }

        ctx.fillStyle = strokeStyle;
        const y = height / 2 - barHeight / 2;
        ctx.fillRect(x, y, Math.max(2, barWidth - 2), Math.max(2, barHeight));
        x += barWidth;
      }
    }
    renderVisualizer();

    // UI Updates
    function updateStateUI(state, details) {
      currentState = state;
      if (state !== 'speaking' && state !== 'interrupted') {
        isInterrupted = false;
      }
      document.body.className = 'state-' + state;
      statusText.textContent = details || (state.charAt(0).toUpperCase() + state.slice(1));

      if (state === 'idle' || state === 'error') {
        toggleBtn.className = 'btn btn-primary';
        toggleText.textContent = 'Start Voice';
      } else {
        toggleBtn.className = 'btn btn-danger';
        toggleText.textContent = 'Stop Voice';
      }
    }

    // Button Listeners
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

    // Handle messages from Extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'stateChange':
          updateStateUI(msg.state, msg.details);
          break;

        case 'audioChunk':
          playPcmChunk(msg.data);
          break;

        case 'micRms':
          micRmsLevel = msg.rms;
          break;

        case 'startWebviewMic':
          startWebviewMic();
          break;

        case 'stopWebviewMic':
          stopWebviewMic();
          break;

        case 'interrupted':
          stopAllAudio();
          updateStateUI('interrupted', 'Barge-in');
          setTimeout(() => {
            if (currentState === 'interrupted') {
              updateStateUI('listening', 'Listening');
            }
          }, 800);
          break;

        case 'transcript':
          appendTranscript(msg.entry);
          break;

        case 'transcriptUpdate':
          updateTranscriptEntry(msg.id, msg.partialText, msg.toolResult, msg.status);
          break;
      }
    });

    function appendTranscript(entry) {
      const div = document.createElement('div');
      div.id = 'entry-' + entry.id;
      div.className = 'message-card ' + entry.role;

      if (entry.role === 'tool' && entry.toolCall) {
        div.innerHTML = \`
          <div class="tool-card">
            <div class="tool-header">
              <span>🔧 \${entry.toolCall.name}</span>
              <span id="tool-status-\${entry.id}" style="font-weight: normal; opacity: 0.8;">\${entry.toolCall.status}</span>
            </div>
            <div class="tool-args">\${JSON.stringify(entry.toolCall.args)}</div>
            <div id="tool-out-\${entry.id}" class="tool-output" style="display: none;"></div>
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
        if (bubble) {
          bubble.textContent += partialText;
        }
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
        if (st) {
          st.textContent = status;
        }
      }

      transcript.scrollTop = transcript.scrollHeight;
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>`;
  }
}
