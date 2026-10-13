import { EventEmitter } from 'events';
import * as child_process from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface AudioCaptureOptions {
  pythonPath?: string;
  scriptPath?: string;
  deviceIndex?: number;
  blockMs?: number;
}

export class AudioCaptureEngine extends EventEmitter {
  private proc: child_process.ChildProcess | null = null;
  private options: AudioCaptureOptions;
  private isCapturing: boolean = false;
  private isMuted: boolean = false;
  private bufferRemainder: string = '';

  constructor(options?: AudioCaptureOptions) {
    super();
    this.options = options || {};
  }

  public updateOptions(options: Partial<AudioCaptureOptions>): void {
    this.options = { ...this.options, ...options };
  }

  public start(): Promise<void> {
    if (this.isCapturing) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      let pythonExe = this.options.pythonPath;
      if (!pythonExe || !fs.existsSync(pythonExe)) {
        if (fs.existsSync('C:\\Python311\\python.exe')) {
          pythonExe = 'C:\\Python311\\python.exe';
        } else {
          pythonExe = 'python';
        }
      }
      const script = this.options.scriptPath || path.resolve(__dirname, '..', 'scripts', 'audio_capture.py');

      if (!fs.existsSync(script)) {
        reject(new Error(`Audio capture script not found at ${script}`));
        return;
      }

      const args = [
        '-u', // Unbuffered binary stdout and stderr
        script,
        '--block-ms',
        String(this.options.blockMs || 100),
        '--format',
        'json'
      ];

      if (this.options.deviceIndex !== undefined) {
        args.push('--device', String(this.options.deviceIndex));
      }

      try {
        this.proc = child_process.spawn(pythonExe, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        });
      } catch (err) {
        reject(err);
        return;
      }

      this.isCapturing = true;
      let readyReceived = false;

      this.proc.stdout?.setEncoding('utf8');
      this.proc.stdout?.on('data', (chunk: string) => {
        this.handleStdoutChunk(chunk);
      });

      this.proc.stderr?.setEncoding('utf8');
      this.proc.stderr?.on('data', (data: string) => {
        const lines = data.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.type === 'ready') {
              readyReceived = true;
              this.emit('ready', parsed);
              resolve();
            } else if (parsed.type === 'error') {
              this.emit('error', new Error(parsed.message));
            }
          } catch {
            // Raw stderr output
            this.emit('stderr', trimmed);
          }
        }
      });

      this.proc.on('error', (err) => {
        this.isCapturing = false;
        this.emit('error', err);
        if (!readyReceived) {
          reject(err);
        }
      });

      this.proc.on('exit', (code, signal) => {
        this.isCapturing = false;
        this.emit('stopped', { code, signal });
      });

      // Timeout fallback if ready event not received within 3 seconds
      setTimeout(() => {
        if (!readyReceived && this.isCapturing) {
          readyReceived = true;
          resolve();
        }
      }, 3000);
    });
  }

  private handleStdoutChunk(chunk: string): void {
    this.bufferRemainder += chunk;
    const lines = this.bufferRemainder.split('\n');
    this.bufferRemainder = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed);
        if (msg.type === 'pcm' && msg.data) {
          if (!this.isMuted) {
            this.emit('pcm', msg.data);
            this.emit('rms', msg.rms || 0.0);
          } else {
            this.emit('rms', 0.0);
          }
        }
      } catch (err) {
        // Line formatting parse error, ignore corrupted lines
      }
    }
  }

  /**
   * For webview microphone capture or synthetic audio feeds
   */
  public feedPcmChunk(base64Data: string, rms?: number): void {
    if (this.isMuted) return;
    this.emit('pcm', base64Data);
    if (rms !== undefined) {
      this.emit('rms', rms);
    }
  }

  public setMute(mute: boolean): void {
    this.isMuted = mute;
    if (this.proc && this.proc.stdin && !this.proc.stdin.destroyed) {
      try {
        const cmd = mute ? 'mute' : 'unmute';
        this.proc.stdin.write(JSON.stringify({ command: cmd }) + '\n');
      } catch {
        // ignore stdin write error
      }
    }
    this.emit('muteChange', this.isMuted);
  }

  public toggleMute(): boolean {
    this.setMute(!this.isMuted);
    return this.isMuted;
  }

  public stop(): void {
    if (!this.isCapturing && !this.proc) return;

    this.isCapturing = false;
    const procToKill = this.proc;
    this.proc = null;

    if (procToKill) {
      try {
        if (procToKill.stdin && !procToKill.stdin.destroyed) {
          procToKill.stdin.write(JSON.stringify({ command: 'stop' }) + '\n');
        }
        setTimeout(() => {
          if (!procToKill.killed) {
            try {
              procToKill.kill('SIGTERM');
            } catch {}
          }
        }, 300);
      } catch {
        try {
          procToKill.kill();
        } catch {}
      }
    }
    this.bufferRemainder = '';
  }

  public get capturing(): boolean {
    return this.isCapturing;
  }

  public get muted(): boolean {
    return this.isMuted;
  }
}
