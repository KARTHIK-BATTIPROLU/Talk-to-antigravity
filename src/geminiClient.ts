import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { GeminiSetupConfig, GeminiFunctionCall, GeminiFunctionResponse } from './types';

export interface GeminiClientEvents {
  connected: () => void;
  setupComplete: () => void;
  audioChunk: (base64Pcm: string) => void;
  textChunk: (text: string) => void;
  userCaption: (text: string) => void;
  modelCaption: (text: string) => void;
  interrupted: () => void;
  turnComplete: () => void;
  toolCall: (calls: GeminiFunctionCall[]) => void;
  toolCallCancellation: (ids: string[]) => void;
  error: (err: Error) => void;
  close: (code: number, reason: string) => void;
}

export class GeminiLiveClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private isReady: boolean = false;
  private config: GeminiSetupConfig;
  private isClosedIntentionally: boolean = false;
  private isTurnInterrupted: boolean = false;
  private pendingQueue: string[] = [];

  constructor(config: GeminiSetupConfig) {
    super();
    this.config = config;
  }

  public updateConfig(config: Partial<GeminiSetupConfig>): void {
    this.config = { ...this.config, ...config };
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.isClosedIntentionally = false;
      const model = this.config.model || 'models/gemini-2.5-flash-native-audio-latest';
      const endpoint = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(this.config.apiKey)}`;

      try {
        this.ws = new WebSocket(endpoint);
      } catch (err) {
        reject(err);
        return;
      }

      let connectionResolved = false;

      this.ws.on('open', () => {
        this.sendSetup();
        this.emit('connected');
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const text = data.toString('utf8');
          const message = JSON.parse(text);
          this.handleServerMessage(message);

          if (!connectionResolved && message.setupComplete) {
            connectionResolved = true;
            resolve();
          }
        } catch (err: any) {
          this.emit('error', new Error(`Failed to parse WebSocket message: ${err.message}`));
        }
      });

      this.ws.on('error', (err: Error) => {
        this.emit('error', err);
        if (!connectionResolved) {
          connectionResolved = true;
          reject(err);
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.isReady = false;
        const reasonStr = reason ? reason.toString('utf8') : '';
        this.emit('close', code, reasonStr);
        if (!connectionResolved) {
          connectionResolved = true;
          reject(new Error(`WebSocket closed before setup completed: ${code} ${reasonStr}`));
        }
      });
    });
  }

  private sendSetup(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const setupPayload: any = {
      setup: {
        model: this.config.model || 'models/gemini-2.5-flash-native-audio-latest',
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.config.voiceName || 'Puck'
              }
            }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      }
    };

    if (this.config.systemInstruction) {
      setupPayload.setup.systemInstruction = {
        parts: [{ text: this.config.systemInstruction }]
      };
    }

    if (this.config.tools && this.config.tools.length > 0) {
      setupPayload.setup.tools = [
        {
          functionDeclarations: this.config.tools
        }
      ];
    }

    this.ws.send(JSON.stringify(setupPayload));
  }

  private handleServerMessage(message: any): void {
    if (message.setupComplete) {
      this.isReady = true;
      this.emit('setupComplete');
      // Flush pending queue if any
      while (this.pendingQueue.length > 0 && this.isReady) {
        const item = this.pendingQueue.shift();
        if (item && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(item);
        }
      }
      return;
    }

    // Check for server content
    if (message.serverContent) {
      const { modelTurn, turnComplete, interrupted, inputAudioTranscription, outputAudioTranscription } = message.serverContent;

      if (interrupted) {
        this.isTurnInterrupted = true;
        this.emit('interrupted');
      }

      if (inputAudioTranscription && inputAudioTranscription.text) {
        this.emit('userCaption', inputAudioTranscription.text);
      }

      if (outputAudioTranscription && outputAudioTranscription.text) {
        this.emit('modelCaption', outputAudioTranscription.text);
      }

      if (!this.isTurnInterrupted && modelTurn && Array.isArray(modelTurn.parts)) {
        for (const part of modelTurn.parts) {
          if (part.inlineData && part.inlineData.data) {
            this.emit('audioChunk', part.inlineData.data);
          }
          if (part.text) {
            this.emit('textChunk', part.text);
          }
        }
      }

      if (turnComplete) {
        this.isTurnInterrupted = false;
        this.emit('turnComplete');
      }
    }

    // Check for tool call
    if (message.toolCall && Array.isArray(message.toolCall.functionCalls)) {
      const calls: GeminiFunctionCall[] = message.toolCall.functionCalls.map((fc: any) => ({
        id: fc.id,
        name: fc.name,
        args: fc.args || {}
      }));
      this.emit('toolCall', calls);
    }

    // Check for tool call cancellation
    if (message.toolCallCancellation && Array.isArray(message.toolCallCancellation.ids)) {
      this.emit('toolCallCancellation', message.toolCallCancellation.ids);
    }
  }

  /**
   * Manually trigger turn interruption (client barge-in)
   */
  public interruptTurn(): void {
    this.isTurnInterrupted = true;
    this.emit('interrupted');
  }

  /**
   * Stream raw microphone PCM chunk up (16kHz 16-bit mono)
   */
  public sendAudioChunk(base64Pcm: string): void {
    const payload = JSON.stringify({
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'audio/pcm;rate=16000',
            data: base64Pcm
          }
        ]
      }
    });

    this.sendPayload(payload);
  }

  /**
   * Send a text prompt / turn to Gemini
   */
  public sendTextMessage(text: string): void {
    this.isTurnInterrupted = false;
    const payload = JSON.stringify({
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text }]
          }
        ],
        turnComplete: true
      }
    });

    this.sendPayload(payload);
  }

  /**
   * Send function/tool responses back to Gemini
   */
  public sendToolResponses(responses: GeminiFunctionResponse[]): void {
    const payload = JSON.stringify({
      toolResponse: {
        functionResponses: responses
      }
    });

    this.sendPayload(payload);
  }

  private sendPayload(payload: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isReady) {
      this.ws.send(payload);
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.isReady) {
      this.pendingQueue.push(payload);
    }
  }

  public disconnect(): void {
    this.isClosedIntentionally = true;
    this.isReady = false;
    this.pendingQueue = [];
    if (this.ws) {
      try {
        this.ws.close();
      } catch (err) {
        // ignore close error
      }
      this.ws = null;
    }
  }

  public get ready(): boolean {
    return this.isReady && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
