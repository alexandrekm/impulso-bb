// Shared host contract: imported by server.ts (client) and host.ts (implementation).
import { defineRpcContract, type ExperimentalHostSignals } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** Upper bound for one script body stored per project. */
export const MAX_SCRIPT_LENGTH = 64 * 1024;

export const hookScriptsSchema = z
  .object({
    preCreate: z.string().max(MAX_SCRIPT_LENGTH),
    postCreate: z.string().max(MAX_SCRIPT_LENGTH),
  })
  .strict();
export type HookScripts = z.infer<typeof hookScriptsSchema>;

const failed = z.object({ status: z.literal("failed"), message: z.string().min(1) }).strict();

export const hostContract = defineRpcContract({
  create: {
    input: z
      .object({
        operationId: z.string().min(1),
        sourcePath: z.string().min(1),
        pathKey: z.string().min(1),
        branchName: z.string().min(1),
        /** "reset" = new thread (git worktree add -B); "reuse" = restore an existing branch. */
        branchMode: z.enum(["reset", "reuse"]),
        scripts: hookScriptsSchema,
        /** Extra BB_* variables exported to both scripts. */
        env: z.record(z.string(), z.string()),
        scriptTimeoutMs: z.number().int().positive(),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("created"),
          path: z.string().min(1),
          baseBranch: z.string().min(1).nullable(),
        })
        .strict(),
      failed,
    ]),
  },
  remove: {
    input: z
      .object({
        operationId: z.string().min(1),
        sourcePath: z.string().min(1).nullable(),
        pathKey: z.string().min(1),
        path: z.string().min(1).nullable(),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("removed") }).strict(),
      failed,
    ]),
  },
});

export const hostSignals = {
  progress: {
    payload: z
      .object({
        operationId: z.string().min(1),
        kind: z.enum(["step", "log"]),
        text: z.string(),
      })
      .strict(),
  },
} satisfies ExperimentalHostSignals;
