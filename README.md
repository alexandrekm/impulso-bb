# impulso-bb

My custom [bb](https://getbb.app) plugins. Each plugin lives in `plugins/<name>` and is a standalone package.

| Plugin | Description |
| --- | --- |
| [worktree-hooks](plugins/worktree-hooks) | Worktree environment that runs per-project scripts before and after the worktree is created, before the agent starts |
| [umbrella-repos](plugins/umbrella-repos) | Repos tab with per-repo git status, diffs and GitHub PRs for multi-repo (umbrella) workspaces |

## Install from GitHub

The repo is a plugin collection (`.bb/plugins.json`). It is private, so git must be able to authenticate over HTTPS (`gh auth setup-git`).

```sh
# Always latest main (rolling)
bb plugin install git:https://github.com/alexandrekm/impulso-bb.git@main --plugin worktree-hooks

# Semver: newest 0.x release
bb plugin install git:https://github.com/alexandrekm/impulso-bb.git@^0.1.0 --plugin worktree-hooks --tag-prefix worktree-hooks/

# Pin exactly (tag or commit)
bb plugin install git:https://github.com/alexandrekm/impulso-bb.git@worktree-hooks/v0.1.0 --plugin worktree-hooks
```

Then `bb plugin outdated` and `bb plugin update` pull new commits (branch) or releases (semver range).

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

To add a plugin: create `plugins/<name>`, list it in `.bb/plugins.json`, `release-please-config.json`
and `.release-please-manifest.json`. Never move a published tag.

## Local development

```sh
cd plugins/<name>
npm install --include=dev
bb plugin install .   # then: bb plugin dev
```
