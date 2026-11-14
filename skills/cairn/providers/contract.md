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
| `list-items --kind <kind>` | Which open items of this kind exist? | `items` (each `id`, `url`, `title`) |
| `save-item --kind <kind> --file <draft>` | Create a work item, or update the open one of that kind with exactly that title | `created` (true or false), `item` (`id`, `url`, `title`) |

Add a command here only when a feature first needs it. Then add it to every
provider.

`save-item` is idempotent. Saving the same draft twice leaves one item. It
checks access for `create-item` and `label` before it changes anything, and
creates the kind's label or category if it is missing.

## Kinds

| Kind | Meaning |
|---|---|
| `epic` | Why the work exists, and what success looks like |
| `feature` | One capability a persona gains |
| `task` | One engineering step that delivers a feature |

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
| `PROVIDER_ERROR` | The provider rejected a change. The message carries its error text. |

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
