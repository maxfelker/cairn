# Provider contract

Cairn's workflow is the same for every SDLC tool. Each provider, such as GitHub,
Jira, or Azure DevOps, is an adapter that implements this contract with its own
CLI or API. The core skill only calls contract commands and reads contract
results. It never improvises a provider's commands.

A provider is two files in this folder:

- `<provider>.md`: when to use the provider, and anything an agent must know
  that the commands do not cover.
- `<provider>.js`: the adapter. It is zero-dependency Node and is run as
  `node <provider>.js <command> [args]`.

Add the adapter to the `allowed-tools` list in `SKILL.md`, so users are not
prompted each time Cairn runs it.

`tests/contract.test.js` runs every adapter in this folder against this
contract. A new provider is done when it passes.

## Commands

| Command | Answers | Success fields |
|---|---|---|
| `target` | Which project does this clone's work belong to? | `provider`, `target` (a stable id, such as `owner/name`) |
| `auth` | Is the user logged in with the provider's own tool? | `login` |
| `access [--for <action>]` | What may the user do on the target? | `permission`, `allowed` (the actions the user may take) |
| `check` | All of the above, for the setup check | `target`, `auth`, `access` (each a full result) |
| `comment --on <id> --file <text\|-> [--key <key>]` | Comment on an item as Cairn. With a key, update Cairn's earlier comment with that key instead of adding another | `comment` (`id`, `url`), `created`, `changed` |
| `find-item --query <text>` | Which item does the user mean? A reference (`42`, `#42`) or a link to an item in this target is one exact match. A link elsewhere is `NOT_THIS_PROVIDER`. Plain text matches open item titles by shared words | `matches` (each `id`, `title`, `kind`, `state`, `url`; best first, up to 5), `exact` (true when there is one clear match, and then the only one listed) |
| `get-item --id <id>` | What does this item say, and what is under it? | `item` (`id`, `url`, `title`, `kind`, `state`, `body`, `images`, `parent` or null), `comments` (`id`, `author`, `body`, `url`, `at`, `cairn`, `images`), `children` (`id`, `title`, `kind`, `state`), `changes` (`id`, `url`, `state`: `merged`, `open`, or `closed`): the changes that close it |
| `list-items --kind <kind>` | Which open items of this kind exist? | `items` (each `id`, `url`, `title`) |
| `order-children --parent <id> --ids <id,id,…>` | Put these children first, in this order (others keep their order after them) | `order`, `moved` (0 when already in order) |
| `save-item --kind <kind> --file <draft> [--parent <id>]` | Create a work item, or update the open one of that kind with exactly that title. With a parent, match among its children, and link a new item under it | `created`, `item` (`id`, `url`, `title`), and with a parent: `parent`, `linked` |
| `start-change --for <id> [--partial <name>]` | Start the work on an item, or go back to it. Makes one branch for the item from the latest `main`, linked to the item, or switches to the branch the item already has. With `--partial`, the change delivers only part of the item: the branch is plain, named `<id>-<name>`, and not linked | `branch`, `created`, `linked` |
| `push-change` | Push the current change branch. Never `main`, and never with force | `branch`, `pushed` (false when the provider already has every commit) |
| `save-change --for <id> --file <draft> [--partial [--closes <id,id,…>]]` | Put the current branch up for review: open its change, or update the one already open. The command ends the description with the closing references, then checks what the provider will close | `change` (`id`, `url`), `created`, `closes` (the ids it closes on merge) |
| `get-change --id <change>` | Where does this change stand in review? Reads only | `change` (`id`, `url`, `state`: `open`, `merged`, or `closed`, `branch`, `opened`, `closes`), `checks` (`state`: `passed`, `failed`, `pending`, or `none`, and `runs`, each `name` and `state`), `review` (`decision`: the provider's review verdict or null, `pending`: true when the user has a review not yet submitted), `mergeable`, `mergeState`, `behind` (commits on `main` the branch lacks, or null when the change is not open), `reviews` (submitted reviews with a summary: a comment plus `state`), `comments` (the change's conversation), `threads` (`id`, `resolved`, `outdated`, `path`, `line`, `comments`). Every comment has `id`, `author`, `body`, `url`, `at`, `cairn` (true when Cairn wrote it), and `images` |
| `get-image --url <url> --out <folder>` | Let me look at an image attached to an item or a change. Downloads one URL from an `images` list into a folder outside the repository | `path`, `type`, `bytes` |
| `reply --on <thread> --file <text\|->` | Answer one review thread as Cairn, in the thread. Never resolves it. Sending the same reply again posts nothing | `comment` (`id`, `url`), `change`, `created` |
| `merge-change --id <change> --approved` | Merge a change the developer approved. Refuses to run without `--approved`, never bypasses the provider's rules, and keeps the branch. Merging a merged change again does nothing | `change` (`id`, `url`), `merged` (false when it was already merged), `method`, `commit` |
| `list-changes [--merged-since <tag>]` | What would a release contain, and is `main` ready to tag? Reads only | `since` (`tag`, `commit`, `at`, `release`: the release's URL or null; null when there is no version tag yet), `tags` (`local` and `remote`, each `tag` and `commit` or null, and `match`), `main` (`local`, `remote`, `match`, and `checks` as in `get-change`), `changes` (merged into `main` after the tag, oldest first, each `id`, `url`, `title`, `labels`, `merged`, `closes`), `items` (the items those changes closed, each `id`, `url`, `title`, `kind`, `state`, `parent`) |

Add a command here only when a feature first needs it. Then add it to every
provider.

`save-item` is idempotent. Saving the same draft twice leaves one item,
linked once. An item left unlinked by an interrupted run is found and linked
rather than duplicated. It checks access for `create-item` and `label` (plus `link-child` with a
parent) before it changes anything.
Providers record the kind natively where they can (an issue type or work
item type), and fall back to a label or category otherwise. Results report
which with `via`.

## Changes

A change is a branch, its pushed commits, and the request to review and
merge it, such as a pull request. The three change commands keep the rules
that protect other people's work in code:

- **One branch per item, from the latest `main`.** `start-change` reuses
  the item's branch when it exists, in the clone or on the provider.
  Running it twice never makes a second branch.
- **A dirty working tree is refused.** If the clone has uncommitted changes
  and is not already on the item's branch, `start-change` fails with
  `DIRTY_TREE` and changes nothing. It never stashes or discards.
- **`main` is never pushed or proposed, and nothing is force-pushed.**
  `push-change` and `save-change` fail with `NOT_ON_CHANGE` on `main`. A
  push the provider rejects is reported, not retried.
- **A linked branch closes its item.** Link the branch only when the
  change finishes the item. Use `--partial` for a change that delivers
  part of it.
- **The command writes the closing references.** `save-change` closes the
  item and its open children by default. With `--partial`, the description
  says the change is part of the item, and closes only the ids in
  `--closes`. It then reads back what the provider will close, and fails
  with `CLOSES_MISMATCH` when that differs. The change stays open, and the
  failure carries `change` and the `closes` the provider reported.

`save-change` checks access for `propose-change`, and the other two check
`push`, before they change anything.

**Review stays with the reviewer.** `reply` answers in a thread with
Cairn's marker, and checks access for `comment`. No command resolves a
thread or dismisses a review.

**Merging needs the developer's approval.** `merge-change` fails with
`NOT_APPROVED` before it calls the provider unless it is given
`--approved`, which the skill passes only after the developer says yes.
The flag is a checkpoint, not a lock: every merge names its approval, and
tests can check that nothing merges without it. A required check, review,
or branch rule that blocks the merge fails with `PROTECTED`, and is never
worked around. It checks access for `merge`. Feedback outside a thread is answered with
`comment` on the change.

## Releases

A release is a version tag on `main` and the notes that describe it.
`list-changes` gathers what the next release would contain. It starts from
the latest SemVer tag on the provider, or from `--merged-since`, and lists
every change merged into `main` after that tag's commit.

**Differences are reported, not fixed.** `list-changes` compares the latest
version tag in the clone with the one on the provider, and the clone's
`main` with the provider's. It never fetches, pushes, or moves a tag to make
them agree: the developer decides. A `--merged-since` tag that is not on the
provider fails with `TARGET_UNAVAILABLE`.

## Times

`at` and `opened` are ISO 8601 times in UTC, so they compare as text.
`next.js` uses them to tell feedback that came after Cairn's last answer.

## Images

An image attached to an item or a comment is listed in that result's
`images`, each with a `url` to download and its `alt` text. The provider
stays the image's source of truth. `get-image` saves a copy only into a
folder outside the repository, and fails with `INSIDE_REPO` for a folder
inside it, so an image is never committed. Refer to an image in a reply by
its place on the provider, not by the local copy. A URL may expire a few
minutes after it is read, so download right after reading.

## Comments

Every Cairn comment ends with a hidden marker, `<!-- cairn -->`, or
`<!-- cairn key=<key> -->` with a key. That is how people and tools tell
Cairn's comments apart, and how a keyed comment is found again to update.

## Kinds

| Kind | Meaning |
|---|---|
| `epic` | Why the work exists, and what success looks like |
| `feature` | One capability a persona gains |
| `task` | One engineering step that delivers a feature |
| `bug` | Something that does not work as expected |

## Drafts

A draft is one Markdown file, or `-` for stdin. The first line is
`# <title>`, and the rest is the body. Cairn writes drafts to a temporary location outside the
repository, and checks their structure with `structure.js` before saving.
Adapters only read drafts.

## Results

Every command prints exactly one JSON object to stdout:

- exit `0`: `{"ok": true, ...}`
- exit `1`: `{"ok": false, "code": "<CODE>", "message": "<what is wrong>", "fix": "<one line the user can act on>"}`
- exit `2`: wrong usage. Usage goes to stderr, with no JSON.

Providers may add their own fields to a result, but never anything secret.
Tokens, token sources, and scopes never appear in output.

## Codes

| Code | Meaning |
|---|---|
| `GIT_MISSING` | `git` is not installed. |
| `NOT_A_REPO` | The directory is not inside a git clone. |
| `NO_REMOTE` | The clone has no remote. |
| `NOT_THIS_PROVIDER` | The clone's remote belongs to a different provider. |
| `CLI_MISSING` | The provider's CLI is not installed. |
| `NOT_LOGGED_IN` | The provider's CLI is not logged in. |
| `TARGET_UNAVAILABLE` | The target does not exist, or the user cannot see it. |
| `MISSING_PERMISSION` | The user's permission is too low for the action. |
| `FEATURE_DISABLED` | The target has the needed feature turned off, such as issues. |
| `UNKNOWN_ACTION` | The provider does not know the requested action. |
| `INVALID_DRAFT` | The draft file cannot be read, or has no `# <title>` line. |
| `DIRTY_TREE` | The working tree has uncommitted changes, and the clone is not on the item's branch. |
| `NOT_ON_CHANGE` | The clone is on `main` or on no branch, where Cairn does not push or open a change. |
| `NOT_PUSHED` | The branch is not on the provider yet, so no change can be opened for it. |
| `CLOSES_MISMATCH` | The change would close items it does not deliver, or would not close one it does. |
| `INSIDE_REPO` | A file Cairn would write, such as a downloaded image, would land inside the repository. |
| `NOT_APPROVED` | A merge or another consequential action was asked for without the developer's approval. |
| `PROTECTED` | A required check, required review, or branch rule blocked the action. |
| `PROVIDER_ERROR` | The provider or git rejected a change. The message carries its error text. |

## Actions

Actions are the provider-neutral names for the changes Cairn makes.
`access --for <action>` checks one action before Cairn attempts it.

| Action | Meaning |
|---|---|
| `comment` | Comment on a work item or a change. |
| `create-item` | Create a work item (an epic, feature, or task). |
| `label` | Label or classify a work item. |
| `link-child` | Link a work item as a child of another. |
| `push` | Push a branch. |
| `propose-change` | Open a change for review, such as a pull request. |
| `merge` | Merge a change into `main`. |
