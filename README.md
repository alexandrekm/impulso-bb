# impulso-bb

My custom [bb](https://getbb.app) plugins. Each plugin lives in `plugins/<name>` and is a standalone package.

| Plugin | Description |
| --- | --- |
| [worktree-hooks](plugins/worktree-hooks) | Worktree environment that runs per-project scripts before and after the worktree is created, before the agent starts |
| [umbrella-repos](plugins/umbrella-repos) | Repos tab with per-repo git status, diffs and GitHub PRs for multi-repo (umbrella) workspaces |

## Install via marketplace

The repo is a bb plugin marketplace (`marketplace.json`). Add it from a local checkout (no git auth needed for the catalog):

```sh
bb marketplace add path:/path/to/impulso-bb   # or Settings -> Plugin marketplaces
bb plugin install worktree-hooks@impulso-bb
bb plugin outdated && bb plugin update
```

Every entry tracks the `main` branch, so `git pull` in the checkout + `bb marketplace refresh impulso-bb` updates the catalog,
and `bb plugin update` pulls new commits from `main`. Plugin code itself is fetched from GitHub over HTTPS (bb rejects SSH URLs),
so the repo being private needs `gh auth setup-git` or `git config --global url."git@github.com:".insteadOf "https://github.com/"`.

Direct install from the checkout also works: `bb plugin install path:/path/to/impulso-bb --plugin <name>`.

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