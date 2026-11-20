# Cairn

**Give your agents a high-quality inner loop for the SDLC.**

When an agent works today, its plans, decisions, and progress usually stay in a terminal session or a local Markdown file. Only the person at that keyboard can see them. Cairn moves that context into your team's SDLC tool. Ideas become epics, features, and tasks. Feedback goes into issue and pull request threads. Releases are built from the work record. Every person and every agent reads the same source of truth, and anyone can pick up the work where someone else left off.

Cairn follows the workflow in [Share agentic context in your SDLC tools instead of committing markdown files](https://maxfelker.com/article/sharing-agentic-context-in-your-sdlc-tools).

Cairn currently runs in Claude Code and supports GitHub. You need `git`, Node.js 18 or later, and the [GitHub CLI](https://cli.github.com).

## Get started

1. **Install Cairn.** In Claude Code, run:

   ```
   /plugin marketplace add maxfelker/cairn
   /plugin install cairn@cairn
   ```

2. **Log in to GitHub.** Run `gh auth login`. Skip this if `gh auth status` says you are logged in.
3. **Check the setup.** Start a new session in a clone of a GitHub repository, and ask:

   ```
   Is Cairn set up?
   ```

There are no commands to learn. Cairn works out the next step from what you ask and from the state of the work on GitHub.

## Walk through the lifecycle

Copy each prompt into Claude Code, and swap in your own idea and numbers. Cairn asks before it merges or publishes anything.

**Create an epic from what you share in the terminal.** Paste an idea, notes, or a transcript after the prompt.

```
Plan this idea: <paste your idea, notes, or transcript>
```

**Break the epic into features.** Each feature is one capability, such as "A player can move the camera with WASD".

```
Break down epic #1 into features
```

**Design the architecture across the features.** Cairn records one plan for shared work, interfaces, and build order, as a comment on the epic.

```
How should we build epic #1?
```

**Break a feature into technical tasks.** The tasks follow the architecture.

```
Break down feature #2 into tasks
```

**Build a feature and open a pull request.** Cairn builds the tasks on one branch, then opens a pull request for review.

```
Work on #2
```

**Review the pull request, and have Cairn make the changes.** Leave comments on the pull request in GitHub, then:

```
Address the feedback on #31
```

When the review is done, ask `Is #31 ready?`. Cairn merges only when you say yes.

**Publish a versioned release.** Cairn proposes a semantic version and notes from the merged work, then tags it and publishes a GitHub release when you say yes.

```
Prepare a release
```

## Manage the plugin

| To | Run in Claude Code |
|---|---|
| Install | `/plugin marketplace add maxfelker/cairn`, then `/plugin install cairn@cairn` |
| Install for a team | `claude plugin install cairn@cairn --scope project` in a shell in the repository, then commit `.claude/settings.json` |
| Turn off for now | `/plugin disable cairn@cairn` |
| Turn back on | `/plugin enable cairn@cairn` |
| Update | `/plugin marketplace update cairn`, then `/plugin update cairn@cairn`, then restart Claude Code |
| Uninstall | `/plugin uninstall cairn@cairn`, then `/plugin marketplace remove cairn` |

Cairn keeps all of its state in GitHub, so uninstalling leaves nothing to clean up.

## Status

Cairn is early. The [epic](https://github.com/maxfelker/cairn/issues/1) tracks what is built and what comes next. To work on Cairn itself, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[GPL-3.0](LICENSE)
