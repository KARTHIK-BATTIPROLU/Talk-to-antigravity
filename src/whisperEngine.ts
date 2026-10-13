import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';

export class WhisperCaptionEngine extends EventEmitter {
  private pythonProcess: ChildProcess | null = null;
  private pythonPath: string;
  private scriptPath: string;

  constructor(pythonPath: string, workspaceRoot: string) {
    super();
    this.pythonPath = pythonPath;
    this.scriptPath = path.join(workspaceRoot, 'scripts', 'whisper_caption.py');
  }

  public start(): void {
    if (this.pythonProcess) return;

    this.pythonProcess = spawn(this.pythonPath, ['-u', this.scriptPath]);

    this.pythonProcess.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString('utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'caption') {
            this.emit('caption', msg.text);
          }
        } catch (e) {
          // Ignore parse errors or print them if debugging
        }
      }
    });

    this.pythonProcess.stderr?.on('data', (data: Buffer) => {
      // console.error(`Whisper stderr: ${data.toString('utf8')}`);
    });

    this.pythonProcess.on('close', (code) => {
      this.pythonProcess = null;
      this.emit('close', code);
    });
  }

  public stop(): void {
    if (this.pythonProcess) {
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
  }

  public feedPcmChunk(base64Pcm: string): void {
    if (this.pythonProcess && this.pythonProcess.stdin) {
      this.pythonProcess.stdin.write(JSON.stringify({ type: 'pcm', data: base64Pcm }) + '\n');
    }
  }

  public interrupt(): void {
    if (this.pythonProcess && this.pythonProcess.stdin) {
      this.pythonProcess.stdin.write(JSON.stringify({ command: 'interrupt' }) + '\n');
    }
  }
}
