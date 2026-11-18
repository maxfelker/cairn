# Cairn

**Give your agents a high-quality inner loop for the SDLC.**

When an agent works today, its plans, decisions, and progress usually stay in a terminal session or a local Markdown file. Only the person at that keyboard can see them. Cairn moves that context into your team's SDLC tool. Ideas become epics, features, and tasks. Feedback goes into issue and pull request threads. Releases are built from the work record. Every person and every agent reads the same source of truth, and anyone can pick up the work where someone else left off.

Cairn follows the workflow in [Share agentic context in your SDLC tools instead of committing markdown files](https://maxfelker.com/article/sharing-agentic-context-in-your-sdlc-tools).

Cairn currently runs in Claude Code and supports GitHub. You need `git`, Node.js 18 or later, and the [GitHub CLI](https://cli.github.com).

## Get started

1. **Log in to GitHub.** Run `gh auth login`. Skip this if `gh auth status` says you are logged in.
2. **Install Cairn.** In Claude Code, run:

   ```
   /plugin marketplace add maxfelker/cairn
   /plugin install cairn@cairn
   ```

3. **Talk to Cairn.** Start a new session in a clone of a GitHub repository, and ask **"is Cairn set up?"**. Then say what you want, such as **"plan this idea: …"** or **"work on #42"**.

There are no commands to learn. Cairn works out the next step from what you ask and from the state of the work on GitHub.

## What you can ask

| Ask | Cairn |
|---|---|
| "plan this idea: …" | Writes it up as an epic, then breaks it into features and tasks |
| "how should we build epic #1?" | Records one architecture for the epic's features |
| "work on #42" | Takes the next step: break it down, build it on a branch, or continue the open pull request |
| "address the feedback on #31" | Answers review comments in their threads, with commits on the same branch |
| "is #31 ready?" | Gives one verdict against the criteria, and merges only when you say yes |
| "prepare a release" | Proposes a version and notes from the merged work, and publishes only when you say yes |

## Manage the plugin

| To | Run in Claude Code |
|---|---|
| Install | `/plugin marketplace add maxfelker/cairn`, then `/plugin install cairn@cairn` |
| Turn off for now | `/plugin disable cairn@cairn` |
| Turn back on | `/plugin enable cairn@cairn` |
| Update | `/plugin marketplace update cairn`, then `/plugin update cairn@cairn`, then restart Claude Code |
| Uninstall | `/plugin uninstall cairn@cairn`, then `/plugin marketplace remove cairn` |

Every command also works in a shell as `claude plugin …`, for example `claude plugin disable cairn@cairn`.

**Install for a team.** Run `claude plugin install cairn@cairn --scope project` in the repository. It records Cairn in the repository's `.claude/settings.json`, so everyone who works there is offered Cairn. Commit that file.

**Nothing is left behind.** Cairn keeps all of its state in GitHub, in issues, comments, pull requests, and releases. It writes no files of its own, so uninstalling leaves nothing to clean up. Claude Code marks its cached copy of the plugin as orphaned, and removes it on its own.

## Status

Cairn is early. The [epic](https://github.com/maxfelker/cairn/issues/1) tracks what is built and what comes next. To work on Cairn itself, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[GPL-3.0](LICENSE)
