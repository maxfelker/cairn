# Contributing to Cairn

Cairn is a Claude Code plugin: a manifest in `.claude-plugin/`, one core
skill in `skills/cairn/`, and provider adapters in `skills/cairn/providers/`.
The work itself is tracked in this repository's issues. The
[epic](https://github.com/maxfelker/cairn/issues/1) is the place to start.

You need `git`, Node.js 18 or later, the [GitHub CLI](https://cli.github.com)
logged in with `gh auth login`, and Claude Code.

## Try a change

Load Cairn straight from your checkout, for one session, with nothing
installed:

```
claude --plugin-dir .
```

Edit a file under `skills/`, then start a new session the same way to pick
up the change. This is the everyday loop.

Cairn is tested on this repository itself. There is no sandbox repository.
Read-only commands, such as `get-item` and `list-changes`, are safe to run
here at any time. The release flow is tried with a draft release
(`publish-release --draft`), which makes no tag. Delete the draft on GitHub
when you are done.

## Try the real install

To check the install path a user takes, add your checkout as a local
marketplace and install from it:

```
/plugin marketplace add ./
/plugin install cairn@cairn
```

Remove it again with `/plugin uninstall cairn@cairn` and
`/plugin marketplace remove cairn`.

## Run what CI runs

CI runs two commands on every pull request. Run them before you push:

```
claude plugin validate . --strict
node --test 'tests/*.test.js'
```

The first checks the manifests and the skill. The second runs every test.
The tests never reach GitHub: the adapters run against a mock `gh` in
`tests/fake-gh/` and temporary git repositories.

## Run the evals

The evals in `evals/` check that everyday requests, such as "is Cairn set
up?" or "work on #42", start Cairn, and that an unrelated request does not.
They run real Claude sessions on your own login, so they cost model usage
and are not part of CI. Run them before a release, and after changing the
skill's description:

```
claude plugin eval . --no-publish
```

The first run asks you to confirm that you trust this plugin directory.
Each case runs with Cairn and without it. The report shows the difference
Cairn makes, and the run fails when a case scores below 1.0. Results are
written to `evals/results/`, which git ignores.

## Make a pull request

Work happens on a branch for an issue, with one commit per task, and one
pull request per feature. Cairn's own workflows do this for you: ask Cairn
to "work on #N".
