# impulso-bb

My custom [bb](https://getbb.app) plugins. Each plugin lives in `plugins/<name>` and is a standalone package.

| Plugin | Description |
| --- | --- |
| [worktree-hooks](plugins/worktree-hooks) | Worktree environment that runs per-project scripts before and after the worktree is created, before the agent starts |

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

## Releasing

Each plugin is versioned independently with a prefixed tag `<plugin>/vX.Y.Z`, matching `version` in its `package.json`.
Do not move a published tag: bb refuses a tag that changes commit, so publish a fix as a new version.

```sh
git tag worktree-hooks/v0.1.0 && git push origin worktree-hooks/v0.1.0
```

## Local development

```sh
cd plugins/<name>
npm install --include=dev
bb plugin install .   # then: bb plugin dev
```
