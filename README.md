# vs-auto-tcr-with-codex
Visual Studio Code extension for a Codex-assisted TCR workflow (Test → Commit → Revert with approve/deny).

## Current state
- Creates prompt IDs, appends to `prompts.md`, and opens per-prompt thought logs.
- Tracks active session (with baseline git SHA and last test result) and shows status in the status bar.
- Approve/Deny flows now run tests, stage changes, commit, and push (deny reverts code back to baseline, keeps logs).
- Continue can call Codex (via OpenAI Chat Completions) and attempt to apply unified diffs via `git apply --3way`.
- Configuration surface is in place (prompts root, prompt log file, test command, git remote/branch).
- Prompts/log contract documented in `docs/prompts-contract.md`.
- Prompts folder placeholder at `prompts/.gitkeep`.

## Commands
- `TCR Prompt: New Prompt Session` (`tcrPrompt.new`) — collect title + body, generate prompt ID, append to `prompts.md`, create `prompts/<id>-log.md`, capture git HEAD as baseline, and open the thought log.
- `TCR Prompt: Continue Active Session` (`tcrPrompt.continue`) — calls Codex (if `apiKey` set), appends response to thought log, and attempts to apply returned unified diff via `git apply --3way`.
- `TCR Prompt: Review Workspace Changes` (`tcrPrompt.reviewChanges`) — focuses SCM.
- `TCR Prompt: Approve (Test → Commit → Push)` (`tcrPrompt.approve`) — runs configured tests (logs output in thought log + output channel), stages logs + changed files, commits, pushes, updates `prompts.md`.
- `TCR Prompt: Deny (Revert Code, Keep Logs)` (`tcrPrompt.deny`) — reverts code to baseline, stages logs, commits, pushes, updates `prompts.md`.
- `TCR Prompt: Show Status` (`tcrPrompt.status`) — shows active session info and updates status bar.
- `TCR Prompt: Select Session` (`tcrPrompt.selectSession`) — quick-pick across stored sessions and opens its thought log.

## Configuration
See `package.json` for defaults:
- `tcrPrompt.promptsRoot` (default `prompts`)
- `tcrPrompt.promptLogFile` (default `prompts.md`)
- `tcrPrompt.testCommand` (default `npm test`)
- `tcrPrompt.gitRemote` / `tcrPrompt.gitBranch` (default `origin` / `main`)
- `tcrPrompt.apiKey` (OpenAI API key)
- `tcrPrompt.apiBaseUrl` (default chat completions endpoint)
- `tcrPrompt.model`, `tcrPrompt.systemPrompt`, `tcrPrompt.temperature`, `tcrPrompt.maxTokens`

## Build / run
```bash
npm install
npm run watch   # or: npm run compile
```
Launch the extension via VS Code’s Extension Development Host.

## How prompt creation works
1) `tcrPrompt.new` asks for a short title and full prompt text.  
2) Generates an ID like `p-20250123T121314` and timestamps the entry.  
3) Ensures `prompts.md` and the `prompts/` folder exist, appends a `PENDING` entry to `prompts.md`, writes `prompts/<id>-log.md`, and records git `HEAD` (if available) as the baseline.  
4) Opens the thought log so you can start appending Codex conversations manually (until Codex integration lands).
