// bb-plugin-impulso-settings — frontend entry.
// A section on this plugin's settings page that renders impulso-pi's feature
// catalog: tabs, grouped rows, and a control per row (toggle, select, model,
// model shortlist). Every change is written immediately by the server.
import { useCallback, useEffect, useMemo, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import type { Catalog, Row } from "./catalog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const SELECT_CLASS =
  "h-8 w-full max-w-xs rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function optionLabel(row: Row, value: string): string {
  return value === "" ? row.blankLabel : value;
}

function ModelSelect(props: { row: Row; models: string[] | null; busy: boolean; onSet: (v: string) => void }) {
  const { row, models } = props;
  const options = useMemo(() => {
    const list = models ?? [];
    return row.value && !list.includes(row.value) ? [row.value, ...list] : list;
  }, [models, row.value]);
  return (
    <select
      aria-label={row.label}
      className={SELECT_CLASS}
      value={row.value}
      disabled={props.busy}
      onChange={(e) => props.onSet(e.target.value)}
    >
      <option value="">{row.blankLabel}</option>
      {options.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
      {models === null ? <option disabled>Loading models…</option> : null}
    </select>
  );
}

function ShortlistEditor(props: {
  row: Row;
  models: string[] | null;
  busy: boolean;
  onSave: (selected: string[], universe: string[]) => void;
}) {
  const { row, models } = props;
  const universe = models ?? [];
  const saved = useMemo(
    () => universe.filter((m) => row.shortlist.some((e) => e === m || e.startsWith(m + ":"))),
    [universe, row.shortlist],
  );
  const [picked, setPicked] = useState<string[]>(saved);
  useEffect(() => setPicked(saved), [saved]);
  const kept = row.shortlist.filter((e) => !universe.some((m) => e === m || e.startsWith(m + ":")));
  const dirty = picked.length !== saved.length || picked.some((m) => !saved.includes(m));
  if (models === null) return <p className="text-xs text-muted-foreground">Loading models…</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
        {universe.map((m) => (
          <label key={m} className="flex items-center gap-2 text-xs text-foreground">
            <Checkbox
              checked={picked.includes(m)}
              disabled={props.busy}
              onCheckedChange={(on) =>
                setPicked((cur) => (on === true ? [...cur, m] : cur.filter((x) => x !== m)))
              }
            />
            <span className="font-mono">{m}</span>
          </label>
        ))}
      </div>
      {kept.length ? (
        <p className="text-xs text-muted-foreground">Kept as-is (not in the list): {kept.join(", ")}</p>
      ) : null}
      <div>
        <Button size="sm" disabled={!dirty || props.busy} onClick={() => props.onSave(picked, universe)}>
          Save shortlist
        </Button>
      </div>
    </div>
  );
}

function FeatureRow(props: {
  row: Row;
  models: string[] | null;
  busy: boolean;
  onSet: (id: string, value: string) => void;
  onSaveShortlist: (selected: string[], universe: string[]) => void;
}) {
  const { row } = props;
  const control = (() => {
    switch (row.control) {
      case "toggle":
        return (
          <Checkbox
            aria-label={row.label}
            checked={row.value === "on"}
            disabled={props.busy}
            onCheckedChange={(on) => props.onSet(row.id, on === true ? "on" : "off")}
          />
        );
      case "select":
        return (
          <select
            aria-label={row.label}
            className={SELECT_CLASS}
            value={row.value}
            disabled={props.busy}
            onChange={(e) => props.onSet(row.id, e.target.value)}
          >
            {row.options.map((v) => (
              <option key={v} value={v}>
                {optionLabel(row, v)}
              </option>
            ))}
          </select>
        );
      case "model":
        return <ModelSelect row={row} models={props.models} busy={props.busy} onSet={(v) => props.onSet(row.id, v)} />;
      case "models":
        return null;
    }
  })();
  return (
    <div className="flex flex-col gap-1.5 border-b border-border/50 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{row.label}</p>
          <p className="text-xs text-muted-foreground">{row.description}</p>
          {row.warning ? <p className="mt-1 text-xs text-destructive">⚠ {row.warning}</p> : null}
        </div>
        {control ? <div className="shrink-0">{control}</div> : null}
      </div>
      {row.control === "models" ? (
        <ShortlistEditor row={row} models={props.models} busy={props.busy} onSave={props.onSaveShortlist} />
      ) : null}
    </div>
  );
}

function ImpulsoSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [tab, setTab] = useState("");
  const [models, setModels] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    rpc.call("catalog", null).then(
      (c) => {
        setCatalog(c);
        setTab((cur) => cur || c.tabs[0]?.id || "");
      },
      (cause) => setCatalog({ tabs: [], rows: [], error: errorText(cause) }),
    );
    rpc.call("models", null).then(
      (r) => {
        setModels(r.models);
        if (r.error) toast.error("Could not list models: " + r.error);
      },
      () => setModels([]),
    );
  }, [rpc]);

  const apply = useCallback(
    async (run: () => Promise<Catalog>, okText: string) => {
      setBusy(true);
      try {
        setCatalog(await run());
        toast.success(okText + " — applies to new pi sessions");
      } catch (cause) {
        toast.error(errorText(cause));
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  const onSet = useCallback(
    (id: string, value: string) => void apply(() => rpc.call("set", { id, value }), "Saved"),
    [apply, rpc],
  );
  const onSaveShortlist = useCallback(
    (selected: string[], universe: string[]) =>
      void apply(() => rpc.call("setShortlist", { selected, universe }), "Shortlist saved"),
    [apply, rpc],
  );

  if (catalog === null) return <p className="text-sm text-muted-foreground">Loading impulso settings…</p>;
  if (catalog.error) return <p className="text-sm text-destructive">{catalog.error}</p>;

  const q = query.trim().toLowerCase();
  const rows = catalog.rows.filter((r) =>
    q ? (r.label + " " + r.group + " " + r.description + " " + r.id).toLowerCase().includes(q) : r.tab === tab,
  );
  const groups: [string, Row[]][] = [];
  for (const r of rows) {
    const key = q ? (catalog.tabs.find((t) => t.id === r.tab)?.label ?? r.tab) + " › " + r.group : r.group;
    const g = groups.find(([k]) => k === key);
    if (g) g[1].push(r);
    else groups.push([key, [r]]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1">
        {catalog.tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setQuery("");
            }}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs",
              !q && t.id === tab ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t.label}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          aria-label="Search settings"
          className="ml-auto h-7 w-40 rounded-md border border-input bg-transparent px-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      {groups.length === 0 ? <p className="text-sm text-muted-foreground">No matching settings.</p> : null}
      {groups.map(([name, list]) => (
        <section key={name} className="flex flex-col">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{name}</h3>
          {list.map((row) => (
            <FeatureRow
              key={row.id}
              row={row}
              models={models}
              busy={busy}
              onSet={onSet}
              onSaveShortlist={onSaveShortlist}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "impulso",
    title: "Impulso settings",
    description: "impulso-pi features and pi settings, from the installed catalog. Changes apply to new pi sessions.",
    component: ImpulsoSettings,
  });
});
