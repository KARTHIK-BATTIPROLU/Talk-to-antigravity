import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GoalTask, GoalStatus } from './types';

export class GoalManager {
  private workspaceRoot: string;
  private currentSourcePath?: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot || process.cwd();
  }

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
    this.currentSourcePath = undefined;
  }

  /**
   * Resolves the active task file hierarchically:
   * 1. Active Antigravity brain session matching current workspace root
   * 2. .antigravity/task.md
   * 3. task.md in workspace root
   * 4. .agents/task.md
   */
  public resolveTaskFilePath(): string {
    const wsBaseName = path.basename(this.workspaceRoot).toLowerCase();
    const wsNormalized = this.workspaceRoot.replace(/\\/g, '/').toLowerCase();

    // 1. Check Antigravity brain sessions matching current workspace root
    try {
      const brainDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
      if (fs.existsSync(brainDir)) {
        const entries = fs.readdirSync(brainDir, { withFileTypes: true });
        const sessionDirs = entries
          .filter((e) => e.isDirectory() && e.name !== 'tempmediaStorage')
          .map((e) => ({
            name: e.name,
            fullPath: path.join(brainDir, e.name),
            mtime: fs.statSync(path.join(brainDir, e.name)).mtimeMs
          }))
          .sort((a, b) => b.mtime - a.mtime);

        for (const session of sessionDirs) {
          const directTask = path.join(session.fullPath, 'task.md');
          const sysTask = path.join(session.fullPath, '.system_generated', 'task.md');
          const taskCandidate = fs.existsSync(directTask) ? directTask : (fs.existsSync(sysTask) ? sysTask : null);

          if (taskCandidate) {
            // Check if this brain session matches current workspace root
            if (this.sessionMatchesWorkspace(session.fullPath, wsBaseName, wsNormalized)) {
              return taskCandidate;
            }
          }
        }
      }
    } catch {
      // Ignore filesystem errors scanning brain directory
    }

    // 2. .antigravity/task.md in workspace root
    const dotAntigravityTask = path.join(this.workspaceRoot, '.antigravity', 'task.md');
    if (fs.existsSync(dotAntigravityTask)) {
      return dotAntigravityTask;
    }

    // 3. Root task.md
    const rootTask = path.join(this.workspaceRoot, 'task.md');
    if (fs.existsSync(rootTask)) {
      return rootTask;
    }

    // 4. .agents/task.md
    const agentsTask = path.join(this.workspaceRoot, '.agents', 'task.md');
    if (fs.existsSync(agentsTask)) {
      return agentsTask;
    }

    // Default: initialize .antigravity/task.md
    return dotAntigravityTask;
  }

  private sessionMatchesWorkspace(sessionPath: string, wsBaseName: string, wsNormalized: string): boolean {
    try {
      const wsUrlEncoded = encodeURI(wsNormalized);
      const wsBaseEncoded = encodeURIComponent(wsBaseName);
      const files = fs.readdirSync(sessionPath);
      for (const file of files) {
        if (file.endsWith('.md') || file.endsWith('.json')) {
          const rawContent = fs.readFileSync(path.join(sessionPath, file), 'utf8').toLowerCase();
          let decodedContent = '';
          try {
            decodedContent = decodeURIComponent(rawContent);
          } catch {
            decodedContent = rawContent;
          }

          if (
            rawContent.includes(wsNormalized) ||
            rawContent.includes(wsBaseName) ||
            rawContent.includes(wsUrlEncoded) ||
            rawContent.includes(wsBaseEncoded) ||
            decodedContent.includes(wsNormalized) ||
            decodedContent.includes(wsBaseName)
          ) {
            return true;
          }
        }
      }
    } catch {
      // Ignore
    }
    return false;
  }

  /**
   * Reads and parses the active task.md file into GoalStatus.
   * If the file does not exist, initializes a default task.md.
   */
  public async getGoalStatus(): Promise<GoalStatus> {
    const filePath = this.resolveTaskFilePath();
    this.currentSourcePath = filePath;

    if (!fs.existsSync(filePath)) {
      this.initializeDefaultTaskFile(filePath);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return this.parseTaskContent(content, filePath);
  }

  public parseTaskContent(content: string, sourcePath: string): GoalStatus {
    const lines = content.replace(/\r\n/g, '\n').split('\n');

    let currentMilestone = 'Default Milestone';
    const tasks: GoalTask[] = [];
    let taskCounter = 1;

    // Regex for checklist item: e.g. "- [ ] item", "1. [/] item", "* [x] item", "- [!] item", "- `[x]` item"
    const checklistRegex = /^(\s*)[-*+]?\s*(?:\d+\.)?\s*`?\[([ xX/!])\]`?\s+(.*)$/;
    const headerRegex = /^#{1,4}\s+(.*)$/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const headerMatch = line.match(headerRegex);
      if (headerMatch) {
        currentMilestone = headerMatch[1].trim();
        continue;
      }

      const match = line.match(checklistRegex);
      if (match) {
        const indentStr = match[1];
        const marker = match[2];
        const text = match[3].trim();

        let status: GoalTask['status'] = 'pending';
        if (marker === 'x' || marker === 'X') {
          status = 'completed';
        } else if (marker === '/') {
          status = 'in_progress';
        } else if (marker === '!') {
          status = 'blocked';
        }

        const indent = Math.floor(indentStr.length / 2);

        tasks.push({
          id: `task-${taskCounter++}`,
          text,
          status,
          indent,
          milestone: currentMilestone
        });
      }
    }

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t) => t.status === 'completed').length;
    const inProgressTasks = tasks.filter((t) => t.status === 'in_progress').length;
    const blockedTasks = tasks.filter((t) => t.status === 'blocked').length;
    const percentDone = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const activeTask = tasks.find((t) => t.status === 'in_progress') || tasks.find((t) => t.status === 'pending');

    return {
      milestone: tasks.length > 0 && activeTask?.milestone ? activeTask.milestone : currentMilestone,
      totalTasks,
      completedTasks,
      inProgressTasks,
      blockedTasks,
      percentDone,
      activeTask,
      tasks,
      sourcePath
    };
  }

  /**
   * Updates task status atomically in the underlying markdown file.
   */
  public async updateTaskStatus(taskIdOrText: string, status: GoalTask['status']): Promise<GoalStatus> {
    const filePath = this.currentSourcePath || this.resolveTaskFilePath();
    if (!fs.existsSync(filePath)) {
      this.initializeDefaultTaskFile(filePath);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.replace(/\r\n/g, '\n').split('\n');

    let markerChar = ' ';
    if (status === 'completed') markerChar = 'x';
    else if (status === 'in_progress') markerChar = '/';
    else if (status === 'blocked') markerChar = '!';

    const checklistRegex = /^(\s*[-*+]?\s*(?:\d+\.)?\s*`?\[)[ xX/!](`?\]\s+)(.*)$/;

    let taskIndex = 1;
    let updated = false;

    const query = taskIdOrText.toLowerCase().trim();

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(checklistRegex);
      if (match) {
        const taskId = `task-${taskIndex}`;
        const itemText = match[3].trim();
        const itemTextLower = itemText.toLowerCase();

        // Match by task ID (e.g. "task-2") or case-insensitive text match
        const matchesId = query === taskId;
        const matchesText = itemTextLower.length > 0 && (itemTextLower.includes(query) || (query.length >= 3 && query.includes(itemTextLower)));
        if (matchesId || matchesText) {
          lines[i] = `${match[1]}${markerChar}${match[2]}${match[3]}`;
          updated = true;
          break;
        }
        taskIndex++;
      }
    }

    if (updated) {
      this.atomicWriteFile(filePath, lines.join('\n'));
    }

    return this.getGoalStatus();
  }

  /**
   * Appends a new task to the task.md file.
   */
  public async addTask(taskText: string, milestone?: string): Promise<GoalStatus> {
    const filePath = this.currentSourcePath || this.resolveTaskFilePath();
    if (!fs.existsSync(filePath)) {
      this.initializeDefaultTaskFile(filePath);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.replace(/\r\n/g, '\n').split('\n');

    const newTaskLine = `- [ ] ${taskText.trim()}`;

    if (milestone) {
      let targetSectionIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(milestone.toLowerCase())) {
          targetSectionIndex = i;
          break;
        }
      }

      if (targetSectionIndex !== -1) {
        // Find next section or end of file
        let insertIndex = lines.length;
        for (let j = targetSectionIndex + 1; j < lines.length; j++) {
          if (lines[j].startsWith('#')) {
            insertIndex = j;
            break;
          }
        }
        lines.splice(insertIndex, 0, newTaskLine);
      } else {
        lines.push(`\n## ${milestone}\n`, newTaskLine);
      }
    } else {
      lines.push(newTaskLine);
    }

    this.atomicWriteFile(filePath, lines.join('\n'));
    return this.getGoalStatus();
  }

  private initializeDefaultTaskFile(targetPath: string): void {
    const defaultTemplate = `# Antigravity Project Tasks

## Milestone 1: Setup & Initialization
- [x] Initialize project repository and configure environment
- [/] Connect Antigravity Voice Companion
- [ ] Define core architecture and implementation plan
- [ ] Run automated test suite verification
`;
    this.atomicWriteFile(targetPath, defaultTemplate);
  }

  private atomicWriteFile(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${filePath}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, content, 'utf8');
    try {
      fs.renameSync(tempPath, filePath);
    } catch {
      // Fallback for Windows if target file is temporarily locked
      try {
        fs.copyFileSync(tempPath, filePath);
        fs.unlinkSync(tempPath);
      } catch {
        fs.writeFileSync(filePath, content, 'utf8');
      }
    }
  }
}
