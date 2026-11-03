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

## Adding a plugin

Create `plugins/<name>`, then list it in `marketplace.json` (entry with `"ref": "main"`) and `.bb/plugins.json`.
There is no release process: `main` is the release.

## Local development

```sh
cd plugins/<name>
npm install --include=dev
bb plugin install .   # then: bb plugin dev
```