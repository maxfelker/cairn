# Cairn

**Give your agents a high-quality inner loop for the SDLC.**

When an agent works today, its plans, decisions, and progress usually stay in a terminal session or a local Markdown file. Only the person at that keyboard can see them. Cairn moves that context into your team's SDLC tool. Ideas become epics, features, and tasks. Feedback goes into issue and pull request threads. Releases are built from the work record. Every person and every agent reads the same source of truth, and anyone can pick up the work where someone else left off.

Cairn follows the workflow in [Share agentic context in your SDLC tools instead of committing markdown files](https://maxfelker.com/article/sharing-agentic-context-in-your-sdlc-tools).

## Install

Cairn currently runs in Claude Code and supports GitHub. You need `git` and the [GitHub CLI](https://cli.github.com), logged in with `gh auth login`.

```
/plugin marketplace add maxfelker/cairn
/plugin install cairn@cairn
```

Then, in a clone of your repository, ask: **"is Cairn set up?"**

## Status

Cairn is early. Planning, implementation, feedback, and release workflows are added one at a time. The [epic](https://github.com/maxfelker/cairn/issues/1) tracks them.

## License

[GPL-3.0](LICENSE)
