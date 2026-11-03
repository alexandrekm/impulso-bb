import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTask, expandHome, findJiraKey, isSafePromptName, splitList } from "./prompts.ts";

describe("buildTask", () => {
  it("strips frontmatter and appends args and config dir", () => {
    const t = buildTask("---\ndescription: x\n---\n\n# Body\n", "ABC-1", "/h/.pi/agent");
    assert.ok(t.startsWith("# Body"));
    assert.ok(t.includes("Additional user instructions:\nABC-1"));
    assert.ok(t.includes("/h/.pi/agent"));
  });
  it("omits the args block when empty", () => {
    assert.ok(!buildTask("body", "  ", "/c").includes("Additional user"));
  });
  it("rejects an empty body", () => {
    assert.throws(() => buildTask("---\na: b\n---\n", "", "/c"));
  });
});
describe("helpers", () => {
  it("finds jira keys", () => {
    assert.equal(findJiraKey("do XCXX-12 now"), "XCXX-12");
    assert.equal(findJiraKey("no key"), undefined);
  });
  it("expands home", () => assert.equal(expandHome("~/a", "/h"), "/h/a"));
  it("validates names", () => {
    assert.equal(isSafePromptName("create-pr"), true);
    assert.equal(isSafePromptName("../x"), false);
  });
  it("splits lists", () => assert.deepEqual(splitList("a, b,,c"), ["a", "b", "c"]));
});
