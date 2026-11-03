// bb-plugin-worktree-hooks — frontend entry.
// Adds a section to this plugin's settings page: pick a project, then edit its
// pre-create and post-create scripts.
import { useCallback, useEffect, useMemo, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";

type Project = { id: string; name: string };
type Scripts = { preCreate: string; postCreate: string };

const EMPTY: Scripts = { preCreate: "", postCreate: "" };

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function ScriptBox(props: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={props.id} className="text-sm font-medium text-foreground">
        {props.label}
      </label>
      <p className="text-xs text-muted-foreground">{props.hint}</p>
      <textarea
        id={props.id}
        value={props.value}
        disabled={props.disabled}
        spellCheck={false}
        rows={8}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
        className="min-h-32 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}

function HooksSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState<string>("");
  const [saved, setSaved] = useState<Scripts>(EMPTY);
  const [draft, setDraft] = useState<Scripts>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc.call("listProjects").then(
      ({ projects }) => {
        setProjects(projects);
        setProjectId((current) => current || projects[0]?.id || "");
      },
      (cause) => setError(errorText(cause)),
    );
  }, [rpc]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    rpc.call("getHooks", { projectId }).then(
      (scripts) => {
        if (cancelled) return;
        setSaved(scripts);
        setDraft(scripts);
        setError(null);
        setLoading(false);
      },
      (cause) => {
        if (cancelled) return;
        setError(errorText(cause));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, projectId]);

  const dirty = useMemo(
    () => draft.preCreate !== saved.preCreate || draft.postCreate !== saved.postCreate,
    [draft, saved],
  );

  const save = useCallback(async () => {
    if (!projectId) return;
    setSaving(true);
    try {
      const next = await rpc.call("setHooks", { projectId, ...draft });
      setSaved(next);
      setDraft(next);
      toast.success("Hook scripts saved");
    } catch (cause) {
      toast.error(`Could not save: ${errorText(cause)}`);
    } finally {
      setSaving(false);
    }
  }, [rpc, projectId, draft]);

  if (projects === null) {
    return <p className="text-sm text-muted-foreground">{error ?? "Loading projects…"}</p>;
  }
  if (projects.length === 0) {
    return <p className="text-sm text-muted-foreground">No projects yet. Add a git project to configure hooks.</p>;
  }

  const disabled = loading || saving;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="worktree-hooks-project" className="text-sm font-medium text-foreground">
          Project
        </label>
        <select
          id="worktree-hooks-project"
          value={projectId}
          disabled={saving}
          onChange={(event) => {
            if (dirty && !window.confirm("Discard unsaved changes?")) return;
            setProjectId(event.target.value);
          }}
          className="h-8 w-full max-w-sm rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      <ScriptBox
        id="worktree-hooks-pre"
        label="Before worktree creation"
        hint="Runs in the project checkout before git worktree add. Use it to fetch, validate, or prepare the source repo."
        placeholder={"git fetch origin --prune"}
        value={draft.preCreate}
        disabled={disabled}
        onChange={(preCreate) => setDraft((d) => ({ ...d, preCreate }))}
      />
      <ScriptBox
        id="worktree-hooks-post"
        label="After worktree creation"
        hint="Runs inside the new worktree before the agent starts. Use it to install dependencies, copy env files, or seed data."
        placeholder={"cp \"$BB_SOURCE_PATH/.env\" .env\nnpm ci"}
        value={draft.postCreate}
        disabled={disabled}
        onChange={(postCreate) => setDraft((d) => ({ ...d, postCreate }))}
      />

      <p className="text-xs text-muted-foreground">
        Scripts run with <code>bash -e</code> unless they start with a shebang. A non-zero exit fails the thread
        launch. Available variables: <code>BB_HOOK_PHASE</code>, <code>BB_SOURCE_PATH</code>,{" "}
        <code>BB_WORKTREE_PATH</code>, <code>BB_BRANCH</code>, <code>BB_BASE_BRANCH</code> (post only),{" "}
        <code>BB_PROJECT_ID</code>, <code>BB_PROJECT_NAME</code>, <code>BB_THREAD_ID</code>, <code>BB_HOST_ID</code>.
        Pick the <strong>Worktree + hooks</strong> environment when starting a thread.
      </p>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button onClick={() => void save()} disabled={!dirty || disabled}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={() => setDraft(saved)} disabled={!dirty || disabled}>
          Reset
        </Button>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "project-hooks",
    title: "Project hook scripts",
    description: "Commands that run around worktree creation for threads using the Worktree + hooks environment.",
    component: HooksSettings,
  });
});
