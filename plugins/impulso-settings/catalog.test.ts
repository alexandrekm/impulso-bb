import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCatalog,
  checkValue,
  controlFor,
  expandHome,
  findFeature,
  parseModelList,
  shortlistValue,
  type CatalogFeature,
  type CatalogModule,
  type ShortlistModule,
} from "./catalog.ts";

const F = (id: string, tab: string, extra: Partial<CatalogFeature> = {}): CatalogFeature => ({
  id,
  tab,
  group: "g",
  label: id,
  description: "",
  kind: "local",
  ...extra,
});

function fakeModule(): CatalogModule & { writes: [string, string][] } {
  const features = [
    F("guard", "tools"),
    F("cache", "providers", { kind: "config" }),
    F("memory-model", "models", { kind: "pi-setting", picker: true, blankLabel: "same as main thread" }),
    F("shortlist", "models", { kind: "pi-setting", picker: true, modelList: true }),
  ];
  const writes: [string, string][] = [];
  return {
    writes,
    TABS: [
      { id: "models", label: "Models" },
      { id: "tools", label: "Tools" },
      { id: "providers", label: "Providers" },
      { id: "empty", label: "Empty" },
    ],
    featuresForTab: (tab) => features.filter((f) => f.tab === tab),
    featureValues: (f) => (f.id === "cache" ? ["auto", "short", "long"] : ["on", "off"]),
    getFeatureState: (f) => (f.id === "cache" ? "auto" : f.id === "memory-model" ? "" : "on"),
    setFeatureState: (f, v) => void writes.push([f.id, v]),
    featureWarning: (f) => (f.id === "guard" ? "careful" : undefined),
    getShortlist: () => ["anthropic/a:high", "glob/*"],
  };
}

describe("controlFor", () => {
  it("maps picker, list, toggle and enum rows", () => {
    assert.equal(controlFor(F("x", "t", { picker: true, modelList: true }), []), "models");
    assert.equal(controlFor(F("x", "t", { picker: true }), []), "model");
    assert.equal(controlFor(F("x", "t"), ["on", "off"]), "toggle");
    assert.equal(controlFor(F("x", "t"), ["", "a"]), "select");
  });
});

describe("buildCatalog", () => {
  it("builds rows per tab and drops empty tabs", () => {
    const c = buildCatalog(fakeModule());
    assert.deepEqual(c.tabs.map((t) => t.id), ["models", "tools", "providers"]);
    const byId = Object.fromEntries(c.rows.map((r) => [r.id, r]));
    assert.equal(byId.guard!.control, "toggle");
    assert.equal(byId.guard!.warning, "careful");
    assert.deepEqual(byId.cache!.options, ["auto", "short", "long"]);
    assert.equal(byId["memory-model"]!.blankLabel, "same as main thread");
    assert.deepEqual(byId.shortlist!.shortlist, ["anthropic/a:high", "glob/*"]);
    assert.equal(byId.guard!.blankLabel, "same as main");
  });
  it("finds features across tabs", () => {
    assert.equal(findFeature(fakeModule(), "cache")?.tab, "providers");
    assert.equal(findFeature(fakeModule(), "nope"), undefined);
  });
});

describe("checkValue", () => {
  const c = buildCatalog(fakeModule());
  const row = (id: string) => c.rows.find((r) => r.id === id)!;
  it("accepts valid values and rejects others", () => {
    assert.equal(checkValue(row("guard"), "off"), null);
    assert.ok(checkValue(row("guard"), "maybe"));
    assert.equal(checkValue(row("cache"), "long"), null);
    assert.ok(checkValue(row("cache"), "forever"));
    assert.equal(checkValue(row("memory-model"), ""), null);
    assert.equal(checkValue(row("memory-model"), "anthropic/claude-haiku-5-5"), null);
    assert.ok(checkValue(row("memory-model"), "haiku"));
    assert.ok(checkValue(row("shortlist"), "[]"));
  });
});

describe("parseModelList", () => {
  it("skips the header and the measure provider, dedupes", () => {
    const out = [
      "provider   model    context",
      "anthropic  claude-a 1M",
      "measure    measure-model 200K",
      "tiers      smallModel 200K",
      "anthropic  claude-a 1M",
      "",
    ].join("\n");
    assert.deepEqual(parseModelList(out), ["anthropic/claude-a", "tiers/smallModel"]);
  });
});

describe("shortlistValue", () => {
  const sl: ShortlistModule = {
    selectedFromShortlist: () => [],
    mergeShortlist: (existing, selected) => [...existing.filter((e) => e.startsWith("glob")), ...selected],
  };
  it("serializes the merged list, or blank when empty", () => {
    assert.equal(shortlistValue(sl, ["glob/*"], ["a/b"], []), JSON.stringify(["glob/*", "a/b"]));
    assert.equal(shortlistValue(sl, [], [], []), "");
  });
});

describe("expandHome", () => {
  it("expands ~ and ~/", () => {
    assert.equal(expandHome("~", "/h"), "/h");
    assert.equal(expandHome("~/x", "/h"), "/h/x");
    assert.equal(expandHome("/abs", "/h"), "/abs");
  });
});
