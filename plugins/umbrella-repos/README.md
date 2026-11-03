# Umbrella Repos

A bb plugin for **umbrella folders**: a thread workspace that is not itself a git
repo but holds several child repos (for example `~/code/agents/{impulso-pi,impulso-bb}`).
bb's built-in Git and PR features only look at the workspace root, so they show
nothing there. This plugin adds a **Repos** tab to those threads.

## What it shows

For every git repo found under the workspace (default: two folder levels deep):

- branch (or detached SHA), ahead/behind upstream, "unpushed" when there is no upstream
- commits ahead of the default branch (`origin/HEAD`)
- staged / unstaged / untracked / conflicted counts
- GitHub PR for the current branch: number, state, draft, checks, review decision (via `gh`)
- changed files with +/- counts and bb's own diff viewer (unified or split), for
  - **Uncommitted**: working tree vs `HEAD` (including untracked files)
  - **Branch**: working tree vs the merge base with the default branch

Status refreshes every 15 s and PRs every 60 s while the page is visible. The
refresh button forces both. The tab only appears for non-git workspaces that
contain at least one repo.

## No agent context

On purpose, this plugin adds **nothing** to agent threads: no skills
(`"skills": []` in `package.json`, and no `skills/` folder), no agent tools, no
instructions and no CLI commands. It is UI only. It is also read-only: it never
runs a git command that changes a repo.

## Settings

Settings → Plugins → Umbrella Repos:

| Setting | Default | Meaning |
| --- | --- | --- |
| Scan depth | `2` | Folder levels below the workspace searched for repos (1–5). The scan does not descend into a repo it found. |
| Skipped folders | `node_modules,vendor,dist,build,target,tmp` | Folder names never scanned. Dot-folders are always skipped. |

## How it works

- `host.ts` runs on the environment's machine. It finds repos (any folder with a
  `.git` dir or file, so worktrees and submodules count) and runs `git` and
  `gh` there. It never wakes a suspended machine. Repo and file paths are
  validated to stay inside the workspace.
- `server.ts` resolves the thread's environment to its machine and path,
  calls the host, and caches PR lookups (20 s while checks are pending, else 60 s).
- `app.tsx` registers the fixed thread tab (`experimental_tab`) and renders
  with `experimental_Diff`.

Requirements on the machine: `git`, and `gh` logged in for PR data (without
it, PR chips show `PR ?`).

## Develop

```sh
npm install --include=dev
npx tsc -p .
bb plugin build
bb plugin install . --yes     # first time, from this folder
bb plugin reload umbrella-repos
```

Exercise the backend without the UI:

```sh
echo '{"environmentId":"env_..."}' > /tmp/in.json
bb plugin rpc call umbrella-repos overview --input-file /tmp/in.json --json
```
