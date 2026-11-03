// bb-plugin-umbrella-repos — backend entry.
//
// For a thread whose workspace is an "umbrella" folder (not itself a git repo,
// but holding several child repos), exposes per-repo git status, changed files,
// patches and GitHub PRs to the app's Repos tab. All git/gh work runs on the
// environment's machine through host.ts.
//
// Deliberately contributes nothing to agent context: no skills, agent tools,
// instructions or CLI commands.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract, type PullRequest } from "./contract";
import { rpcContract } from "./rpc";

const DETECT_TTL_MS = 60_000;
const PR_TTL_MS = 60_000;
const PR_PENDING_TTL_MS = 20_000;
const PR_CONCURRENCY = 4;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class Unavailable extends Error {}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]!);
      }
    }),
  );
  return results;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    maxDepth: {
      type: "number",
      label: "Scan depth",
      description: "How many folder levels below the thread's workspace to search for git repos.",
      experimental_schema: z.number().int().min(1).max(5),
      default: 2,
    },
    excludeDirs: {
      type: "string",
      label: "Skipped folders",
      description: "Comma-separated folder names never scanned (dot-folders are always skipped).",
      default: "node_modules,vendor,dist,build,target,tmp",
    },
  });

  const host = bb.hosts.experimental_client({ contract: hostContract });

  async function scanOptions() {
    const { maxDepth, excludeDirs } = await settings.get();
    return {
      maxDepth,
      excludeDirs: excludeDirs
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .slice(0, 100),
    };
  }

  /** The environment's machine and folder; throws Unavailable when it cannot be read now. */
  async function workspace(environmentId: string) {
    const env = await bb.sdk.environments.get({ environmentId });
    if (env.hostLifecycle !== "active") throw new Unavailable("The environment's machine is " + env.hostLifecycle);
    if (env.status !== "ready") throw new Unavailable("The environment is " + env.status);
    if (!env.path) throw new Unavailable("The environment has no workspace path");
    return { hostId: env.hostId, root: env.path, isGitRepo: env.isGitRepo };
  }

  function unavailable(error: unknown) {
    return { status: "unavailable" as const, message: errorMessage(error) };
  }

  const detectCache = new Map<string, { at: number; repoCount: number }>();
  const prCache = new Map<string, { at: number; value: PullRequest }>();

  bb.rpc.register(rpcContract, {
    async detect({ environmentId }) {
      const cached = detectCache.get(environmentId);
      if (cached && Date.now() - cached.at < DETECT_TTL_MS) return { repoCount: cached.repoCount };
      let repoCount = 0;
      try {
        const ws = await workspace(environmentId);
        // A real repo root is bb's built-in Git plugin's job.
        if (!ws.isGitRepo) {
          const result = await host.call("discover", { root: ws.root, options: await scanOptions() }, { hostId: ws.hostId, timeoutMs: 15_000 });
          repoCount = result.status === "ok" ? result.relPaths.length : 0;
        }
      } catch (error) {
        bb.log.debug("detect " + environmentId + ": " + errorMessage(error));
      }
      detectCache.set(environmentId, { at: Date.now(), repoCount });
      return { repoCount };
    },

    async overview({ environmentId }) {
      try {
        const ws = await workspace(environmentId);
        const result = await host.call("scan", { root: ws.root, options: await scanOptions() }, { hostId: ws.hostId, timeoutMs: 60_000 });
        if (result.status === "failed") return unavailable(result.message);
        detectCache.set(environmentId, { at: Date.now(), repoCount: result.repos.length });
        return { status: "ok" as const, root: ws.root, repos: result.repos };
      } catch (error) {
        return unavailable(error);
      }
    },

    async files({ environmentId, relPath, target }) {
      try {
        const ws = await workspace(environmentId);
        const result = await host.call("files", { root: ws.root, relPath, target }, { hostId: ws.hostId, timeoutMs: 60_000 });
        return result.status === "failed" ? unavailable(result.message) : result;
      } catch (error) {
        return unavailable(error);
      }
    },

    async patch({ environmentId, relPath, target, path, previousPath, untracked }) {
      try {
        const ws = await workspace(environmentId);
        const result = await host.call(
          "patch",
          { root: ws.root, relPath, target, path, previousPath, untracked },
          { hostId: ws.hostId, timeoutMs: 60_000 },
        );
        return result.status === "failed" ? unavailable(result.message) : result;
      } catch (error) {
        return unavailable(error);
      }
    },

    async pullRequests({ environmentId, force }) {
      try {
        const ws = await workspace(environmentId);
        const scan = await host.call("discover", { root: ws.root, options: await scanOptions() }, { hostId: ws.hostId, timeoutMs: 15_000 });
        if (scan.status === "failed") return unavailable(scan.message);
        const entries = await mapLimit(scan.relPaths, PR_CONCURRENCY, async (relPath) => {
          const key = ws.hostId + "\0" + ws.root + "\0" + relPath;
          const cached = prCache.get(key);
          const pending = cached?.value.outcome === "available" && cached.value.state === "OPEN" && cached.value.checks.pending > 0;
          const ttl = pending ? PR_PENDING_TTL_MS : PR_TTL_MS;
          if (!force && cached && Date.now() - cached.at < ttl) return [relPath, cached.value] as const;
          let value: PullRequest;
          try {
            value = await host.call("pullRequest", { root: ws.root, relPath }, { hostId: ws.hostId, timeoutMs: 45_000 });
          } catch (error) {
            value = { outcome: "unavailable", message: errorMessage(error) };
          }
          prCache.set(key, { at: Date.now(), value });
          return [relPath, value] as const;
        });
        return { status: "ok" as const, rows: Object.fromEntries(entries) };
      } catch (error) {
        return unavailable(error);
      }
    },
  });
}
