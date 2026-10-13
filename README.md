# Talking to Antigravity (Voice Dev Bridge) 🎙️⚡

A real-time, two-way conversational voice interface for **Antigravity**, **Cursor**, **Claude Code**, and **VS Code**, powered by the **Google Gemini 2.0 / 2.5 Flash Native Audio Live WebSocket API** (`bidiGenerateContent`).

---

## 🌟 Key Features

1. **Bidirectional Multimodal Streaming**:
   - Streams 16kHz 16-bit mono PCM audio from your Windows microphone directly to Gemini Live.
   - Receives 24kHz raw PCM audio chunks back with ultra-low latency playback via Web Audio API in the Sidebar Webview.
2. **Sub-100ms Barge-In / Interruption**:
   - Instant response cancellation: as soon as you speak or hit interrupt, playing audio buffers stop immediately (<15ms) and the queue resets.
3. **Client-Side Function Calling**:
   - Gemini can natively inspect and modify your workspace via live tools:
     - `read_file(path, start_line?, end_line?)`: Reads workspace files with line indexing and CRLF normalization.
     - `write_file(path, content)`: Creates or overwrites files directly in the workspace.
     - `get_workspace_tree(depth?, sub_dir?)`: Explores project directory structure (auto-filtering node_modules/git).
     - `get_active_editor()`: Inspects current active tab, cursor position, visible viewport lines, and active selections.
     - `run_terminal_command(command, interactive?)`: Executes headless background commands or visibly inside the integrated terminal.
4. **CLI Integration Bridge**:
   - Direct integration with **Claude Code CLI** (`claude -p "<prompt>"`) and **Antigravity CLI** (`agy-node`).
   - Dedicated interactive terminal session named `Voice Dev Bridge` for live shell visibility.
5. **Dual Audio Capture with Fallback**:
   - Primary: Python `sounddevice` engine streaming 16kHz mono PCM.
   - Automatic WebRTC Fallback: Webview AudioContext capture with browser-grade Acoustic Echo Cancellation (AEC), noise suppression, and automatic gain control.
6. **Rich Sidebar Webview & Status Bar**:
   - Status Bar item reflecting live states: `Idle` | `Listening` | `Thinking` | `Speaking` | `Interrupted` | `Error`.
   - Real-time oscilloscope / frequency waveform canvas visualizer in the sidebar.
   - Interactive transcript feed displaying user transcripts, model speech, and expandable tool execution cards.

---

## 📐 Architecture

```
                       ┌────────────────────────────────────────┐
                       │          Sidebar Webview UI            │
                       │  - Web AudioContext 24kHz Player       │
                       │  - Live HTML5 Canvas Waveform          │
                       │  - Transcript Feed & Quick Text Input  │
                       └──────────────────▲─────────────────────┘
                                          │ PostMessage
                                          ▼
┌───────────────────────┐         ┌──────────────────────────────┐         ┌─────────────────────────┐
│  audio_capture.py     │  PCM    │    Extension Core Host       │   WS    │  Gemini Live API        │
│  (sounddevice engine) │────────▶│  - Session State Machine     │────────▶│  (gemini-2.5-flash-     │
│  16kHz 16-bit Mono    │         │  - Audio Routing Pipeline    │◀────────│   native-audio-latest)  │
└───────────────────────┘         └──────────────┬───────────────┘         └─────────────────────────┘
                                                 │
                                                 ▼
                                  ┌──────────────────────────────┐
                                  │       Tool Executor          │
                                  │  - read_file                 │
                                  │  - get_workspace_tree        │
                                  │  - get_active_editor         │
                                  │  - run_terminal_command      │
                                  │  - claude & agy-node CLI     │
                                  └──────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- Windows 10/11
- Node.js >= 18 (Verified on Node v22.20.0)
- Python 3.10+ (Verified on Python 3.11.7 with `sounddevice` and `numpy`)

### 1. Build & Test
```powershell
npm install
npm run build
npm test
```

### 2. Launch Extension in VS Code / Cursor / Antigravity
1. Open this directory in VS Code, Cursor, or Antigravity:
   ```powershell
   code .
   ```
2. Press `F5` (or run `Launch Talking to Antigravity Extension` from Run & Debug).
3. In the new Extension Development Host window:
   - Look at the bottom-right status bar for `$(mic) Voice: Idle`.
   - Open the **Voice Dev Bridge** view container from the activity bar (microphone icon).
   - Click **Start Voice** (or run command `Voice Bridge: Start Voice Session`).
   - Speak naturally: *"What files are in this project?"* or *"Read package.json"*.

---

## ⚙️ Configuration Settings

Accessible via `Settings > Extensions > Talking to Antigravity Voice Bridge`:

| Setting | Default | Description |
|---|---|---|
| `talkingToAntigravity.apiKey` | `(pre-configured)` | Google Gemini API key for Live WebSocket |
| `talkingToAntigravity.model` | `models/gemini-2.5-flash-native-audio-latest` | Gemini 2.0/2.5 Live model |
| `talkingToAntigravity.voiceName` | `Puck` | Voice: `Puck`, `Charon`, `Kore`, `Fenrir`, `Aoede` |
| `talkingToAntigravity.pythonPath` | `C:\Python311\python.exe` | Python executable for audio capture engine |
| `talkingToAntigravity.claudeCliPath` | `C:\Users\Karthik\AppData\Roaming\npm\claude.cmd` | Claude Code CLI path |
| `talkingToAntigravity.antigravityCliPath` | `C:\Users\Karthik\AppData\Roaming\Antigravity\bin\agy-node.cmd` | Antigravity CLI path |

---

## 🧪 Testing Record

- **Automated Tests**: 20 tests across 5 test suites covering Gemini WebSocket client protocol, barge-in audio suppression, tool call cancellation, audio capture parsing, mute toggling, tool execution (`read_file`, `write_file`, `get_workspace_tree`, `run_terminal_command`), and terminal integration.
- **End-to-End Live Integration Test**: Live verified against Google Gemini Multimodal Live API (`bidiGenerateContent`) using `scripts/test_gemini_live.py`, `scripts/test_tool_roundtrip.py`, and `dist/tests/liveIntegration.test.js`.
