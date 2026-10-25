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

export interface GoalTask {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  indent: number;
  milestone?: string;
}

export interface GoalStatus {
  milestone: string;
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
  percentDone: number;
  activeTask?: GoalTask;
  tasks: GoalTask[];
  sourcePath: string;
}

export interface PlanStep {
  id: number;
  text: string;
  approved: boolean;
}

export interface PlanData {
  objective: string;
  proposedChanges: Array<{ action: 'CREATE' | 'MODIFY' | 'DELETE'; path: string; rationale: string }>;
  verificationPlan: string[];
  steps: PlanStep[];
  allApproved: boolean;
  sourcePath: string;
}

export interface DevServerInfo {
  port: number;
  url: string;
  status: 'running' | 'stopped';
  title?: string;
}

export interface WorkspaceDelta {
  modifiedFiles: string[];
  stagedFiles: string[];
  untrackedFiles: string[];
  insertions: number;
  deletions: number;
  branch: string;
  ahead: number;
  behind: number;
}

export interface AmbientSnapshot {
  activeFile?: string;
  languageId?: string;
  cursorLine?: number;
  diagnosticsCount: { errors: number; warnings: number };
  gitBranch?: string;
  gitStatusSummary?: string;
  detectedDevServers: string[];
  recentTerminalOutput?: string;
}

export type WebviewToExtensionMessage =
  | { type: 'startSession' }
  | { type: 'stopSession' }
  | { type: 'toggleMute' }
  | { type: 'interrupt' }
  | { type: 'sendTextMessage'; text: string }
  | { type: 'micPcmChunk'; data: string; rms: number }
  | { type: 'clearTranscript' }
  | { type: 'executeTerminalCommand'; command: string }
  | { type: 'getGoal' }
  | { type: 'updateTaskStatus'; taskIdOrText: string; status: GoalTask['status'] }
  | { type: 'addTask'; text: string; milestone?: string }
  | { type: 'getPlan' }
  | { type: 'approvePlanStep'; stepId: number }
  | { type: 'getTeamworkPreview' }
  | { type: 'openDiff'; filePath: string }
  | { type: 'scanDevServers' }
  | { type: 'runBoost'; prompt: string; model?: 'pro' | 'flash' }
  | { type: 'switchTab'; tab: string }
  | { type: 'openExternal'; url: string };

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
  | { type: 'modelCaption'; text: string }
  | { type: 'goalUpdate'; data: GoalStatus }
  | { type: 'planUpdate'; data: PlanData | null }
  | { type: 'teamworkUpdate'; delta: WorkspaceDelta; walkthrough?: string }
  | { type: 'devServersUpdate'; servers: DevServerInfo[] }
  | { type: 'boostProgress'; message: string }
  | { type: 'boostComplete'; result: string }
  | { type: 'activeTab'; tab: string };


