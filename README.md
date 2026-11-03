# impulso-bb

My custom [bb](https://getbb.app) plugins. Each plugin lives in `plugins/<name>` and is a standalone package.

| Plugin | Description |
| --- | --- |
| [worktree-hooks](plugins/worktree-hooks) | Worktree environment that runs per-project scripts before and after the worktree is created, before the agent starts |
| [umbrella-repos](plugins/umbrella-repos) | Repos tab with per-repo git status, diffs and GitHub PRs for multi-repo (umbrella) workspaces |

## Install via marketplace

The repo is a bb plugin marketplace (`marketplace.json`). It is private, so git must authenticate over HTTPS (`gh auth setup-git`).

```sh
bb marketplace add git:https://github.com/alexandrekm/impulso-bb.git@main
bb plugin search worktree   # entries from impulso-bb
bb plugin install worktree-hooks@impulso-bb
bb plugin outdated && bb plugin update
```

Entries track release tags (`<plugin>/vX.Y.Z`) through semver ranges, so a release reaches users without a catalog change.
`delegate` has no release yet and tracks `main`; switch it to a range once it is tagged.
When a plugin leaves its range (e.g. 0.2 -> 0.3), bump `range` in `marketplace.json`.

Direct install still works: `bb plugin install git:https://github.com/alexandrekm/impulso-bb.git@main --plugin <name>`.

## Releasing (automatic)

Releases are automated per plugin with [release-please](https://github.com/googleapis/release-please).
Use Conventional Commits and touch only the plugin you mean to release:

| Commit type | Bump (while < 1.0) |
| --- | --- |
| `feat` | minor (0.1.0 -> 0.2.0) |
| `fix`, `perf` | patch (0.1.0 -> 0.1.1) |
| breaking (`feat!`, `BREAKING CHANGE:`) | minor (major after 1.0) |
| `docs`, `build`, `ci`, `test`, `refactor`, `style` | no release |

On every push to `main`, release-please keeps a "release" PR open per plugin that bumps `package.json`,
updates `CHANGELOG.md`, and lists the commits. Merging it creates the tag `<plugin>/vX.Y.Z` and a GitHub release,
which `bb plugin update` picks up for semver installs. Commits are attributed to a plugin by file path, so
changes under `plugins/<name>/` only release that plugin.

To add a plugin: create `plugins/<name>`, list it in `marketplace.json`, `.bb/plugins.json`, `release-please-config.json`
and `.release-please-manifest.json`. Never move a published tag.

## Local development

```sh
cd plugins/<name>
npm install --include=dev
bb plugin install .   # then: bb plugin dev
```