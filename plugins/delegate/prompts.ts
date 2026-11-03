// Pure helpers: turn a pi prompt template into a delegated task. Port of
// impulso-pi extensions/subagent-routing/routing.ts (templateTask, Jira key).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const JIRA_KEY = /\b[A-Z][A-Z0-9]*-\d+\b/;

export function expandHome(p: string, home = homedir()): string {
  return p === "~" ? home : p.startsWith("~/") ? join(home, p.slice(2)) : p;
}

export function isSafePromptName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(name);
}

export function findJiraKey(text: string): string | undefined {
  return JIRA_KEY.exec(text)?.[0];
}

export function splitList(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Strip frontmatter, append args, and tell the child where the pi config dir is. */
export function buildTask(raw: string, args: string, configDir: string): string {
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
  if (!body) throw new Error("The prompt is empty");
  const extra = args.trim() ? "\n\nAdditional user instructions:\n" + args.trim() : "";
  return body + extra + "\n\n(Paths written relative to the pi config dir resolve under " + configDir + ".)";
}

export function loadPromptTask(promptsDir: string, name: string, args: string): string {
  if (!isSafePromptName(name)) throw new Error("Invalid prompt name: " + name);
  const dir = expandHome(promptsDir);
  const raw = readFileSync(join(dir, name + ".md"), "utf8");
  return buildTask(raw, args, dirname(dir));
}
