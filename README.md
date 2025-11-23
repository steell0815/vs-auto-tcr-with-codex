# vs-auto-tcr-with-codex
Visual Studio Code extension for a Codex-assisted TCR workflow (Test → Commit → Revert with approve/deny).

## Current state
- Skeleton extension with command stubs and configuration surface.
- Prompts/log contract documented in `docs/prompts-contract.md`.
- Prompts folder placeholder at `prompts/.gitkeep`.

## Commands (stubs)
- `TCR Prompt: New Prompt Session` (`tcrPrompt.new`)
- `TCR Prompt: Continue Active Session` (`tcrPrompt.continue`)
- `TCR Prompt: Review Workspace Changes` (`tcrPrompt.reviewChanges`)
- `TCR Prompt: Approve (Test → Commit → Push)` (`tcrPrompt.approve`)
- `TCR Prompt: Deny (Revert Code, Keep Logs)` (`tcrPrompt.deny`)
- `TCR Prompt: Show Status` (`tcrPrompt.status`)

## Configuration
See `package.json` for defaults:
- `tcrPrompt.promptsRoot` (default `prompts`)
- `tcrPrompt.promptLogFile` (default `prompts.md`)
- `tcrPrompt.testCommand` (default `npm test`)
- `tcrPrompt.gitRemote` / `tcrPrompt.gitBranch` (default `origin` / `main`)

## Build / run
```bash
npm install
npm run watch   # or: npm run compile
```
Launch the extension via VS Code’s Extension Development Host.
