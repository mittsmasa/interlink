"use client";

import { CaretDownIcon, NotebookIcon } from "@phosphor-icons/react";
import { useState } from "react";
import {
  BEHAVIOR_PATTERN_LABELS,
  type InterviewNotes,
} from "@/lib/interview/notes";
import { type InterviewPhase, PHASE_LABELS } from "@/lib/interview/phase";
import { cn } from "@/lib/utils";

type NotesPanelProps = {
  notes: InterviewNotes;
  phase: InterviewPhase;
};

/**
 * 聞き取りメモ（読み取り専用）。AI が updateNotes で貯めた発散の材料と
 * 現在フェーズを見せる。チャットの onFinish → router.refresh() で自動更新。
 */
export function NotesPanel({ notes, phase }: NotesPanelProps) {
  const [open, setOpen] = useState(false);

  const isEmpty =
    notes.theme === null &&
    notes.behavior === null &&
    notes.idealBehavior === null &&
    notes.stakeholders.length === 0 &&
    notes.variableCandidates.length === 0;

  return (
    <div className="border-b">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-accent"
        aria-expanded={open}
      >
        <NotebookIcon className="size-4 text-muted-foreground" />
        <span className="font-serif text-sm">聞き取りメモ</span>
        <span className="ml-auto rounded-full border px-2 py-0.5 font-serif text-muted-foreground text-xs">
          いま: {PHASE_LABELS[phase]}
        </span>
        <CaretDownIcon
          className={cn(
            "size-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="px-4 pb-3 text-sm">
          {isEmpty ? (
            <p className="text-muted-foreground">
              対話が進むと、聞き取った材料がここに整理されます。
            </p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">テーマ</dt>
              <dd>{notes.theme ?? "—"}</dd>

              <dt className="text-muted-foreground">挙動</dt>
              <dd>
                {notes.behavior
                  ? `${BEHAVIOR_PATTERN_LABELS[notes.behavior.pattern]} — ${notes.behavior.description}`
                  : "—"}
                {notes.idealBehavior && (
                  <span className="text-muted-foreground">
                    （理想: {notes.idealBehavior}）
                  </span>
                )}
              </dd>

              <dt className="text-muted-foreground">関係者</dt>
              <dd>
                {notes.stakeholders.length > 0
                  ? notes.stakeholders.map((s) => (
                      <span
                        key={s.name}
                        title={s.concerns.join(" / ")}
                        className="after:content-['・'] last:after:content-none"
                      >
                        {s.name}
                      </span>
                    ))
                  : "—"}
              </dd>

              <dt className="text-muted-foreground">変数候補</dt>
              <dd>
                {notes.variableCandidates.length > 0
                  ? notes.variableCandidates.map((c) => (
                      <span
                        key={c.name}
                        title={c.source ? `出所: ${c.source}` : undefined}
                        className="after:content-['・'] last:after:content-none"
                      >
                        {c.name}
                      </span>
                    ))
                  : "—"}
              </dd>
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
