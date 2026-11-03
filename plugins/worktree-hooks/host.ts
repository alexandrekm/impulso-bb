// Host entry: runs on the machine that owns the project checkout.
// Creates/removes git worktrees and runs the per-project hook scripts.
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  experimental_defineHostEntry,
  experimental_killProcessesWithCwdUnder,
  type ExperimentalHostRpcContext,
} from "@get-bb/plugin-sdk/host";
import { hostContract, hostSignals } from "./contract.js";

type Ctx = ExperimentalHostRpcContext<typeof hostSignals>;

const PATH_KEY = /^[A-Za-z0-9._-]+$/u;
const COMPLETED_MARKER = ".worktree-hooks-completed";
const OUTPUT_TAIL_BYTES = 4000;

function worktreeRoot(dataDir: string, pathKey: string): string {
  if (!PATH_KEY.test(pathKey) || pathKey === "." || pathKey === "..") {
    throw new Error("A worktree path key must be a single path segment");
  }
  return path.join(dataDir, "worktrees", pathKey);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Batches child output into progress signals so the launch report streams. */
function outputStreamer(ctx: Ctx, operationId: string) {
  let buffer = "";
  let timer: NodeJS.Timeout | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const text = buffer.replace(/\n$/u, "");
    buffer = "";
    if (text.length > 0) {
      void ctx.experimental_emitSignal("progress", { operationId, kind: "log", text }).catch(() => {});
    }
  };
  return {
    write(chunk: string) {
      buffer += chunk;
      if (buffer.length > 16_000) flush();
      else timer ??= setTimeout(flush, 200);
    },
    flush,
  };
}

interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  output: string;
}

/** Spawns a process in its own group so abort/timeout kills the whole tree. */
function run(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    signal: AbortSignal;
    timeoutMs?: number;
    onOutput?: (chunk: string) => void;
  },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) return reject(options.signal.reason);
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let output = "";
    let timedOut = false;
    const onData = (data: Buffer) => {
      const text = data.toString("utf8");
      output = (output + text).slice(-OUTPUT_TAIL_BYTES);
      options.onOutput?.(text);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const killGroup = () => {
      if (child.pid === undefined || child.exitCode !== null) return;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
      setTimeout(() => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        } catch {}
      }, 5000).unref();
    };
    const onAbort = () => killGroup();
    options.signal.addEventListener("abort", onAbort, { once: true });
    const timer =
      options.timeoutMs === undefined
        ? null
        : setTimeout(() => {
            timedOut = true;
            killGroup();
          }, options.timeoutMs);
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
      if (options.signal.aborted) return reject(options.signal.reason);
      resolve({ code, signal, timedOut, output });
    });
  });
}

async function git(cwd: string, args: string[], signal: AbortSignal): Promise<string> {
  const result = await run("git", args, { cwd, signal, timeoutMs: 10 * 60_000 });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.output.trim() || `exit ${result.code}`}`);
  }
  return result.output.trim();
}

async function tryGit(cwd: string, args: string[], signal: AbortSignal): Promise<string | null> {
  try {
    return await git(cwd, args, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}

/** origin/HEAD's target when known, else the checkout's current branch. */
async function defaultBaseBranch(sourcePath: string, signal: AbortSignal): Promise<string | null> {
  const remoteHead = await tryGit(sourcePath, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], signal);
  if (remoteHead) return remoteHead;
  const current = await tryGit(sourcePath, ["rev-parse", "--abbrev-ref", "HEAD"], signal);
  return current && current !== "HEAD" ? current : null;
}

/** Runs one hook script with bash -e (or its own shebang). Throws on failure. */
async function runHook(
  ctx: Ctx,
  args: {
    operationId: string;
    label: string;
    script: string;
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
  },
): Promise<void> {
  if (args.script.trim().length === 0) return;
  const step = (text: string) =>
    void ctx.experimental_emitSignal("progress", { operationId: args.operationId, kind: "step", text }).catch(() => {});
  step(`Running ${args.label} script`);
  const file = path.join(ctx.experimental_paths.tempDir, `${args.operationId.replace(/[^A-Za-z0-9_-]/gu, "_")}-${args.label}.sh`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, args.script.endsWith("\n") ? args.script : `${args.script}\n`, { mode: 0o700 });
  const hasShebang = args.script.startsWith("#!");
  const streamer = outputStreamer(ctx, args.operationId);
  try {
    const result = await run(hasShebang ? file : "/bin/bash", hasShebang ? [] : ["-e", file], {
      cwd: args.cwd,
      env: { ...process.env, ...args.env },
      signal: ctx.signal,
      timeoutMs: args.timeoutMs,
      onOutput: streamer.write,
    });
    streamer.flush();
    if (result.timedOut) {
      throw new Error(`The ${args.label} script timed out after ${Math.round(args.timeoutMs / 1000)}s`);
    }
    if (result.code !== 0) {
      const tail = result.output.trim().split("\n").slice(-15).join("\n");
      const why = result.signal ? `signal ${result.signal}` : `exit code ${result.code}`;
      throw new Error(`The ${args.label} script failed (${why})${tail ? `:\n${tail}` : ""}`);
    }
  } finally {
    streamer.flush();
    await fs.rm(file, { force: true });
  }
}

/** Copies gitignored files that match .worktreeinclude (same idea as bb's Worktree provider). */
async function copyWorktreeInclude(sourcePath: string, worktreePath: string, signal: AbortSignal): Promise<number> {
  const includeFile = path.join(sourcePath, ".worktreeinclude");
  if (!(await exists(includeFile))) return 0;
  const listed = (args: string[]) =>
    tryGit(sourcePath, ["ls-files", "--others", "--ignored", "--directory", "-z", ...args], signal).then(
      (out) => new Set((out ?? "").split("\0").filter(Boolean)),
    );
  const [ignored, included] = await Promise.all([
    listed(["--exclude-standard"]),
    listed([`--exclude-from=${includeFile}`]),
  ]);
  let copied = 0;
  for (const rel of included) {
    if (!ignored.has(rel)) continue;
    const from = path.join(sourcePath, rel);
    const to = path.join(worktreePath, rel);
    if (await exists(to)) continue;
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.cp(from, to, { recursive: true, errorOnExist: false, force: false });
    copied += 1;
  }
  return copied;
}

async function removeWorktree(
  ctx: Ctx,
  args: { sourcePath: string | null; root: string; worktreePath: string | null },
): Promise<void> {
  await experimental_killProcessesWithCwdUnder({ directories: [args.root] }).catch(() => []);
  if (args.sourcePath && args.worktreePath && (await exists(args.sourcePath))) {
    await tryGit(args.sourcePath, ["worktree", "remove", "--force", args.worktreePath], ctx.signal);
  }
  await fs.rm(args.root, { recursive: true, force: true });
  if (args.sourcePath && (await exists(args.sourcePath))) {
    await tryGit(args.sourcePath, ["worktree", "prune"], ctx.signal);
  }
}

export default experimental_defineHostEntry({
  contract: hostContract,
  experimental_signals: hostSignals,
  handlers: {
    async create(input, ctx) {
      const step = (text: string) =>
        void ctx.experimental_emitSignal("progress", { operationId: input.operationId, kind: "step", text }).catch(() => {});
      const root = worktreeRoot(ctx.experimental_paths.dataDir, input.pathKey);
      const worktreePath = path.join(root, path.basename(input.sourcePath));
      const marker = path.join(root, COMPLETED_MARKER);

      // Idempotent on retries after a restart: a finished attempt is reused as is.
      if ((await exists(marker)) && (await exists(worktreePath))) {
        const baseBranch = (await fs.readFile(marker, "utf8")).trim() || null;
        return { status: "created" as const, path: worktreePath, baseBranch };
      }
      if (await exists(root)) {
        step("Cleaning up a previous incomplete attempt");
        await removeWorktree(ctx, { sourcePath: input.sourcePath, root, worktreePath });
      }

      const env: Record<string, string> = {
        ...input.env,
        BB_SOURCE_PATH: input.sourcePath,
        BB_WORKTREE_PATH: worktreePath,
        BB_BRANCH: input.branchName,
      };
      let worktreeAdded = false;
      try {
        // 1. Before the worktree exists: runs in the project checkout.
        await runHook(ctx, {
          operationId: input.operationId,
          label: "pre-create",
          script: input.scripts.preCreate,
          cwd: input.sourcePath,
          env: { ...env, BB_HOOK_PHASE: "pre-create" },
          timeoutMs: input.scriptTimeoutMs,
        });

        // 2. Create the worktree (base resolved after pre-create so a fetch there counts).
        const baseBranch = await defaultBaseBranch(input.sourcePath, ctx.signal);
        step(`Creating worktree on ${input.branchName}${baseBranch ? ` from ${baseBranch}` : ""}`);
        await fs.mkdir(root, { recursive: true });
        const branchExists =
          (await tryGit(input.sourcePath, ["show-ref", "--verify", "--quiet", `refs/heads/${input.branchName}`], ctx.signal)) !== null;
        const addArgs =
          input.branchMode === "reuse" && branchExists
            ? ["worktree", "add", worktreePath, input.branchName]
            : ["worktree", "add", "-B", input.branchName, worktreePath, ...(baseBranch ? [baseBranch] : [])];
        await git(input.sourcePath, addArgs, ctx.signal);
        worktreeAdded = true;

        const copied = await copyWorktreeInclude(input.sourcePath, worktreePath, ctx.signal);
        if (copied > 0) step(`Copied ${copied} .worktreeinclude entr${copied === 1 ? "y" : "ies"}`);

        // 3. After the worktree exists, before core attaches it and the agent starts.
        await runHook(ctx, {
          operationId: input.operationId,
          label: "post-create",
          script: input.scripts.postCreate,
          cwd: worktreePath,
          env: { ...env, BB_HOOK_PHASE: "post-create", BB_BASE_BRANCH: baseBranch ?? "" },
          timeoutMs: input.scriptTimeoutMs,
        });

        await fs.writeFile(marker, baseBranch ?? "");
        return { status: "created" as const, path: worktreePath, baseBranch };
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        if (worktreeAdded || (await exists(root))) {
          step("Removing the worktree after a failure");
          await removeWorktree(ctx, { sourcePath: input.sourcePath, root, worktreePath }).catch(() => {});
        }
        return { status: "failed" as const, message: errorMessage(error) };
      }
    },

    async remove(input, ctx) {
      try {
        const root = worktreeRoot(ctx.experimental_paths.dataDir, input.pathKey);
        const worktreePath =
          input.path ?? (input.sourcePath ? path.join(root, path.basename(input.sourcePath)) : null);
        await removeWorktree(ctx, { sourcePath: input.sourcePath, root, worktreePath });
        return { status: "removed" as const };
      } catch (error) {
        return { status: "failed" as const, message: errorMessage(error) };
      }
    },
  },
});
