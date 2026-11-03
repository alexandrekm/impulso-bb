# impulso-bb

A [bb](https://getbb.app) plugin marketplace. It holds only `marketplace.json`: every entry is an npm package, and bb installs from npm.

| Plugin | npm | Description |
| --- | --- | --- |
| worktree-hooks | [`bb-plugin-worktree-hooks`](https://www.npmjs.com/package/bb-plugin-worktree-hooks) | Worktree environment that runs per-project scripts before and after the worktree is created, before the agent starts |
| umbrella-repos | [`bb-plugin-umbrella-repos`](https://www.npmjs.com/package/bb-plugin-umbrella-repos) | Repos tab with per-repo git status, diffs and GitHub PRs for multi-repo (umbrella) workspaces |

## Install

```sh
bb marketplace add git:github.com/alexandrekm/impulso-bb@main   # or Settings -> Plugin marketplaces
bb plugin install worktree-hooks@impulso-bb
bb plugin outdated && bb plugin update
```

Entries use semver ranges, so a new npm release reaches users without a catalog change.
While a plugin is below 1.0, a minor bump (0.3 -> 0.4) leaves its range: bump `range` here when that happens.

## Where the code lives

The plugin source moved to a private repo, where it is built with `bb plugin build` and published to npm.
The history up to the move stays here (the last commit with `plugins/` is 9043270), and the old `<plugin>/vX.Y.Z` tags still resolve, so existing git installs keep working until you switch them:

```sh
bb plugin install worktree-hooks@impulso-bb   # after removing the git install
```
