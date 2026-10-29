"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import { apiErrorText } from "@/lib/api-errors";
import { clearEverything } from "@/lib/clear-data";
import { setFlash } from "@/lib/flash";
import { formatFileSize } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";

/** The word to type before the final button is enabled. Not translated, in every language. */
export const CONFIRM_WORD = "DELETE";

/** Settings → Data Management: Clear All Data with a typed confirmation. */
export default function DataManagement() {
  const { t } = useI18n();
  const d = t.dataManagement;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <Card className="border-rose-400/30">
      <CardHeader title={d.title} description={d.description} />
      <div className="mx-5 mb-5 flex flex-col gap-4 rounded-xl border border-rose-400/30 bg-rose-400/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-rose-200">
            <Icon name="alert" size={15} />
            {d.clearTitle}
          </p>
          <p className="mt-1 text-sm text-muted">{d.clearText}</p>
        </div>
        <Button ref={triggerRef} variant="danger" className="shrink-0" onClick={() => setOpen(true)}>
          <Icon name="trash" size={15} />
          {d.clearButton}
        </Button>
      </div>
      {open && <ClearDataDialog onCancel={close} />}
    </Card>
  );
}

function ClearDataDialog({ onCancel }: { onCancel: () => void }) {
  const { t } = useI18n();
  const d = t.dataManagement;
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const messageId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmed = typed === CONFIRM_WORD;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  async function deleteAll() {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    const outcome = await clearEverything();
    if (outcome.kind === "error" || outcome.kind === "unverified") {
      setError(outcome.kind === "error" ? `${d.failed} ${apiErrorText(t, outcome.error)}` : d.notVerified);
      setBusy(false);
      return;
    }
    setFlash(
      outcome.kind === "success"
        ? { tone: "ok", text: d.success(outcome.result.files_deleted, formatFileSize(outcome.result.bytes_freed)) }
        : { tone: "warn", text: d.offline },
    );
    router.push("/");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={d.cancel}
        tabIndex={-1}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => !busy && onCancel()}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="relative w-full max-w-md rounded-2xl border border-rose-400/30 bg-surface p-6 shadow-[0_25px_50px_rgb(0_0_0/0.5)]"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-400/10 text-rose-300">
            <Icon name="trash" size={20} />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-foreground">
              {d.dialogTitle}
            </h2>
            <p id={messageId} className="mt-2 text-sm leading-relaxed text-muted">
              {d.dialogMessage}
            </p>
          </div>
        </div>

        <p className="mt-4 rounded-xl border border-border/70 bg-background/50 px-3 py-2 text-xs text-muted">{d.keeps}</p>

        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            deleteAll();
          }}
        >
          <label htmlFor={inputId} className="flex flex-col gap-1.5 text-sm text-foreground">
            {d.typePrompt}
            <input
              id={inputId}
              ref={inputRef}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={busy}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={CONFIRM_WORD}
              className="h-10 rounded-xl border border-border bg-background px-3 font-mono text-sm tracking-widest text-foreground placeholder:text-muted/40 focus:border-rose-300 focus:outline-none disabled:opacity-40"
            />
          </label>

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs leading-relaxed text-rose-200">
              <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          {busy && (
            <p role="status" className="text-xs text-muted">
              {d.deleting}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={onCancel} disabled={busy}>
              {d.cancel}
            </Button>
            <Button type="submit" variant="danger" disabled={!confirmed || busy}>
              <Icon name="trash" size={15} />
              {d.confirm}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
