"use client";

import {
  ArrowsOutIcon,
  CaretDownIcon,
  ChartLineIcon,
  PlayIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SimConfigRecord } from "@/lib/diagram/sim-config";
import { type SimResult, simulate } from "@/lib/diagram/simulate";
import type { Diagram } from "@/lib/queries/diagrams";
import { cn } from "@/lib/utils";
import { updateSimConfig } from "../_actions";
import { LARGE_DIMS, SimChart } from "./sim-chart";
import {
  canSimulate,
  hasDelayedEdges,
  type SeriesMode,
  toSimEdges,
  toSimNodes,
  visibleSeriesNames,
} from "./sim-inputs";

type SimulationPanelProps = {
  projectId: string;
  diagram: Diagram;
  /** 保存済みの設定。入力欄の初期値になり、変更はここへ書き戻す */
  simConfig: SimConfigRecord;
  open: boolean;
  onToggle: () => void;
};

/**
 * シミュレーション実行 + 時系列グラフのフローティングパネル。キャンバス左下に折りたたみで置く
 * （構造パネルは左上、inspector は右上）。simulate はクライアントで呼ぶ純粋関数で、結果は保存
 * しない（ループ/lint と同思想）。
 *
 * ただし dt / steps / 時間単位は「この問いをどの時間軸で眺めるか」という決め事なので
 * プロジェクトに保存する（MCP の run_simulation もこの値を既定値として読む）。
 * 遅れステップ数は実行ごとの試行なので保存しない。
 */
export function SimulationPanel({
  projectId,
  diagram,
  simConfig,
  open,
  onToggle,
}: SimulationPanelProps) {
  const [dt, setDt] = useState(String(simConfig.dt));
  const [steps, setSteps] = useState(String(simConfig.steps));
  const [timeUnit, setTimeUnit] = useState(simConfig.timeUnit ?? "");
  const [delaySteps, setDelaySteps] = useState("1");
  const [result, setResult] = useState<SimResult | null>(null);
  const [mode, setMode] = useState<SeriesMode>("all");
  const [expanded, setExpanded] = useState(false);
  const [, startTransition] = useTransition();

  const { simNodes, simEdges, runnable, delayed } = useMemo(() => {
    const simNodes = toSimNodes(diagram.nodes);
    const simEdges = toSimEdges(diagram.edges);
    return {
      simNodes,
      simEdges,
      runnable: canSimulate(simNodes),
      delayed: hasDelayedEdges(simEdges),
    };
  }, [diagram]);

  // 表示モードに応じて描く系列を絞る（all=全 kind / stock=ストックのみ）
  const names = useMemo(
    () => visibleSeriesNames(simNodes, mode),
    [simNodes, mode],
  );

  // 拡大オーバーレイ表示中は背景スクロールを止め、Esc で閉じられるようにする
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  /**
   * 入力を設定として保存する。入力途中の 1 文字ごとには書かず、欄を離れたときと
   * 実行時だけ呼ぶ。数値として読めない値は送らない（保存側でも既定へ倒れるが、
   * 入力中の中途半端な値で上書きしないため）
   */
  const persist = () => {
    const patch: { dt?: number; steps?: number; timeUnit?: string | null } = {
      timeUnit: timeUnit.trim() === "" ? null : timeUnit,
    };
    const dtValue = Number(dt);
    if (dt.trim() !== "" && Number.isFinite(dtValue) && dtValue > 0) {
      patch.dt = dtValue;
    }
    const stepsValue = Number(steps);
    if (
      steps.trim() !== "" &&
      Number.isInteger(stepsValue) &&
      stepsValue >= 1
    ) {
      patch.steps = stepsValue;
    }
    startTransition(async () => {
      await updateSimConfig(projectId, patch);
    });
  };

  const run = () => {
    persist();
    // 数値変換は simulate 側の config 検証に委ねる（空欄→0, 不正→NaN はそこで
    // invalid-config として人間可読メッセージになる）
    setResult(
      simulate(simNodes, simEdges, {
        dt: Number(dt),
        steps: Number(steps),
        delaySteps: Number(delaySteps),
      }),
    );
  };

  return (
    <div
      // 外側クリックで閉じる判定の目印（diagram-canvas の pointerdown ハンドラが参照）。
      // 拡大オーバーレイもこの配下なので、オーバーレイ内のクリックでは閉じない
      data-floating-panel
      className="absolute bottom-3 left-3 flex w-80 max-sm:w-[calc(100%-1.5rem)] flex-col-reverse"
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-fit items-center gap-2 rounded-lg border bg-card/95 px-3 py-1.5 shadow-md backdrop-blur-sm transition-colors hover:bg-accent"
        aria-expanded={open}
      >
        <ChartLineIcon className="size-4 text-muted-foreground" />
        <span className="font-serif text-sm">シミュレーション</span>
        <CaretDownIcon
          className={cn(
            "size-3 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="ink-in mb-2 space-y-3 rounded-lg border bg-card/95 p-4 shadow-md backdrop-blur-sm">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="sim-dt" className="text-muted-foreground text-xs">
                dt
              </Label>
              <Input
                id="sim-dt"
                type="number"
                step="0.1"
                value={dt}
                onChange={(e) => setDt(e.target.value)}
                onBlur={persist}
                className="h-8 w-14"
              />
            </div>
            <div className="space-y-1">
              <Label
                htmlFor="sim-steps"
                className="text-muted-foreground text-xs"
              >
                steps
              </Label>
              <Input
                id="sim-steps"
                type="number"
                step="1"
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
                onBlur={persist}
                className="h-8 w-16"
              />
            </div>
            <div className="space-y-1">
              <Label
                htmlFor="sim-unit"
                className="text-muted-foreground text-xs"
              >
                単位
              </Label>
              <Input
                id="sim-unit"
                value={timeUnit}
                onChange={(e) => setTimeUnit(e.target.value)}
                onBlur={persist}
                placeholder="週"
                className="h-8 w-14"
              />
            </div>
            {/* 遅れ付きリンクがある図でだけ出す（無い図では効かない設定のため） */}
            {delayed && (
              <div className="space-y-1">
                <Label
                  htmlFor="sim-delay"
                  className="text-muted-foreground text-xs"
                >
                  遅れ
                </Label>
                <Input
                  id="sim-delay"
                  type="number"
                  step="1"
                  min="1"
                  value={delaySteps}
                  onChange={(e) => setDelaySteps(e.target.value)}
                  className="h-8 w-14"
                />
              </div>
            )}
            <Button
              size="sm"
              className="ml-auto gap-1.5"
              disabled={!runnable}
              onClick={run}
            >
              <PlayIcon className="size-3.5" weight="fill" />
              実行
            </Button>
          </div>

          {runnable && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">表示</span>
              <div className="flex gap-1">
                <ModeButton
                  active={mode === "stock"}
                  onClick={() => setMode("stock")}
                >
                  ストックのみ
                </ModeButton>
                <ModeButton
                  active={mode === "all"}
                  onClick={() => setMode("all")}
                >
                  すべて
                </ModeButton>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                disabled={!result?.ok}
                aria-label="グラフを拡大"
                className="ml-auto rounded-md border p-1.5 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
              >
                <ArrowsOutIcon className="size-3.5" />
              </button>
            </div>
          )}

          <div className="min-h-24">
            {!runnable ? (
              <p className="text-muted-foreground text-sm leading-relaxed">
                ストックに初期値、フロー/補助変数に式を設定すると実行できます。
              </p>
            ) : result === null ? (
              <p className="text-muted-foreground text-sm leading-relaxed">
                dt と steps
                を決めて「実行」すると、各変数の時間変化が描かれます。
              </p>
            ) : result.ok ? (
              names.length > 0 ? (
                <SimChart series={result.series} names={names} />
              ) : (
                <p className="text-muted-foreground text-sm leading-relaxed">
                  表示する系列がありません（ストックがありません）。
                </p>
              )
            ) : (
              <p className="text-(--vermilion) text-sm leading-relaxed">
                {result.error.message}
              </p>
            )}
          </div>
        </div>
      )}

      {expanded && result?.ok && (
        // biome-ignore lint/a11y/noStaticElementInteractions: 背景クリックで閉じる軽量オーバーレイ。閉じる操作は ✕ ボタンと Esc でも可能
        // biome-ignore lint/a11y/useKeyWithClickEvents: Esc と ✕ ボタンで閉じられる。背景クリックは補助的な手段
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setExpanded(false);
          }}
        >
          <div className="relative max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg border bg-card p-6 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-sm">シミュレーション結果</h2>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-label="閉じる"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent"
              >
                <XIcon className="size-4" />
              </button>
            </div>
            {names.length > 0 ? (
              <SimChart
                series={result.series}
                names={names}
                dims={LARGE_DIMS}
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                表示する系列がありません。
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-1 font-serif text-xs transition-colors",
        active
          ? "border-ink bg-ink/10 text-ink"
          : "text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
