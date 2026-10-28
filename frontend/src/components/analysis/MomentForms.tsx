"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import type { MomentDraft, MomentError, VideoDurations } from "@/lib/analysis";
import { formatTime, parseTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";

import { formatLength, momentErrorText, type FormError } from "./momentText";

type FormProps = {
  /** Live playback positions (ms). */
  referenceNowMs: number;
  currentNowMs: number;
  durations: VideoDurations;
  enabled: boolean;
  onAdd: (draft: MomentDraft) => MomentError | null;
};

const SIDE_TONE = { reference: "text-primary-soft", current: "text-accent" } as const;

/** Single Frame: one moment per video. Fields follow the players until a value is captured or typed. */
export function FrameForm({ referenceNowMs, currentNowMs, durations, enabled, onAdd }: FormProps) {
  const { t } = useI18n();
  const a = t.analysis;
  // null = follow the player's live time
  const [reference, setReference] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<FormError | null>(null);

  function add() {
    const referenceMs = reference === null ? referenceNowMs : parseTime(reference);
    const currentMs = current === null ? currentNowMs : parseTime(current);
    if (referenceMs === null || currentMs === null) return setError("format");
    const result = onAdd({ kind: "frame", referenceMs, currentMs, description });
    setError(result);
    if (!result) {
      setReference(null);
      setCurrent(null);
      setDescription("");
    }
  }

  const change = (setter: (v: string | null) => void) => (value: string | null) => {
    setter(value);
    setError(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {(["reference", "current"] as const).map((side) => {
          const value = side === "reference" ? reference : current;
          const nowMs = side === "reference" ? referenceNowMs : currentNowMs;
          const set = change(side === "reference" ? setReference : setCurrent);
          return (
            <div key={side} className="rounded-xl border border-border/70 bg-background/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-medium ${SIDE_TONE[side]}`}>{a[side]}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                    value === null ? "bg-emerald-400/10 text-emerald-300" : "bg-primary/20 text-primary-soft"
                  }`}
                >
                  {value === null ? a.live : a.captured}
                </span>
              </div>
              <TimeInput label={a[side]} value={value ?? formatTime(nowMs)} disabled={!enabled} onChange={set} onEnter={add} large />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="ghost" disabled={!enabled} onClick={() => set(formatTime(nowMs))}>
                  <Icon name="target" size={13} /> {a.capture}
                </Button>
                {value !== null && (
                  <Button size="sm" variant="ghost" disabled={!enabled} onClick={() => set(null)}>
                    {a.follow}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <DescriptionAndAdd
        description={description}
        onDescription={setDescription}
        addLabel={a.addFrame}
        enabled={enabled}
        onAdd={add}
        message={error ? momentErrorText(t, error, durations) : null}
        hint={enabled ? a.frameHint : a.needVideos}
      />
    </div>
  );
}

type ClipDrafts = { referenceStart: string | null; referenceEnd: string | null; currentStart: string | null; currentEnd: string | null };
const EMPTY_CLIP: ClipDrafts = { referenceStart: null, referenceEnd: null, currentStart: null, currentEnd: null };

/** Short Clip: a from–to range per video, set with "Set start" / "Set end" or typed. */
export function ClipForm({ referenceNowMs, currentNowMs, durations, enabled, onAdd }: FormProps) {
  const { t } = useI18n();
  const a = t.analysis;
  const [drafts, setDrafts] = useState<ClipDrafts>(EMPTY_CLIP);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<FormError | null>(null);

  const set = (key: keyof ClipDrafts, value: string | null) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  function add() {
    if (Object.values(drafts).some((v) => v === null || v.trim() === "")) return setError("incomplete");
    const ms = {
      referenceStartMs: parseTime(drafts.referenceStart!),
      referenceEndMs: parseTime(drafts.referenceEnd!),
      currentStartMs: parseTime(drafts.currentStart!),
      currentEndMs: parseTime(drafts.currentEnd!),
    };
    if (Object.values(ms).some((v) => v === null)) return setError("format");
    const result = onAdd({ kind: "clip", ...(ms as Record<keyof typeof ms, number>), description });
    setError(result);
    if (!result) {
      setDrafts(EMPTY_CLIP);
      setDescription("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {(["reference", "current"] as const).map((side) => {
          const nowMs = side === "reference" ? referenceNowMs : currentNowMs;
          const startKey = `${side}Start` as const;
          const endKey = `${side}End` as const;
          const startMs = drafts[startKey] === null ? null : parseTime(drafts[startKey]!);
          const endMs = drafts[endKey] === null ? null : parseTime(drafts[endKey]!);
          return (
            <div key={side} className="flex flex-col gap-2 rounded-xl border border-border/70 bg-background/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-medium ${SIDE_TONE[side]}`}>{a[side]}</span>
                <span className="font-mono text-[11px] text-muted">
                  {a.live} {formatTime(nowMs)}
                </span>
              </div>
              {(
                [
                  [startKey, a.start, a.setStart],
                  [endKey, a.end, a.setEnd],
                ] as const
              ).map(([key, label, setLabel]) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-muted">{label}</span>
                  <TimeInput
                    label={`${a[side]} ${label}`}
                    value={drafts[key] ?? ""}
                    placeholder="--:--.--"
                    disabled={!enabled}
                    onChange={(v) => set(key, v)}
                    onEnter={add}
                  />
                  <Button size="sm" variant="ghost" disabled={!enabled} onClick={() => set(key, formatTime(nowMs))} className="shrink-0">
                    <Icon name="target" size={13} /> {setLabel}
                  </Button>
                </div>
              ))}
              <p className="h-4 text-right font-mono text-[11px] text-muted">
                {startMs !== null && endMs !== null && endMs > startMs ? a.length(formatLength(endMs - startMs)) : ""}
              </p>
            </div>
          );
        })}
      </div>
      <DescriptionAndAdd
        description={description}
        onDescription={setDescription}
        addLabel={a.addClip}
        enabled={enabled}
        onAdd={add}
        message={error ? momentErrorText(t, error, durations) : null}
        hint={enabled ? a.clipHint : a.needVideos}
      />
    </div>
  );
}

type TimeInputProps = {
  label: string;
  value: string;
  placeholder?: string;
  disabled: boolean;
  large?: boolean;
  onChange: (value: string) => void;
  onEnter: () => void;
};

export function TimeInput({ label, value, placeholder, disabled, large = false, onChange, onEnter }: TimeInputProps) {
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      disabled={disabled}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onEnter();
      }}
      className={`w-full min-w-0 rounded-lg border border-border bg-surface px-3 font-mono text-foreground tabular-nums placeholder:text-muted/50 focus:border-primary-soft focus:outline-none disabled:opacity-40 ${
        large ? "mt-2 h-10 text-lg" : "h-8 text-sm"
      }`}
    />
  );
}

type DescriptionAndAddProps = {
  description: string;
  onDescription: (value: string) => void;
  addLabel: string;
  enabled: boolean;
  onAdd: () => void;
  message: string | null;
  hint: string;
};

function DescriptionAndAdd({ description, onDescription, addLabel, enabled, onAdd, message, hint }: DescriptionAndAddProps) {
  const { t } = useI18n();
  return (
    <>
      <label className="flex flex-col gap-1.5 text-xs text-muted">
        {t.analysis.eventLabel}
        <input
          id="match-event-input"
          type="text"
          value={description}
          maxLength={120}
          disabled={!enabled}
          placeholder={t.analysis.eventPlaceholder}
          onChange={(event) => onDescription(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onAdd();
          }}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted/60 focus:border-primary-soft focus:outline-none disabled:opacity-40"
        />
      </label>
      <div className="flex flex-col items-center gap-2">
        <Button disabled={!enabled} onClick={onAdd} className="px-5">
          <Icon name="plusCircle" size={17} />
          {addLabel}
        </Button>
        {message ? (
          <p role="alert" className="text-center text-xs text-rose-300">
            {message}
          </p>
        ) : (
          <p className="text-center text-xs text-muted">{hint}</p>
        )}
      </div>
    </>
  );
}
