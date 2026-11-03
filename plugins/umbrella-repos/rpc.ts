// App <-> server RPC contract. Imported at runtime by app.tsx, so keep it to
// zod schemas only (no server or node imports).
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { diffTargetSchema, fileChangeSchema, pullRequestSchema, repoStatusSchema } from "./contract";

const environmentInput = { environmentId: z.string().min(1).max(200) };
const repoInput = { ...environmentInput, relPath: z.string().min(1).max(4096) };
const unavailable = z.object({ status: z.literal("unavailable"), message: z.string() }).strict();

export const rpcContract = defineRpcContract({
  /** Cheap check used to decide whether the Repos tab is shown at all. */
  detect: {
    input: z.object(environmentInput).strict(),
    output: z.object({ repoCount: z.number().int() }).strict(),
  },
  overview: {
    input: z.object(environmentInput).strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("ok"), root: z.string(), repos: z.array(repoStatusSchema) }).strict(),
      unavailable,
    ]),
  },
  files: {
    input: z.object({ ...repoInput, target: diffTargetSchema }).strict(),
    output: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("ok"),
          baseLabel: z.string(),
          files: z.array(fileChangeSchema),
          totalCount: z.number().int(),
        })
        .strict(),
      unavailable,
    ]),
  },
  patch: {
    input: z
      .object({
        ...repoInput,
        target: diffTargetSchema,
        path: z.string().min(1).max(4096),
        previousPath: z.string().min(1).max(4096).nullable(),
        untracked: z.boolean(),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("ok"), patch: z.string(), truncated: z.boolean() }).strict(),
      unavailable,
    ]),
  },
  pullRequests: {
    input: z.object({ ...environmentInput, force: z.boolean().optional() }).strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("ok"), rows: z.record(z.string(), pullRequestSchema) }).strict(),
      unavailable,
    ]),
  },
});
export type RpcContract = typeof rpcContract;
