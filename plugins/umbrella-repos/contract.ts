// Shared schemas plus the host contract: imported by server.ts (client),
// host.ts (implementation) and, through rpc.ts, by app.tsx (types only).
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** Upper bounds so one huge repo cannot flood the UI or the RPC channel. */
export const MAX_FILES = 500;
export const MAX_PATCH_BYTES = 1024 * 1024;

export const diffTargetSchema = z.enum(["uncommitted", "branch"]);
export type DiffTarget = z.infer<typeof diffTargetSchema>;

/** A repo-relative path: no absolute paths, no `..` segments. */
const relPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.startsWith("/") && !value.split(/[\\/]/u).includes(".."), "Must be a relative path inside the root");

export const repoStatusSchema = z
  .object({
    /** Path of the repo relative to the umbrella root, e.g. `impulso-pi`. */
    relPath: z.string(),
    name: z.string(),
    /** Current branch; null when HEAD is detached. */
    branch: z.string().nullable(),
    headSha: z.string().nullable(),
    upstream: z.string().nullable(),
    ahead: z.number().int().nullable(),
    behind: z.number().int().nullable(),
    /** Default remote branch (origin/HEAD), e.g. `origin/main`. */
    baseBranch: z.string().nullable(),
    /** Commits on HEAD that are not on baseBranch. */
    aheadOfBase: z.number().int().nullable(),
    remoteUrl: z.string().nullable(),
    staged: z.number().int(),
    unstaged: z.number().int(),
    untracked: z.number().int(),
    conflicted: z.number().int(),
    error: z.string().nullable(),
  })
  .strict();
export type RepoStatus = z.infer<typeof repoStatusSchema>;

export const fileStatusSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "typechange",
  "untracked",
  "conflicted",
]);
export type FileStatus = z.infer<typeof fileStatusSchema>;

export const fileChangeSchema = z
  .object({
    path: z.string(),
    previousPath: z.string().nullable(),
    status: fileStatusSchema,
    additions: z.number().int().nullable(),
    deletions: z.number().int().nullable(),
    binary: z.boolean(),
  })
  .strict();
export type FileChange = z.infer<typeof fileChangeSchema>;

export const pullRequestSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("available"),
      number: z.number().int(),
      title: z.string(),
      url: z.string(),
      state: z.enum(["OPEN", "CLOSED", "MERGED"]),
      isDraft: z.boolean(),
      reviewDecision: z.string().nullable(),
      mergeable: z.string().nullable(),
      checks: z
        .object({
          passed: z.number().int(),
          failed: z.number().int(),
          pending: z.number().int(),
        })
        .strict(),
    })
    .strict(),
  z.object({ outcome: z.literal("absent") }).strict(),
  z.object({ outcome: z.literal("unavailable"), message: z.string() }).strict(),
]);
export type PullRequest = z.infer<typeof pullRequestSchema>;

const failed = z.object({ status: z.literal("failed"), message: z.string().min(1) }).strict();

const rootInput = { root: z.string().min(1) };
const repoInput = { ...rootInput, relPath: relPathSchema };

export const scanOptionsSchema = z
  .object({
    maxDepth: z.number().int().min(1).max(5),
    excludeDirs: z.array(z.string().min(1)).max(100),
  })
  .strict();

export const hostContract = defineRpcContract({
  /** Cheap: only walks directories looking for `.git`. */
  discover: {
    input: z.object({ ...rootInput, options: scanOptionsSchema }).strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("ok"), relPaths: z.array(z.string()) }).strict(),
      failed,
    ]),
  },
  /** Discovery plus `git status` for every repo found. */
  scan: {
    input: z.object({ ...rootInput, options: scanOptionsSchema }).strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("ok"), repos: z.array(repoStatusSchema) }).strict(),
      failed,
    ]),
  },
  files: {
    input: z.object({ ...repoInput, target: diffTargetSchema }).strict(),
    output: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("ok"),
          /** What the diff compares against, for display (e.g. `HEAD`, `origin/main`). */
          baseLabel: z.string(),
          files: z.array(fileChangeSchema),
          totalCount: z.number().int(),
        })
        .strict(),
      failed,
    ]),
  },
  patch: {
    input: z
      .object({
        ...repoInput,
        target: diffTargetSchema,
        path: relPathSchema,
        previousPath: relPathSchema.nullable(),
        untracked: z.boolean(),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("ok"), patch: z.string(), truncated: z.boolean() }).strict(),
      failed,
    ]),
  },
  pullRequest: {
    input: z.object(repoInput).strict(),
    output: pullRequestSchema,
  },
});
