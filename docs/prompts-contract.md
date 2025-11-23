# Prompts Folder Contract

This extension expects a simple, repo-local contract:

- `prompts.md` – append-only log of prompts and decisions (config: `tcrPrompt.promptLogFile`).
- `prompts/` – folder containing one thought-log markdown file per prompt (config: `tcrPrompt.promptsRoot`).

## prompts.md

Minimal schema (append a section per prompt):

```
## 2025-11-23T10:15:30Z – <title>
ID: p-0001
Status: PENDING | APPROVED | DENIED
ThoughtLog: prompts/p-0001-log.md
Commit: <commit sha or pending>

Prompt:
> Original user request...
```

The extension will update `Status` and `Commit` when approve/deny completes.

## Thought logs (`prompts/<id>-log.md`)

Each file holds the running conversation and decisions for a single prompt:

```
# Thought Log – p-0001

## Prompt
<full prompt text>

## Codex Conversation
[timestamp] user/codex messages, diffs, notes...

## Notes
Key risks, follow-ups, test outcomes.
```

The extension appends messages and test results here as it runs Codex + TCR flows.
