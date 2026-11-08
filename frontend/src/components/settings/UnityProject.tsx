"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import {
  ApiError,
  chooseUnityProjectFolder,
  connectUnityProject,
  disconnectUnityProject,
  getUnityProject,
  type ApiUnityProject,
} from "@/lib/api";
import { apiErrorText } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n/I18nProvider";

import UnityFolderPicker from "./UnityFolderPicker";

type ProjectState = { project: ApiUnityProject | null; error: ApiError | null; loading: boolean };

const toApiError = (error: unknown) => (error instanceof ApiError ? error : new ApiError(0, "unknown", String(error)));

/** The Unity project Analyze reads when connected (Settings → Unity project). */
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

/** One line under the Analyze button: whether the next analysis reads a Unity project. */
export function UnityProjectLine() {
  const { t } = useI18n();
  const u = t.unityProject;
  const { project } = useUnityProject();
  if (!project || !project.supported) return null;
  if (project.connected && project.error_code) {
    return (
      <p role="alert" className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-amber-200">
        <Icon name="alert" size={13} />
        {apiErrorText(t, new ApiError(409, project.error_code, project.error ?? ""))}
        <Link href="/settings" className="font-medium text-amber-100 underline-offset-2 hover:underline">
          {t.nav.settings}
        </Link>
      </p>
    );
  }
  if (project.connected) {
    const count = project.folders.filter((f) => !project.missing_folders.includes(f)).length;
    return (
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted" title={project.path ?? undefined}>
        <Icon name="composition" size={13} className="text-primary-soft" />
        {count ? u.analyzeOn(project.name ?? "", count) : u.analyzeNoFolders(project.name ?? "")}
      </p>
    );
  }
  return (
    <p className="text-center text-xs text-muted">
      {u.analyzeOff} ·{" "}
      <Link href="/settings" className="font-medium text-foreground underline-offset-2 hover:underline">
        {u.connectLink}
      </Link>
    </p>
  );
}

type Busy = "choose" | "connect" | "disconnect" | null;

/** Settings card body: connect a Unity project folder (macOS folder dialog or pasted path) or disconnect it. */
export default function UnityProjectSettings() {
  const { t } = useI18n();
  const u = t.unityProject;
  const { project, error, loading, set } = useUnityProject();
  const [busy, setBusy] = useState<Busy>(null);
  const [path, setPath] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

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

  async function connect(folder: string) {
    const next = await connectUnityProject(folder);
    set(next);
    setPath("");
    setNotice({ tone: "ok", text: u.connectedNotice(next.name ?? "") });
  }

  const choose = () =>
    run("choose", async () => {
      const chosen = await chooseUnityProjectFolder();
      if (chosen.path) await connect(chosen.path);
    });

  const connectTyped = () => {
    const value = path.trim();
    if (value) run("connect", () => connect(value));
  };

  const disconnect = () => {
    if (!window.confirm(u.disconnectConfirm)) return;
    run("disconnect", async () => {
      set(await disconnectUnityProject());
      setNotice({ tone: "ok", text: u.disconnectedNotice });
    });
  };

  if (loading && !project) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-soft/30 border-t-primary-soft" />
        {u.checking}
      </p>
    );
  }
  if (!project) {
    return (
      <p role="alert" className="text-sm text-rose-200">
        {error ? apiErrorText(t, error) : u.unknown}
      </p>
    );
  }
  if (!project.supported) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-sm text-amber-200">
        <Icon name="info" size={15} className="mt-0.5 shrink-0" /> {u.unsupported}
      </p>
    );
  }

  const picker = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={project.connected ? "secondary" : "primary"} disabled={busy !== null} onClick={choose}>
          <Icon name="plusCircle" size={14} /> {busy === "choose" ? u.choosing : u.choose}
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
            disabled={busy !== null}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") connectTyped();
            }}
            className="h-9 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 font-mono text-sm text-foreground"
          />
          <Button size="sm" disabled={busy !== null || !path.trim()} onClick={connectTyped} className="h-9">
            <Icon name="link" size={14} /> {busy === "connect" ? u.connecting : u.connect}
          </Button>
        </span>
      </label>
    </div>
  );

  const info = (
    <ul className="flex flex-col gap-1.5 text-xs text-muted">
      <li className="flex items-start gap-1.5">
        <Icon name="check" size={13} className="mt-px shrink-0" /> {u.reads}
      </li>
      <li className="flex items-start gap-1.5">
        <Icon name="info" size={13} className="mt-px shrink-0" /> {u.privacy}
      </li>
      <li className="flex items-start gap-1.5">
        <Icon name="clock" size={13} className="mt-px shrink-0" /> {u.slower}
      </li>
    </ul>
  );

  const noticeEl = notice && (
    <p role={notice.tone === "error" ? "alert" : "status"} className={`text-xs ${notice.tone === "error" ? "text-rose-200" : "text-emerald-300"}`}>
      {notice.text}
    </p>
  );

  if (!project.connected) {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <p className="flex items-center gap-2 text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-muted" /> {u.notConnected}
        </p>
        {picker}
        {noticeEl}
        {info}
      </div>
    );
  }

  const serialization =
    project.text_serialization === true ? u.forceText : project.text_serialization === false ? u.binary : u.unknown;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="rounded-xl border border-border/70 bg-background/50 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold break-all text-foreground">
            <Icon name="composition" size={15} className="shrink-0 text-primary-soft" /> {project.name ?? "—"}
          </h3>
          {project.error_code ? (
            <Badge className="border-rose-400/30 bg-rose-400/10 text-rose-200">
              <Icon name="alert" size={12} /> {u.problemBadge}
            </Badge>
          ) : (
            <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200">
              <Icon name="check" size={12} /> {u.connectedBadge}
            </Badge>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-2.5 text-xs">
          <dt className="text-muted">{u.folder}</dt>
          <dd className="font-mono break-all text-foreground">{project.path ?? "—"}</dd>
          {!project.error_code && (
            <>
              <dt className="text-muted">{u.version}</dt>
              <dd className="text-foreground">{project.unity_version ?? u.unknown}</dd>
              <dt className="text-muted">{u.serialization}</dt>
              <dd className={project.text_serialization === false ? "text-amber-200" : "text-foreground"}>{serialization}</dd>
            </>
          )}
        </dl>
        {project.error_code && (
          <p role="alert" className="mt-3 text-xs text-amber-200">
            {apiErrorText(t, new ApiError(409, project.error_code, project.error ?? ""))}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="danger" disabled={busy !== null} onClick={disconnect}>
            <Icon name="x" size={14} /> {busy === "disconnect" ? u.disconnecting : u.disconnect}
          </Button>
        </div>
      </div>
      {!project.error_code && <UnityFolderPicker key={project.path} project={project} onSaved={set} />}
      <details className="text-xs text-muted">
        <summary className="cursor-pointer text-foreground">{u.change}</summary>
        <div className="mt-3">{picker}</div>
      </details>
      {noticeEl}
      {info}
    </div>
  );
}
