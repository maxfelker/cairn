---
name: cairn
description: >
  Delegate software delivery while keeping the shared record in the team's SDLC
  tool (GitHub Issues, pull requests, and releases) instead of local files. Use
  when the user wants to plan an idea, turn it into an epic, break work into
  features or tasks, design or record an epic's architecture ("how should we
  build epic #1?"), work on, pick up, or continue an item by number, link, or
  description ("work on #42", "pick up the next task", "work on the camera
  feature"), address issue or review feedback, check whether a pull request is
  ready or merge one ("is #31 ready?", "merge PR #31"), prepare or cut a
  release ("prepare a release", "package this as the next release"), and
  when they ask whether Cairn is set up or ready ("is Cairn set up?", "check
  Cairn").
license: GPL-3.0-only
# Pre-approve only the read-only setup checks and Cairn's own adapters, so the
# user is not prompted for each one. Add a line for each new provider.
allowed-tools:
  - Bash(git --version)
  - Bash(node --version)
  - Bash(git rev-parse --is-inside-work-tree)
  - Bash(git remote)
  - Bash(node "${CLAUDE_SKILL_DIR}/structure.js":*)
  - Bash(node "${CLAUDE_SKILL_DIR}/next.js":*)
  - Bash(node "${CLAUDE_SKILL_DIR}/architecture.js":*)
  - Bash(node "${CLAUDE_SKILL_DIR}/release.js":*)
  - Bash(node "${CLAUDE_SKILL_DIR}/providers/github.js":*)
  - Bash(git status:*)
  - Bash(git log:*)
  - Bash(git diff:*)
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

When a failure stops work on an item and the user cannot fix it in this
session, also post a `**Blocked:**` comment on the item (see Comments), so
whoever picks it up next knows what is stopped and what will start it again. Skip this when the failure is that Cairn
cannot reach or comment on the provider at all.

**Check access before every change.** Before Cairn creates, labels, links,
comments, pushes, or opens a change for review, run
`access --for <action>` with the matching contract action. If it fails, stop
before the change and tell the user the message and the fix. Never work
around a failed check.

## Comments

Comments are how people who were not in the session follow the work. Write
each one for a person who reads only that comment, and possibly only its
first line.

Every comment is one of three kinds. The first line names the kind and gives
the bottom line. The rest is a few plain sentences.

| Kind | Post it when | The first line says | Then say |
|---|---|---|---|
| `**Decision:**` | You make a choice the item does not already settle | What was decided | Why, and what it changes |
| `**Question:**` | You need an answer to continue, and asked the user | The question, so that it can be answered as it stands | What the answer changes, when that helps |
| `**Blocked:**` | You stop on something you cannot resolve, such as a failed command or missing access | What is stopped, and what will start it again | What failed, and what is safe or lost |

**How to write one:**

- **Bottom line first.** The first line is the conclusion. A reader who
  stops there knows the result, and knows whether they must do something.
- **Lead with the effect.** Say what the event means for the work or the
  reader before you say how it happened. "The branch cannot be pushed until
  the login has WRITE access" comes before the error text.
- **Use simple, exact sentences.** One idea in each sentence, and no more
  than 25 words. Use the active voice and the present or simple past tense.
  Give the name, the number, or the command instead of "it" or "some".
  Use one word for one thing all through the comment.
- **Write prose, not a form.** Only the kind on the first line is a label.
  Give reasons with "because" or in the next sentence. Do not add `**Why:**`
  or `**Needed:**` lines.
- **Use plain words.** No idioms, no jargon the item does not already use,
  and no words that only make sense inside the session.
- **Keep it small.** One point per comment, and a few sentences. Refer to
  items and changes in the provider's short form.

For example:

```markdown
**Decision:** A feature gets one change, and each task is a commit on its branch.

The feature asks for one focused change that a reviewer can read from start to finish. One merge then closes the feature and all of its tasks.
```

```markdown
**Blocked:** The branch cannot be pushed until the login has WRITE access to the repository.

The push was refused because the login has READ access. A repository admin can grant WRITE access. The two commits are saved locally, so nothing is lost.
```

Not this, which hides the result and reads like a form:

```markdown
**Blocked:** Push failed.

**Needed:** Access.
```

- **Where:** planning, decisions, questions, and blockers go on the work
  item. Implementation review goes on the change. A decision about a
  whole epic goes on the epic.
- **Check, then post:** pipe the draft to `structure.js comment -`, fix
  every problem, then post it with `comment --on <id> --file -`. The
  adapter adds Cairn's marker. The check finds a missing kind, a labeled
  line, and a long sentence. The rest of this section is yours to follow.
- **Do not post progress.** There is no progress comment. Commits, the
  change, and closed items show the work as it happens. Cairn reports
  progress once for each feature, in the feature-completed summary.

Summaries with their own shape, such as the feature-completed summary and
the architecture, are not checked as comments. Write them in the same
plain style.

**Replies to feedback** are not one of the three kinds either. They go in
the reviewer's thread, or on the change or item where the feedback was
left, and are not checked as comments. Start with the bottom line: what
changed and where, or the question you need answered. Then say how you
validated it, and give the commit. Refer to an attached image by its place
on the provider, never by a local copy.

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
   customer, a player, a reviewer, an enemy AI. Each criterion is something
   that persona gains, never technology for its own sake. Never name a
   system, component, or foundation as a criterion. The people building the
   product are a persona only when the product is for them, as with a
   developer tool, and then `## Who it is for` must say so.
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
     perceive. Take personas from the epic's `## Who it is for`. Developers
     are a persona only when the epic is for developers. Most products are
     not, but a developer tool is.
   - **The capability is the goal, never the technology.** Reject a feature
     whose point is building or adopting a component, library, or
     integration, whoever its persona is: "A developer can add a trade API"
     is a task, while "A developer can publish a mod" is a capability.
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
   Pipe each draft to `structure.js feature - --for "<who it is for>"`,
   quoting the epic's `## Who it is for` text, and fix every problem.
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
   feature. Suggest recording the epic's architecture as the next step.

### Record an epic's architecture

Use this when the user asks how an epic should be built ("design the
architecture for epic #1", "how should we build epic #1?"), and for the
`architect` step. Look at every feature of the epic together, and at the
code, so shared work, interfaces, and order are decided once, before any
feature is broken into tasks. The result is one comment on the epic that
anyone can read and that later steps build on.

1. **Read the epic and its features.** Run `get-item --id <epic>`, then
   `get-item` on each open feature. Take bodies and comments into account.
   Closed features are already built: read them only for context.
2. **Check the current state.** Pipe the epic's `get-item` result to
   `architecture.js status -`. It says whether an architecture is
   `missing`, `stale` (and which features it misses or that were renamed),
   or `current`, and gives the `covers` line for the current features. When
   updating, start from the existing comment it returns.
3. **Read the code.** Look at the parts of the repository the features
   touch: what exists to reuse, where new code belongs, and what several
   features would otherwise build twice.
4. **Draft the architecture.** Start with one plain sentence that sums up
   the approach. Then these sections, short and in plain language:
   - `## Shared foundation`: work more than one feature needs, and which
     feature builds it first.
   - `## Decisions`: each key design choice, with why.
   - `## Interfaces`: how the features' parts talk to each other.
   - `## Build order`: the open features in the order to build them, each
     with what it depends on.
   - `## Trade-offs`: what was considered and given up.
   - `## Open questions`: anything unclear, or "None". When features
     conflict, ask the user instead of choosing silently.

   Refer to items in the provider's short form. Paste the `covers` line
   from step 2, unchanged, as the last line. Pipe the draft to
   `architecture.js check -`, and fix every problem.
5. **Post it.** Pipe the draft to
   `comment --on <epic> --key architecture --file -`. The key makes a
   re-run update the same comment instead of adding a second.
6. **Reply briefly** with the link, the build order in one line, and any
   open questions. Suggest breaking the first feature in the build order
   into tasks as the next step.

### Break a feature into tasks

Use this when the user asks to break down, decompose, or plan the tasks of a
feature ("break down feature #2"). Tasks are the "how" behind the
capability: concrete engineering steps a person or an agent can pick up.

1. **Read the feature.** Run `get-item --id <feature>`. Take its body,
   comments, and existing children into account. A step already covered by
   an open child keeps that child's exact title, so saving updates it.
2. **Start from the architecture.** If the feature has a parent epic, run
   `get-item --id <epic>` and pipe it to `architecture.js status -`.
   - `missing` or `stale`: say so with its `reason`, offer **Record an
     epic's architecture**, and stop. Do not create tasks.
   - `current`: read the architecture comment it returns. Plan the tasks
     from it: build the shared foundation it assigns to this feature, and
     do not repeat foundation an earlier feature in the build order owns.
     Depend on that work instead.

   A feature with no parent epic has no architecture. Plan it on its own.
3. **Decide whether to split it.**
   - If the feature is small enough to implement directly in one focused
     change, say so and stop. Do not create placeholder or fake tasks.
   - If you find a new user-facing capability, do not hide it in a task.
     Propose it as a separate feature (a title in the form
     `A <persona> can …`), and let the user decide.
4. **Plan the tasks.** Each task is one concrete engineering step that
   helps deliver the capability. This is where components, files, and
   substrate belong, including foundation work this feature is the first to
   need. Order them so that prerequisites come before the steps that depend
   on them. Keep them simple and useful: reuse what already exists, prefer
   native platform features, and take the shortest change that works.
5. **Draft each task**: `# <action>` (start with a verb: "Add …",
   "Move …"); a short prose paragraph on what the step does and why;
   `## Implementation guidance`, with enough to start; `## Validation`, on
   how to check the work; and `## Done when`, with checklist items. Pipe
   each draft to `structure.js task -`, and fix every problem.
6. **Save each task** in order, piping it to
   `save-item --kind task --parent <feature> --file -`.
7. **Set the order.** Run `order-children --parent <feature> --ids <ids>`
   with the task ids in the planned order. It moves only what is out of
   place.
8. **Update the feature.** Replace the items in its Acceptance Criteria with
   one reference per task, in order, written the way the provider reference
   says to reference an item. Keep the rest of the feature as it is,
   including its title. Check it with
   `structure.js feature - --for "<who it is for>"`, quoting the parent
   epic's `## Who it is for` (read it with `get-item`), and save it with
   `save-item --kind feature`, adding `--parent <parent>` when `get-item`
   reported one.
9. **Reply briefly.** List the tasks in order as references, marking each as
   new or already existing. Mention any feature you proposed, and suggest
   working on the first task as the next step.

### Address feedback

Use this for the `address-feedback` step, and when the user asks ("address
the feedback on #31", "answer the review"). The reviewer's comments are
answered where they were left, and every decision stays next to the
discussion that prompted it.

1. **Find the change.** The user may name the change or the item.
   - Run `get-change --id <id>`. If it fails with `TARGET_UNAVAILABLE`, the
     id is an item: run `get-item --id <id>`, and use the open change in
     its `changes`. With no open change, say there is nothing in review,
     and stop.
   - Run `get-item` on each id in the change's `closes`, for the
     requirements and for comments left on the items.
2. **Collect what is unanswered.** These are the same rules `next.js`
   uses, so a later run agrees:
   - a review thread that is not resolved, whose newest comment is not
     Cairn's (`cairn` is false);
   - a comment or review summary on the change, newer (`at`) than Cairn's
     last comment on the change;
   - a comment on an item, newer than both the change's `opened` and
     Cairn's last comment on that item.

   Skip everything else. It is answered already.
3. **Look at the images.** For each image in that feedback, run
   `get-image --url <url> --out <folder>` with a temporary folder outside
   the repository, such as the session scratchpad, and look at the file.
   Image URLs expire a few minutes after they are read, so download right
   after step 1. If one has expired, read again. Never copy an image into
   the repository.
4. **Mention a pending review.** If `review.pending` is true, the developer
   has a review they have not submitted. Tell them, because nobody else
   can see it until they do.
5. **Sort each piece of feedback.**
   - **Code:** a change to the work on the branch.
   - **Requirement:** a change to what the item asks for.
   - **Unclear:** you cannot tell what is wanted, or two pieces of
     feedback disagree. Do not guess.
   - **No action:** thanks, agreement, or a note that needs nothing. It
     still gets a reply in step 7, even a one-line one. A reply is how
     the record shows it was read, and without one every later run finds
     it unanswered again.
6. **Act on it.**
   - **Code:** work on the change's `branch` from `get-change`. When the
     clone is already on it, stay there. Otherwise run
     `start-change --for <unit>`. If the branch it reports is not the
     change's branch, stop and tell the user, because the commits would
     land outside the change. Make the change, run the project's checks, and commit. One
     commit per piece of feedback, or per group that touches the same
     thing. End the message with `For <reference>.` for the task it
     touches, or the unit when no task fits. Run `push-change`. Never open
     a second change for feedback.
   - **Requirement:** update the item's body with `save-item`, keeping its
     title, and check it with `structure.js` first. When the change is
     large, or alters a feature's tasks, ask the user before saving.
   - **Unclear:** ask one clarifying question as the reply.
7. **Reply where the feedback was left,** to every piece from step 2,
   including those that need no action. Write each reply as **Comments**
   says for replies.
   - A review thread: `reply --on <thread> --file -`.
   - Comments and review summaries on the change: one
     `comment --on <change> --file -` that answers each of them by name.
   - A comment on an item: `comment --on <item> --file -`.

   Never resolve a thread or dismiss a review. That stays with the
   reviewer.
8. **Update the description.** When the feedback changed what the change
   does or how to test it, draft the description again and save it with
   `save-change`, as **Implement through a change** says.
9. **Reply briefly** to the user: each piece of feedback, what you did,
   and a link to your reply. Name any question still waiting for an
   answer, and a pending review of theirs.

### Check readiness and merge

Use this when the user asks whether a change is ready ("is #31 ready to
merge?", "can we ship the camera feature?"), or asks to merge one. Cairn
gives one clear verdict, posts it on the change so everyone reads the same
answer, and merges only after the developer says yes.

1. **Find the change** as **Address feedback** step 1 says, and read each
   item it closes with `get-item`. For a feature, read its tasks too: their
   **Done when** items are the feature's criteria.
2. **Check each criterion.** For each checklist item in the **Done when**
   or **Acceptance criteria** of every closing item, decide whether the
   change meets it. Read the diff (`git diff origin/main...<branch>`) and
   the commits. Give evidence for each: a commit, a test, a file, or a
   check. Say "not met" when you cannot find evidence. Do not assume.
3. **Check the rest.** From `get-change`:
   - **Checks:** `checks.state`. `failed` or `pending` is not ready. Name
     each failed or pending run. With no checks, say so.
   - **Review:** `review.decision`. `changes_requested` or
     `review_required` is not ready. If `review.pending` is true, the
     developer has an unsubmitted review: say so.
   - **Feedback:** run `next.js` with `--change`, as **Work on an item**
     says. `address-feedback` is not ready.
   - **Branch:** `mergeable` `conflicting` is not ready. When `behind` is
     more than 0, say how many commits behind `main` the branch is. It
     blocks only when `mergeState` is `behind` or `blocked`.
4. **Give the verdict.** The change is ready when every criterion is met
   and nothing in step 3 blocks it. Otherwise list exactly what remains,
   one line each, with what would fix it.
5. **Post it on the change.** Pipe the summary to
   `comment --on <change> --key readiness --file -`. The key makes a
   re-run update the same comment instead of adding another. Use this
   shape:

   ```
   **Ready to merge.** <or> **Not ready to merge:** <how many> things remain.

   <One or two plain sentences on the verdict.>

   | Criterion | Met | Evidence |
   |---|---|---|
   | <criterion, with its item reference> | Yes / No | <commit, test, file, or check> |

   **Checks:** <state, and any failed or pending run>
   **Review:** <decision, and who approved or asked for changes>
   **Branch:** <up to date or how far behind; conflicts or none>

   **Remains:**
   - <one line per thing left, and what would fix it>
   ```

   Leave out **Remains** when the change is ready.
6. **Offer to merge, only when ready.** Ask one plain question, such as
   "#31 is ready. Merge it into main?", and wait. A yes means an explicit
   yes to merging this change, in this session. When the user's own
   request was to merge this change, that request is the yes. Approval for
   another change, or from an earlier session, does not count. When the
   change is not ready, never offer to merge, even if asked: say what
   remains.
7. **Merge on a yes.** Run `merge-change --id <change> --approved`.
   - `PROTECTED`: report GitHub's rule as it is, and what would satisfy
     it. Never work around it.
   - Any other failure: report it, and leave the change open.
8. **Finish.** After the merge, run **Finish a feature** for each feature
   the change closed, and reply with the link to the merged change.

### Finish a feature

Run this right after the last change for a feature merges, and whenever the
user asks ("close out feature #2", "is feature #2 done?"). The parent epic
then reads as a running record of shipped capabilities.

1. **Read the feature.** Run `get-item --id <feature>`, then `get-item` on
   each child, and collect the merged changes from all of them.
2. **Check that it is complete.** The feature is complete when it is closed,
   or when every child is closed and at least one change has merged. If it
   is not complete, list what is still open, and stop without commenting.
3. **Post the summary on the parent.** Pipe it to
   `comment --on <parent> --key feature-complete-<feature id> --file -`. The
   key makes a re-run update the same comment instead of adding a second.
   Keep it simple and small, in exactly this shape:

   ```
   **Feature completed: <feature title>** <feature reference>

   <One or two plain-language sentences on the capability it added.>

   **<Items line>:** <feature reference>, <child references, in order>
   **<Changes line>:** <merged change references>
   ```

   Write every reference in the provider's short form (see its reference
   file), never as a Markdown URL link: the provider expands short
   references into titled, status-aware links. The provider reference
   also names the two summary lines.
4. **Reply** with the link to the comment.

### Prepare a release

Use this when the user asks to release what has merged ("prepare a
release", "package this as the next release", "cut v0.2.0"). Cairn gathers
the work since the last release, proposes a version with its reason and the
notes, and publishes only after the developer says yes.

1. **Gather the work.** Run `list-changes`. Add `--merged-since <tag>` only
   when the user names the release to start from.
2. **Stop when `main` is not ready.** Say what is wrong and how to fix it,
   and draft nothing, when:
   - `tags.match` is false: the latest version tag here and on the provider
     differ. Name both. The developer decides which is right. Do not fetch,
     push, or delete tags yourself.
   - `main.match` is false: the clone's `main` differs from the
     provider's. Suggest `git pull` on `main`.
   - `main.checks.state` is `failed` or `pending`: name each run that is
     not passing. With `none`, go on, but say `main` has no checks.
   - `changes` is empty: there is nothing to release since `since.tag`.
3. **Propose the version.** Give each change one kind, from the change and
   the items it closes:
   - `breaking`: people who use the product must change what they do, such
     as a renamed or removed command, or a changed result.
   - `feature`: it closes a feature, or adds something people can do.
   - `fix`: anything else, such as a bug fix, docs, or tests.

   Pipe `{"since": <since.tag or null>, "changes": [{"id", "title",
   "kind"}]}` to `release.js next-version -`. Use the `tag` it returns, and
   give its `reason`. Say which changes you counted as breaking, and why.
4. **Draft the notes** in the plain style of **Comments**, for someone who
   uses the product and did not follow the work:

   ```markdown
   <One or two sentences: what people can do with this release.>

   ## What's new
   - <a capability, in plain words> (<feature>, <change>)

   ## Fixes
   - <what works now that did not> (<item>, <change>)

   ## Technical changes
   - <what changed underneath, when it matters to someone> (<change>)
   ```

   Group the work by feature. Group tasks under their feature, and leave
   them out of the notes on their own. Leave out a section with nothing
   in it. Write every reference in the provider's short form.
5. **Show it and wait.** Show the version, its reason, the notes, and the
   `main` commit it will tag, with its checks. If the repository records
   its version in a file, such as `package.json` or a plugin manifest, and
   that file does not say the new version, say so: the release will not
   change it. Then wait for an explicit yes. A yes to an earlier version
   or other notes does not count.
6. **Publish on a yes.** Pipe the notes to
   `publish-release --tag <tag> --target <main.remote> --file - --approved`.
   - `TAG_EXISTS`, `MAIN_MISMATCH`, or `CHECKS_FAILING`: report it as it
     is, with its fix. Never pick another tag or target to get around it.
     Run `list-changes` again before proposing anything new.
7. **Link the release.** Comment on each feature in `items`, and on each
   epic that is the `parent` of one of them, with
   `comment --on <id> --key release-<tag> --file -`. Keep it to one line
   and one sentence:

   ```
   **Released in <tag>:** <release url>

   <What this item gained in the release, in one sentence.>
   ```

8. **Reply** with the link to the release, and the items you commented on.

### Work on an item

Use this when the user names something to work on, in any words ("work on
#42", "pick up the next task on the camera feature", "continue the release
feature"). Work from the provider's current state alone, never from memory
of an earlier session or from local planning files. A brand-new session
must reach the same step.

1. **Find the item.** Pass the reference, link, or description to
   `find-item --query <text>`. Leave out the surrounding words ("work on",
   "pick up the next task on") and keep what names the item.
   - `exact` is true: use the single match.
   - Several matches: ask one short question listing them as references
     with their titles, and wait. Do not guess.
   - No matches: say so, and ask which item they mean.
2. **Read it.** Run `get-item --id <id>`.
3. **Choose the step.** Pipe the same `get-item` result to `next.js -`:

   ```
   node "${CLAUDE_SKILL_DIR}/providers/<provider>.js" get-item --id <id> | node "${CLAUDE_SKILL_DIR}/next.js" -
   ```

   When the item's `changes` include an open change, read it first with
   `get-change --id <change>`, save the result to a temporary file outside
   the repository, and add `--change <that file>` to the `next.js` call.
   Then `next.js` can see unanswered feedback.

   Follow the step it gives. Do not pick a different one. Tell the user the
   step and its `reason` in one line.
4. **Act on the step.**
   - `architect`: say the epic has no current architecture, with the
     `reason`, and offer **Record an epic's architecture**. It posts on the
     epic, so wait for a yes unless the user already asked for it.
   - `break-down`: say it has no features (or tasks) yet, and offer to
     break it down. Breaking down creates items, so wait for a yes unless
     the user already asked for a breakdown. Then run **Break an epic into
     features** or **Break a feature into tasks**. For a feature small
     enough to build in one change, that workflow says so.
   - `work-on-child`: say which child is next, then repeat from step 2 on
     that child. When the user asked for "the next task", this is how you
     reach it.
   - `address-feedback`: the open change has feedback that Cairn has not
     answered. Run **Address feedback**. It commits and replies where
     others read, so list the feedback first and wait for a yes, unless
     the user already asked you to work on the item or address the
     feedback.
   - `finish-feature`: run **Finish a feature**.
   - `release`: say every feature is closed, and offer **Prepare a
     release**. It publishes, so it always waits for the developer's yes.
   - `done`: say it is closed, and offer the next open sibling if the
     parent has one.
   - `implement` or `continue-change`: get the parent with `get-item` too.
     Read the item's body, its comments, and the parent's body. Comments
     often carry later decisions. For `continue-change`, also look at the
     open change it names. Then reply with a short summary **before
     writing any code**:
     - what the item asks for, in a sentence;
     - your approach, as a few steps, naming the files or areas you expect
       to touch;
     - open questions, or anything the item leaves unclear.

     Stop there and ask whether to proceed, unless the user already
     asked you to build it. On a yes, run **Implement through a change**.

### Implement through a change

Run this for the `implement` and `continue-change` steps of **Work on an
item**, once the user says to proceed. It takes the work from the item to a
change that is ready for review. A new session that runs it again continues
the same branch and the same change.

These rules have no exceptions:

- Never commit on `main`, and never push `main`.
- Never force-push, and never rewrite commits that are pushed.
- Never stash, discard, overwrite, or commit changes you did not make.
- Never run git or the provider's own commands for something a change
  command covers: `start-change`, `push-change`, and `save-change`.
- Never merge here. Merging happens only in **Check readiness and merge**,
  after the developer approves.

1. **Pick the unit.** The unit is the item the change is for.
   - A task under a feature: the unit is the feature. A feature gets one
     change, and each task is one or more commits on its branch.
   - A task or bug with no parent: the unit is that item.
   - When the user asked for only part of the unit, such as one task of a
     feature, the change is **partial**. Choose a short name for it in
     lowercase words joined by hyphens.
2. **Start or resume.** Run `start-change --for <unit>`. For a partial
   change, add `--partial <name>`, so that the unit stays open when the
   change merges. Tell the user the branch.
   - `DIRTY_TREE`: stop. Show the user their uncommitted changes, and ask
     what they want to do with them. Do not offer to stash or move them
     yourself. Continue only after the user has dealt with them.
3. **Find where the work stands.** Read the commits on the branch that
   are not on `main` (`git log --oneline origin/main..HEAD`), and the
   unit's Decision and Blocked comments. A task whose work is already on
   the branch is done. When you cannot tell from the commit messages, read
   the diff. Do not build a task twice.
4. **Build the tasks in order.** Take the unit's open children in the
   order `get-item` lists them. Build them one after another, without
   stopping to report or to ask whether to go on. The tasks were thought
   through when the feature was broken down, and the developer sees the
   finished feature through its change. Stop early only when you are
   blocked, or need a decision or approval that is the developer's. For
   each one:
   - Read it with `get-item`, and build what it asks for. Follow its
     implementation guidance and its validation.
   - Run the project's own checks, and fix what fails.
   - Make each task one commit: the task is the commit boundary, so a
     reviewer can read the change task by task. Split a task into more
     commits only when one commit would mix unrelated steps. Stage files
     by name, and only files this work changed. Never stage everything.
   - Write a commit message a person can read. The first line says what
     changed, in plain words. After a blank line, say why, when the reason
     is not obvious. End with the task on its own line, as
     `For <reference>.` Do not put a closing word such as "closes" or
     "fixes" before a reference in a commit message.
   - Run `push-change` when the task is done, so the work is on the
     provider before the next task starts. If the push is rejected, stop
     and tell the user the message and the fix.
5. **Record decisions, not steps.** Post a `**Decision:**` comment on the
   unit for a choice the items do not settle. Do not post a comment for
   each task. The pushed commits show the work.
6. **Open the change.** When every task is built and the checks pass,
   draft the description. A reviewer, a product manager, and another agent
   must each understand the change from it, without the session and
   without reading the code first. Write it in the plain style of
   **Comments**.

   ```markdown
   # <title: what the change does, as a short statement>

   <The bottom line: one to three sentences on what a person who uses the
   product can do now, or what is different for them.>

   ## What changed
   ## Highlights
   ## How to test
   ## How it was validated
   ## Trade-offs and follow-up
   ```

   - **The opening** is for the reader who stops there. Say the effect on
     the user first. Do not start with file names or internal parts.
   - **What changed** explains the change in paragraphs, in terms a user
     understands: what was true before, what is true now, and why. Name
     code only where it helps the reviewer.
   - **Highlights** is optional. It is a short list of the details worth
     knowing, one line each. It sums up the explanation. It does not
     replace it.
   - **How to test** gives test cases a person or an agent can follow:
     what to do, and what to expect.
     - A command-line change: the exact commands in a code block, each
       with the output or result to expect.
     - A change people see: a screenshot of the result, with the steps to
       reach it. When you cannot attach a screenshot, say so, describe
       what the reader will see, and ask the user to add one.
     - An API or library change: a short call and its result.
   - **How it was validated** says what you ran and what happened,
     including anything that failed or was not run.
   - **Trade-offs and follow-up** says what the change leaves out, and
     why.

   Describe the change as it is. Do not copy the plan from the items. Do
   not write the closing lines: the command adds them. Do not put a closing
   word before a reference to an item that stays open.

   Pipe the draft to `structure.js change -` and fix every problem.

   Run `save-change --for <unit> --file -`. For a partial change, add
   `--partial --closes <ids>`, with the ids of the tasks this change
   finishes. The command opens the change, or updates the one that is
   already open, and checks what the change will close.
   - `CLOSES_MISMATCH`: the change is open, but it would close the wrong
     items. Follow the `fix`. When the fix needs the provider's own page,
     tell the user what to do there, and do not call the change ready.
7. **Reply briefly** with the link to the change, what was validated, and
   anything left open. The user reviews it. When they ask whether it is
   ready, or to merge it, run **Check readiness and merge**.

For `continue-change`, the change is already open. Do steps 2 to 5, then
run `save-change` again when the description no longer matches the work.

When a failure stops the work and the user cannot fix it in this session,
post a `**Blocked:**` comment on the unit, as **Comments** says.
