import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultTitle, isTier, parseTierModel } from "./tiers.ts";

describe("parseTierModel", () => {
  it("returns empty for blank", () => {
    assert.deepEqual(parseTierModel(""), {});
    assert.deepEqual(parseTierModel("  "), {});
    assert.deepEqual(parseTierModel(undefined), {});
  });
  it("splits on the first slash", () => {
    assert.deepEqual(parseTierModel("pi/anthropic/claude-haiku-5-5"), {
      providerId: "pi",
      model: "anthropic/claude-haiku-5-5",
    });
  });
  it("treats a slashless value as a model", () => {
    assert.deepEqual(parseTierModel("claude-haiku-5-5"), { model: "claude-haiku-5-5" });
  });
});

describe("isTier", () => {
  it("accepts known tiers only", () => {
    assert.equal(isTier("small"), true);
    assert.equal(isTier("huge"), false);
  });
});

describe("defaultTitle", () => {
  it("uses the first line and truncates", () => {
    assert.equal(defaultTitle("fix bug\nmore"), "Delegate: fix bug");
    assert.ok(defaultTitle("x".repeat(200)).length <= "Delegate: ".length + 60);
  });
});
