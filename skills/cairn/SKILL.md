---
name: cairn
description: >
  Delegate software delivery while keeping the shared record in the team's SDLC
  tool (GitHub Issues, pull requests, and releases) instead of local files. Use
  when the user wants to plan an idea, turn it into an epic, break work into
  features or tasks, work on or implement an issue ("work on #42"), address
  issue or review feedback, check whether a pull request is ready, or cut a
  release, and when they ask whether Cairn is set up or ready ("is Cairn set
  up?", "check Cairn").
license: GPL-3.0-only
---

# Cairn

Cairn helps the user delegate software work while the plan, decisions,
progress, and release record stay in the team's SDLC tool, where humans and
agents both read them. The user talks in plain language. Cairn works out the
next step and does it.

## Design rules

- **The SDLC tool is the source of truth.** Plans, trade-offs, questions,
  progress, and validation results go into tickets and comments, not local
  Markdown files, terminal-only summaries, or agent-specific folders.
- **Tickets explain why. Pull requests show how.** The ticket holds the
  requirements and the discussion. The pull request stays focused on the
  change and links back to its ticket.
- **Cairn keeps no state outside the SDLC tool.** It writes no config, cache,
  or plan files to the user's machine or repository. That is why uninstalling
  is one command and leaves nothing behind. Another person or agent can pick
  the work up from the tool alone.
- **Use the user's own access.** Use the provider's official CLI, already
  logged in. Never ask for, read, or store tokens.
- **Safe defaults.** Keep unrelated local changes. Respect branch protections,
  required checks, and approvals. Ask before you merge, publish a release, or
  take any action that is hard to undo.

## Provider reference

Find the provider from the repository's remote URL, then read its reference
file in this skill's folder before you run any provider command:

| Remote host  | Reference                  |
|--------------|----------------------------|
| `github.com` | [github.md](github.md)     |

If the host is not listed, tell the user that Cairn supports only the
providers above for now.

## Setup check

Run this when the user asks whether Cairn is set up or ready, and before the
first change Cairn makes in a session. Run each check, then report every
result. Do not stop at the first gap.

1. **git installed:** `git --version` succeeds.
   Fix: install Git from https://git-scm.com/downloads.
2. **Inside a git clone:** `git rev-parse --is-inside-work-tree` prints `true`.
   Fix: `cd` into a clone of the repository, or clone it first.
3. **Has a remote:** `git remote` lists at least one remote (prefer `origin`).
   Fix: add the repository's URL with `git remote add origin <url>`.
4. **Provider supported:** the remote host appears in the provider table.
   Fix: none for now. Say which providers are supported.
5. **Provider CLI installed:** run the CLI check from the provider reference.
   Fix: use the install line from the provider reference.

If check 3 or 4 fails, you cannot pick a provider. Run check 5 for every
provider in the table, so the user still learns what is missing.

Report as a short checklist: one line per check, marked ready (✓) or missing
(✗). Give a one-line fix under each ✗. End with a single sentence on whether
Cairn is ready. When everything passes, suggest a next step such as
"plan this idea: …" or "work on #42".

Example:

```
✓ git 2.43.0
✓ Inside a git clone
✗ No git remote
  Fix: git remote add origin git@github.com:OWNER/REPO.git
✓ GitHub CLI (gh 2.62.0)

Cairn is not ready yet: add a remote, then ask again.
```

## Workflows

Each delivery workflow (planning an epic, breaking it into features and
tasks, implementing an issue, handling feedback, releasing) gets its own
section here as it ships. Until a workflow has a section, follow the design
rules above and tell the user that Cairn does not support that step yet.
