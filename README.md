# impulso-bb

My custom [bb](https://getbb.app) plugins. Each plugin lives in `plugins/<name>` and is a standalone package.

| Plugin | Description |
| --- | --- |
| [worktree-hooks](plugins/worktree-hooks) | Worktree environment that runs per-project scripts before and after the worktree is created, before the agent starts |
| [umbrella-repos](plugins/umbrella-repos) | Repos tab with per-repo git status, diffs and GitHub PRs for multi-repo (umbrella) workspaces |
| [delegate](plugins/delegate) | Hand a task or prompt template (e.g. create-pr) to a visible child thread on a small/medium/big model tier via `bb delegate` |

## Install via marketplace

The repo is a bb plugin marketplace (`marketplace.json`). It must be public (or git must authenticate over HTTPS) because bb fetches plugin code from GitHub.

```sh
bb marketplace add git:https://github.com/alexandrekm/impulso-bb.git@main   # or Settings -> Plugin marketplaces
bb plugin install worktree-hooks@impulso-bb
bb plugin outdated && bb plugin update
```

Entries track release tags (`<plugin>/vX.Y.Z`) through semver ranges, so a release reaches users without a catalog change.
When a plugin leaves its range (e.g. 0.2 -> 0.3 while < 1.0), bump `range` in `marketplace.json`.
`delegate` has no release yet and tracks `main`; switch it to a range once it is tagged.

For local development, install from the checkout instead: `bb plugin install path:/path/to/impulso-bb --plugin <name>` then `bb plugin reload <name>`.

## Releasing (automatic)

Releases are automated per plugin with [release-please](https://github.com/googleapis/release-please).
Use Conventional Commits and touch only the plugin you mean to release:

| Commit type | Bump (while < 1.0) |
| --- | --- |
| `feat` | minor (0.1.0 -> 0.2.0) |
| `fix`, `perf` | patch (0.1.0 -> 0.1.1) |
| breaking (`feat!`, `BREAKING CHANGE:`) | minor (major after 1.0) |
| `docs`, `build`, `ci`, `test`, `refactor`, `style` | no release |

On every push to `main`, release-please keeps a release PR open per plugin that bumps `package.json` and `CHANGELOG.md`.
Merging it creates the tag `<plugin>/vX.Y.Z` and a GitHub release, which `bb plugin update` picks up. Never move a published tag.

To add a plugin: create `plugins/<name>`, list it in `marketplace.json`, `.bb/plugins.json`, `release-please-config.json`
and `.release-please-manifest.json`.

## Local development

```sh
cd plugins/<name>
npm install --include=dev
bb plugin install .   # then: bb plugin dev
```