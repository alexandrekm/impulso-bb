# bb-plugin-worktree-hooks

Adds a **Worktree + hooks** environment provider to bb. When a thread starts with it:

1. The project's **pre-create** script runs in the project checkout.
2. A git worktree is created on the thread branch, and `.worktreeinclude` files are copied.
3. The project's **post-create** script runs inside the new worktree.
4. Core runs `.bb-env-setup.sh` (if present) and then spawns the agent.

A failing script (non-zero exit or timeout) fails the launch and removes the worktree.

## Configure

Settings → Plugins → **Worktree Hooks** → *Project hook scripts*: pick a project and fill in the two boxes.
The timeout is set with `bb plugin config worktree-hooks set scriptTimeoutMinutes <1-120>` (default 15).

The available variables are listed in [skills/worktree-hooks/SKILL.md](skills/worktree-hooks/SKILL.md).

## Develop

```sh
npm install --include=dev
bb plugin install .   # once
bb plugin dev         # rebuild + reload on save
```
