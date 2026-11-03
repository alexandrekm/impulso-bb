# bb-plugin-impulso-settings

The settings page for [impulso-pi](https://github.com/alexandrekm/impulso-pi), rendered in bb
(Settings → Plugins → Impulso Settings). It replaces impulso-pi's old pi TUI page (`/settings`).

impulso-pi stays the single source of truth: `extensions/impulso-settings/features.ts` declares every
feature and reads/writes its state. This plugin imports the **installed** copy
(`~/.pi/agent/extensions/impulso-settings/`) at runtime and only renders it:

- tabs and groups from the catalog, plus a search box
- a control per row: toggle, select, model picker, or the model shortlist editor
- model lists come from `pi --list-models` (cached 10 minutes)

Changes are written immediately and apply to **new** pi sessions.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `catalogDir` | `~/.pi/agent/extensions/impulso-settings` | Folder holding the installed `features.ts` / `model-settings.ts` |
| `piCommand` | blank | Command for `--list-models`; blank tries `~/.pi/agent/bin/pi`, then `pi` |

Runs on the bb server machine and needs Node with native TypeScript (bb ships Node 24).

## Develop

```sh
npm install --include=dev
npx tsc -p . && node --test catalog.test.ts
bb plugin build && bb plugin install . --yes
```
