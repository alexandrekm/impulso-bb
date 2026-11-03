// Pure helpers for the delegate plugin: tier -> provider/model resolution.

export const TIERS = ["small", "medium", "big"] as const;
export type Tier = (typeof TIERS)[number];

export interface TierModel {
  /** Undefined = let bb use the project's remembered provider. */
  providerId?: string;
  /** Undefined = let bb use the provider's default model. */
  model?: string;
}

/**
 * Parse a tier setting. Accepts "provider/model" (split on the FIRST slash, so
 * "pi/anthropic/claude-haiku-5-5" -> provider "pi", model "anthropic/claude-haiku-5-5"),
 * a bare model id with no provider (leading "/model"), or blank (project default).
 */
export function parseTierModel(raw: string | undefined | null): TierModel {
  const value = (raw ?? "").trim();
  if (!value) return {};
  const slash = value.indexOf("/");
  if (slash === -1) return { model: value };
  const providerId = value.slice(0, slash).trim();
  const model = value.slice(slash + 1).trim();
  return { ...(providerId ? { providerId } : {}), ...(model ? { model } : {}) };
}

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

export function defaultTitle(task: string, max = 60): string {
  const line = task.trim().split(/\r?\n/, 1)[0] ?? "";
  const clean = line.replace(/\s+/g, " ");
  return "Delegate: " + (clean.length > max ? clean.slice(0, max - 1) + "…" : clean);
}
