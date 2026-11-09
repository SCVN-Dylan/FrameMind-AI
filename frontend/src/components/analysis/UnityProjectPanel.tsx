"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import {
  ApiError,
  chooseUnityProjectFolder,
  connectUnityProject,
  disconnectUnityProject,
  forgetUnityProject,
  getUnityProject,
  type ApiUnityProject,
} from "@/lib/api";
import { apiErrorText } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n/I18nProvider";

import UnityFolderPicker from "./UnityFolderPicker";

type ProjectState = { project: ApiUnityProject | null; error: ApiError | null; loading: boolean };

const toApiError = (error: unknown) => (error instanceof ApiError ? error : new ApiError(0, "unknown", String(error)));

/** The Unity project Analyze reads when connected. */
export function useUnityProject() {
  const [state, setState] = useState<ProjectState>({ project: null, error: null, loading: true });

  const load = useCallback((signal?: AbortSignal) => {
    getUnityProject(signal)
      .then((project) => setState({ project, error: null, loading: false }))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ project: null, error: toApiError(error), loading: false });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const set = useCallback((project: ApiUnityProject) => setState({ project, error: null, loading: false }), []);
  return { ...state, reload: load, set };
}

const NONE = "";
const ADD = "__add__";
type Busy = "choose" | "connect" | "switch" | "forget" | null;

/** Next to Analyze: which Unity project (if any) this analysis reads, and which of its folders.
 *  Each analysis can be for a different project, so projects used before stay in the list with their folders. */
export default function UnityProjectPanel({ disabled = false }: { disabled?: boolean }) {
  const { t } = useI18n();
  const u = t.unityProject;
  const { project, error, set } = useUnityProject();
  const [busy, setBusy] = useState<Busy>(null);
  const [adding, setAdding] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [path, setPath] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  if (!project) {
    return error ? (
      <p role="alert" className="text-xs text-rose-200">
        {apiErrorText(t, error)}
      </p>
    ) : null;
  }
  if (!project.supported) return null;

  const locked = disabled || busy !== null;

  async function run(kind: Exclude<Busy, null>, action: () => Promise<void>) {
    setBusy(kind);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setNotice({ tone: "error", text: apiErrorText(t, toApiError(err)) });
    } finally {
      setBusy(null);
    }
  }

  async function connect(folder: string, kind: Exclude<Busy, null>) {
    await run(kind, async () => {
      const next = await connectUnityProject(folder);
      set(next);
      setPath("");
      setAdding(false);
      // A project with nothing ticked yet opens its folder list so the user can choose.
      setFoldersOpen(next.folders.length === 0);
      setNotice(next.folders.length === 0 ? { tone: "ok", text: u.connectedNotice(next.name ?? "") } : null);
    });
  }

  function onSelect(value: string) {
    if (value === ADD) {
      setAdding(true);
      setNotice(null);
      return;
    }
    setAdding(false);
    if (value === NONE) {
      if (project?.connected) void run("switch", async () => set(await disconnectUnityProject()));
      return;
    }
    if (value !== project?.path) void connect(value, "switch");
  }

  const choose = () =>
    run("choose", async () => {
      const chosen = await chooseUnityProjectFolder();
      if (chosen.path) {
        setBusy(null);
        await connect(chosen.path, "connect");
      }
    });

  const forget = () => {
    if (!project.path || !window.confirm(u.forgetConfirm(project.name ?? ""))) return;
    const target = project.path;
    void run("forget", async () => {
      set(await forgetUnityProject(target));
      setFoldersOpen(false);
    });
  };

  const readable = project.folders.filter((f) => !project.missing_folders.includes(f)).length;
  const selectValue = adding ? ADD : project.connected ? (project.path ?? NONE) : NONE;
  const status = !project.connected
    ? u.analyzeOff
    : project.error_code
      ? apiErrorText(t, new ApiError(409, project.error_code, project.error ?? ""))
      : readable
        ? u.readsCount(readable)
        : u.foldersNone;
  const warn = project.connected && (project.error_code !== null || readable === 0);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border/70 bg-background/50 p-3.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="unity-project-select" className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Icon name="composition" size={14} className="text-primary-soft" /> {u.title}
        </label>
        <select
          id="unity-project-select"
          value={selectValue}
          disabled={locked}
          onChange={(e) => onSelect(e.target.value)}
          className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
        >
          <option value={NONE}>{u.videosOnlyOption}</option>
          {project.recent.map((r) => (
            <option key={r.path} value={r.path} title={r.path}>
              {r.available ? `${r.name} · ${u.folderCountShort(r.folder_count)}` : `${r.name} · ${u.notFound}`}
            </option>
          ))}
          <option value={ADD}>{u.addProject}</option>
        </select>
        {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-soft/30 border-t-primary-soft" />}
      </div>

      {project.connected && !adding && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role={warn ? "alert" : undefined} className={`text-xs ${warn ? "text-amber-200" : "text-muted"}`} title={project.path ?? undefined}>
            {status}
            {!project.error_code && project.text_serialization === false && <> · {u.binaryShort}</>}
          </p>
          <div className="flex gap-1.5">
            {!project.error_code && (
              <Button size="sm" variant="secondary" aria-expanded={foldersOpen} disabled={disabled} onClick={() => setFoldersOpen((v) => !v)}>
                <Icon name={foldersOpen ? "chevronDown" : "chevronRight"} size={13} /> {u.foldersButton}
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={locked} onClick={forget} title={u.forget}>
              <Icon name="trash" size={13} /> <span className="sr-only">{u.forget}</span>
            </Button>
          </div>
        </div>
      )}

      {project.connected && !adding && foldersOpen && !project.error_code && (
        <div className="border-t border-border/60 pt-3">
          <UnityFolderPicker key={project.path} project={project} onSaved={set} />
        </div>
      )}

      {adding && (
        <div className="flex flex-col gap-2.5 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" disabled={locked} onClick={choose}>
              <Icon name="plusCircle" size={14} /> {busy === "choose" ? u.choosing : u.choose}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => setAdding(false)}>
              {u.cancel}
            </Button>
            {busy === "choose" && <span className="text-xs text-muted">{u.dialogHint}</span>}
          </div>
          <label className="flex flex-col gap-1.5 text-xs text-muted" htmlFor="unity-project-path">
            {u.pathLabel}
            <span className="flex gap-2">
              <input
                id="unity-project-path"
                value={path}
                placeholder={u.pathPlaceholder}
                autoComplete="off"
                spellCheck={false}
                disabled={locked}
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && path.trim()) void connect(path.trim(), "connect");
                }}
                className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 font-mono text-sm text-foreground"
              />
              <Button size="sm" disabled={locked || !path.trim()} onClick={() => void connect(path.trim(), "connect")}>
                <Icon name="link" size={14} /> {busy === "connect" ? u.connecting : u.connect}
              </Button>
            </span>
          </label>
          <ul className="flex flex-col gap-1 text-xs text-muted">
            <li>{u.reads}</li>
            <li>{u.privacy}</li>
            <li>{u.slower}</li>
          </ul>
        </div>
      )}

      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`text-xs ${notice.tone === "error" ? "text-rose-200" : "text-emerald-300"}`}>
          {notice.text}
        </p>
      )}
    </div>
  );
}
