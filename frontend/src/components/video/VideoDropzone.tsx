"use client";

import { useState, type DragEvent } from "react";

import Icon, { type IconName } from "@/components/ui/Icon";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { VIDEO_ACCEPT } from "@/lib/video";

type VideoDropzoneProps = {
  label: string;
  hint: string;
  icon: IconName;
  iconClassName: string;
  /** Validation message from the parent, shown under the drop area. */
  error: string | null;
  onSelect: (file: File) => void;
};

/** Click-or-drop area for choosing a local video file. Validation is done by the parent. */
export default function VideoDropzone({ label, hint, icon, iconClassName, error, onSelect }: VideoDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const { t } = useI18n();

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onSelect(file);
  }

  return (
    <label
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`group flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 text-center transition-all duration-200 focus-within:border-primary-soft focus-within:ring-2 focus-within:ring-primary-soft/30 ${
        error
          ? "border-rose-400/60 bg-rose-400/5"
          : dragging
            ? "border-primary-soft bg-primary/10"
            : "border-border bg-background/60 hover:border-primary-soft/60 hover:bg-background"
      }`}
    >
      <input
        type="file"
        accept={VIDEO_ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onSelect(file);
          event.target.value = "";
        }}
      />
      <span
        className={`mb-1 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-surface transition-transform duration-200 group-hover:-translate-y-0.5 ${iconClassName}`}
      >
        <Icon name={icon} size={22} />
      </span>
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="text-xs text-muted">{dragging ? t.video.dropHere : hint}</span>
      <span className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted transition-colors group-hover:text-foreground">
        <Icon name="upload" size={14} />
        {t.video.chooseFile}
      </span>
      <span className="text-[11px] text-muted/80">{t.video.formats}</span>
      {error && (
        <span role="alert" className="mt-1 max-w-sm text-xs text-rose-300">
          {error}
        </span>
      )}
    </label>
  );
}
