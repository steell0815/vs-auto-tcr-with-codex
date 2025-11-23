# next
```
I want to use Codex but in a TCR context. I would like to create a visual studio code plugin finally, that allows me to maintain a configurable prompts.md file that keeps track of the users prompts. Also, for each prompt, the thought process should be stored in files to each prompt - one file per process log. Finally each change should be tested as automatically as possible, but really before a commit, the user should approve or deny the change. If a change is approved, all the changes (prompt, prompt-thought-log, decision - approve/deny, and all code files) should be packed in a git commit and pushed to main branch. If denied, prompt, prompt-thouht-log, decision should be pushed, but the source code changes should be rolled back.

Can you derive a plan to accomplish this later with Codex?
```

## chats response
Here’s a concrete, staged plan to get from idea → working VS Code extension → integrated with Codex/TCR-style workflow.

I’ll break it into 6 parts:

Overall architecture
Data model & file layout
VS Code extension features
TCR-style workflow (Test–Commit–Revert) with Codex in the loop
Git integration flow (approve/deny)
Milestone roadmap
1. Overall architecture
You’re basically building a small “Prompt TCR” system:

Frontend: VS Code extension

Commands, UI, status bar, quick picks.
Manages prompts.md, per-prompt log files, and approval flow.
Backend:

Codex/OpenAI API calls (via Node/TypeScript in extension).
Local Git CLI calls (or a git library).
Local test runner (npm test, pytest, mvn test, etc.).
Repository contract:

A prompts/ directory and a prompts.md file whose format you control.
Tests are defined by the project (you just run them).
Everything happens locally in the repo; the extension orchestrates.

2. Data model & file layout
2.1 prompts.md
A single, append-only-ish log of all user prompts and decisions.

Example format (you can enforce a simple markdown schema):

# Prompt Log

## 2025-11-23T10:15:30Z – Add caching to user API
ID: p-0001
Status: APPROVED
Files: src/userApi.ts, tests/userApi.test.ts
ThoughtLog: prompts/p-0001-log.md
Commit: 3f4a9b2

Prompt:
> Add an in-memory cache layer for getUserById in src/userApi.ts
> and make sure existing tests still pass. If necessary, add more tests.
For a denied change:

## 2025-11-23T11:02:04Z – Refactor payment pipeline
ID: p-0002
Status: DENIED
Files: (no code changes kept)
ThoughtLog: prompts/p-0002-log.md
Commit: 9c1e0d7   <!-- only logs and prompts, no code diff -->
The extension is responsible for:

Generating a unique prompt ID.
Writing the section for that ID.
Updating the Status and Commit once the approval flow completes.
2.2 Per-prompt thought process files
One file per prompt, e.g.:

prompts/p-0001-log.md
prompts/p-0002-log.md
Content could be:

# Thought Log – p-0001

## Prompt
Add an in-memory cache layer for getUserById in src/userApi.ts...

## Codex Conversation

[2025-11-23T10:15:35Z]
- User: "Add a cache layer..."
- Codex: "We could wrap getUserById with..."

[2025-11-23T10:16:00Z]
- Codex diff suggestion:
```diff
@@ ...
+ const cache = new Map<string, User>();
Notes
Cache invalidation handled via ...
Risk: memory usage for large user sets.

The extension will:

- Append each interaction with Codex to this file.
- Log key decisions, diffs, test outcomes.

---

## 3. VS Code extension features

Use the usual VS Code extension stack:

- `extension.ts` – registers commands.
- `package.json` – contribution points for commands, menus, keybindings.

### 3.1 Core commands

You’ll want something like:

1. **`tcrPrompt.new`** – Start a new “Codex prompt session”
   - Ask user for:
     - Prompt title (short).
     - Prompt body (multi-line input box or open a temp editor).
   - Create:
     - A new prompt ID.
     - Entry stub in `prompts.md` with Status: `PENDING`.
     - A new thought log file `prompts/{id}-log.md`.
   - Then call Codex for first response.

2. **`tcrPrompt.continue`** – Continue Codex interaction for the active prompt
   - Append to same thought log.
   - Potentially show a diff or code suggestion preview.

3. **`tcrPrompt.reviewChanges`**
   - Show current git diff (or a list of changed files).
   - Possibly use VS Code’s built-in diff view API.

4. **`tcrPrompt.approve`**
   - Trigger test → commit → push main (if all green).
   - Update `prompts.md` (Status → APPROVED, add Commit hash).

5. **`tcrPrompt.deny`**
   - Trigger test (optional or skip) → revert code changes → commit log only.
   - Update `prompts.md` (Status → DENIED, add Commit hash).

6. **`tcrPrompt.status`**
   - Show the last prompt’s status, test result, etc. in a small UI.

### 3.2 UI elements

- **Status bar item** like: `TCR: PENDING (last: p-0001)`  
- **Quick pick menu** to choose an existing prompt if multiple are in flight.
- Output channel for:
  - Codex API logs.
  - Test results.
  - Git commands and errors.

---

## 4. TCR-style workflow with Codex in the loop

You want something like:

> Prompt → Codex proposes changes → Apply changes → Run tests → User decides approve/deny → Git commit → Push/reset

### 4.1 How Codex is used

Within the extension:

- On `tcrPrompt.new`, send the prompt to Codex with a **code-aware system message** like:

  > “You are operating in a TCR context. You must produce minimal, testable edits in unified diff format against the current repo. Only modify files necessary to satisfy the prompt.”

- Then:
  1. Get Codex response (diff).
  2. Parse unified diff.
  3. Apply diff to workspace (with a safety check: only within current repo).
  4. Save the modified files.

- Log **Codex response** into the prompt log.

### 4.2 Automatic test execution

Right after applying a Codex diff:

- Optionally auto-run tests immediately (or when user presses "Run tests").
- Use a configuration section in `package.json` like:

```json
"contributes": {
  "configuration": {
    "properties": {
      "tcrPrompt.testCommand": {
        "type": "string",
        "default": "npm test",
        "description": "Command to run tests before commit"
      }
    }
  }
}
Execute via Node child_process:

On success: mark “Tests: PASS” in log.
On failure: mark “Tests: FAIL” in log + display results.
This must happen before you allow an “approve” commit as part of TCR.

5. Git integration flow (approve/deny)
Assuming you use the Git CLI from Node.

5.1 Tracking the baseline
At prompt start:

Record the current HEAD commit hash:

e.g. git rev-parse HEAD

Store in:

An in-memory map of promptId → baselineSha.
And in the prompt log.
At approve/deny time, you know what to diff against.

5.2 Approve flow
On tcrPrompt.approve:

Ensure tests are green

If last run was failing or not run yet, either re-run tests automatically or warn user.
Stage everything that should be committed:

git add prompts.md prompts/{id}-log.md

git add all changed source files (or just run git add -A if you’re okay with that, but safer to be explicit).

You can compute changed files via:

git diff --name-only baselineSha, filter out files you don’t want.
Commit:

Commit message template, e.g.:

git commit -m "TCR: [APPROVE] {short-title} ({promptId})"
Push to main:

git push origin main (configurable remote/branch preferred).
Update prompt entry in prompts.md:

Status → APPROVED
Commit hash set to new HEAD.
Write these changes to disk and ensure they’re included in the commit.

5.3 Deny flow
On tcrPrompt.deny:

Compute the code changes since baseline:

git diff --name-only baselineSha HEAD

Exclude:

prompts.md
prompts/{id}-log.md
Revert code files:

Simplest: git checkout baselineSha -- <code-files>
Or: git restore --staged --worktree <code-files> while keeping logs.
Ensure logs stay:

prompts.md & prompts/{id}-log.md should not be reverted.
Stage only logs:

git add prompts.md prompts/{id}-log.md
Commit:

git commit -m "TCR: [DENY] {short-title} ({promptId})"
Push:

git push origin main.
Update prompts.md:

Status → DENIED
Commit hash set to commit ID that contains only logs.
6. Milestone roadmap
To “accomplish this later with Codex”, here’s a realistic progression.

Milestone 1 – Barebones prompt & logging (no Codex yet)
 Initialize VS Code extension skeleton (yo code).

 Add config for prompts.md file path and prompts/ folder.

 Implement tcrPrompt.new:

Create prompt ID, log entry in prompts.md, and prompts/{id}-log.md.
 Implement simple UI: show last prompt in status bar.

 No Codex, no git. Just file management.

Milestone 2 – Codex integration & diff application
 Add Codex/OpenAI API client.
 Define prompt format for Codex (system + user).
 Implement tcrPrompt.new to send initial prompt to Codex.
 Parse unified diffs from Codex and apply to workspace.
 Append Codex responses to thought log.
Milestone 3 – Test runner integration
 Configurable test command.
 Implement tcrPrompt.runTests (or run automatically after applying diff).
 Capture exit code, stdout/stderr, and log them.
 Reflect test status in status bar and thought log.
Milestone 4 – Git + TCR approve/deny
 Record baseline commit on prompt start.

 Implement tcrPrompt.approve:

Tests required to pass.
Stage logs + code changes.
Commit & push.
Update prompts.md.
 Implement tcrPrompt.deny:

Revert code files to baseline.
Keep & stage logs only.
Commit & push.
Update prompts.md.
Milestone 5 – Polishing & safety
 Handle detached HEAD, uncommitted changes before prompt start.

 Allow configuration of:

Git remote/branch.
Whether push is automatic or manual.
 Add richer UI:

Quick pick to browse past prompts.
Command to open log for last prompt.
 Add extension tests (using vscode-test).

If you like, in the next step I can:

Draft a concrete folder structure and package.json contributions.
Or sketch the exact TypeScript interfaces for your “Prompt Session” object (PromptSession { id, title, baselineSha, status, testResult, filesChanged, ... }).

Got it—plan captured. Milestones are clear:

M1: VS Code extension skeleton, prompts.md + per-prompt logs, basic UI.
M2: Codex integration + diff apply; log Codex responses.
M3: Configurable test runner, record results.
M4: Git TCR flow—baseline tracking, approve (tests→commit/push), deny (revert code, commit logs).
M5: Safety/polish—config for remote/branch, richer UI, extension tests.
If you want, I can now draft the extension skeleton (package.json contributions + command stubs + prompts folder contract) or design the data structures/interfaces for the prompt sessions.
````

# next
```
draft the extension skeleton (package.json contributions + command stubs + prompts folder contract)
```

## chats response
Built the extension skeleton with command stubs, config surface, and prompts contract.

Added package.json with VS Code contributions (commands + config), scripts, and dev deps; activation events cover all TCR commands.
Implemented src/extension.ts stubbing each command, creating the prompts folder and prompts.md if missing, and wiring an output channel.
Documented the prompts/log contract (docs/prompts-contract.md) and placed a placeholder prompts/.gitkeep; updated README.md with commands, config, and build notes.
Added a basic .vscodeignore for packaging.
Next steps: npm install then npm run watch and launch the Extension Development Host; fill in real logic for Codex diffing, test execution, and git approve/deny flows.

7 files changed
+306
-1

Undo

View all changes
.vscodeignore
+6
-0

README.md
+28
-1

prompts-contract.md
+42
-0

package.json
+102
-0

.gitkeep
+1
-0

extension.ts
+106
-0

tsconfig.json
+21
-0





Auto context


Local

Agent

# next
```
go on please
````

## chat responds

Can you pickup the milestone plan that you can find here? https://chatgpt.com/share/6922c046-a35c-8007-845a-a4e76a532cf3



Can you pickup the milestone plan that you can find here?
https://chatgpt.com/share/6922c046-a35c-8007-845a-a4e76a532cf3


I don’t have access to that shared link yet. I can either:

Download it myself if you approve a quick network fetch, or
You can paste the milestone plan here and I’ll pick it up.
Which do you prefer?

You have my approval, this time, for "Download it myself if you approve a quick network fetch"


I tried fetching the shared plan directly:

curl https://chatgpt.com/share/6922c046-a35c-8007-845a-a4e76a532cf3 just returns the static share shell HTML with no plan content (React app bootstrapping).
Attempts to hit the share JSON endpoint (…/backend-api/share/… on both chatgpt.com and chat.openai.com) are blocked by Cloudflare’s “Just a moment…” challenge, so I can’t extract the actual data programmatically from here.
Could you paste the milestone plan text, or give me another reachable source (e.g., a gist or file in the repo)? Once I have the content I’ll pick up the plan.

This was my prompt:
"I want to use Codex but in a TCR context. I would like to create a visual studio code plugin finally, that allows me to maintain a configurable prompts.md file that keeps track of the users prompts. Also, for each prompt, the thought process should be stored in files to each prompt - one file per process log. Finally each change should be tested as automatically as possible, but really before a commit, the user should approve or deny the change. If a change is approved, all the changes (prompt, prompt-thought-log, decision - approve/deny, and all code files) should be packed in a git commit and pushed to main branch. If denied, prompt, prompt-thouht-log, decision should be pushed, but the source code changes should be rolled back.

Can you derive a plan to accomplish this later with Codex?"

and now follows the chatGpt response:
Here’s a concrete, staged plan to get from idea → working VS Code extension → integrated with Codex/TCR-style workflow.

I’ll break it into 6 parts:

Overall architecture
Data model & file layout
VS Code extension features
TCR-style workflow (Test–Commit–Revert) with Codex in the loop
Git integration flow (approve/deny)
Milestone roadmap
1. Overall architecture
You’re basically building a small “Prompt TCR” system:

Frontend: VS Code extension

Commands, UI, status bar, quick picks.
Manages prompts.md, per-prompt log files, and approval flow.
Backend:

Codex/OpenAI API calls (via Node/TypeScript in extension).
Local Git CLI calls (or a git library).
Local test runner (npm test, pytest, mvn test, etc.).
Repository contract:

A prompts/ directory and a prompts.md file whose format you control.
Tests are defined by the project (you just run them).
Everything happens locally in the repo; the extension orchestrates.

2. Data model & file layout
2.1 prompts.md
A single, append-only-ish log of all user prompts and decisions.

Example format (you can enforce a simple markdown schema):

# Prompt Log

## 2025-11-23T10:15:30Z – Add caching to user API
ID: p-0001
Status: APPROVED
Files: src/userApi.ts, tests/userApi.test.ts
ThoughtLog: prompts/p-0001-log.md
Commit: 3f4a9b2

Prompt:
> Add an in-memory cache layer for getUserById in src/userApi.ts
> and make sure existing tests still pass. If necessary, add more tests.
For a denied change:

## 2025-11-23T11:02:04Z – Refactor payment pipeline
ID: p-0002
Status: DENIED
Files: (no code changes kept)
ThoughtLog: prompts/p-0002-log.md
Commit: 9c1e0d7   <!-- only logs and prompts, no code diff -->
The extension is responsible for:

Generating a unique prompt ID.
Writing the section for that ID.
Updating the Status and Commit once the approval flow completes.
2.2 Per-prompt thought process files
One file per prompt, e.g.:

prompts/p-0001-log.md
prompts/p-0002-log.md
Content could be:

# Thought Log – p-0001

## Prompt
Add an in-memory cache layer for getUserById in src/userApi.ts...

## Codex Conversation

[2025-11-23T10:15:35Z]
- User: "Add a cache layer..."
- Codex: "We could wrap getUserById with..."

[2025-11-23T10:16:00Z]
- Codex diff suggestion:
```diff
@@ ...
+ const cache = new Map<string, User>();
Notes
Cache invalidation handled via ...
Risk: memory usage for large user sets.

The extension will:

- Append each interaction with Codex to this file.
- Log key decisions, diffs, test outcomes.

---

## 3. VS Code extension features

Use the usual VS Code extension stack:

- `extension.ts` – registers commands.
- `package.json` – contribution points for commands, menus, keybindings.

### 3.1 Core commands

You’ll want something like:

1. **`tcrPrompt.new`** – Start a new “Codex prompt session”
   - Ask user for:
     - Prompt title (short).
     - Prompt body (multi-line input box or open a temp editor).
   - Create:
     - A new prompt ID.
     - Entry stub in `prompts.md` with Status: `PENDING`.
     - A new thought log file `prompts/{id}-log.md`.
   - Then call Codex for first response.

2. **`tcrPrompt.continue`** – Continue Codex interaction for the active prompt
   - Append to same thought log.
   - Potentially show a diff or code suggestion preview.

3. **`tcrPrompt.reviewChanges`**
   - Show current git diff (or a list of changed files).
   - Possibly use VS Code’s built-in diff view API.

4. **`tcrPrompt.approve`**
   - Trigger test → commit → push main (if all green).
   - Update `prompts.md` (Status → APPROVED, add Commit hash).

5. **`tcrPrompt.deny`**
   - Trigger test (optional or skip) → revert code changes → commit log only.
   - Update `prompts.md` (Status → DENIED, add Commit hash).

6. **`tcrPrompt.status`**
   - Show the last prompt’s status, test result, etc. in a small UI.

### 3.2 UI elements

- **Status bar item** like: `TCR: PENDING (last: p-0001)`  
- **Quick pick menu** to choose an existing prompt if multiple are in flight.
- Output channel for:
  - Codex API logs.
  - Test results.
  - Git commands and errors.

---

## 4. TCR-style workflow with Codex in the loop

You want something like:

> Prompt → Codex proposes changes → Apply changes → Run tests → User decides approve/deny → Git commit → Push/reset

### 4.1 How Codex is used

Within the extension:

- On `tcrPrompt.new`, send the prompt to Codex with a **code-aware system message** like:

  > “You are operating in a TCR context. You must produce minimal, testable edits in unified diff format against the current repo. Only modify files necessary to satisfy the prompt.”

- Then:
  1. Get Codex response (diff).
  2. Parse unified diff.
  3. Apply diff to workspace (with a safety check: only within current repo).
  4. Save the modified files.

- Log **Codex response** into the prompt log.

### 4.2 Automatic test execution

Right after applying a Codex diff:

- Optionally auto-run tests immediately (or when user presses "Run tests").
- Use a configuration section in `package.json` like:

```json
"contributes": {
  "configuration": {
    "properties": {
      "tcrPrompt.testCommand": {
        "type": "string",
        "default": "npm test",
        "description": "Command to run tests before commit"
      }
    }
  }
}
Execute via Node child_process:

On success: mark “Tests: PASS” in log.
On failure: mark “Tests: FAIL” in log + display results.
This must happen before you allow an “approve” commit as part of TCR.

5. Git integration flow (approve/deny)
Assuming you use the Git CLI from Node.

5.1 Tracking the baseline
At prompt start:

Record the current HEAD commit hash:

e.g. git rev-parse HEAD

Store in:

An in-memory map of promptId → baselineSha.
And in the prompt log.
At approve/deny time, you know what to diff against.

5.2 Approve flow
On tcrPrompt.approve:

Ensure tests are green

If last run was failing or not run yet, either re-run tests automatically or warn user.
Stage everything that should be committed:

git add prompts.md prompts/{id}-log.md

git add all changed source files (or just run git add -A if you’re okay with that, but safer to be explicit).

You can compute changed files via:

git diff --name-only baselineSha, filter out files you don’t want.
Commit:

Commit message template, e.g.:

git commit -m "TCR: [APPROVE] {short-title} ({promptId})"
Push to main:

git push origin main (configurable remote/branch preferred).
Update prompt entry in prompts.md:

Status → APPROVED
Commit hash set to new HEAD.
Write these changes to disk and ensure they’re included in the commit.

5.3 Deny flow
On tcrPrompt.deny:

Compute the code changes since baseline:

git diff --name-only baselineSha HEAD

Exclude:

prompts.md
prompts/{id}-log.md
Revert code files:

Simplest: git checkout baselineSha -- <code-files>
Or: git restore --staged --worktree <code-files> while keeping logs.
Ensure logs stay:

prompts.md & prompts/{id}-log.md should not be reverted.
Stage only logs:

git add prompts.md prompts/{id}-log.md
Commit:

git commit -m "TCR: [DENY] {short-title} ({promptId})"
Push:

git push origin main.
Update prompts.md:

Status → DENIED
Commit hash set to commit ID that contains only logs.
6. Milestone roadmap
To “accomplish this later with Codex”, here’s a realistic progression.

Milestone 1 – Barebones prompt & logging (no Codex yet)
 Initialize VS Code extension skeleton (yo code).

 Add config for prompts.md file path and prompts/ folder.

 Implement tcrPrompt.new:

Create prompt ID, log entry in prompts.md, and prompts/{id}-log.md.
 Implement simple UI: show last prompt in status bar.

 No Codex, no git. Just file management.

Milestone 2 – Codex integration & diff application
 Add Codex/OpenAI API client.
 Define prompt format for Codex (system + user).
 Implement tcrPrompt.new to send initial prompt to Codex.
 Parse unified diffs from Codex and apply to workspace.
 Append Codex responses to thought log.
Milestone 3 – Test runner integration
 Configurable test command.
 Implement tcrPrompt.runTests (or run automatically after applying diff).
 Capture exit code, stdout/stderr, and log them.
 Reflect test status in status bar and thought log.
Milestone 4 – Git + TCR approve/deny
 Record baseline commit on prompt start.

 Implement tcrPrompt.approve:

Tests required to pass.
Stage logs + code changes.
Commit & push.
Update prompts.md.
 Implement tcrPrompt.deny:

Revert code files to baseline.
Keep & stage logs only.
Commit & push.
Update prompts.md.
Milestone 5 – Polishing & safety
 Handle detached HEAD, uncommitted changes before prompt start.

 Allow configuration of:

Git remote/branch.
Whether push is automatic or manual.
 Add richer UI:

Quick pick to browse past prompts.
Command to open log for last prompt.
 Add extension tests (using vscode-test).

If you like, in the next step I can:

Draft a concrete folder structure and package.json contributions.
Or sketch the exact TypeScript interfaces for your “Prompt Session” object (PromptSession { id, title, baselineSha, status, testResult, filesChanged, ... }).

Got it—plan captured. Milestones are clear:

M1: VS Code extension skeleton, prompts.md + per-prompt logs, basic UI.
M2: Codex integration + diff apply; log Codex responses.
M3: Configurable test runner, record results.
M4: Git TCR flow—baseline tracking, approve (tests→commit/push), deny (revert code, commit logs).
M5: Safety/polish—config for remote/branch, richer UI, extension tests.
If you want, I can now draft the extension skeleton (package.json contributions + command stubs + prompts folder contract) or design the data structures/interfaces for the prompt sessions.

draft the extension skeleton (package.json contributions + command stubs + prompts folder contract)


Built the extension skeleton with command stubs, config surface, and prompts contract.

Added package.json with VS Code contributions (commands + config), scripts, and dev deps; activation events cover all TCR commands.
Implemented src/extension.ts stubbing each command, creating the prompts folder and prompts.md if missing, and wiring an output channel.
Documented the prompts/log contract (docs/prompts-contract.md) and placed a placeholder prompts/.gitkeep; updated README.md with commands, config, and build notes.
Added a basic .vscodeignore for packaging.
Next steps: npm install then npm run watch and launch the Extension Development Host; fill in real logic for Codex diffing, test execution, and git approve/deny flows.

7 files changed
+306
-1

Undo

View all changes
.vscodeignore
+6
-0

README.md
+28
-1

prompts-contract.md
+42
-0

package.json
+102
-0

.gitkeep
+1
-0

extension.ts
+106
-0

tsconfig.json
+21
-0

go on please


Extended the extension skeleton to actually create prompt sessions.

src/extension.ts: added prompt ID generator, collected title/body inputs, ensured prompts artifacts, appended PENDING entries to prompts.md, created per-prompt thought logs, recorded git HEAD baseline (if available), and stored active session state. Continue/status now open/show the active log; other commands remain stubs.
README.md: documented new creation flow and clarified commands/config.
docs/prompts-contract.md: noted ID format and clarified manual logging for now.
Next steps: wire Codex calls and diff application into continue, add test runner + git approve/deny flows, and surface status in the UI.

3 files changed
+174
-13

Undo

View all changes
README.md
+10
-3

prompts-contract.md
+2
-2

extension.ts
+162
-8





Auto context


Local

Agent


```

# next
```
Next steps: wire Codex calls and diff application into continue, add test runner + git approve/deny flows, and surface status in the UI.
```

## chat responds

```
Hooked up real TCR flows and status surface.

src/extension.ts: Added status bar, active-session storage, test runner, staging/commit/push helpers, and prompt-log status updates. approve now runs tests, stages logs + code, commits, pushes, and marks APPROVED. deny reverts code back to the baseline SHA, keeps/stages logs, commits, pushes, and marks DENIED. continue can append a note (placeholder for Codex/diff application). Baseline SHA is captured on prompt creation and used for revert.
README.md: Reflected the new flows and status bar; clarified commands.
Notes:

Approve/Deny will run git commands and push to the configured remote/branch.
Tests run via the configured tcrPrompt.testCommand using your shell (bash -lc on non-Windows).
Next options:

Wire Codex/diff application into continue (API config, apply unified diff safely).
Add persistence of multiple sessions + quick-pick selector.
Harden git/test errors and add richer UI (output panel parsing, status decorations).
2 files changed
+251
-14

Undo

View all changes
README.md
+8
-6

extension.ts
+243
-8
```

