import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type TcrConfiguration = {
  promptsRoot: string;
  promptLogFile: string;
  testCommand: string;
  gitRemote: string;
  gitBranch: string;
};

type PromptStatus = 'PENDING' | 'APPROVED' | 'DENIED';

type StoredPromptSession = {
  id: string;
  title: string;
  createdAt: string;
  status: PromptStatus;
  thoughtLogRelativePath: string;
  baselineSha?: string;
};

const COMMANDS = {
  NEW: 'tcrPrompt.new',
  CONTINUE: 'tcrPrompt.continue',
  REVIEW: 'tcrPrompt.reviewChanges',
  APPROVE: 'tcrPrompt.approve',
  DENY: 'tcrPrompt.deny',
  STATUS: 'tcrPrompt.status'
};

const STATE_KEYS = {
  ACTIVE_SESSION: 'tcrPrompt.activeSession'
};

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel('TCR Prompt');

  const ensureWorkspace = (): vscode.Uri | undefined => {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      void vscode.window.showErrorMessage('TCR Prompt: open a folder or workspace first.');
      return;
    }
    return workspace.uri;
  };

  const readConfig = (): TcrConfiguration => {
    const cfg = vscode.workspace.getConfiguration('tcrPrompt');
    return {
      promptsRoot: cfg.get<string>('promptsRoot', 'prompts'),
      promptLogFile: cfg.get<string>('promptLogFile', 'prompts.md'),
      testCommand: cfg.get<string>('testCommand', 'npm test'),
      gitRemote: cfg.get<string>('gitRemote', 'origin'),
      gitBranch: cfg.get<string>('gitBranch', 'main')
    };
  };

  const ensureArtifacts = async (workspaceUri: vscode.Uri, config: TcrConfiguration) => {
    const promptsFolder = path.join(workspaceUri.fsPath, config.promptsRoot);
    const promptLogPath = path.join(workspaceUri.fsPath, config.promptLogFile);

    await fs.mkdir(promptsFolder, { recursive: true });
    try {
      await fs.access(promptLogPath);
    } catch {
      const header = '# Prompt Log\n\n';
      await fs.writeFile(promptLogPath, header, { encoding: 'utf8' });
    }
  };

  const register = (command: string, handler: (...args: any[]) => any) => {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  };

  const generatePromptId = () => {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
    return `p-${timestamp}`;
  };

  const formatAsBlockQuote = (text: string) => text.split('\n').map((line) => `> ${line}`).join('\n');

  const writeThoughtLog = async (
    absolutePath: string,
    id: string,
    title: string,
    promptBody: string,
    createdAt: string
  ) => {
    const content = [
      `# Thought Log – ${id}`,
      '',
      '## Prompt',
      title,
      '',
      promptBody,
      '',
      '## Timeline',
      `- ${createdAt}: Prompt created.`,
      '',
      '## Notes',
      '- Add Codex interactions here as the session progresses.',
      ''
    ].join('\n');
    await fs.writeFile(absolutePath, content, { encoding: 'utf8' });
  };

  const appendPromptLogEntry = async (
    promptLogPath: string,
    id: string,
    title: string,
    promptBody: string,
    thoughtLogRelative: string,
    createdAt: string
  ) => {
    const entry = [
      `## ${createdAt} – ${title}`,
      `ID: ${id}`,
      'Status: PENDING',
      `ThoughtLog: ${thoughtLogRelative}`,
      'Commit: pending',
      '',
      'Prompt:',
      formatAsBlockQuote(promptBody),
      '',
      '---',
      ''
    ].join('\n');
    await fs.appendFile(promptLogPath, entry, { encoding: 'utf8' });
  };

  const tryGetBaselineSha = async (workspaceUri: vscode.Uri): Promise<string | undefined> => {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: workspaceUri.fsPath,
        encoding: 'utf8'
      });
      return stdout.trim();
    } catch (err) {
      channel.appendLine(`Could not read git HEAD: ${(err as Error).message}`);
      return undefined;
    }
  };

  const saveActiveSession = async (session: StoredPromptSession) => {
    await context.workspaceState.update(STATE_KEYS.ACTIVE_SESSION, session);
  };

  const loadActiveSession = (): StoredPromptSession | undefined => {
    return context.workspaceState.get<StoredPromptSession>(STATE_KEYS.ACTIVE_SESSION);
  };

  register(COMMANDS.NEW, async () => {
    const workspaceUri = ensureWorkspace();
    if (!workspaceUri) return;

    const config = readConfig();
    await ensureArtifacts(workspaceUri, config);

    const title = await vscode.window.showInputBox({
      title: 'TCR Prompt: Title',
      prompt: 'Short title for this prompt/session.',
      placeHolder: 'e.g., Add caching to user API'
    });
    if (!title) {
      return;
    }

    const promptBody = await vscode.window.showInputBox({
      title: 'TCR Prompt: Body',
      prompt: 'Full prompt text (press Enter to confirm).',
      placeHolder: 'Describe the change you want Codex to apply.',
      value: ''
    });
    if (!promptBody) {
      return;
    }

    const id = generatePromptId();
    const createdAt = new Date().toISOString();
    const thoughtLogRelative = path.posix.join(config.promptsRoot, `${id}-log.md`);
    const thoughtLogAbsolute = path.join(workspaceUri.fsPath, config.promptsRoot, `${id}-log.md`);
    const promptLogPath = path.join(workspaceUri.fsPath, config.promptLogFile);
    const baselineSha = await tryGetBaselineSha(workspaceUri);

    await writeThoughtLog(thoughtLogAbsolute, id, title, promptBody, createdAt);
    await appendPromptLogEntry(promptLogPath, id, title, promptBody, thoughtLogRelative, createdAt);
    await saveActiveSession({
      id,
      title,
      createdAt,
      status: 'PENDING',
      thoughtLogRelativePath: thoughtLogRelative,
      baselineSha
    });

    channel.appendLine(`Created prompt ${id} (baseline: ${baselineSha ?? 'unknown'}).`);
    void vscode.window.showInformationMessage(`TCR Prompt: created ${id}.`);

    const doc = await vscode.workspace.openTextDocument(thoughtLogAbsolute);
    await vscode.window.showTextDocument(doc);
  });

  register(COMMANDS.CONTINUE, async () => {
    const session = loadActiveSession();
    if (!session) {
      void vscode.window.showWarningMessage('No active prompt session. Start a new one first.');
      return;
    }
    const workspaceUri = ensureWorkspace();
    if (!workspaceUri) return;

    const thoughtLogAbsolute = path.join(workspaceUri.fsPath, session.thoughtLogRelativePath);
    try {
      const doc = await vscode.workspace.openTextDocument(thoughtLogAbsolute);
      await vscode.window.showTextDocument(doc);
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not open thought log: ${(err as Error).message}`);
    }
  });

  register(COMMANDS.REVIEW, async () => {
    if (!ensureWorkspace()) return;
    channel.appendLine('Review changes (stub).');
    void vscode.commands.executeCommand('workbench.scm.focus');
  });

  register(COMMANDS.APPROVE, async () => {
    if (!ensureWorkspace()) return;
    channel.appendLine('Approve flow (stub: run tests → commit → push).');
    void vscode.window.showWarningMessage('Approve is stubbed; implement git + test flow.');
  });

  register(COMMANDS.DENY, async () => {
    if (!ensureWorkspace()) return;
    channel.appendLine('Deny flow (stub: revert code, keep logs).');
    void vscode.window.showWarningMessage('Deny is stubbed; implement revert + commit flow.');
  });

  register(COMMANDS.STATUS, async () => {
    const session = loadActiveSession();
    if (!session) {
      void vscode.window.showInformationMessage('TCR Prompt: no active session.');
      return;
    }
    const info = `ID ${session.id} | ${session.status} | Created ${session.createdAt} | Log ${session.thoughtLogRelativePath}`;
    channel.appendLine(info);
    void vscode.window.showInformationMessage(info);
  });
}

export function deactivate(): void {
  // nothing to clean up yet
}
