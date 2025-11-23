import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';

type TcrConfiguration = {
  promptsRoot: string;
  promptLogFile: string;
  testCommand: string;
  gitRemote: string;
  gitBranch: string;
};

const COMMANDS = {
  NEW: 'tcrPrompt.new',
  CONTINUE: 'tcrPrompt.continue',
  REVIEW: 'tcrPrompt.reviewChanges',
  APPROVE: 'tcrPrompt.approve',
  DENY: 'tcrPrompt.deny',
  STATUS: 'tcrPrompt.status'
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

  register(COMMANDS.NEW, async () => {
    const workspaceUri = ensureWorkspace();
    if (!workspaceUri) return;

    const config = readConfig();
    await ensureArtifacts(workspaceUri, config);

    channel.appendLine('New prompt session bootstrapped (stub).');
    void vscode.window.showInformationMessage('TCR Prompt: new session created (stub).');
  });

  register(COMMANDS.CONTINUE, async () => {
    if (!ensureWorkspace()) return;
    channel.appendLine('Continue prompt session (stub).');
    void vscode.window.showInformationMessage('TCR Prompt: continue (stub).');
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
    if (!ensureWorkspace()) return;
    channel.appendLine('Status check (stub).');
    void vscode.window.showInformationMessage('TCR Prompt: status stub.');
  });
}

export function deactivate(): void {
  // nothing to clean up yet
}
