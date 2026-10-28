"use client";

import { useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import type { MomentDraft, MomentError, VideoDurations } from "@/lib/analysis";
import { formatOffset, formatTime, parseTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MatchedMoment, MomentKind } from "@/lib/types";

import { formatLength, formatSpan, momentErrorText, type FormError } from "./momentText";

type MomentListProps = {
  kind: MomentKind;
  moments: MatchedMoment[];
  selectedId: string | null;
  durations: VideoDurations;
  enabled: boolean;
  onSelect: (moment: MatchedMoment) => void;
  onUpdate: (id: string, draft: MomentDraft) => MomentError | null;
  onRemove: (id: string) => void;
  onClear: () => void;
};

/** Frame pairs or clip pairs. Clicking a row selects it for analysis and seeks both videos. */
export default function MomentList(props: MomentListProps) {
  const { kind, moments, selectedId, durations, enabled } = props;
  const { t } = useI18n();
  const a = t.analysis;
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">
          {kind === "frame" ? a.frameListTitle : a.clipListTitle}{" "}
          <span className="font-mono text-xs text-muted">({moments.length})</span>
        </h3>
        {moments.length > 0 && (
          <Button size="sm" variant="ghost" onClick={props.onClear}>
            {a.clearAll}
          </Button>
        )}
      </div>

      {moments.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-xs text-muted">
          {kind === "frame" ? a.emptyFrames : a.emptyClips}
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {moments.map((moment, index) =>
            editingId === moment.id ? (
              <MomentEditor
                key={moment.id}
                moment={moment}
                index={index}
                durations={durations}
                onSave={(draft) => {
                  const error = props.onUpdate(moment.id, draft);
                  if (!error) setEditingId(null);
                  return error;
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <li
                key={moment.id}
                className={`flex items-center gap-2 rounded-xl border px-2 py-1.5 transition-colors ${
                  moment.id === selectedId ? "border-primary-soft/60 bg-primary/15" : "border-border/70 bg-background/40 hover:border-primary-soft/40"
                }`}
              >
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => props.onSelect(moment)}
                  title={a.seekPair}
                  aria-pressed={moment.id === selectedId}
                  className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-1.5 py-1 text-left disabled:cursor-not-allowed"
                >
                  <span
                    className={`mt-0.5 flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-[10px] ${
                      moment.id === selectedId ? "bg-primary-soft text-background" : "bg-surface-raised text-muted"
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className={`truncate text-sm ${moment.description ? "text-foreground" : "text-muted italic"}`}>
                      {moment.description ?? a.noEvent}
                    </span>
                    <MomentTimes moment={moment} />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(moment.id)}
                  aria-label={`${a.edit} #${index + 1}`}
                  title={a.edit}
                  className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                >
                  <Icon name="pencil" size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => props.onRemove(moment.id)}
                  aria-label={`${a.delete} #${index + 1}`}
                  title={a.delete}
                  className="rounded-lg p-1.5 text-muted transition-colors hover:bg-rose-400/10 hover:text-rose-300"
                >
                  <Icon name="trash" size={14} />
                </button>
              </li>
            ),
          )}
        </ol>
      )}
    </div>
  );
}

function MomentTimes({ moment }: { moment: MatchedMoment }) {
  const { t } = useI18n();
  const a = t.analysis;
  if (moment.kind === "frame") {
    return (
      <span className="flex flex-wrap items-center gap-x-2.5 font-mono text-xs">
        <span className="text-primary-soft">
          {a.reference} {formatTime(moment.referenceMs)}
        </span>
        <span className="text-muted">↔</span>
        <span className="text-accent">
          {a.current} {formatTime(moment.currentMs)}
        </span>
        <span className="text-muted">
          {a.offset} {formatOffset(moment.currentMs - moment.referenceMs)}
        </span>
      </span>
    );
  }
  return (
    <span className="flex flex-col font-mono text-xs">
      <span className="text-primary-soft">
        {a.reference} {formatSpan(moment.referenceStartMs, moment.referenceEndMs)}{" "}
        <span className="text-muted">({formatLength(moment.referenceEndMs - moment.referenceStartMs)})</span>
      </span>
      <span className="text-accent">
        {a.current} {formatSpan(moment.currentStartMs, moment.currentEndMs)}{" "}
        <span className="text-muted">({formatLength(moment.currentEndMs - moment.currentStartMs)})</span>
      </span>
    </span>
  );
}

type MomentEditorProps = {
  moment: MatchedMoment;
  index: number;
  durations: VideoDurations;
  onSave: (draft: MomentDraft) => MomentError | null;
  onCancel: () => void;
};

function MomentEditor({ moment, index, durations, onSave, onCancel }: MomentEditorProps) {
  const { t } = useI18n();
  const a = t.analysis;
  const initial =
    moment.kind === "frame"
      ? [moment.referenceMs, moment.currentMs]
      : [moment.referenceStartMs, moment.referenceEndMs, moment.currentStartMs, moment.currentEndMs];
  const [values, setValues] = useState(initial.map((ms) => formatTime(ms, 3)));
  const [description, setDescription] = useState(moment.description ?? "");
  const [error, setError] = useState<FormError | null>(null);

  const labels =
    moment.kind === "frame"
      ? [a.reference, a.current]
      : [`${a.reference} ${a.start}`, `${a.reference} ${a.end}`, `${a.current} ${a.start}`, `${a.current} ${a.end}`];

  function save() {
    const ms = values.map(parseTime);
    if (ms.some((v) => v === null)) return setError("format");
    const [r0, r1, c0, c1] = ms as number[];
    const draft: MomentDraft =
      moment.kind === "frame"
        ? { kind: "frame", referenceMs: r0, currentMs: r1, description }
        : { kind: "clip", referenceStartMs: r0, referenceEndMs: r1, currentStartMs: c0, currentEndMs: c1, description };
    setError(onSave(draft));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") save();
    if (event.key === "Escape") onCancel();
  }

  const inputClass =
    "h-8 w-28 rounded-lg border border-border bg-surface px-2 font-mono text-xs text-foreground focus:border-primary-soft focus:outline-none";

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-primary-soft/50 bg-primary/10 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-5 min-w-5 items-center justify-center rounded bg-surface-raised px-1 font-mono text-[10px] text-muted">
          {index + 1}
        </span>
        {values.map((value, i) => (
          <input
            key={i}
            aria-label={labels[i]}
            title={labels[i]}
            value={value}
            onChange={(event) => {
              setValues((prev) => prev.map((v, j) => (j === i ? event.target.value : v)));
              setError(null);
            }}
            onKeyDown={onKeyDown}
            className={`${inputClass} ${i < values.length / 2 ? "border-primary-soft/40" : "border-accent/40"}`}
          />
        ))}
        <input
          aria-label={a.eventLabel}
          placeholder={a.eventPlaceholder}
          value={description}
          maxLength={120}
          onChange={(event) => setDescription(event.target.value)}
          onKeyDown={onKeyDown}
          className="h-8 min-w-40 flex-1 rounded-lg border border-border bg-surface px-2 text-xs text-foreground placeholder:text-muted/60 focus:border-primary-soft focus:outline-none"
        />
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="primary" onClick={save}>
            <Icon name="check" size={13} /> {a.save}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {a.cancel}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-rose-300">
          {momentErrorText(t, error, durations)}
        </p>
      )}
    </li>
  );
}
