// Host entry: runs on the machine that owns the umbrella folder.
// Discovers child git repos and reads their status, diffs and PRs with git/gh.
// Read-only: never mutates a repo.
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import {
  MAX_FILES,
  MAX_PATCH_BYTES,
  hostContract,
  type DiffTarget,
  type FileChange,
  type FileStatus,
  type PullRequest,
  type RepoStatus,
} from "./contract.js";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const COMMAND_TIMEOUT_MS = 30_000;
const STATUS_CONCURRENCY = 6;

// bb's host process may not inherit a login shell PATH, so try the usual spots.
const BIN_CANDIDATES: Record<string, string[]> = {
  git: ["git", "/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"],
  gh: ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"],
};
const resolvedBins = new Map<string, string>();

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

class MissingBinaryError extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function spawnOnce(
  command: string,
  args: string[],
  options: { cwd: string; signal: AbortSignal; maxBytes: number },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) return reject(options.signal.reason);
    const child = spawn(command, args, {
      cwd: options.cwd,
      // Never prompt (credentials, pagers, editors) from a background read.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GH_PROMPT_DISABLED: "1", NO_COLOR: "1", PAGER: "cat" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    let outBytes = 0;
    let truncated = false;
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (outBytes >= options.maxBytes) {
        truncated = true;
        return;
      }
      const room = options.maxBytes - outBytes;
      if (chunk.length > room) truncated = true;
      const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
      out.push(kept);
      outBytes += kept.length;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4000);
    });
    const kill = () => child.kill("SIGKILL");
    options.signal.addEventListener("abort", kill, { once: true });
    const timer = setTimeout(kill, COMMAND_TIMEOUT_MS);
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", kill);
      reject(error.code === "ENOENT" ? new MissingBinaryError(command) : error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", kill);
      if (options.signal.aborted) return reject(options.signal.reason);
      resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr, truncated });
    });
  });
}

async function run(
  bin: "git" | "gh",
  args: string[],
  options: { cwd: string; signal: AbortSignal; maxBytes?: number },
): Promise<RunResult> {
  const opts = { ...options, maxBytes: options.maxBytes ?? 8 * 1024 * 1024 };
  const known = resolvedBins.get(bin);
  if (known) return spawnOnce(known, args, opts);
  for (const candidate of BIN_CANDIDATES[bin] ?? [bin]) {
    try {
      const result = await spawnOnce(candidate, args, opts);
      resolvedBins.set(bin, candidate);
      return result;
    } catch (error) {
      if (!(error instanceof MissingBinaryError)) throw error;
    }
  }
  throw new MissingBinaryError(bin + " is not installed or not on PATH");
}

/** Runs git and returns trimmed stdout, or null on a non-zero exit. */
async function gitOut(cwd: string, args: string[], signal: AbortSignal): Promise<string | null> {
  const result = await run("git", args, { cwd, signal });
  return result.code === 0 ? result.stdout.trim() : null;
}

/** Resolves a child repo path and refuses anything outside the root. */
async function repoDir(root: string, relPath: string): Promise<string> {
  const base = path.resolve(root);
  const abs = path.resolve(base, relPath);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error("Repo path escapes the umbrella root");
  if (!(await exists(path.join(abs, ".git")))) throw new Error(relPath + " is not a git repository");
  return abs;
}

async function discover(root: string, maxDepth: number, excludeDirs: string[]): Promise<string[]> {
  const base = path.resolve(root);
  const exclude = new Set(excludeDirs);
  const found: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !exclude.has(e.name))
        .map(async (e) => {
          const child = path.join(dir, e.name);
          // A .git dir (clone) or file (worktree/submodule) marks a repo; do not descend into it.
          if (await exists(path.join(child, ".git"))) found.push(path.relative(base, child));
          else if (depth < maxDepth) await walk(child, depth + 1);
        }),
    );
  }
  await walk(base, 1);
  return found.sort((a, b) => a.localeCompare(b));
}

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

async function baseBranch(cwd: string, signal: AbortSignal): Promise<string | null> {
  return gitOut(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], signal);
}

async function repoStatus(root: string, relPath: string, signal: AbortSignal): Promise<RepoStatus> {
  const status: RepoStatus = {
    relPath,
    name: path.basename(relPath),
    branch: null,
    headSha: null,
    upstream: null,
    ahead: null,
    behind: null,
    baseBranch: null,
    aheadOfBase: null,
    remoteUrl: null,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    error: null,
  };
  try {
    const cwd = await repoDir(root, relPath);
    const [porcelain, base, remoteUrl] = await Promise.all([
      run("git", ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], { cwd, signal }),
      baseBranch(cwd, signal),
      gitOut(cwd, ["config", "--get", "remote.origin.url"], signal),
    ]);
    if (porcelain.code !== 0) throw new Error(porcelain.stderr.trim() || "git status failed");
    const records = porcelain.stdout.split("\0");
    for (let i = 0; i < records.length; i++) {
      const rec = records[i]!;
      if (rec.startsWith("# branch.oid ")) {
        const oid = rec.slice(13);
        status.headSha = oid === "(initial)" ? null : oid.slice(0, 12);
      } else if (rec.startsWith("# branch.head ")) {
        const head = rec.slice(14);
        status.branch = head === "(detached)" ? null : head;
      } else if (rec.startsWith("# branch.upstream ")) {
        status.upstream = rec.slice(18);
      } else if (rec.startsWith("# branch.ab ")) {
        const match = /^\+(\d+) -(\d+)$/u.exec(rec.slice(12));
        if (match) {
          status.ahead = Number(match[1]);
          status.behind = Number(match[2]);
        }
      } else if (rec.startsWith("1 ") || rec.startsWith("2 ")) {
        const xy = rec.slice(2, 4);
        if (xy[0] !== ".") status.staged++;
        if (xy[1] !== ".") status.unstaged++;
        if (rec.startsWith("2 ")) i++; // the next record is the rename source
      } else if (rec.startsWith("u ")) {
        status.conflicted++;
      } else if (rec.startsWith("? ")) {
        status.untracked++;
      }
    }
    status.baseBranch = base;
    status.remoteUrl = remoteUrl;
    if (base && status.headSha) {
      const count = await gitOut(cwd, ["rev-list", "--count", base + "..HEAD"], signal);
      status.aheadOfBase = count === null ? null : Number(count);
    }
  } catch (error) {
    if (signal.aborted) throw error;
    status.error = errorMessage(error);
  }
  return status;
}

/** Revision a target diffs the working tree against. */
async function targetBase(cwd: string, target: DiffTarget, signal: AbortSignal): Promise<{ rev: string; label: string }> {
  const head = await gitOut(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"], signal);
  if (target === "branch") {
    const base = await baseBranch(cwd, signal);
    if (!base) throw new Error("No default branch (origin/HEAD) is known. Run: git remote set-head origin --auto");
    if (!head) return { rev: EMPTY_TREE, label: base };
    const mergeBase = await gitOut(cwd, ["merge-base", base, "HEAD"], signal);
    if (!mergeBase) throw new Error("HEAD has no merge base with " + base);
    return { rev: mergeBase, label: base };
  }
  return head ? { rev: head, label: "HEAD" } : { rev: EMPTY_TREE, label: "empty tree" };
}

const NAME_STATUS: Record<string, FileStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "typechange",
  U: "conflicted",
};

async function listFiles(cwd: string, rev: string, signal: AbortSignal): Promise<FileChange[]> {
  const [nameStatus, numstat, untracked] = await Promise.all([
    run("git", ["diff", "--name-status", "-z", "-M", rev], { cwd, signal }),
    run("git", ["diff", "--numstat", "-z", "-M", rev], { cwd, signal }),
    run("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd, signal }),
  ]);
  if (nameStatus.code !== 0) throw new Error(nameStatus.stderr.trim() || "git diff failed");

  const stats = new Map<string, { additions: number | null; deletions: number | null; binary: boolean }>();
  const numParts = numstat.stdout.split("\0");
  for (let i = 0; i < numParts.length; i++) {
    const part = numParts[i]!;
    if (!part) continue;
    const [add, del, file] = part.split("\t");
    const binary = add === "-" && del === "-";
    const entry = { additions: binary ? null : Number(add), deletions: binary ? null : Number(del), binary };
    if (file === "" || file === undefined) {
      // Rename: "add\tdel\t\0old\0new"
      i += 2;
      stats.set(numParts[i] ?? "", entry);
    } else {
      stats.set(file, entry);
    }
  }

  const files: FileChange[] = [];
  const parts = nameStatus.stdout.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i]!;
    if (!code) continue;
    const kind = NAME_STATUS[code[0]!] ?? "modified";
    let previousPath: string | null = null;
    let file: string;
    if (code[0] === "R" || code[0] === "C") {
      previousPath = parts[++i] ?? null;
      file = parts[++i] ?? "";
    } else {
      file = parts[++i] ?? "";
    }
    const stat = stats.get(file);
    files.push({ path: file, previousPath, status: kind, additions: stat?.additions ?? null, deletions: stat?.deletions ?? null, binary: stat?.binary ?? false });
  }
  for (const file of untracked.stdout.split("\0")) {
    if (!file) continue;
    files.push({ path: file, previousPath: null, status: "untracked", additions: null, deletions: null, binary: false });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function summarizeChecks(rollup: unknown): { passed: number; failed: number; pending: number } {
  const counts = { passed: 0, failed: 0, pending: 0 };
  if (!Array.isArray(rollup)) return counts;
  for (const item of rollup as Array<Record<string, unknown>>) {
    const state = String(item.conclusion ?? item.state ?? "").toUpperCase();
    const runStatus = String(item.status ?? "").toUpperCase();
    if ((runStatus && runStatus !== "COMPLETED") || state === "PENDING" || state === "EXPECTED" || state === "") counts.pending++;
    else if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(state)) counts.failed++;
    else counts.passed++;
  }
  return counts;
}

async function pullRequest(cwd: string, signal: AbortSignal): Promise<PullRequest> {
  const branch = await gitOut(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], signal);
  if (!branch) return { outcome: "absent" };
  let result: RunResult;
  try {
    result = await run(
      "gh",
      ["pr", "view", "--json", "number,title,url,state,isDraft,reviewDecision,mergeable,statusCheckRollup"],
      { cwd, signal },
    );
  } catch (error) {
    if (error instanceof MissingBinaryError) return { outcome: "unavailable", message: "gh is not installed on this machine" };
    throw error;
  }
  if (result.code !== 0) {
    const stderr = result.stderr.trim();
    if (/no (open )?pull requests? found/iu.test(stderr)) return { outcome: "absent" };
    if (/none of the git remotes|not a git repository|no git remotes/iu.test(stderr)) return { outcome: "absent" };
    return { outcome: "unavailable", message: stderr.split("\n")[0] || "gh pr view failed" };
  }
  const pr = JSON.parse(result.stdout) as Record<string, unknown>;
  const state = String(pr.state ?? "OPEN").toUpperCase();
  return {
    outcome: "available",
    number: Number(pr.number),
    title: String(pr.title ?? ""),
    url: String(pr.url ?? ""),
    state: state === "MERGED" || state === "CLOSED" ? state : "OPEN",
    isDraft: Boolean(pr.isDraft),
    reviewDecision: typeof pr.reviewDecision === "string" && pr.reviewDecision ? pr.reviewDecision : null,
    mergeable: typeof pr.mergeable === "string" && pr.mergeable ? pr.mergeable : null,
    checks: summarizeChecks(pr.statusCheckRollup),
  };
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    async discover(input, ctx) {
      try {
        const relPaths = await discover(input.root, input.options.maxDepth, input.options.excludeDirs);
        return { status: "ok" as const, relPaths };
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        return { status: "failed" as const, message: errorMessage(error) };
      }
    },

    async scan(input, ctx) {
      try {
        const relPaths = await discover(input.root, input.options.maxDepth, input.options.excludeDirs);
        const repos = await mapLimit(relPaths, STATUS_CONCURRENCY, (relPath) => repoStatus(input.root, relPath, ctx.signal));
        return { status: "ok" as const, repos };
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        return { status: "failed" as const, message: errorMessage(error) };
      }
    },

    async files(input, ctx) {
      try {
        const cwd = await repoDir(input.root, input.relPath);
        const base = await targetBase(cwd, input.target, ctx.signal);
        const files = await listFiles(cwd, base.rev, ctx.signal);
        return { status: "ok" as const, baseLabel: base.label, files: files.slice(0, MAX_FILES), totalCount: files.length };
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        return { status: "failed" as const, message: errorMessage(error) };
      }
    },

    async patch(input, ctx) {
      try {
        const cwd = await repoDir(input.root, input.relPath);
        let result: RunResult;
        if (input.untracked) {
          // --no-index exits 1 when the files differ, which is always here.
          result = await run("git", ["diff", "--no-index", "--", "/dev/null", input.path], { cwd, signal: ctx.signal, maxBytes: MAX_PATCH_BYTES });
          if (result.code !== 0 && result.code !== 1) throw new Error(result.stderr.trim() || "git diff failed");
        } else {
          const base = await targetBase(cwd, input.target, ctx.signal);
          const paths = input.previousPath ? [input.previousPath, input.path] : [input.path];
          result = await run("git", ["diff", "-M", base.rev, "--", ...paths], { cwd, signal: ctx.signal, maxBytes: MAX_PATCH_BYTES });
          if (result.code !== 0) throw new Error(result.stderr.trim() || "git diff failed");
        }
        return { status: "ok" as const, patch: result.stdout, truncated: result.truncated };
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        return { status: "failed" as const, message: errorMessage(error) };
      }
    },

    async pullRequest(input, ctx) {
      try {
        const cwd = await repoDir(input.root, input.relPath);
        return await pullRequest(cwd, ctx.signal);
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        return { outcome: "unavailable" as const, message: errorMessage(error) };
      }
    },
  },
});
