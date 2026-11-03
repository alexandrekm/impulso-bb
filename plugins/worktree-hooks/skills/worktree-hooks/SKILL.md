---
name: worktree-hooks
description: "Explain or troubleshoot the Worktree Hooks plugin: per-project scripts that run before and after a thread's git worktree is created, before the agent starts."
---

# Worktree Hooks

The plugin adds a **Worktree + hooks** environment provider. Pick it in the
new-thread environment picker instead of the built-in Worktree to use it.

## Order of operations for a new thread

1. **Pre-create script** runs in the project checkout (`cwd` = source repo).
2. `git worktree add -B <thread-branch> <path> <base>`. The base is
   `origin/HEAD` when known, else the checkout's current branch. Gitignored
   files listed in `.worktreeinclude` are copied over.
3. **Post-create script** runs inside the new worktree.
4. Core runs the repo's `.bb-env-setup.sh`, if any, and then starts the agent.

A non-zero exit or a timeout fails the launch, and the plugin removes the
worktree. Script output streams to the thread's environment launch report.

## Configuration

- Scripts are per project: Settings → Plugins → Worktree Hooks → *Project hook scripts*.
- `scriptTimeoutMinutes` (default 15): `bb plugin config worktree-hooks set scriptTimeoutMinutes 30`.
- Scripts run with `/bin/bash -e` unless the first line is a shebang.

## Environment variables

`BB_HOOK_PHASE` (`pre-create` | `post-create`), `BB_SOURCE_PATH`, `BB_WORKTREE_PATH`,
`BB_BRANCH`, `BB_BASE_BRANCH` (post-create only), `BB_PROJECT_ID`,
`BB_PROJECT_NAME`, `BB_THREAD_ID`, `BB_HOST_ID`.

## Troubleshooting

- Logs: `bb plugin logs worktree-hooks`.
- Worktrees live under the plugin's host data dir:
  `~/.bb/plugins/worktree-hooks/host-data/worktrees/<pathKey>/<repo>`.
