# GitHub provider

Cairn uses GitHub Issues, sub-issues, comments, pull requests, and releases as
the record of work. The adapter, `github.js`, runs `gh` (including `gh api`)
and `git` with the login the user already has. It never asks for, reads, or
stores a token.

## Detecting GitHub

A remote whose URL host is `github.com` is a GitHub repository. Both forms
count:

- `git@github.com:OWNER/REPO.git`
- `https://github.com/OWNER/REPO.git`

## Kinds and references

- **Kinds:** each kind uses the repository's issue type of the same name
  (`Feature`, `Task`, `Bug`, and `Epic` where an organization defines one).
  Every item also gets the kind label (`feature`, `task`) as a backup. Where
  no type exists, as with `epic` in most repositories, the label alone
  marks the kind.
- **References:** refer to an item as `#<id>` (for example `- [ ] #12`).
  GitHub expands these into the item's title and status.
- **Children** are native sub-issues.
- **Summary lines:** a feature-completed summary names its items line
  **Issues:** and its changes line **PRs:**, for example
  `**Issues:** #6, #40, #41` and `**PRs:** #44`.

## Commands

Run each one as `node "${CLAUDE_SKILL_DIR}/providers/github.js" <command>`.

| Command | What it runs | Notes |
|---|---|---|
| `target` | `git remote get-url` | Uses `origin`, or the first remote |
| `auth` | `gh auth status --json hosts` | Reports only the login |
| `access [--for <action>]` | `gh repo view --json viewerPermission,hasIssuesEnabled` | See the role table |
| `check` | all three | For the setup check |
| `find-item --query <text>` | `gh api` one issue, or the open issue listing | A `github.com/OWNER/REPO/issues/N` link must be this repository |
| `get-item --id <n>` | `gh api` issue, comments, sub-issues, parent; GraphQL closing PRs | |
| `comment --on <n> --file - [--key <k>]` | `gh api` issue comments | Adds the hidden Cairn marker |
| `list-items --kind <kind>` | `gh api` issues by type or label | |
| `order-children --parent <n> --ids <n,n>` | `gh api` sub-issue reprioritize | Moves only what is out of place |
| `save-item --kind <kind> --file - [--parent <n>]` | `gh api` create or update, and sub-issue link | |
| `start-change --for <n> [--partial <name>]` | `gh issue develop`, `git fetch`, `git checkout` | The linked branch gets GitHub's own name. A partial branch is `<n>-<name>` |
| `push-change` | `git ls-remote`, `git push -u origin HEAD` | No force flag, ever |
| `save-change --for <n> --file - [--partial [--closes <n,n>]]` | `gh pr list`, `gh pr create` or `gh pr edit`, `gh pr view` | Ends the description with `Closes #n` lines, or `Part of #n.` |
| `get-change --id <n>` | `gh pr view --json`, GraphQL review threads and pending review, `gh api` compare with `main` | `decision`, `mergeable`, and `mergeState` are GitHub's values in lowercase, such as `changes_requested` and `behind` |

How contract actions map to GitHub repository roles:

| Action | Lowest role | Also needs |
|---|---|---|
| `comment` | READ | |
| `create-item` | READ | Issues turned on |
| `label`, `link-child` | TRIAGE | Issues turned on |
| `push`, `propose-change` | WRITE | |

## Changes

- A change is a pull request into `main`.
- **A linked branch closes its issue.** A branch made with
  `gh issue develop` shows under Development on the issue, and GitHub then
  treats the pull request from it as closing that issue. Only the pull
  request's own page can remove that link. That is why `start-change`
  takes `--partial` for a change that delivers part of an issue.
- **A closing word in the description closes an issue too.** GitHub reads
  "closes", "fixes", or "resolves" (and "closed", "fixed", "resolved")
  before `#n` anywhere in the description, even in the middle of a
  sentence. Never write one before an issue that must stay open. Say
  "the parent feature" or "Part of #n" instead. `save-change` fails with
  `CLOSES_MISMATCH` when this happens.
- GitHub works out the closing links a moment after the description is
  saved, so `save-change` reads them up to three times.
- **Review threads are GraphQL only.** Resolved and outdated state, and a
  pending review, are not in the REST API. A pending review is visible
  only to its author, so `review.pending` is always the user's own.
  `get-change` reads the first 100 threads, and the first 100 comments in
  each.

Branch protection and required reviews can still block a push or merge,
even with the role. Report those errors as GitHub returns them, and never
bypass them.

## Install and login

- No `gh`: install it from https://cli.github.com (`brew install gh`,
  `winget install --id GitHub.cli`, or your Linux package manager).
- Not logged in: the user runs `gh auth login`. Inside Claude Code they type
  `! gh auth login`, so it runs in the session.

Do not install `gh` or log in for the user. Tell them what to run, and stop.
