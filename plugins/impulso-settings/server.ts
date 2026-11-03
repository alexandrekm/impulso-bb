// bb-plugin-impulso-settings — backend entry.
//
// The settings page for impulso-pi, rendered in bb. impulso-pi owns the
// catalog: extensions/impulso-settings/features.ts declares every feature and
// reads/writes its state. This plugin imports the INSTALLED copy of that file
// (~/.pi/agent by default) at runtime and only renders it, so there is one
// source of truth. Changes apply to new pi sessions.
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  buildCatalog,
  checkValue,
  expandHome,
  findFeature,
  parseModelList,
  shortlistValue,
  toRow,
  type Catalog,
  type CatalogModule,
  type ShortlistModule,
} from "./catalog";

const rowSchema = z.object({
  id: z.string(),
  tab: z.string(),
  group: z.string(),
  label: z.string(),
  description: z.string(),
  control: z.enum(["toggle", "select", "model", "models"]),
  options: z.array(z.string()),
  blankLabel: z.string(),
  value: z.string(),
  warning: z.string().nullable(),
  shortlist: z.array(z.string()),
});
const catalogSchema = z.object({
  tabs: z.array(z.object({ id: z.string(), label: z.string() })),
  rows: z.array(rowSchema),
  error: z.string().nullable(),
});

export const rpcContract = defineRpcContract({
  catalog: { input: z.null(), output: catalogSchema },
  set: { input: z.object({ id: z.string().min(1), value: z.string().max(500) }).strict(), output: catalogSchema },
  setShortlist: {
    input: z.object({ selected: z.array(z.string().min(1)).max(200), universe: z.array(z.string()).max(2000) }).strict(),
    output: catalogSchema,
  },
  models: { input: z.null(), output: z.object({ models: z.array(z.string()), error: z.string().nullable() }) },
});

const MODELS_TTL_MS = 10 * 60_000;

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    catalogDir: {
      type: "string",
      label: "Catalog directory",
      description: "Installed impulso-settings extension folder holding features.ts.",
      experimental_schema: z.string().min(1).max(500),
      default: "~/.pi/agent/extensions/impulso-settings",
    },
    piCommand: {
      type: "string",
      label: "pi command",
      description: "Used to list available models (pi --list-models). Blank = ~/.pi/agent/bin/pi, then pi on PATH.",
      experimental_schema: z.string().max(500),
      default: "",
    },
  });

  // Import the installed catalog; the mtime query re-imports after install.sh updates it.
  async function loadModules(): Promise<{ mod: CatalogModule; sl: ShortlistModule }> {
    const dir = expandHome((await settings.get()).catalogDir, homedir());
    const load = async (file: string) => {
      const path = join(dir, file);
      const { mtimeMs } = await stat(path);
      return import(pathToFileURL(path).href + "?v=" + Math.floor(mtimeMs));
    };
    const [mod, sl] = await Promise.all([load("features.ts"), load("model-settings.ts")]);
    return { mod: mod as CatalogModule, sl: sl as ShortlistModule };
  }

  async function catalog(): Promise<Catalog> {
    try {
      return buildCatalog((await loadModules()).mod);
    } catch (cause) {
      return { tabs: [], rows: [], error: "Could not load the impulso-pi catalog: " + errorText(cause) };
    }
  }

  let modelCache: { at: number; models: string[] } | null = null;
  function run(cmd: string): Promise<string> {
    return new Promise((resolve, reject) =>
      execFile(cmd, ["--list-models"], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) =>
        err ? reject(err) : resolve(stdout),
      ),
    );
  }
  async function listModels(): Promise<string[]> {
    if (modelCache && Date.now() - modelCache.at < MODELS_TTL_MS) return modelCache.models;
    const configured = (await settings.get()).piCommand.trim();
    const candidates = configured ? [expandHome(configured, homedir())] : [join(homedir(), ".pi/agent/bin/pi"), "pi"];
    let last: unknown;
    for (const cmd of candidates) {
      try {
        const models = parseModelList(await run(cmd));
        modelCache = { at: Date.now(), models };
        return models;
      } catch (cause) {
        last = cause;
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  bb.rpc.register(rpcContract, {
    catalog: () => catalog(),
    async set({ id, value }) {
      const { mod } = await loadModules();
      const f = findFeature(mod, id);
      if (!f) throw new Error("Unknown feature: " + id);
      const problem = checkValue(toRow(mod, f), value);
      if (problem) throw new Error(id + ": " + problem);
      mod.setFeatureState(f, value);
      bb.log.info("Set " + id + " = " + (value || "(default)"));
      return buildCatalog(mod);
    },
    async setShortlist({ selected, universe }) {
      const { mod, sl } = await loadModules();
      const f = findFeature(mod, "enabled-models");
      if (!f) throw new Error("The catalog has no enabled-models feature");
      mod.setFeatureState(f, shortlistValue(sl, mod.getShortlist(), selected, universe));
      bb.log.info("Saved model shortlist (" + selected.length + " selected)");
      return buildCatalog(mod);
    },
    async models() {
      try {
        return { models: await listModels(), error: null };
      } catch (cause) {
        return { models: [], error: errorText(cause) };
      }
    },
  });
}
