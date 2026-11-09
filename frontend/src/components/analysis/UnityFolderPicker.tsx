"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import {
  ApiError,
  listUnityProjectFolders,
  setUnityProjectFolders,
  type ApiUnityFolder,
  type ApiUnityProject,
} from "@/lib/api";
import { apiErrorText } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n/I18nProvider";

const toApiError = (error: unknown) => (error instanceof ApiError ? error : new ApiError(0, "unknown", String(error)));

/** The chosen folder that already includes `path` (a parent of it), if any. */
function coveringFolder(path: string, chosen: Set<string>): string | null {
  for (const folder of chosen) if (path !== folder && path.startsWith(`${folder}/`)) return folder;
  return null;
}

type Props = {
  project: ApiUnityProject;
  onSaved: (project: ApiUnityProject) => void;
};

/** Tick the project folders Codex may read during Analyze. Nothing ticked = analysis uses the videos only.
 *  Render it with `key={project.path}` so another project starts with a fresh tree. */
export default function UnityFolderPicker({ project, onSaved }: Props) {
  const { t } = useI18n();
  const u = t.unityProject;
  const [children, setChildren] = useState<Record<string, ApiUnityFolder[]>>({});
  const [open, setOpen] = useState<Set<string>>(() => new Set(["Assets"]));
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const loading = useRef(new Set<string>());

  const saved = project.folders;
  const chosen = useMemo(() => draft ?? new Set(saved), [draft, saved]);
  const dirty = draft !== null && (draft.size !== saved.length || saved.some((f) => !draft.has(f)));

  const load = useCallback(
    (parent: string) => {
      if (loading.current.has(parent)) return;
      loading.current.add(parent);
      listUnityProjectFolders(parent)
        .then((res) => setChildren((prev) => ({ ...prev, [parent]: res.folders })))
        .catch((error) => {
          setChildren((prev) => ({ ...prev, [parent]: [] }));
          setNotice({ tone: "error", text: apiErrorText(t, toApiError(error)) });
        });
    },
    [t],
  );

  useEffect(() => {
    for (const parent of ["", ...open]) if (!(parent in children)) load(parent);
  }, [open, children, load]);

  function toggle(path: string, checked: boolean) {
    const next = new Set(chosen);
    if (checked) {
      next.add(path);
      for (const folder of [...next]) if (folder.startsWith(`${path}/`)) next.delete(folder);
    } else {
      next.delete(path);
    }
    setDraft(next);
    setNotice(null);
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      const next = await setUnityProjectFolders([...chosen]);
      setDraft(null);
      onSaved(next);
      setNotice({ tone: "ok", text: u.foldersSaved });
    } catch (error) {
      setNotice({ tone: "error", text: apiErrorText(t, toApiError(error)) });
    } finally {
      setSaving(false);
    }
  }

  function renderLevel(parent: string, depth: number): React.ReactNode {
    const kids = children[parent];
    const indent = { paddingLeft: depth * 20 };
    if (!kids) {
      return (
        <p className="flex items-center gap-2 py-1 text-xs text-muted" style={indent}>
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary-soft/30 border-t-primary-soft" />
          {u.loadingFolders}
        </p>
      );
    }
    if (kids.length === 0) {
      return (
        <p className="py-1 text-xs text-muted" style={{ paddingLeft: depth * 20 + 26 }}>
          {u.noSubfolders}
        </p>
      );
    }
    return kids.map((folder) => {
      const isOpen = open.has(folder.path);
      const covered = coveringFolder(folder.path, chosen);
      return (
        <div key={folder.path}>
          <div className="flex min-h-7 items-center gap-1" style={indent}>
            {folder.has_children ? (
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={folder.path}
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (isOpen) next.delete(folder.path);
                    else next.add(folder.path);
                    return next;
                  })
                }
                className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-foreground"
              >
                <Icon name={isOpen ? "chevronDown" : "chevronRight"} size={14} />
              </button>
            ) : (
              <span className="w-[22px] shrink-0" />
            )}
            <label
              className={`flex min-w-0 items-center gap-2 text-sm ${covered ? "cursor-default" : "cursor-pointer"}`}
              title={covered ? u.includedByParent : folder.path}
            >
              <input
                type="checkbox"
                aria-label={folder.path}
                checked={chosen.has(folder.path) || covered !== null}
                disabled={covered !== null || saving}
                onChange={(e) => toggle(folder.path, e.target.checked)}
                className="h-[15px] w-[15px] accent-primary"
              />
              <span className={`font-mono break-all ${covered ? "text-muted" : "text-foreground"}`}>{folder.name}</span>
            </label>
          </div>
          {isOpen && folder.has_children && renderLevel(folder.path, depth + 1)}
        </div>
      );
    });
  }

  const missing = project.missing_folders;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Icon name="check" size={15} className="text-primary-soft" /> {u.foldersTitle}
        </h3>
        <p className="mt-1 text-xs text-muted">{u.foldersHint}</p>
      </div>
      <div role="group" aria-label={u.foldersTitle} className="max-h-80 overflow-auto rounded-xl border border-border/70 bg-background/50 px-2 py-1.5">
        {renderLevel("", 0)}
      </div>
      {missing.length > 0 && <p className="text-xs text-amber-200">{u.missingFolders(missing.join(", "))}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs ${chosen.size ? "text-muted" : "text-amber-200"}`}>
          {chosen.size ? u.foldersCount(chosen.size) : u.foldersNone}
          {dirty && <span className="text-amber-200"> · {u.unsaved}</span>}
        </span>
        <Button size="sm" variant="primary" disabled={saving || !dirty} onClick={save}>
          <Icon name="check" size={14} /> {saving ? u.savingFolders : u.saveFolders}
        </Button>
      </div>
      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`text-xs ${notice.tone === "error" ? "text-rose-200" : "text-emerald-300"}`}>
          {notice.text}
        </p>
      )}
    </div>
  );
}
