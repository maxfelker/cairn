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

## Commands

Run each one as `node "${CLAUDE_SKILL_DIR}/providers/github.js" <command>`.

| Command | What it runs | Notes |
|---|---|---|
| `target` | `git remote get-url` | Uses `origin`, or the first remote |
| `auth` | `gh auth status --json hosts` | Reports only the login |
| `access [--for <action>]` | `gh repo view --json viewerPermission,hasIssuesEnabled` | See the role table |
| `check` | all three | For the setup check |

How contract actions map to GitHub repository roles:

| Action | Lowest role | Also needs |
|---|---|---|
| `comment` | READ | |
| `create-item` | READ | Issues turned on |
| `label`, `link-child` | TRIAGE | Issues turned on |
| `push`, `propose-change` | WRITE | |

Branch protection and required reviews can still block a push or merge,
even with the role. Report those errors as GitHub returns them, and never
bypass them.

## Install and login

- No `gh`: install it from https://cli.github.com (`brew install gh`,
  `winget install --id GitHub.cli`, or your Linux package manager).
- Not logged in: the user runs `gh auth login`. Inside Claude Code they type
  `! gh auth login`, so it runs in the session.

Do not install `gh` or log in for the user. Tell them what to run, and stop.
