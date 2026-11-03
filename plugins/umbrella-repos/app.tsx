// bb-plugin-umbrella-repos — frontend entry.
// Adds a "Repos" tab to threads whose workspace is an umbrella folder holding
// several git repos: per-repo branch, sync, changes, PR state and diffs.
import { useEffect, useRef, useState } from "react";
import {
  UrlLink,
  definePluginApp,
  experimental_Diff as Diff,
  experimental_Icon as Icon,
  experimental_useRpcQuery as useRpcQuery,
  type ExperimentalThreadTabProps,
} from "@get-bb/plugin-sdk/app";
import type { DiffTarget, FileChange, PullRequest, RepoStatus } from "./contract";
import { rpcContract } from "./rpc";
import { cn } from "@/lib/utils";

const STATUS_POLL_MS = 15_000;
const PR_POLL_MS = 60_000;

/** Calls refetch on an interval while the page is visible. */
function usePoll(refetch: () => Promise<void>, intervalMs: number, enabled = true) {
  const latest = useRef(refetch);
  latest.current = refetch;
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === "visible") void latest.current();
    };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [intervalMs, enabled]);
}

function Muted(props: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-sm text-muted-foreground", props.className)}>{props.children}</p>;
}

function Chip(props: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "info"; title?: string }) {
  const tone = {
    neutral: "border-border text-muted-foreground",
    good: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
    warn: "border-amber-500/40 text-amber-600 dark:text-amber-400",
    bad: "border-red-500/40 text-red-600 dark:text-red-400",
    info: "border-sky-500/40 text-sky-600 dark:text-sky-400",
  }[props.tone ?? "neutral"];
  return (
    <span title={props.title} className={cn("inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-px text-[11px] leading-4 tabular-nums", tone)}>
      {props.children}
    </span>
  );
}

function PrChip({ pr }: { pr: PullRequest | undefined }) {
  if (!pr) return null;
  if (pr.outcome === "absent") return null;
  if (pr.outcome === "unavailable") {
    return (
      <Chip tone="neutral" title={pr.message}>
        PR ?
      </Chip>
    );
  }
  const stateTone = pr.state === "MERGED" ? "info" : pr.state === "CLOSED" ? "bad" : pr.isDraft ? "neutral" : "good";
  const stateLabel = pr.state === "OPEN" ? (pr.isDraft ? "draft" : "open") : pr.state.toLowerCase();
  const { passed, failed, pending } = pr.checks;
  return (
    <span className="inline-flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
      <UrlLink href={pr.url} className="no-underline" title={pr.title}>
        <Chip tone={stateTone}>
          #{pr.number} {stateLabel}
        </Chip>
      </UrlLink>
      {failed > 0 ? <Chip tone="bad" title="Failing checks">✕ {failed}</Chip> : null}
      {pending > 0 ? <Chip tone="warn" title="Pending checks">● {pending}</Chip> : null}
      {failed === 0 && pending === 0 && passed > 0 ? <Chip tone="good" title="Passing checks">✓ {passed}</Chip> : null}
      {pr.reviewDecision === "APPROVED" ? <Chip tone="good">approved</Chip> : null}
      {pr.reviewDecision === "CHANGES_REQUESTED" ? <Chip tone="bad">changes requested</Chip> : null}
    </span>
  );
}

const FILE_STATUS_LETTER: Record<FileChange["status"], { letter: string; className: string }> = {
  added: { letter: "A", className: "text-emerald-600 dark:text-emerald-400" },
  untracked: { letter: "U", className: "text-emerald-600 dark:text-emerald-400" },
  modified: { letter: "M", className: "text-amber-600 dark:text-amber-400" },
  typechange: { letter: "T", className: "text-amber-600 dark:text-amber-400" },
  renamed: { letter: "R", className: "text-sky-600 dark:text-sky-400" },
  copied: { letter: "C", className: "text-sky-600 dark:text-sky-400" },
  deleted: { letter: "D", className: "text-red-600 dark:text-red-400" },
  conflicted: { letter: "!", className: "text-red-600 dark:text-red-400" },
};

function FilePatch(props: { environmentId: string; relPath: string; target: DiffTarget; file: FileChange; view: "unified" | "split" }) {
  const { data, error, isLoading } = useRpcQuery({
    contract: rpcContract,
    method: "patch",
    input: {
      environmentId: props.environmentId,
      relPath: props.relPath,
      target: props.target,
      path: props.file.path,
      previousPath: props.file.previousPath,
      untracked: props.file.status === "untracked",
    },
  });
  if (isLoading) return <Muted className="px-3 py-2 text-xs">Loading diff…</Muted>;
  if (error) return <Muted className="px-3 py-2 text-xs text-destructive">{error.message}</Muted>;
  if (!data) return null;
  if (data.status === "unavailable") return <Muted className="px-3 py-2 text-xs">{data.message}</Muted>;
  if (props.file.binary) return <Muted className="px-3 py-2 text-xs">Binary file</Muted>;
  if (data.patch.trim() === "") return <Muted className="px-3 py-2 text-xs">No textual changes</Muted>;
  return (
    <div className="border-t border-border">
      {data.truncated ? <Muted className="px-3 py-1 text-xs">Diff truncated (over 1 MB).</Muted> : null}
      <Diff patch={data.patch} path={props.file.path} view={props.view} />
    </div>
  );
}

function RepoFiles(props: { environmentId: string; relPath: string; target: DiffTarget; view: "unified" | "split"; version: number }) {
  const [openPath, setOpenPath] = useState<string | null>(null);
  const { data, error, isLoading, refetch } = useRpcQuery({
    contract: rpcContract,
    method: "files",
    input: { environmentId: props.environmentId, relPath: props.relPath, target: props.target },
  });
  // Re-list files whenever the overview refreshes.
  const latestRefetch = useRef(refetch);
  latestRefetch.current = refetch;
  const firstVersion = useRef(props.version);
  useEffect(() => {
    if (props.version !== firstVersion.current) void latestRefetch.current();
  }, [props.version]);

  if (isLoading) return <Muted className="px-3 py-2 text-xs">Loading files…</Muted>;
  if (error) return <Muted className="px-3 py-2 text-xs text-destructive">{error.message}</Muted>;
  if (!data) return null;
  if (data.status === "unavailable") return <Muted className="px-3 py-2 text-xs">{data.message}</Muted>;
  if (data.files.length === 0) {
    return <Muted className="px-3 py-2 text-xs">No changes against {data.baseLabel}.</Muted>;
  }
  return (
    <div className="flex flex-col">
      <Muted className="px-3 py-1 text-xs">
        {data.totalCount} file{data.totalCount === 1 ? "" : "s"} vs {data.baseLabel}
        {data.totalCount > data.files.length ? " (showing first " + data.files.length + ")" : ""}
      </Muted>
      {data.files.map((file) => {
        const open = openPath === file.path;
        const mark = FILE_STATUS_LETTER[file.status];
        return (
          <div key={file.path} className="flex flex-col">
            <button
              type="button"
              onClick={() => setOpenPath(open ? null : file.path)}
              className="flex w-full items-center gap-2 px-3 py-1 text-left font-mono text-xs hover:bg-state-hover"
            >
              <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3 shrink-0 text-muted-foreground" />
              <span className={cn("w-3 shrink-0 text-center font-semibold", mark.className)}>{mark.letter}</span>
              <span className="min-w-0 flex-1 truncate" title={file.previousPath ? file.previousPath + " → " + file.path : file.path}>
                {file.previousPath ? file.previousPath + " → " : ""}
                {file.path}
              </span>
              {file.additions !== null ? <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span> : null}
              {file.deletions !== null ? <span className="text-red-600 dark:text-red-400">-{file.deletions}</span> : null}
            </button>
            {open ? (
              <FilePatch environmentId={props.environmentId} relPath={props.relPath} target={props.target} file={file} view={props.view} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RepoRow(props: {
  environmentId: string;
  repo: RepoStatus;
  pr: PullRequest | undefined;
  target: DiffTarget;
  view: "unified" | "split";
  version: number;
}) {
  const { repo } = props;
  const [open, setOpen] = useState(false);
  const changes = repo.staged + repo.unstaged + repo.untracked + repo.conflicted;
  return (
    <div className="flex flex-col rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left hover:bg-state-hover"
      >
        <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium text-foreground" title={repo.relPath}>
          {repo.relPath}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <Icon name="GitBranch" className="size-3 shrink-0" />
          <span className="truncate">{repo.branch ?? (repo.headSha ? "detached @ " + repo.headSha.slice(0, 7) : "no commits")}</span>
        </span>
        <span className="ml-auto inline-flex flex-wrap items-center justify-end gap-1">
          {repo.error ? <Chip tone="bad" title={repo.error}>error</Chip> : null}
          {repo.conflicted > 0 ? <Chip tone="bad">{repo.conflicted} conflicted</Chip> : null}
          {changes > 0 ? (
            <Chip tone="warn" title={repo.staged + " staged, " + repo.unstaged + " unstaged, " + repo.untracked + " untracked"}>
              {changes} changed
            </Chip>
          ) : repo.error ? null : (
            <Chip>clean</Chip>
          )}
          {repo.ahead ? <Chip title={"Ahead of " + repo.upstream}>↑{repo.ahead}</Chip> : null}
          {repo.behind ? <Chip tone="warn" title={"Behind " + repo.upstream}>↓{repo.behind}</Chip> : null}
          {repo.branch && !repo.upstream ? <Chip title="Branch has no upstream">unpushed</Chip> : null}
          {repo.aheadOfBase && repo.baseBranch && repo.branch !== repo.baseBranch.replace(/^origin\//u, "") ? (
            <Chip tone="info" title={"Commits not on " + repo.baseBranch}>
              +{repo.aheadOfBase} vs {repo.baseBranch.replace(/^origin\//u, "")}
            </Chip>
          ) : null}
          <PrChip pr={props.pr} />
        </span>
      </button>
      {open ? (
        <div className="border-t border-border py-1">
          {repo.error ? <Muted className="px-3 py-1 text-xs text-destructive">{repo.error}</Muted> : null}
          <RepoFiles environmentId={props.environmentId} relPath={repo.relPath} target={props.target} view={props.view} version={props.version} />
        </div>
      ) : null}
    </div>
  );
}

function Toggle<T extends string>(props: { value: T; options: Array<{ value: T; label: string; title?: string }>; onChange: (value: T) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5">
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={props.value === option.value}
          onClick={() => props.onChange(option.value)}
          className={cn(
            "rounded px-2 py-0.5 text-xs text-muted-foreground",
            props.value === option.value ? "bg-state-active text-foreground" : "hover:bg-state-hover",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ReposTab({ environment }: ExperimentalThreadTabProps) {
  const environmentId = environment?.id ?? "";
  const [target, setTarget] = useState<DiffTarget>("uncommitted");
  const [view, setView] = useState<"unified" | "split">("unified");
  const [version, setVersion] = useState(0);

  const overview = useRpcQuery({ contract: rpcContract, method: "overview", input: { environmentId }, enabled: environmentId !== "" });
  const prs = useRpcQuery({ contract: rpcContract, method: "pullRequests", input: { environmentId }, enabled: environmentId !== "" });
  usePoll(overview.refetch, STATUS_POLL_MS, environmentId !== "");
  usePoll(prs.refetch, PR_POLL_MS, environmentId !== "");
  useEffect(() => {
    if (overview.data) setVersion((value) => value + 1);
  }, [overview.data]);

  if (!environment) return <Muted>This thread has no environment.</Muted>;
  if (overview.isLoading) return <Muted>Scanning repositories…</Muted>;
  if (overview.error && !overview.data) return <Muted className="text-destructive">{overview.error.message}</Muted>;
  const data = overview.data;
  if (!data) return null;
  if (data.status === "unavailable") return <Muted>{data.message}</Muted>;

  const prRows = prs.data?.status === "ok" ? prs.data.rows : {};
  const dirty = data.repos.filter((repo) => repo.staged + repo.unstaged + repo.untracked + repo.conflicted > 0).length;
  const openPrs = Object.values(prRows).filter((pr) => pr.outcome === "available" && pr.state === "OPEN").length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={data.root}>
          {data.repos.length} repo{data.repos.length === 1 ? "" : "s"} · {dirty} with changes · {openPrs} open PR{openPrs === 1 ? "" : "s"}
        </span>
        <Toggle
          value={target}
          onChange={setTarget}
          options={[
            { value: "uncommitted", label: "Uncommitted", title: "Working tree vs HEAD" },
            { value: "branch", label: "Branch", title: "Working tree vs merge base with the default branch" },
          ]}
        />
        <Toggle
          value={view}
          onChange={setView}
          options={[
            { value: "unified", label: "Unified" },
            { value: "split", label: "Split" },
          ]}
        />
        <button
          type="button"
          title="Refresh status and pull requests"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-50"
          disabled={overview.isFetching || prs.isFetching}
          onClick={() => {
            void overview.refetch();
            void prs.refetch();
          }}
        >
          <Icon name="RefreshCw" className={cn("size-3.5", (overview.isFetching || prs.isFetching) && "animate-spin")} />
        </button>
      </div>
      {data.repos.length === 0 ? <Muted>No git repositories found under {data.root}.</Muted> : null}
      {data.repos.map((repo) => (
        <RepoRow
          key={repo.relPath}
          environmentId={environmentId}
          repo={repo}
          pr={prRows[repo.relPath]}
          target={target}
          view={view}
          version={version}
        />
      ))}
    </div>
  );
}

/** Show the tab only where it adds something: non-git workspaces that hold repos. */
function useReposTabVisible({ environment }: ExperimentalThreadTabProps): boolean {
  const environmentId = environment?.id ?? "";
  const { data } = useRpcQuery({ contract: rpcContract, method: "detect", input: { environmentId }, enabled: environmentId !== "" });
  return (data?.repoCount ?? 0) > 0;
}

export default definePluginApp((app) => {
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "fixed",
    id: "repos",
    title: "Repos",
    tooltip: "Git status, diffs and pull requests for every repo in this folder",
    icon: "FolderGit",
    layout: "padded",
    component: ReposTab,
    useVisible: useReposTabVisible,
  });
});
