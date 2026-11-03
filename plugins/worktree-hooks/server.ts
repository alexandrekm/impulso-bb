// bb-plugin-worktree-hooks — backend entry.
//
// Registers a "Worktree + hooks" environment provider. Core calls create()
// when a thread starts and only attaches the environment (and spawns the
// agent) after create() returns, so both scripts finish before the agent runs:
//
//   pre-create script (cwd: project checkout)
//   -> git worktree add (+ .worktreeinclude copy)
//   -> post-create script (cwd: new worktree)
//   -> core runs .bb-env-setup.sh, then the agent starts
//
// Scripts are configured per project in Settings -> Plugins -> Worktree Hooks.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import type { PluginEnvironmentProviderProgress } from "@get-bb/plugin-sdk/environment-provider";
import { z } from "zod";
import { hookScriptsSchema, hostContract, hostSignals, type HookScripts } from "./contract";

export const PROVIDER_ID = "worktree-hooks";

const projectIdSchema = z.string().min(1).max(200);

export const rpcContract = defineRpcContract({
  listProjects: {
    input: z.null(),
    output: z.object({
      projects: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
    }),
  },
  getHooks: {
    input: z.object({ projectId: projectIdSchema }).strict(),
    output: hookScriptsSchema,
  },
  setHooks: {
    input: z.object({ projectId: projectIdSchema, ...hookScriptsSchema.shape }).strict(),
    output: hookScriptsSchema,
  },
});

const EMPTY_SCRIPTS: HookScripts = { preCreate: "", postCreate: "" };
const resourceSchema = z.object({ sourcePath: z.string().min(1) }).strict();

const projectKey = (projectId: string) => `project:${projectId}`;
const pathKeyKey = (pathKey: string) => `pathKey:${pathKey}`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    scriptTimeoutMinutes: {
      type: "number",
      label: "Script timeout (minutes)",
      description: "Maximum run time for each pre/post-create script.",
      experimental_schema: z.number().int().min(1).max(120),
      default: 15,
    },
  });

  async function readScripts(projectId: string): Promise<HookScripts> {
    const stored = hookScriptsSchema.safeParse(await bb.storage.kv.get(projectKey(projectId)));
    return stored.success ? stored.data : EMPTY_SCRIPTS;
  }

  // Host progress signals -> the launch report of the matching operation.
  const host = bb.hosts.experimental_client({ contract: hostContract, experimental_signals: hostSignals });
  const reports = new Map<string, PluginEnvironmentProviderProgress>();
  host.experimental_onSignal("progress", ({ payload }) => {
    const report = reports.get(payload.operationId);
    if (!report) return;
    if (payload.kind === "step") report.step(payload.text);
    else report.log(payload.text);
  });

  async function createWorktree(
    ctx: {
      project: { id: string; name: string };
      host: { id: string };
      projectCheckout: { path: string };
      thread: { id: string };
      pathKey: string;
      attempt: number;
      report: PluginEnvironmentProviderProgress;
      signal: AbortSignal;
    },
    branchName: string,
    branchMode: "reset" | "reuse",
  ) {
    const operationId = `create#${ctx.pathKey}#${ctx.attempt}`;
    const sourcePath = ctx.projectCheckout.path;
    // Remembered so remove() can prune even if create never returned.
    await bb.storage.kv.set(pathKeyKey(ctx.pathKey), { sourcePath });
    const [scripts, { scriptTimeoutMinutes }] = await Promise.all([readScripts(ctx.project.id), settings.get()]);
    const scriptTimeoutMs = scriptTimeoutMinutes * 60_000;
    reports.set(operationId, ctx.report);
    try {
      const result = await host.call(
        "create",
        {
          operationId,
          sourcePath,
          pathKey: ctx.pathKey,
          branchName,
          branchMode,
          scripts,
          scriptTimeoutMs,
          env: {
            BB_PROJECT_ID: ctx.project.id,
            BB_PROJECT_NAME: ctx.project.name,
            BB_THREAD_ID: ctx.thread.id,
            BB_HOST_ID: ctx.host.id,
          },
        },
        // Two scripts plus git work; the host enforces the per-script timeout.
        { hostId: ctx.host.id, signal: ctx.signal, timeoutMs: 2 * scriptTimeoutMs + 10 * 60_000 },
      );
      if (result.status === "failed") return result;
      return {
        status: "created" as const,
        path: result.path,
        ownsPath: true,
        resource: { sourcePath },
        ...(result.baseBranch === null ? {} : { mergeBaseBranch: result.baseBranch }),
      };
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      return { status: "failed" as const, message: errorMessage(error) };
    } finally {
      reports.delete(operationId);
    }
  }

  bb.experimental_environments.register({
    id: PROVIDER_ID,
    displayName: "Worktree + hooks",
    description: "Git worktree that runs this project's pre/post-create scripts before the agent starts.",
    icon: "FolderGit",
    requires: { gitCheckout: true },
    policy: { pathKeys: "per-attempt" },
    async create(ctx) {
      return createWorktree(ctx, ctx.suggestedBranchName, "reset");
    },
    async restore(ctx) {
      const branch = ctx.previous.environment.branchName;
      if (branch === null) {
        return { status: "failed", message: "The removed worktree had no branch checked out, so there is nothing to restore." };
      }
      return createWorktree(ctx, branch, "reuse");
    },
    async remove(ctx) {
      const parsed = resourceSchema.safeParse(ctx.resource);
      const remembered = resourceSchema.safeParse(await bb.storage.kv.get(pathKeyKey(ctx.pathKey)));
      const sourcePath = parsed.success ? parsed.data.sourcePath : remembered.success ? remembered.data.sourcePath : null;
      if (ctx.hostId === null) {
        if (ctx.path === null) return { status: "removed" };
        return { status: "failed", message: "The worktree machine is unknown" };
      }
      const operationId = `remove#${ctx.pathKey}#${ctx.attempt}`;
      reports.set(operationId, ctx.report);
      try {
        const result = await host.call(
          "remove",
          { operationId, sourcePath, pathKey: ctx.pathKey, path: ctx.path },
          { hostId: ctx.hostId, signal: ctx.signal, timeoutMs: 10 * 60_000 },
        );
        if (result.status === "removed") await bb.storage.kv.delete(pathKeyKey(ctx.pathKey));
        return result;
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        return { status: "failed", message: errorMessage(error) };
      } finally {
        reports.delete(operationId);
      }
    },
  });

  bb.rpc.register(rpcContract, {
    async listProjects() {
      const projects = await bb.sdk.projects.list();
      return {
        projects: projects
          .filter((project) => project.kind === "standard")
          .map((project) => ({ id: project.id, name: project.name })),
      };
    },
    async getHooks({ projectId }) {
      return readScripts(projectId);
    },
    async setHooks({ projectId, preCreate, postCreate }) {
      await bb.sdk.projects.get({ projectId }); // 404s for an unknown project
      const scripts: HookScripts = { preCreate, postCreate };
      if (preCreate.trim() === "" && postCreate.trim() === "") await bb.storage.kv.delete(projectKey(projectId));
      else await bb.storage.kv.set(projectKey(projectId), scripts);
      bb.log.info(`Updated hook scripts for ${projectId}`);
      return scripts;
    },
  });
}
