import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PlanData, PlanStep } from './types';

export class PlanManager {
  private workspaceRoot: string;
  private currentPlanPath?: string;
  private cachedPlan: PlanData | null = null;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot || process.cwd();
  }

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
    this.currentPlanPath = undefined;
    this.cachedPlan = null;
  }

  /**
   * Resolves the canonical implementation_plan.md file path:
   * 1. .antigravity/implementation_plan.md
   * 2. implementation_plan.md in workspace root
   * 3. Brain session plan (e.g. antigravity_voice_companion_plan.md or implementation_plan.md)
   */
  public resolvePlanFilePath(): string {
    const dotAntigravityPlan = path.join(this.workspaceRoot, '.antigravity', 'implementation_plan.md');
    if (fs.existsSync(dotAntigravityPlan)) {
      return dotAntigravityPlan;
    }

    const rootPlan = path.join(this.workspaceRoot, 'implementation_plan.md');
    if (fs.existsSync(rootPlan)) {
      return rootPlan;
    }

    // Check brain session directories for active plan
    try {
      const brainDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
      if (fs.existsSync(brainDir)) {
        const entries = fs.readdirSync(brainDir, { withFileTypes: true });
        const sessions = entries
          .filter((e) => e.isDirectory() && e.name !== 'tempmediaStorage')
          .map((e) => ({
            fullPath: path.join(brainDir, e.name),
            mtime: fs.statSync(path.join(brainDir, e.name)).mtimeMs
          }))
          .sort((a, b) => b.mtime - a.mtime);

        const wsBaseName = path.basename(this.workspaceRoot).toLowerCase();
        const wsNormalized = this.workspaceRoot.replace(/\\/g, '/').toLowerCase();
        const wsUrlEncoded = encodeURI(wsNormalized);
        const wsBaseEncoded = encodeURIComponent(wsBaseName);

        for (const session of sessions) {
          const files = fs.readdirSync(session.fullPath);
          const planFile = files.find(
            (f) => f.endsWith('_plan.md') || f === 'implementation_plan.md'
          );
          if (planFile && this.sessionMatchesWorkspace(session.fullPath, wsBaseName, wsNormalized)) {
            return path.join(session.fullPath, planFile);
          }
        }
      }
    } catch {
      // Ignore filesystem errors
    }

    return dotAntigravityPlan;
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
   * Loads and parses the active implementation plan.
   */
  public async getPlan(): Promise<PlanData | null> {
    const filePath = this.resolvePlanFilePath();
    this.currentPlanPath = filePath;

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    this.cachedPlan = this.parsePlanContent(content, filePath);
    return this.cachedPlan;
  }

  /**
   * Parses markdown text into structured PlanData.
   */
  public parsePlanContent(content: string, sourcePath: string): PlanData {
    const lines = content.replace(/\r\n/g, '\n').split('\n');

    let objective = 'General Implementation Plan';
    const proposedChanges: PlanData['proposedChanges'] = [];
    const verificationPlan: string[] = [];
    const steps: PlanStep[] = [];

    // Parse Objective
    const titleMatch = content.match(/^#\s+(?:Implementation Plan:\s*)?(.*)$/m);
    if (titleMatch && titleMatch[1]) {
      objective = titleMatch[1].trim();
    }

    // Proposed Changes parsing: #### [ACTION] [path] or [ACTION] path
    const changeRegex = /####?\s+\[(CREATE|MODIFY|DELETE)\]\s+\[?([^\]\(\s]+)\]?(?:\(file:\/\/\/[^\)]*\))?/i;
    let currentAction: 'CREATE' | 'MODIFY' | 'DELETE' | null = null;
    let currentPath: string | null = null;
    let currentRationale: string[] = [];

    const flushChange = () => {
      if (currentAction && currentPath) {
        proposedChanges.push({
          action: currentAction,
          path: currentPath,
          rationale: currentRationale.join(' ').trim() || 'No description provided'
        });
      }
      currentAction = null;
      currentPath = null;
      currentRationale = [];
    };

    let inVerification = false;
    let inSteps = false;
    let stepIdCounter = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.match(/^##\s+Verification Plan/i)) {
        flushChange();
        inVerification = true;
        inSteps = false;
        continue;
      }

      if (line.match(/^##\s+(?:Proposed Changes|Execution Steps|Steps)/i)) {
        flushChange();
        inVerification = false;
        if (line.match(/steps/i)) {
          inSteps = true;
        }
        continue;
      }

      const matchChange = line.match(changeRegex);
      if (matchChange) {
        flushChange();
        currentAction = matchChange[1].toUpperCase() as any;
        currentPath = matchChange[2].trim();
        continue;
      }

      if (currentAction && currentPath && line.trim() && !line.startsWith('#')) {
        currentRationale.push(line.trim());
      }

      if (inVerification && (line.trim().startsWith('-') || line.trim().startsWith('*') || line.match(/^\d+\./))) {
        const item = line.replace(/^[-*]|\d+\.\s*/, '').trim();
        if (item) {
          verificationPlan.push(item);
        }
      }

      // Explicit Step parsing: "1. [x] Step text" or "- [x] Step text" or "1. Step text"
      const stepChecklistMatch = line.match(/^(\s*(?:\d+\.|\-|\*))\s*\[([ xX])\]\s+(.*)$/);
      if (stepChecklistMatch) {
        const approved = stepChecklistMatch[2].toLowerCase() === 'x';
        steps.push({
          id: stepIdCounter++,
          text: stepChecklistMatch[3].trim(),
          approved
        });
      } else if (inSteps && line.match(/^\d+\.\s+(.*)$/)) {
        const text = line.replace(/^\d+\.\s+/, '').trim();
        steps.push({
          id: stepIdCounter++,
          text,
          approved: false
        });
      }
    }
    flushChange();

    // If no explicit steps were parsed, synthesize steps from proposedChanges
    if (steps.length === 0 && proposedChanges.length > 0) {
      proposedChanges.forEach((c) => {
        steps.push({
          id: stepIdCounter++,
          text: `${c.action} ${c.path}: ${c.rationale.slice(0, 80)}`,
          approved: false
        });
      });
    }

    const allApproved = steps.length > 0 ? steps.every((s) => s.approved) : true;

    return {
      objective,
      proposedChanges,
      verificationPlan,
      steps,
      allApproved,
      sourcePath
    };
  }

  /**
   * Approves a specific plan step by stepId.
   */
  public async approveStep(stepId: number): Promise<PlanData> {
    const plan = await this.getPlan();
    if (!plan) {
      throw new Error('No active plan found to approve');
    }

    const step = plan.steps.find((s) => s.id === stepId);
    if (step) {
      step.approved = true;
    }

    plan.allApproved = plan.steps.every((s) => s.approved);
    this.cachedPlan = plan;

    // Persist step approval update back to the file
    const targetFilePath = this.currentPlanPath || this.resolvePlanFilePath();
    if (targetFilePath && fs.existsSync(targetFilePath)) {
      const content = fs.readFileSync(targetFilePath, 'utf8');
      const lines = content.replace(/\r\n/g, '\n').split('\n');

      let currentStepId = 1;
      let modified = false;

      for (let i = 0; i < lines.length; i++) {
        // Matches bracketed steps: "1. [ ] text" or "- [ ] text"
        const stepMatch = lines[i].match(/^(\s*(?:\d+\.|\-|\*))\s*\[([ xX])\](\s+.*)$/);
        if (stepMatch) {
          if (currentStepId === stepId) {
            lines[i] = `${stepMatch[1]} [x]${stepMatch[3]}`;
            modified = true;
            break;
          }
          currentStepId++;
          continue;
        }

        // Matches unbracketed numbered steps: "1. text"
        const numMatch = lines[i].match(/^(\s*\d+\.)\s+(.*)$/);
        if (numMatch) {
          if (currentStepId === stepId) {
            lines[i] = `${numMatch[1]} [x] ${numMatch[2]}`;
            modified = true;
            break;
          }
          currentStepId++;
        }
      }

      if (modified) {
        fs.writeFileSync(targetFilePath, lines.join('\n'), 'utf8');
      }
    }

    return plan;
  }

  /**
   * Checks whether tool execution (modifying code) is permitted under the approval gate.
   */
  public isExecutionPermitted(): boolean {
    if (!this.cachedPlan) {
      const filePath = this.currentPlanPath || this.resolvePlanFilePath();
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          this.cachedPlan = this.parsePlanContent(content, filePath);
        } catch {
          return true;
        }
      } else {
        return true;
      }
    }
    return this.cachedPlan ? this.cachedPlan.allApproved : true;
  }

  /**
   * Creates or updates the implementation plan file conforming to Antigravity standards.
   */
  public async createOrUpdatePlan(data: Partial<PlanData>): Promise<PlanData> {
    const filePath = this.currentPlanPath || path.join(this.workspaceRoot, '.antigravity', 'implementation_plan.md');
    this.currentPlanPath = filePath;

    const objective = data.objective || 'Voice-Driven Feature Implementation';
    const proposedChanges = data.proposedChanges || [];
    const verificationPlan = data.verificationPlan || ['Automated unit tests', 'Manual verification'];
    const steps = data.steps || [];

    let md = `# Implementation Plan: ${objective}\n\n`;

    md += `## Proposed Changes\n\n`;
    if (proposedChanges.length > 0) {
      proposedChanges.forEach((change) => {
        md += `#### [${change.action}] ${change.path}\n${change.rationale}\n\n`;
      });
    } else {
      md += `*No file changes specified yet.*\n\n`;
    }

    md += `## Execution Steps\n\n`;
    if (steps.length > 0) {
      steps.forEach((step, idx) => {
        const mark = step.approved ? 'x' : ' ';
        md += `${idx + 1}. [${mark}] ${step.text}\n`;
      });
      md += '\n';
    } else {
      md += `1. [ ] Review proposed changes\n2. [ ] Execute implementation\n3. [ ] Run tests and verify\n\n`;
    }

    md += `## Verification Plan\n\n### Automated Tests\n`;
    verificationPlan.forEach((v) => {
      md += `- ${v}\n`;
    });
    md += `\n### Manual Verification\n- Verify end-to-end functionality in editor\n`;

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, md, 'utf8');

    return (await this.getPlan())!;
  }
}
