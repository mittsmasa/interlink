import type { SimEdge, SimNode } from "@/lib/diagram/simulate";

// 図 → シミュレーション入力の変換は MCP（run_simulation）とも共用するため lib 側に置く
export { toSimEdges, toSimNodes } from "@/lib/diagram/sim-inputs";

/**
 * 実行ボタンの出し分け用の軽い判定。stock が 1 つも無ければシミュレーションは成立しない
 * （時間発展する量が無い）。厳密な妥当性（式の参照解決・循環・missing-field 等）は
 * simulate に委ね、ここでは「押せる状態かどうか」だけを大まかに見る。
 */
export function canSimulate(simNodes: SimNode[]): boolean {
  return simNodes.some((node) => node.kind === "stock");
}

/**
 * 図に「遅れ」付きのリンクがあるか。遅れステップ数の入力を出すかどうかの判定に使う
 * （遅れが 1 本も無い図では効かない設定なので、パネルに出さない）。
 */
export function hasDelayedEdges(simEdges: SimEdge[]): boolean {
  return simEdges.some((edge) => edge.hasDelay);
}

export type SeriesMode = "all" | "stock";

/**
 * グラフに描く系列（ノード名）を表示モードで絞る。色は名前順 index で決まるため
 * 元の並び順を保つ。"stock" は kind==="stock" のみ、"all" は全 SimNode。
 */
export function visibleSeriesNames(
  simNodes: SimNode[],
  mode: SeriesMode,
): string[] {
  return simNodes
    .filter((node) => mode === "all" || node.kind === "stock")
    .map((node) => node.name);
}
