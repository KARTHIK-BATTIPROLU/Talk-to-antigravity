export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'interrupted' | 'error';

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

export interface GeminiSetupConfig {
  apiKey: string;
  model?: string;
  voiceName?: string;
  systemInstruction?: string;
  tools?: ToolDeclaration[];
}

export interface GeminiFunctionCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface GeminiFunctionResponse {
  id: string;
  response: {
    output: any;
  };
}

export interface TranscriptEntry {
  id: string;
  role: 'user' | 'model' | 'system' | 'tool';
  text?: string;
  timestamp: number;
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, any>;
    result?: any;
    status: 'running' | 'success' | 'error';
  };
}

export type WebviewToExtensionMessage =
  | { type: 'startSession' }
  | { type: 'stopSession' }
  | { type: 'toggleMute' }
  | { type: 'interrupt' }
  | { type: 'sendTextMessage'; text: string }
  | { type: 'micPcmChunk'; data: string; rms: number }
  | { type: 'clearTranscript' }
  | { type: 'executeTerminalCommand'; command: string };

export type ExtensionToWebviewMessage =
  | { type: 'stateChange'; state: VoiceState; details?: string }
  | { type: 'audioChunk'; data: string } // base64 24kHz PCM
  | { type: 'micRms'; rms: number }
  | { type: 'transcript'; entry: TranscriptEntry }
  | { type: 'transcriptUpdate'; id: string; partialText?: string; toolResult?: any; status?: 'running' | 'success' | 'error' }
  | { type: 'interrupted' }
  | { type: 'startWebviewMic' }
  | { type: 'stopWebviewMic' }
  | { type: 'error'; message: string }
  | { type: 'userCaption'; text: string }
  | { type: 'modelCaption'; text: string };

