"use client";

import { CaretDownIcon, ChartLineIcon, PlayIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type SimResult, simulate } from "@/lib/diagram/simulate";
import type { Diagram } from "@/lib/queries/diagrams";
import { cn } from "@/lib/utils";
import { SimChart } from "./sim-chart";
import { canSimulate, toSimEdges, toSimNodes } from "./sim-inputs";

type SimulationPanelProps = {
  diagram: Diagram;
};

/**
 * シミュレーション実行 + 時系列グラフのフローティングパネル。キャンバス左下に折りたたみで置く
 * （構造パネルは左上、inspector は右上）。simulate はクライアントで呼ぶ純粋関数で、結果は保存
 * しない（ループ/lint と同思想）。
 */
export function SimulationPanel({ diagram }: SimulationPanelProps) {
  const [open, setOpen] = useState(false);
  const [dt, setDt] = useState("1");
  const [steps, setSteps] = useState("20");
  const [result, setResult] = useState<SimResult | null>(null);

  const { simNodes, simEdges, names, runnable } = useMemo(() => {
    const simNodes = toSimNodes(diagram.nodes);
    return {
      simNodes,
      simEdges: toSimEdges(diagram.edges),
      names: simNodes.map((n) => n.name),
      runnable: canSimulate(simNodes),
    };
  }, [diagram]);

  const run = () => {
    // 数値変換は simulate 側の config 検証に委ねる（空欄→0, 不正→NaN はそこで
    // invalid-config として人間可読メッセージになる）
    setResult(
      simulate(simNodes, simEdges, { dt: Number(dt), steps: Number(steps) }),
    );
  };

  return (
    <div className="absolute bottom-3 left-3 flex w-80 flex-col-reverse">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
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
          <div className="flex items-end gap-2">
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
                className="h-8 w-16"
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
                className="h-8 w-20"
              />
            </div>
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
              <SimChart series={result.series} names={names} />
            ) : (
              <p className="text-(--vermilion) text-sm leading-relaxed">
                {result.error.message}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
