# GitHub provider

Cairn uses GitHub Issues, sub-issues, comments, pull requests, and releases as
the record of work. Every GitHub operation goes through the GitHub CLI
(`gh`, including `gh api`) and `git`, using the login the user already has.

## Detecting GitHub

A remote whose URL host is `github.com` is a GitHub repository. Both forms
count:

- `git@github.com:OWNER/REPO.git`
- `https://github.com/OWNER/REPO.git`

## Setup check: CLI

- **Check:** `gh --version` succeeds.
- **Fix:** install the GitHub CLI from https://cli.github.com
  (`brew install gh`, `winget install --id GitHub.cli`, or your Linux
  package manager).

Do not try to install `gh` or log in for the user. Tell them what to run.
Inside Claude Code they can type `! <command>` to run it in the session.
