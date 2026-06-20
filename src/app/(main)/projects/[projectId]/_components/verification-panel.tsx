"use client";

import { CaretDownIcon, CompassIcon, WarningIcon } from "@phosphor-icons/react";
import type { ArchetypeMatch } from "@/lib/diagram/archetypes";
import type { LintFinding } from "@/lib/diagram/lint";
import type { Loop, LoopDetectionResult } from "@/lib/diagram/loops";
import { cn } from "@/lib/utils";
import { LoopPolarityIcon, loopColor } from "./loop-badges";

type VerificationPanelProps = {
  loopResult: LoopDetectionResult;
  findings: LintFinding[];
  matches: ArchetypeMatch[];
  open: boolean;
  onToggle: () => void;
  onHighlightLoop: (loop: Loop | null) => void;
  onSelectFinding: (finding: LintFinding) => void;
};

/**
 * 図の構造検証（ループ / lint / 原型）をまとめて見せるパネル。
 * キャンバス左上に折りたたみで置く（inspector は右上）。
 */
export function VerificationPanel({
  loopResult,
  findings,
  matches,
  open,
  onToggle,
  onHighlightLoop,
  onSelectFinding,
}: VerificationPanelProps) {
  const { loops, truncated } = loopResult;
  const warningCount = findings.filter((f) => f.severity === "warning").length;

  return (
    <div className="absolute top-3 left-3 flex max-h-[calc(100%-1.5rem)] w-80 max-sm:w-[calc(100%-1.5rem)] flex-col">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-fit items-center gap-2 rounded-lg border bg-card/95 px-3 py-1.5 shadow-md backdrop-blur-sm transition-colors hover:bg-accent"
        aria-expanded={open}
      >
        <CompassIcon className="size-4 text-muted-foreground" />
        <span className="font-serif text-sm">構造を読む</span>
        {loops.length > 0 && (
          <span className="rounded-full border px-1.5 font-serif text-muted-foreground text-xs">
            {loops.length}
          </span>
        )}
        {warningCount > 0 && (
          <span
            className="size-1.5 rounded-full bg-(--vermilion)"
            title={`気になる点 ${warningCount} 件`}
          />
        )}
        <CaretDownIcon
          className={cn(
            "size-3 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="ink-in mt-2 space-y-4 overflow-y-auto rounded-lg border bg-card/95 p-4 shadow-md backdrop-blur-sm">
          <section>
            <h2 className="mb-2 font-serif text-muted-foreground text-xs tracking-wide">
              ループ
            </h2>
            {loops.length === 0 ? (
              <p className="text-muted-foreground text-sm leading-relaxed">
                まだ閉じたループはありません。対話を続けると円環が見えてきます。
              </p>
            ) : (
              <>
                {truncated && (
                  <p className="mb-2 text-muted-foreground text-xs">
                    ループが多すぎるため一部のみ表示しています
                  </p>
                )}
                <ul className="space-y-1">
                  {loops.map((loop) => (
                    <li key={loop.id}>
                      <button
                        type="button"
                        className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent"
                        onMouseEnter={() => onHighlightLoop(loop)}
                        onMouseLeave={() => onHighlightLoop(null)}
                        onFocus={() => onHighlightLoop(loop)}
                        onBlur={() => onHighlightLoop(null)}
                      >
                        <LoopChip loop={loop} />
                        <span className="text-xs leading-relaxed">
                          {loop.nodeNames.join(" → ")} → {loop.nodeNames[0]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {loops.some((l) => l.derived) && (
                  <p className="mt-2 text-muted-foreground text-xs leading-relaxed">
                    破線枠は式から推定した暫定ループです。因果リンクを引くと確定します。
                  </p>
                )}
              </>
            )}
          </section>

          {findings.length > 0 && (
            <section>
              <h2 className="mb-2 font-serif text-muted-foreground text-xs tracking-wide">
                気になる点
              </h2>
              <ul className="space-y-1">
                {findings.map((finding) => (
                  <li
                    // 同一 rule + 同一ノードの指摘が複数出ることがある（例: 1 つの式が
                    // 複数ノードに依存する missing-dependency-link）。message まで含めて一意化する
                    key={`${finding.rule}:${finding.nodeIds?.[0] ?? finding.edgeIds?.[0]}:${finding.message}`}
                  >
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent"
                      onClick={() => onSelectFinding(finding)}
                    >
                      {finding.severity === "warning" ? (
                        <WarningIcon className="mt-0.5 size-3.5 shrink-0 text-(--vermilion)" />
                      ) : (
                        <span className="mt-0.5 size-3.5 shrink-0 text-center text-muted-foreground text-xs">
                          ◦
                        </span>
                      )}
                      <span className="text-xs leading-relaxed">
                        {finding.message}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {matches.length > 0 && (
            <section>
              <h2 className="mb-2 font-serif text-muted-foreground text-xs tracking-wide">
                似ている構造
              </h2>
              <ul className="space-y-2">
                {matches.map((match) => (
                  <li key={match.archetypeId} className="px-1.5">
                    <p className="font-serif text-sm" title={match.description}>
                      「{match.name}」に似ています
                    </p>
                    <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
                      {match.question}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function LoopChip({ loop }: { loop: Loop }) {
  const color = loopColor(loop.polarity);
  const kindLabel =
    loop.polarity === "R"
      ? "自己強化ループ"
      : loop.polarity === "B"
        ? "バランスループ"
        : "極性は不定です";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 font-serif text-xs",
        loop.derived && "border-dashed",
      )}
      style={{ color, borderColor: color }}
      title={loop.derived ? `${kindLabel}（式から推定・暫定）` : kindLabel}
    >
      <LoopPolarityIcon polarity={loop.polarity} className="size-3" />
      {loop.label}
      {loop.hasDelay && <span title="遅れを含む">∥</span>}
    </span>
  );
}
