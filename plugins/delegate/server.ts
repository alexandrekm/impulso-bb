// bb-plugin-delegate — backend entry.
//
// Replaces pi's subagent-routing extension with bb-native child threads. A
// delegated task becomes a real, visible bb thread (parented to the caller,
// on the same environment) whose output the user can open and read, instead of
// a hidden in-process worker whose result bb cannot render.
//
// Surfaces:
//   - CLI         `bb delegate spawn` — run via bash, only when a prompt or the user asks.
//     No agent tool and no skill on purpose: both sit in every request's context.
//   - settings    three tiers (small/medium/big) -> "provider/model"
import { PluginCliError, cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { execFile } from "node:child_process";
import { findJiraKey, loadPromptTask, splitList } from "./prompts.ts";
import { TIERS, defaultTitle, isTier, parseTierModel, type Tier } from "./tiers.ts";

const WAIT_MAX_MINUTES = 120;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    smallModel: {
      type: "string",
      label: "Small tier model",
      description: 'provider/model for cheap, mechanical tasks (e.g. "pi/anthropic/claude-haiku-5-5"). Blank = project default.',
      experimental_schema: z.string().max(200),
      default: "",
    },
    mediumModel: {
      type: "string",
      label: "Medium tier model",
      description: "provider/model for general delegated tasks. Blank = project default.",
      experimental_schema: z.string().max(200),
      default: "",
    },
    bigModel: {
      type: "string",
      label: "Big tier model",
      description: "provider/model for hard delegated tasks. Blank = project default.",
      experimental_schema: z.string().max(200),
      default: "",
    },
    promptsDir: {
      type: "string",
      label: "Prompts directory",
      description: "Folder of <name>.md prompt templates for `bb delegate prompt` (on the server machine).",
      experimental_schema: z.string().max(300),
      default: "~/.pi/agent/prompts",
    },
    smallPrompts: {
      type: "string",
      label: "Prompts that run on the small tier",
      description: "Comma-separated prompt names (others use the default tier).",
      experimental_schema: z.string().max(300),
      default: "create-pr,create-pr-personal",
    },
    jiraPrompts: {
      type: "string",
      label: "Prompts that require a Jira key",
      description: "Comma-separated prompt names that refuse to run without a key like ABC-123 in the args.",
      experimental_schema: z.string().max(300),
      default: "create-pr",
    },
    defaultTier: {
      type: "string",
      label: "Default tier",
      description: "Tier used when none is given: small, medium or big.",
      experimental_schema: z.enum(TIERS),
      default: "medium",
    },
  });

  interface Request {
    task: string;
    tier?: Tier;
    title?: string;
    wait?: boolean;
    split?: string;
    reasoningLevel?: string;
    parentThreadId: string;
    projectId: string;
    signal?: AbortSignal;
  }

  async function delegate(req: Request) {
    const s = await settings.get();
    const tier: Tier = req.tier ?? (isTier(s.defaultTier) ? s.defaultTier : "medium");
    const { providerId, model } = parseTierModel(
      tier === "small" ? s.smallModel : tier === "big" ? s.bigModel : s.mediumModel,
    );

    // Same workspace as the caller, so the child sees the same checkout.
    const parent = await bb.sdk.threads.get({ threadId: req.parentThreadId });
    const child = await bb.sdk.threads.spawn({
      projectId: req.projectId,
      environment: parent.environmentId
        ? { type: "reuse", environmentId: parent.environmentId }
        : { type: "project-default" },
      parentThreadId: req.parentThreadId,
      prompt: req.task,
      title: req.title?.trim() || defaultTitle(req.task),
      ...(providerId ? { providerId } : {}),
      ...(model ? { model } : {}),
      ...(req.reasoningLevel ? { reasoningLevel: req.reasoningLevel } : {}),
      pluginMetadata: { tier, delegatedFrom: req.parentThreadId },
    });
    if (req.split) {
      execFile("bb", ["thread", "open", child.id, "--split", req.split], (err) => {
        if (err) bb.log.warn(`split open failed: ${err.message}`);
      });
    }
    bb.log.info(`Delegated ${child.id} (tier=${tier}, model=${providerId ?? "-"}/${model ?? "-"})`);

    if (!req.wait) {
      return {
        threadId: child.id,
        tier,
        text:
          `Delegated to thread ${child.id} (tier ${tier}). The user can open it from the sidebar; ` +
          "it reports back to this thread when it finishes. Do not duplicate its work.",
      };
    }
    await bb.sdk.threads.wait({
      threadId: child.id,
      status: "idle",
      timeoutMs: WAIT_MAX_MINUTES * 60_000,
      ...(req.signal ? { signal: req.signal } : {}),
    });
    const out = await bb.sdk.threads.output({ threadId: child.id, ...(req.signal ? { signal: req.signal } : {}) });
    return {
      threadId: child.id,
      tier,
      text: `Thread ${child.id} finished (tier ${tier}). Its last message:\n\n${typeof out.output === "string" ? out.output : JSON.stringify(out)}`,
    };
  }

  bb.cli.register(
    defineCli({
      name: "delegate",
      summary: "Delegate a task to a visible child thread on a model tier",
      commands: {
        spawn: cliCommand({
          summary: "Spawn a child thread of the current thread",
          positionals: [{ name: "task", description: "Complete, self-contained task prompt", required: true }],
          options: {
            tier: { type: "enum", values: TIERS, description: "small, medium or big (default from plugin settings)" },
            title: { type: "string", description: "Child thread title" },
            wait: { type: "boolean", description: "Block until the child is idle and print its last message" },
          },
          async run(input, ctx) {
            if (!ctx.threadId || !ctx.projectId) {
              throw new PluginCliError("Run this inside a bb thread.", {
                code: "no_thread",
                hint: "Call it from an agent session so BB can attach the child to the current thread.",
              });
            }
            const r = await delegate({
              task: input.positionals.task,
              tier: input.options.tier,
              title: input.options.title,
              wait: input.options.wait === true,
              parentThreadId: ctx.threadId,
              projectId: ctx.projectId,
              signal: ctx.signal,
            });
            return { exitCode: 0, stdout: r.text };
          },
        }),
        prompt: cliCommand({
          summary: "Run a prompt template (e.g. create-pr) in a child thread on its tier",
          positionals: [
            { name: "name", description: "Prompt name, e.g. create-pr", required: true },
            { name: "args", description: "Arguments appended as additional instructions", variadic: true },
          ],
          options: {
            tier: { type: "enum", values: TIERS, description: "Override the tier" },
            split: { type: "enum", values: ["right", "down", "left", "top", "replace"], description: "Open the child thread in a split pane" },
            wait: { type: "boolean", description: "Block until the child is idle and print its last message" },
          },
          async run(input, ctx) {
            if (!ctx.threadId || !ctx.projectId) {
              throw new PluginCliError("Run this inside a bb thread.", { code: "no_thread" });
            }
            const name = input.positionals.name;
            const args = [input.positionals.args ?? []].flat().join(" ");
            const s = await settings.get();
            if (splitList(s.jiraPrompts).includes(name) && !findJiraKey(args)) {
              throw new PluginCliError(`/${name} needs a Jira key.`, {
                code: "jira_key_required",
                hint: `Rerun with a key: bb delegate prompt ${name} ABC-123`,
              });
            }
            let task: string;
            try {
              task = loadPromptTask(s.promptsDir, name, args);
            } catch (e) {
              throw new PluginCliError(e instanceof Error ? e.message : String(e), { code: "prompt_not_found" });
            }
            const tier = input.options.tier ?? (splitList(s.smallPrompts).includes(name) ? "small" : undefined);
            const r = await delegate({
              task,
              tier,
              title: `/${name} ${args}`.trim(),
              wait: input.options.wait === true,
              split: input.options.split,
              parentThreadId: ctx.threadId,
              projectId: ctx.projectId,
              signal: ctx.signal,
            });
            return { exitCode: 0, stdout: r.text };
          },
        }),
      },
    }),
  );
}