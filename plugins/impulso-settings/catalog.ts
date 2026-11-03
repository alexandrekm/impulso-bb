// Pure helpers: turn impulso-pi's feature catalog (features.ts, loaded at
// runtime from the installed copy) into rows the settings page can render.
// No I/O here so it can be unit-tested with a fake catalog module.

export type Control = "toggle" | "select" | "model" | "models";

/** The subset of impulso-pi's Feature shape this plugin reads. */
export interface CatalogFeature {
  id: string;
  tab: string;
  group: string;
  label: string;
  description: string;
  kind: string;
  picker?: boolean;
  modelList?: boolean;
  blankLabel?: string;
}

/** The exports of impulso-pi's extensions/impulso-settings/features.ts we use. */
export interface CatalogModule {
  TABS: { id: string; label: string }[];
  featuresForTab(tabId: string): CatalogFeature[];
  featureValues(f: CatalogFeature): string[];
  getFeatureState(f: CatalogFeature): string;
  setFeatureState(f: CatalogFeature, value: string): void;
  featureWarning(f: CatalogFeature): string | undefined;
  getShortlist(): string[];
}

/** The exports of impulso-pi's model-settings.ts we use for the shortlist. */
export interface ShortlistModule {
  selectedFromShortlist(existing: string[], universe: string[]): string[];
  mergeShortlist(existing: string[], selected: string[], universe: string[]): string[];
}

export interface Row {
  id: string;
  tab: string;
  group: string;
  label: string;
  description: string;
  control: Control;
  options: string[];
  blankLabel: string;
  value: string;
  warning: string | null;
  /** For "models": the full saved shortlist (including entries no picker maps). */
  shortlist: string[];
}

export interface Catalog {
  tabs: { id: string; label: string }[];
  rows: Row[];
  error: string | null;
}

const isToggle = (values: string[]) => values.length === 2 && values[0] === "on" && values[1] === "off";

export function controlFor(f: CatalogFeature, values: string[]): Control {
  if (f.picker) return f.modelList ? "models" : "model";
  return isToggle(values) ? "toggle" : "select";
}

export function toRow(mod: CatalogModule, f: CatalogFeature): Row {
  const values = mod.featureValues(f);
  const control = controlFor(f, values);
  return {
    id: f.id,
    tab: f.tab,
    group: f.group,
    label: f.label,
    description: f.description,
    control,
    options: control === "select" ? values : [],
    blankLabel: f.blankLabel ?? "same as main",
    value: mod.getFeatureState(f),
    warning: mod.featureWarning(f) ?? null,
    shortlist: control === "models" ? mod.getShortlist() : [],
  };
}

export function buildCatalog(mod: CatalogModule): Catalog {
  const rows: Row[] = [];
  for (const tab of mod.TABS) for (const f of mod.featuresForTab(tab.id)) rows.push(toRow(mod, f));
  const used = new Set(rows.map((r) => r.tab));
  return { tabs: mod.TABS.filter((t) => used.has(t.id)), rows, error: null };
}

export function findFeature(mod: CatalogModule, id: string): CatalogFeature | undefined {
  for (const tab of mod.TABS) {
    const f = mod.featuresForTab(tab.id).find((x) => x.id === id);
    if (f) return f;
  }
  return undefined;
}

/** Validate a value against the row's control before writing it. */
export function checkValue(row: Row, value: string): string | null {
  if (row.control === "toggle" && value !== "on" && value !== "off") return "expected on or off";
  if (row.control === "select" && !row.options.includes(value)) return "not one of the allowed values";
  if (row.control === "model" && value !== "" && !/^[^/\s]+\/\S+$/.test(value)) return "expected provider/model";
  if (row.control === "models") return "use the shortlist editor";
  return null;
}

/** Parse `pi --list-models` output (a header line, then "provider model ..."). */
export function parseModelList(stdout: string): string[] {
  const out: string[] = [];
  for (const line of stdout.split("\n")) {
    const [provider, model] = line.trim().split(/\s+/);
    if (!provider || !model || provider === "provider" || provider === "measure") continue;
    const ref = provider + "/" + model;
    if (!out.includes(ref)) out.push(ref);
  }
  return out;
}

/** The value setFeatureState expects for the shortlist after a selection. */
export function shortlistValue(sl: ShortlistModule, existing: string[], selected: string[], universe: string[]): string {
  const merged = sl.mergeShortlist(existing, selected, universe);
  return merged.length > 0 ? JSON.stringify(merged) : "";
}

export function expandHome(p: string, home: string): string {
  return p === "~" ? home : p.startsWith("~/") ? home + p.slice(1) : p;
}
