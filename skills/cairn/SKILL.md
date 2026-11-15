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
# Pre-approve only the read-only setup checks and Cairn's own adapters, so the
# user is not prompted for each one. Add a line for each new provider.
allowed-tools:
  - Bash(git --version)
  - Bash(node --version)
  - Bash(git rev-parse --is-inside-work-tree)
  - Bash(git remote)
  - Bash(node "${CLAUDE_SKILL_DIR}/structure.js":*)
  - Bash(node "${CLAUDE_SKILL_DIR}/providers/github.js":*)
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

## Providers

Cairn's workflow is the same for every SDLC tool. Each provider is an
adapter in `providers/` that implements one contract
([providers/contract.md](providers/contract.md)) with that tool's own CLI or
API. Find the provider from the repository's remote URL, then read its
reference file:

| Remote host  | Reference                                  |
|--------------|--------------------------------------------|
| `github.com` | [providers/github.md](providers/github.md) |

If the host is not listed, tell the user which providers Cairn supports.

Run an adapter command like this:

```
node "${CLAUDE_SKILL_DIR}/providers/<provider>.js" <command> [args]
```

Always use that full, quoted path, even inside the Cairn repository, so the
pre-approved permission matches. Each command prints one JSON object. If `ok` is false, show the user its
`message` and `fix`. Use adapter commands for everything they cover. Do not
improvise the provider's own commands for the same thing.

**Check access before every change.** Before Cairn creates, labels, links,
comments, pushes, or opens a change for review, run
`access --for <action>` with the matching contract action. If it fails, stop
before the change and tell the user the message and the fix. Never work
around a failed check.

## Setup check

Run this when the user asks whether Cairn is set up or ready, and before the
first change Cairn makes in a session. Run each check, then report every
result. Do not stop at the first gap.

1. **git installed:** `git --version` succeeds.
   Fix: install Git from https://git-scm.com/downloads.
2. **Node.js installed:** `node --version` succeeds. The provider adapters
   run on Node.
   Fix: install Node.js 18 or later from https://nodejs.org.
3. **Inside a git clone:** `git rev-parse --is-inside-work-tree` prints `true`.
   Fix: `cd` into a clone of the repository, or clone it first.
4. **Has a remote:** `git remote` lists at least one remote (prefer `origin`).
   Fix: add the repository's URL with `git remote add origin <url>`.
5. **Provider supported:** the remote host appears in the provider table.
   Fix: none for now. Say which providers are supported.
6. **Provider ready:** run the adapter's `check` command. Report each of
   its parts:
   - `auth`: the provider CLI is installed and logged in, and as whom;
   - `target`: which project the work goes to;
   - `access`: the user's permission, and any contract actions it does not
     allow.

If check 4 or 5 fails, you cannot pick a provider. Run `auth` for every
provider in the table instead, so the user still learns whether its CLI is
installed and logged in. If Node.js is missing, skip check 6 and say it
needs Node.js.

Report as a short checklist: one line per check, marked ready (✓) or missing
(✗). Give a one-line fix under each ✗. If the permission does not allow every
action, mark access with ⚠ and say in plain words what the user cannot do.
End with a single sentence on whether Cairn is ready. When everything passes,
suggest a next step such as "plan this idea: …" or "work on #42".

Example:

```
✓ git 2.43.0
✓ Node.js 22.11.0
✓ Inside a git clone
✓ Remote: origin (octo/repo)
✓ Provider CLI logged in as octo
⚠ READ access to octo/repo: you can comment and create items, but not
  label, link, push, or open changes for review
  Fix: ask a repository admin for WRITE access.

Cairn can plan and comment here, but cannot implement changes yet.
```

## Workflows

Each delivery workflow gets its own section here as it ships. If the user
asks for a step that has no section yet, follow the design rules above and
tell them Cairn does not support that step yet.

Drafts never go into the repository. Pass a draft to a script on stdin with
`--file -` (or `-` for `structure.js`), using a quoted heredoc:

```
node "${CLAUDE_SKILL_DIR}/structure.js" epic - <<'CAIRN_DRAFT'
# <title>
...
CAIRN_DRAFT
```

### Plan an idea

Use this when the user describes an idea, a product vision, a transcript, or
a document, and wants it planned ("plan this idea: …", "turn this into an
epic").

1. **Look for an existing epic.** Run `list-items --kind epic`. If an open
   epic already covers the same idea, say so, and reuse its exact title, so
   saving updates that epic instead of creating a second one.
2. **Draft the epic.** Keep it simple, clear, and human-readable, in prose.
   It explains the why and the overarching what. It may cover more than one
   persona or outcome. Use these sections, in this order:
   - `# <title>`: a short name for the outcome.
   - `## Why`: why this matters.
   - `## Who it is for`: the personas who benefit.
   - `## In scope`, then `## Out of scope`.
   - `## What success looks like`.
   - `## Acceptance Criteria`: always last. List the feature-level
     capabilities that must exist for the epic to be complete, one per
     line, as `- [ ] A <persona> can <do or perceive something>`.

   A persona is someone or something that experiences the capability: a
   customer, a player, a reviewer, an enemy AI. A developer is not a
   persona. Never name a system, component, or foundation as a criterion.
   Use only what the user said, plus reasonable inferences. If you can't
   tell who the work is for, or what success means, ask one short question
   before drafting.
3. **Check the structure.** Pipe the draft to `structure.js epic -`. Fix
   every problem it lists, then check again until it returns `ok`.
4. **Save it.** Pipe the same draft to the provider's
   `save-item --kind epic --file -`. This checks access, creates the epic
   (or updates the open one with the same title), and makes sure the kind
   exists in the provider.
5. **Reply briefly.** Give the link, whether the epic was created or
   updated, and its acceptance criteria in one line each. Suggest breaking
   it into features as the next step.

### Break an epic into features

Use this when the user asks to break down, decompose, or plan the features
of an epic ("break down epic #1"). Features are a capabilities backlog: each
one is a single observable capability, written from the point of view of
whoever experiences it.

1. **Read the epic.** Run `get-item --id <epic>`. Take its body and comments
   into account (comments often carry clarifications). Note its existing
   children. A capability already covered by an open child keeps that
   child's exact title, so saving updates it instead of duplicating it.
2. **Plan the features.**
   - **One capability per feature.** The title reads
     `A <persona> can <do or perceive one specific thing>`, including the
     input or trigger when it is part of the capability ("A player can move
     the camera with WASD"). If a title needs an "and" or an "or", or names
     a system instead of an action, split it.
   - **A persona is someone or something that directly experiences the
     capability:** a customer, a player, an enemy AI, or a surface they
     perceive. A developer is not a persona. Never create a
     "A developer can …" feature.
   - **Describe behavior, not architecture.** Say what the persona can do
     or perceive, and how they would see it working. Classes, files, and
     components belong in tasks.
   - **Reframe system concerns as something a persona experiences.**
     Instead of a "HUD system", write "A player can see their food count on
     the HUD".
   - **No substrate features.** Work no persona directly experiences
     (setup, plumbing, base components) is not a feature. Order the
     features, then put that work as the earliest tasks of the first
     feature that needs it.
3. **Draft each feature**: `# <title>`; a short prose paragraph restating
   the capability in plain language; `## Expected behavior`, describing
   what the persona sees when it works; and `## Acceptance Criteria`,
   listing the tasks needed to deliver it, with any substrate tasks first.
   Pipe each draft to `structure.js feature -`, and fix every problem.
4. **Save each feature.** Pipe it to
   `save-item --kind feature --parent <epic> --file -`. This creates and
   links a new feature, or updates the existing one with that title.
5. **Update the epic.** Replace the items in the epic's Acceptance Criteria
   with one reference per feature, written the way the provider reference
   says to reference an item. Keep the rest of the epic exactly as it is,
   including its title. Check it with `structure.js epic -`. If the epic
   was already missing sections before your change, don't rewrite it: save
   only the criteria change, and mention the gap. Save it with
   `save-item --kind epic`.
6. **Reply briefly.** List the features as references, marking each as new
   or already existing, and note any substrate assigned to an early
   feature. Suggest breaking a feature into tasks as the next step.

### Break a feature into tasks

Use this when the user asks to break down, decompose, or plan the tasks of a
feature ("break down feature #2"). Tasks are the "how" behind the
capability: concrete engineering steps a person or an agent can pick up.

1. **Read the feature.** Run `get-item --id <feature>`. Take its body,
   comments, and existing children into account. A step already covered by
   an open child keeps that child's exact title, so saving updates it.
2. **Decide whether to split it.**
   - If the feature is small enough to implement directly in one focused
     change, say so and stop. Do not create placeholder or fake tasks.
   - If you find a new user-facing capability, do not hide it in a task.
     Propose it as a separate feature (a title in the form
     `A <persona> can …`), and let the user decide.
3. **Plan the tasks.** Each task is one concrete engineering step that
   helps deliver the capability. This is where components, files, and
   substrate belong, including foundation work this feature is the first to
   need. Order them so that prerequisites come before the steps that depend
   on them. Keep them simple and useful: reuse what already exists, prefer
   native platform features, and take the shortest change that works.
4. **Draft each task**: `# <action>` (start with a verb: "Add …",
   "Move …"); a short prose paragraph on what the step does and why;
   `## Implementation guidance`, with enough to start; `## Validation`, on
   how to check the work; and `## Done when`, with checklist items. Pipe
   each draft to `structure.js task -`, and fix every problem.
5. **Save each task** in order, piping it to
   `save-item --kind task --parent <feature> --file -`.
6. **Set the order.** Run `order-children --parent <feature> --ids <ids>`
   with the task ids in the planned order. It moves only what is out of
   place.
7. **Update the feature.** Replace the items in its Acceptance Criteria with
   one reference per task, in order, written the way the provider reference
   says to reference an item. Keep the rest of the feature as it is,
   including its title. Check it with `structure.js feature -`, and save it
   with `save-item --kind feature`, adding `--parent <parent>` when
   `get-item` reported one.
8. **Reply briefly.** List the tasks in order as references, marking each as
   new or already existing. Mention any feature you proposed, and suggest
   working on the first task as the next step.

