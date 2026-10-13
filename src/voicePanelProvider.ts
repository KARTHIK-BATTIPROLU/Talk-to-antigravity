import * as vscode from 'vscode';
import { VoiceState, TranscriptEntry } from './types';

export class VoicePanelProvider {
  public static currentPanel: VoicePanelProvider | undefined;
  public static readonly viewType = 'voicePanel';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public onStartRequested?: () => void;
  public onStopRequested?: () => void;
  public onToggleMuteRequested?: () => void;
  public onInterruptRequested?: () => void;
  public onMicChunkReceived?: (pcmB64: string, rms: number) => void;

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (VoicePanelProvider.currentPanel) {
      VoicePanelProvider.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      VoicePanelProvider.viewType,
      'Antigravity Voice',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')]
      }
    );

    VoicePanelProvider.currentPanel = new VoicePanelProvider(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      message => {
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
          case 'micPcmChunk':
            this.onMicChunkReceived?.(message.data, message.rms);
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public dispose() {
    VoicePanelProvider.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  public sendAudioChunk(data: string) {
    this._panel.webview.postMessage({ type: 'audioChunk', data });
  }

  public sendMicRms(rms: number) {
    this._panel.webview.postMessage({ type: 'audioLevel', audioLevel: rms });
  }
  
  public sendAudioLevel(level: number) {
    this._panel.webview.postMessage({ type: 'audioLevel', audioLevel: level });
  }

  public sendUserCaption(text: string) {
    this._panel.webview.postMessage({ type: 'userCaption', text });
  }

  public sendModelCaption(text: string) {
    this._panel.webview.postMessage({ type: 'modelCaption', text });
  }

  public updateState(state: VoiceState, details?: string) {
    this._panel.webview.postMessage({ type: 'stateChange', state, details });
  }

  public sendTranscriptEntry(entry: TranscriptEntry) {
    this._panel.webview.postMessage({ type: 'transcriptEntry', entry });
  }

  public updateTranscript(id: string, partialText?: string, toolResult?: any, status?: 'running' | 'success' | 'error') {
    this._panel.webview.postMessage({ type: 'transcriptUpdate', id, partialText, toolResult, status });
  }

  public notifyInterrupted() {
    this._panel.webview.postMessage({ type: 'interrupted' });
  }

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview();
  }

  private _getHtmlForWebview() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Voice Mode</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #0a0a0a;
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    #orb-container {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      position: relative;
    }
    canvas {
      width: 300px;
      height: 300px;
    }
    #caption-bar {
      position: absolute;
      bottom: 100px;
      left: 0;
      right: 0;
      text-align: center;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    }
    .caption {
      font-size: 1.2rem;
      opacity: 0;
      transition: opacity 0.3s ease;
      text-shadow: 0 2px 4px rgba(0,0,0,0.8);
    }
    .caption.visible {
      opacity: 1;
    }
    #user-caption { color: #cccccc; font-style: italic; }
    #model-caption { color: #ffffff; font-weight: 500; }
    
    #controls {
      height: 100px;
      display: flex;
      justify-content: center;
      align-items: center;
      position: relative;
    }
    #mic-button {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: #333;
      border: none;
      color: white;
      cursor: pointer;
      display: flex;
      justify-content: center;
      align-items: center;
      transition: all 0.2s;
    }
    #mic-button:hover { background: #444; }
    #mic-button.muted { box-shadow: 0 0 0 2px #ff4444; animation: pulse-red 2s infinite; }
    
    #end-button {
      position: absolute;
      top: 20px;
      right: 20px;
      background: #333;
      border: none;
      color: white;
      padding: 8px 16px;
      border-radius: 16px;
      cursor: pointer;
    }
    #end-button:hover { background: #ff4444; }
    
    #hint {
      position: absolute;
      bottom: 10px;
      width: 100%;
      text-align: center;
      color: #666;
      font-size: 0.8rem;
    }
    
    @keyframes pulse-red {
      0% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.7); }
      70% { box-shadow: 0 0 0 10px rgba(255, 68, 68, 0); }
      100% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0); }
    }
    
    #transcript-drawer {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 50vh;
      background: rgba(20, 20, 20, 0.95);
      backdrop-filter: blur(10px);
      transform: translateY(100%);
      transition: transform 0.3s ease;
      display: flex;
      flex-direction: column;
      border-top: 1px solid #333;
    }
    #transcript-drawer.open { transform: translateY(0); }
    #transcript-toggle {
      position: absolute;
      top: -30px;
      left: 50%;
      transform: translateX(-50%);
      background: #333;
      border: none;
      color: white;
      padding: 4px 16px;
      border-radius: 8px 8px 0 0;
      cursor: pointer;
    }
    #transcript-content {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .transcript-entry {
      padding: 10px;
      border-radius: 8px;
      max-width: 80%;
    }
    .entry-user { background: #2a2a2a; align-self: flex-end; }
    .entry-model { background: #1a3a5a; align-self: flex-start; }
    .entry-tool { background: #3a1a5a; align-self: center; font-size: 0.9em; font-family: monospace; }
  </style>
</head>
<body>
  <button id="end-button">End</button>
  
  <div id="orb-container">
    <canvas id="orb"></canvas>
  </div>
  
  <div id="caption-bar">
    <div id="user-caption" class="caption"></div>
    <div id="model-caption" class="caption"></div>
  </div>
  
  <div id="controls">
    <button id="mic-button">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="12" y1="19" x2="12" y2="22"></line>
      </svg>
    </button>
    <div id="hint">Esc to interrupt &middot; Space to mute</div>
  </div>
  
  <div id="transcript-drawer">
    <button id="transcript-toggle">History</button>
    <div id="transcript-content"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentState = 'idle';
    let audioLevel = 0;
    
    // Orb Canvas
    const canvas = document.getElementById('orb');
    const ctx = canvas.getContext('2d');
    canvas.width = 300;
    canvas.height = 300;
    
    let time = 0;
    
    function drawOrb() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      
      let baseRadius = 80;
      let pulse = 0;
      
      if (currentState === 'idle') {
        pulse = Math.sin(time * 0.05) * 5;
      } else if (currentState === 'listening') {
        pulse = audioLevel * 100;
      } else if (currentState === 'thinking') {
        pulse = Math.sin(time * 0.2) * 10;
      } else if (currentState === 'speaking') {
        pulse = audioLevel * 150;
      }
      
      const radius = baseRadius + pulse;
      
      const grad = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius);
      
      let hueOffset = 0;
      if (currentState === 'thinking') hueOffset = time * 2;
      
      grad.addColorStop(0, \`hsl(\${190 + hueOffset}, 100%, 70%)\`); // cyan
      grad.addColorStop(0.5, \`hsl(\${220 + hueOffset}, 100%, 60%)\`); // blue
      grad.addColorStop(1, \`hsl(\${260 + hueOffset}, 100%, 40%)\`); // purple
      
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      
      time++;
      requestAnimationFrame(drawOrb);
    }
    drawOrb();
    
    // Captions
    const userCaptionEl = document.getElementById('user-caption');
    const modelCaptionEl = document.getElementById('model-caption');
    let userCaptionTimeout, modelCaptionTimeout;
    
    function showCaption(el, text, timeoutRef) {
      el.textContent = text;
      el.classList.add('visible');
      clearTimeout(timeoutRef);
      return setTimeout(() => {
        el.classList.remove('visible');
      }, 5000);
    }
    
    // UI Interactions
    document.getElementById('mic-button').addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleMute' });
      document.getElementById('mic-button').classList.toggle('muted');
    });
    
    document.getElementById('end-button').addEventListener('click', () => {
      vscode.postMessage({ type: 'stopSession' });
    });
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        vscode.postMessage({ type: 'interrupt' });
      } else if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        vscode.postMessage({ type: 'toggleMute' });
        document.getElementById('mic-button').classList.toggle('muted');
      }
    });
    
    const drawer = document.getElementById('transcript-drawer');
    document.getElementById('transcript-toggle').addEventListener('click', () => {
      drawer.classList.toggle('open');
    });
    
    // Audio Player for speaking state
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    let nextStartTime = 0;
    
    // AudioWorklet for Mic
    let micStream;
    let micAudioContext;
    let micWorkletNode;
    
    async function initWebviewMic() {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } });
        micAudioContext = new AudioContext({ sampleRate: 16000 });
        const source = micAudioContext.createMediaStreamSource(micStream);
        
        // Simple script processor fallback just in case, but instructions said AudioWorklet
        // Let's create an inline worklet
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
                
                // Convert to int16
                const pcm16 = new Int16Array(channelData.length);
                for (let i = 0; i < channelData.length; i++) {
                  let s = Math.max(-1, Math.min(1, channelData[i]));
                  pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                
                // Send back
                this.port.postMessage({ pcm: pcm16, rms });
              }
              return true;
            }
          }
          registerProcessor('mic-processor', MicProcessor);
        \`;
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        await micAudioContext.audioWorklet.addModule(URL.createObjectURL(blob));
        
        micWorkletNode = new AudioWorkletNode(micAudioContext, 'mic-processor');
        micWorkletNode.port.onmessage = (e) => {
          const { pcm, rms } = e.data;
          
          // Basic base64 encode
          const buffer = new Uint8Array(pcm.buffer);
          let binary = '';
          for (let i = 0; i < buffer.byteLength; i++) {
            binary += String.fromCharCode(buffer[i]);
          }
          const base64 = btoa(binary);
          
          vscode.postMessage({ type: 'micPcmChunk', data: base64, rms });
        };
        
        source.connect(micWorkletNode);
        micWorkletNode.connect(micAudioContext.destination);
      } catch (e) {
        console.error('Failed to init mic', e);
      }
    }
    
    function stopWebviewMic() {
      if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
      }
      if (micAudioContext) {
        micAudioContext.close();
      }
    }
    
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'stateChange':
          currentState = message.state;
          if (currentState === 'idle') audioLevel = 0;
          break;
        case 'audioLevel':
          // Smooth the audio level
          audioLevel = audioLevel * 0.7 + message.audioLevel * 0.3;
          break;
        case 'userCaption':
          userCaptionTimeout = showCaption(userCaptionEl, message.text, userCaptionTimeout);
          break;
        case 'modelCaption':
          modelCaptionTimeout = showCaption(modelCaptionEl, message.text, modelCaptionTimeout);
          break;
        case 'audioChunk':
          // Decode and play
          try {
            const binary = atob(message.data);
            const pcm = new Int16Array(binary.length / 2);
            for (let i = 0; i < pcm.length; i++) {
              const lsb = binary.charCodeAt(i * 2);
              const msb = binary.charCodeAt(i * 2 + 1);
              pcm[i] = (msb << 8) | lsb;
            }
            
            // Calc audio level for speaking pulse
            let sum = 0;
            for(let i=0; i<pcm.length; i++) sum += Math.abs(pcm[i]);
            audioLevel = (sum / pcm.length) / 32768.0;
            
            const buffer = audioContext.createBuffer(1, pcm.length, 24000);
            const channelData = buffer.getChannelData(0);
            for (let i = 0; i < pcm.length; i++) {
              channelData[i] = pcm[i] / 32768.0;
            }
            
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);
            
            const currentTime = audioContext.currentTime;
            if (nextStartTime < currentTime) nextStartTime = currentTime;
            source.start(nextStartTime);
            nextStartTime += buffer.duration;
          } catch (e) {
            console.error(e);
          }
          break;
        case 'interrupted':
          // Stop playback
          nextStartTime = 0;
          break;
        case 'transcriptEntry':
          const tc = document.getElementById('transcript-content');
          const div = document.createElement('div');
          div.id = message.entry.id;
          div.className = 'transcript-entry entry-' + message.entry.role;
          
          if (message.entry.role === 'tool') {
            div.textContent = message.entry.toolCall.name + ': ' + message.entry.toolCall.status;
          } else {
            div.textContent = message.entry.text;
          }
          
          tc.appendChild(div);
          tc.scrollTop = tc.scrollHeight;
          break;
        case 'transcriptUpdate':
          const el = document.getElementById(message.id);
          if (el) {
            if (message.partialText) {
              el.textContent += message.partialText;
            } else if (message.status) {
              el.textContent = el.textContent.split(':')[0] + ': ' + message.status;
            }
          }
          break;
        case 'startWebviewMic':
          initWebviewMic();
          break;
        case 'stopWebviewMic':
          stopWebviewMic();
          break;
      }
    });
  </script>
</body>
</html>`;
  }
}
