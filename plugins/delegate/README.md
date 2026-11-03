# bb-plugin-delegate

Delegate a task to a **visible child thread** on a cheaper model tier. Replaces
impulso-pi's `subagent-routing` extension under bb: a pi in-process worker's
result is a custom message bb does not render, while a child thread is a normal,
inspectable thread parented to the caller.

- **No agent tool, no skill** — both add permanent context. Trigger it from a prompt or by asking the agent to run the CLI.
- **CLI** `bb delegate spawn "<task>" [--tier small|medium|big] [--title t] [--wait]`.
- **Settings** (Settings → Plugins → Delegate): `smallModel` / `mediumModel` / `bigModel` as `provider/model` (split on the first slash, e.g. `pi/anthropic/claude-haiku-5-5`); blank = project default. `defaultTier` picks the tier when none is given.
- The child reuses the caller's environment, is parented to it (reports back when done), and carries `pluginMetadata { tier, delegatedFrom }`.

Not ported: the guarded worker tool set, PR prompt commands (use `bb--prompt-library`), and `/delegate` slash routing (use the CLI).

```sh
npm install && npx tsc -p . && node --test tiers.test.ts
bb plugin install . --yes
```