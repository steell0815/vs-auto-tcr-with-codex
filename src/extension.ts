import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
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
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
};

type PromptStatus = 'PENDING' | 'APPROVED' | 'DENIED';

type StoredPromptSession = {
  id: string;
  title: string;
  createdAt: string;
  status: PromptStatus;
  thoughtLogRelativePath: string;
  baselineSha?: string;
  lastTestResult?: 'PASS' | 'FAIL';
  lastTestOutput?: string;
  lastCommit?: string;
  promptBody?: string;
};

const COMMANDS = {
  NEW: 'tcrPrompt.new',
  CONTINUE: 'tcrPrompt.continue',
  REVIEW: 'tcrPrompt.reviewChanges',
  APPROVE: 'tcrPrompt.approve',
  DENY: 'tcrPrompt.deny',
  STATUS: 'tcrPrompt.status',
  SELECT: 'tcrPrompt.selectSession'
};

const STATE_KEYS = {
  ACTIVE_SESSION: 'tcrPrompt.activeSession',
  SESSIONS: 'tcrPrompt.sessions'
};

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const channel = vscode.window.createOutputChannel('TCR Prompt');
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = COMMANDS.STATUS;
  context.subscriptions.push(statusBar);

  const ensureWorkspace = (): vscode.Uri | undefined => {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      void vscode.window.showErrorMessage('TCR Prompt: open a folder or workspace first.');
      return;
    }
    return workspace.uri;
  };

  const snapshotFileTree = async (workspaceUri: vscode.Uri, limit = 200): Promise<string[]> => {
    const root = workspaceUri.fsPath;
    const entries: string[] = [];
    const ignored = new Set(['.git', 'node_modules', '.vscode', '.idea', 'dist', 'out', 'build', '.turbo']);

    const walk = async (dir: string) => {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        if (entries.length >= limit) return;
        const rel = path.relative(root, path.join(dir, item.name));
        const parts = rel.split(path.sep);
        if (parts.some((p) => ignored.has(p))) continue;
        entries.push(rel + (item.isDirectory() ? '/' : ''));
        if (item.isDirectory()) {
          await walk(path.join(dir, item.name));
        }
      }
    };

    try {
      await walk(root);
    } catch (err) {
      logError(`Failed to snapshot workspace: ${(err as Error).message}`);
    }
    return entries.slice(0, limit);
  };

  const readConfig = (): TcrConfiguration => {
    const cfg = vscode.workspace.getConfiguration('tcrPrompt');
    return {
      promptsRoot: cfg.get<string>('promptsRoot', 'prompts'),
      promptLogFile: cfg.get<string>('promptLogFile', 'prompts.md'),
    testCommand: cfg.get<string>('testCommand', 'npm test'),
    gitRemote: cfg.get<string>('gitRemote', 'origin'),
    gitBranch: cfg.get<string>('gitBranch', 'main'),
    apiKey: cfg.get<string>('apiKey', ''),
    apiBaseUrl: cfg.get<string>('apiBaseUrl', 'https://api.openai.com/v1/chat/completions'),
    model: cfg.get<string>('model', 'gpt-4o-mini'),
    systemPrompt: cfg.get<string>(
      'systemPrompt',
      'You operate in a Test-Commit-Revert workflow. Return only unified diffs for necessary files. Be minimal and keep code passing tests.'
    ),
    temperature: cfg.get<number>('temperature', 0),
    maxTokens: cfg.get<number>('maxTokens', 800)
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
    updateStatusBar(session);
  };

  const loadActiveSession = (): StoredPromptSession | undefined => {
    return context.workspaceState.get<StoredPromptSession>(STATE_KEYS.ACTIVE_SESSION);
  };

  const loadSessions = (): StoredPromptSession[] => {
    return context.workspaceState.get<StoredPromptSession[]>(STATE_KEYS.SESSIONS) ?? [];
  };

  const saveSessions = async (sessions: StoredPromptSession[]) => {
    await context.workspaceState.update(STATE_KEYS.SESSIONS, sessions);
  };

  const persistSession = async (session: StoredPromptSession) => {
    const sessions = loadSessions().filter((s) => s.id !== session.id);
    sessions.unshift(session);
    await saveSessions(sessions);
    await saveActiveSession(session);
  };

  const pickSession = async (): Promise<StoredPromptSession | undefined> => {
    const sessions = loadSessions();
    if (!sessions.length) {
      void vscode.window.showInformationMessage('No stored sessions found.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      sessions.map((s) => ({
        label: `${s.id} (${s.status})`,
        description: s.title,
        detail: `Created: ${s.createdAt}`,
        session: s
      })),
      { title: 'Select TCR Prompt Session' }
    );
    if (!picked) return;
    await saveActiveSession(picked.session);
    return picked.session;
  };

  const getActiveSessionOrPick = async (): Promise<StoredPromptSession | undefined> => {
    const active = loadActiveSession();
    if (active) return active;
    return pickSession();
  };

  const updateStatusBar = (session?: StoredPromptSession) => {
    if (!session) {
      statusBar.text = 'TCR: idle';
      statusBar.tooltip = 'No active prompt';
      statusBar.show();
      return;
    }
    const testPart = session.lastTestResult ? ` • Tests: ${session.lastTestResult}` : '';
    statusBar.text = `TCR: ${session.status}${testPart ? testPart : ''} (${session.id})`;
    const details = [session.title, `Created: ${session.createdAt}`];
    if (session.lastTestResult) {
      details.push(`Tests: ${session.lastTestResult}`);
    }
    statusBar.tooltip = details.join('\n');
    statusBar.show();
  };

  const logInfo = (message: string) => {
    channel.appendLine(message);
  };

  const logError = (message: string) => {
    channel.appendLine(`ERROR: ${message}`);
  };

  const appendToThoughtLog = async (absolutePath: string, lines: string[]) => {
    await fs.appendFile(absolutePath, `${lines.join('\n')}\n`, { encoding: 'utf8' });
  };

  const updatePromptStatusInLog = async (
    promptLogPath: string,
    id: string,
    status: PromptStatus,
    commitSha: string | undefined
  ) => {
    const content = await fs.readFile(promptLogPath, 'utf8');
    const sections = content.split('\n---\n');
    const updated = sections.map((section) => {
      if (!section.includes(`ID: ${id}`)) return section;
      const lines = section.split('\n');
      return lines
        .map((line) => {
          if (line.startsWith('Status:')) return `Status: ${status}`;
          if (line.startsWith('Commit:') && commitSha) return `Commit: ${commitSha}`;
          return line;
        })
        .join('\n');
    });
    await fs.writeFile(promptLogPath, updated.join('\n---\n'), 'utf8');
  };

  const runCommand = async (cmd: string, args: string[], cwd: string) => {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, { cwd, encoding: 'utf8' });
      return { stdout, stderr };
    } catch (err: any) {
      const output = (err.stdout ?? '') + (err.stderr ?? '') || err.message || 'Command failed';
      throw new Error(`${cmd} ${args.join(' ')} failed: ${output}`);
    }
  };

  const runTests = async (workspaceUri: vscode.Uri, config: TcrConfiguration) => {
    const command = config.testCommand;
    const isWin = process.platform === 'win32';
    const file = isWin ? 'cmd' : 'bash';
    const args = isWin ? ['/c', command] : ['-lc', command];
    try {
      const { stdout, stderr } = await execFileAsync(file, args, {
        cwd: workspaceUri.fsPath,
        encoding: 'utf8'
      });
      const output = stdout || stderr || 'Tests passed.';
      logInfo(`Tests passed:\n${output}`);
      return { ok: true, output };
    } catch (err: any) {
      const output = (err.stdout ?? '') + (err.stderr ?? '') || (err.message ?? 'Tests failed.');
      logError(`Tests failed:\n${output}`);
      return { ok: false, output };
    }
  };

  const getChangedFilesSinceBaseline = async (workspaceUri: vscode.Uri, baselineSha?: string) => {
    if (!baselineSha) return [];
    try {
      const { stdout } = await runCommand('git', ['diff', '--name-only', baselineSha], workspaceUri.fsPath);
      return stdout.split('\n').filter(Boolean);
    } catch (err) {
      channel.appendLine(`Could not list changes: ${(err as Error).message}`);
      return [];
    }
  };

  const commitAndPush = async (
    workspaceUri: vscode.Uri,
    message: string,
    config: TcrConfiguration
  ): Promise<string | undefined> => {
    try {
      await runCommand('git', ['commit', '-m', message], workspaceUri.fsPath);
      const { stdout } = await runCommand('git', ['rev-parse', 'HEAD'], workspaceUri.fsPath);
      const commitSha = stdout.trim();
      await runCommand('git', ['push', config.gitRemote, config.gitBranch], workspaceUri.fsPath);
      return commitSha;
    } catch (err) {
      const msg = (err as Error).message;
      void vscode.window.showErrorMessage(`Git commit/push failed: ${msg}`);
      logError(msg);
      return undefined;
    }
  };

  const stageFiles = async (workspaceUri: vscode.Uri, files: string[]) => {
    if (!files.length) return;
    await runCommand('git', ['add', ...files], workspaceUri.fsPath);
  };

  const revertCodeChanges = async (
    workspaceUri: vscode.Uri,
    baselineSha: string,
    filesToRevert: string[]
  ) => {
    if (!filesToRevert.length) return;
    await runCommand('git', ['checkout', baselineSha, '--', ...filesToRevert], workspaceUri.fsPath);
  };

  const applyCodexDiff = async (
    diffText: string,
    workspaceUri: vscode.Uri,
    session: StoredPromptSession,
    config: TcrConfiguration
  ) => {
    const trimmed = diffText.trim();
    if (!trimmed.includes('diff ') && !trimmed.includes('+++') && !trimmed.includes('@@')) {
      channel.appendLine('Codex response does not look like a unified diff; skipping apply.');
      void vscode.window.showWarningMessage('Codex response does not look like a diff. Skipping apply.');
      return;
    }

    let patchPath: string | undefined;
    try {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tcr-codex-'));
      patchPath = path.join(tmpDir, 'codex.patch');
      await fs.writeFile(patchPath, trimmed, 'utf8');

      await runCommand('git', ['apply', '--3way', '--whitespace=nowarn', patchPath], workspaceUri.fsPath);

      const thoughtLogAbsolute = path.join(workspaceUri.fsPath, session.thoughtLogRelativePath);
      await appendToThoughtLog(thoughtLogAbsolute, [
        `- ${new Date().toISOString()}: Applied Codex diff via git apply.`,
        ''
      ]);
      void vscode.window.showInformationMessage('Applied Codex diff.');
    } catch (err) {
      const msg = (err as Error).message;
      logError(`Failed to apply diff: ${msg}`);
      void vscode.window.showErrorMessage(`Failed to apply Codex diff: ${msg}`);
    } finally {
      if (patchPath) {
        void fs.rm(patchPath, { force: true });
      }
    }
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
    const session: StoredPromptSession = {
      id,
      title,
      createdAt,
      status: 'PENDING',
      thoughtLogRelativePath: thoughtLogRelative,
      baselineSha,
      promptBody
    };
    await persistSession(session);

    channel.appendLine(`Created prompt ${id} (baseline: ${baselineSha ?? 'unknown'}).`);
    void vscode.window.showInformationMessage(`TCR Prompt: created ${id}.`);

    const doc = await vscode.workspace.openTextDocument(thoughtLogAbsolute);
    await vscode.window.showTextDocument(doc);
  });

  register(COMMANDS.CONTINUE, async () => {
    const session = await getActiveSessionOrPick();
    if (!session) {
      return;
    }
    const workspaceUri = ensureWorkspace();
    if (!workspaceUri) return;

    // Placeholder: In the future call Codex, apply diff, and append results.
    const config = readConfig();
    const apiKey = config.apiKey.trim();
    if (!apiKey) {
      void vscode.window.showWarningMessage('Codex API key not set. Configure tcrPrompt.apiKey to enable Codex.');
    }

    const tree = await snapshotFileTree(workspaceUri, 300);
    const promptForModel = [
      'You are writing a unified diff against the workspace root. Requirements:',
      '- Respond ONLY with a unified diff, no code fences, no extra prose.',
      '- Paths must be relative to workspace root.',
      '- Include full file contents in the diff hunks (no placeholders).',
      '- Create files as needed; keep changes minimal and buildable.',
      '- Do not delete unrelated files.',
      '',
      'Prompt:',
      `Title: ${session.title}`,
      `Body: ${session.promptBody ?? 'N/A'}`,
      `Baseline commit: ${session.baselineSha ?? 'unknown'}`,
      '',
      'Workspace file tree (truncated):',
      tree.map((t) => `- ${t}`).join('\n'),
      '',
      'Return only unified diffs. No fences. Keep output under token limits.'
    ].join('\n');

    let codexResponse: string | undefined;
    if (apiKey) {
      try {
        const payload = {
          model: config.model,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          messages: [
            { role: 'system', content: config.systemPrompt },
            { role: 'user', content: promptForModel }
          ]
        };
        const res = await fetch(config.apiBaseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Codex call failed (${res.status}): ${text}`);
        }
        const data = (await res.json()) as any;
        codexResponse = data?.choices?.[0]?.message?.content?.trim();
      } catch (err) {
        const msg = (err as Error).message;
        logError(`Codex error: ${msg}`);
        void vscode.window.showErrorMessage(`Codex error: ${msg}`);
      }
    }

    const userNote = await vscode.window.showInputBox({
      title: 'Append note to thought log',
      prompt: 'Add a note or Codex response summary (optional)',
      value: codexResponse ?? ''
    });

    const thoughtLogAbsolute = path.join(workspaceUri.fsPath, session.thoughtLogRelativePath);
    const lines = [`- ${new Date().toISOString()}: Continued session.`];
    if (userNote) {
      lines.push('', userNote);
    }
    if (codexResponse && codexResponse !== userNote) {
      lines.push('', '```\n' + codexResponse + '\n```');
    }
    try {
      await appendToThoughtLog(thoughtLogAbsolute, [...lines, '']);
      const doc = await vscode.workspace.openTextDocument(thoughtLogAbsolute);
      await vscode.window.showTextDocument(doc);
      if (codexResponse) {
        await applyCodexDiff(codexResponse, workspaceUri, session, config);
      } else {
        void vscode.window.showWarningMessage('No Codex diff returned; nothing applied.');
      }
    } catch (err) {
      const msg = (err as Error).message;
      logError(msg);
      void vscode.window.showErrorMessage(`Could not update thought log: ${msg}`);
    }
  });

  register(COMMANDS.REVIEW, async () => {
    if (!ensureWorkspace()) return;
    channel.appendLine('Review changes.');
    void vscode.commands.executeCommand('workbench.scm.focus');
  });

  register(COMMANDS.APPROVE, async () => {
    const workspaceUri = ensureWorkspace();
    if (!workspaceUri) return;
    const session = await getActiveSessionOrPick();
    if (!session) {
      return;
    }
    const config = readConfig();

    const testResult = await runTests(workspaceUri, config);
    const thoughtLogAbsolute = path.join(workspaceUri.fsPath, session.thoughtLogRelativePath);
    await appendToThoughtLog(thoughtLogAbsolute, [
      '## Test run (approve)',
      '```',
      testResult.output,
      '```',
      ''
    ]);

    session.lastTestResult = testResult.ok ? 'PASS' : 'FAIL';
    session.lastTestOutput = testResult.output;
    await persistSession(session);

    if (!testResult.ok) {
      void vscode.window.showWarningMessage('Tests failed; approve blocked. See thought log for details.');
      return;
    }

    const changedFiles = await getChangedFilesSinceBaseline(workspaceUri, session.baselineSha);
    const filesToStage = [
      config.promptLogFile,
      session.thoughtLogRelativePath.replace(/\//g, path.sep),
      ...changedFiles
    ];
    try {
      await stageFiles(workspaceUri, filesToStage);
    } catch (err) {
      void vscode.window.showErrorMessage(`Staging failed: ${(err as Error).message}`);
      return;
    }

    const commitSha = await commitAndPush(
      workspaceUri,
      `TCR: [APPROVE] ${session.title} (${session.id})`,
      config
    );
    if (!commitSha) return;

    const promptLogPath = path.join(workspaceUri.fsPath, config.promptLogFile);
    await updatePromptStatusInLog(promptLogPath, session.id, 'APPROVED', commitSha);
    session.status = 'APPROVED';
    session.lastCommit = commitSha;
    await saveActiveSession(session);

    await appendToThoughtLog(thoughtLogAbsolute, [
      `- ${new Date().toISOString()}: Approved and committed ${commitSha}.`,
      ''
    ]);

    void vscode.window.showInformationMessage(`Approved and pushed ${commitSha}`);
  });

  register(COMMANDS.DENY, async () => {
    const workspaceUri = ensureWorkspace();
    if (!workspaceUri) return;
    const session = await getActiveSessionOrPick();
    if (!session) {
      return;
    }
    const config = readConfig();

    if (!session.baselineSha) {
      void vscode.window.showWarningMessage('No baseline recorded; cannot revert code safely.');
      return;
    }

    const changedFiles = await getChangedFilesSinceBaseline(workspaceUri, session.baselineSha);
    const protectedFiles = new Set<string>([
      config.promptLogFile.replace(/\//g, path.sep),
      session.thoughtLogRelativePath.replace(/\//g, path.sep)
    ]);
    const codeFiles = changedFiles.filter((f) => !protectedFiles.has(f));

    try {
      await revertCodeChanges(workspaceUri, session.baselineSha, codeFiles);
    } catch (err) {
      void vscode.window.showErrorMessage(`Revert failed: ${(err as Error).message}`);
      return;
    }

    try {
      await stageFiles(workspaceUri, Array.from(protectedFiles));
    } catch (err) {
      void vscode.window.showErrorMessage(`Staging failed: ${(err as Error).message}`);
      return;
    }

    const commitSha = await commitAndPush(
      workspaceUri,
      `TCR: [DENY] ${session.title} (${session.id})`,
      config
    );
    if (!commitSha) return;

    const promptLogPath = path.join(workspaceUri.fsPath, config.promptLogFile);
    await updatePromptStatusInLog(promptLogPath, session.id, 'DENIED', commitSha);
    session.status = 'DENIED';
    session.lastCommit = commitSha;
    await persistSession(session);

    const thoughtLogAbsolute = path.join(workspaceUri.fsPath, session.thoughtLogRelativePath);
    await appendToThoughtLog(thoughtLogAbsolute, [
      `- ${new Date().toISOString()}: Denied and reverted code. Committed ${commitSha} (logs only).`,
      ''
    ]);

    void vscode.window.showInformationMessage(`Denied and pushed ${commitSha}`);
  });

  register(COMMANDS.STATUS, async () => {
    const session = loadActiveSession();
    if (!session) {
      void vscode.window.showInformationMessage('TCR Prompt: no active session.');
      updateStatusBar(undefined);
      return;
    }
    const info = `ID ${session.id} | ${session.status} | Created ${session.createdAt} | Log ${session.thoughtLogRelativePath}`;
    logInfo(info);
    void vscode.window.showInformationMessage(info);
    updateStatusBar(session);
  });

  register(COMMANDS.SELECT, async () => {
    const session = await pickSession();
    if (!session) return;
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

  updateStatusBar(loadActiveSession());
}

export function deactivate(): void {
  // nothing to clean up yet
}
