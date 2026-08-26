import type { NodeKind } from "@/db/schema";
import type { Loop } from "./loops";

/**
 * 未分類ノード（kind = null）の昇格候補を導出する。
 *
 * 設計 doc（m3-stock-and-flow.md 3〜4 章）の通り、判定の主軸である「一時停止テスト」
 * （時間を止めて残るか）は人の判断で、コードにはできない。ここが担うのは 4 章の
 * 「補助のものさし」3 つ — 単位が率か / 過去の積み重ねを表す語か / 何を直接増減させるか —
 * を決定的なルールに落とし、根拠付きの候補を出すところまで。**確定するのはユーザー**で、
 * この結果を自動適用してはいけない。
 *
 * ループ・lint と同じく保存せず毎回導出する純粋関数。
 */

export const CONFIDENCE_LEVELS = ["high", "mid", "low"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "高",
  mid: "中",
  low: "低",
};

/** 確からしさの表示ラベル（UI とアジェンダで共用） */
export function describeConfidence(confidence: Confidence): string {
  return CONFIDENCE_LABELS[confidence];
}

export const NODE_KIND_LABELS: Record<NodeKind, string> = {
  stock: "ストック",
  flow: "フロー",
  auxiliary: "補助変数",
  constant: "定数",
};

/** MCP 応答・アジェンダに載せる候補数の上限 */
export const MAX_KIND_SUGGESTIONS = 8;

/** 1 候補あたりの理由の上限（並べすぎると読まれない） */
const MAX_REASONS = 3;

export type KindSuggestion = {
  nodeId: string;
  name: string;
  suggestedKind: NodeKind;
  confidence: Confidence;
  /** 日本語の根拠。必ず 1 件以上入る */
  reasons: string[];
};

type SuggestNode = {
  id: string;
  name: string;
  unit: string | null;
  kind: NodeKind | null;
};

type SuggestEdge = { sourceNodeId: string; targetNodeId: string };

// ============================================================
// 語彙（小さな辞書。運用しながら足す前提で、代表的な語だけ持つ）
// ============================================================

/** 単位の分母に来る時間の語。「リットル/分」「件/週」を率と見分ける */
const TIME_WORDS = [
  "秒",
  "分",
  "時間",
  "時",
  "日",
  "週",
  "月",
  "年",
  "四半期",
  "sec",
  "min",
  "hour",
  "day",
  "week",
  "month",
  "year",
];

/** 「〜/週」「〜／月」「〜/1日」の形。数字を挟む書き方も拾う */
const PER_TIME_UNIT = new RegExp(
  `[/／]\\s*\\d*\\s*(${TIME_WORDS.join("|")})`,
  "i",
);

/** 「毎日」「毎週」のように分母を語で書く形 */
const EVERY_TIME_UNIT = /毎\s*(秒|分|時間|時|日|週|月|年)/;

/** 割合を表す単位。時点の量ではなく、その場で計算される中間値 */
const RATIO_UNITS = ["%", "％", "パーセント"];

/**
 * 過去のフローの積み重ねを表す語（doc 4 章のものさし 2）。
 * 「残業時間」は doc が文脈依存の例として挙げている（1 日あたり = flow / 累積 = stock）ので
 * 意図的に入れない。辞書で決めず、対話で確かめる語
 */
const ACCUMULATION_WORDS = [
  "疲労",
  "在庫",
  "残高",
  "信頼",
  "負債",
  "資産",
  "貯金",
  "体力",
  "ストレス",
  "士気",
  "モチベーション",
  "知識",
  "経験",
  "スキル",
  "人員",
  "顧客数",
  "評判",
  "待ち行列",
  "バックログ",
  "満足度",
];

/** 溜まった量を指す言い方の接尾辞 */
const ACCUMULATION_SUFFIXES = ["量", "数", "残高", "在庫"];

/** その瞬間に計算される中間値を指す語 */
const RATIO_WORDS = [
  "率",
  "割合",
  "比率",
  "指数",
  "効率",
  "密度",
  "確率",
  "スコア",
];

/** 変化しない前提の値を指す語 */
const CONSTANT_WORDS = [
  "上限",
  "下限",
  "目標",
  "定員",
  "単価",
  "係数",
  "閾値",
  "容量",
  "キャパ",
  "定数",
];

/** ストックを増減させる動きを表す語（doc 4 章のものさし 3） */
const FLOW_WORDS = [
  "増",
  "減",
  "流入",
  "流出",
  "回復",
  "消費",
  "供給",
  "補充",
  "採用",
  "離職",
  "入金",
  "出金",
  "支出",
  "収入",
  "投入",
  "生産",
  "廃棄",
  "発生",
  "解消",
  "追加",
  "削減",
  "休息",
  "ペース",
  "速度",
];

/**
 * 「〜率」「%」で補助変数と判じたノードは、名前に増減の語を含んでいても
 * フローへ上書きしない（「離職率」は離職フローの速さを決める中間値であって、
 * ストックを直接動かす量ではない）
 */
const RATIO_RULE_IDS = new Set(["unit-ratio", "name-ratio"]);

function includesAny(name: string, words: readonly string[]): string | null {
  return words.find((w) => name.includes(w)) ?? null;
}

// ============================================================
// 判定
// ============================================================

type Signal = {
  id: string;
  kind: NodeKind;
  confidence: Confidence;
  reason: string;
};

type NodeContext = {
  inDegree: number;
  outDegree: number;
  /** 参加しているループのラベル（表示順） */
  loopLabels: string[];
  /** 隣接ノード ID（向きを問わない） */
  neighborIds: string[];
};

/**
 * パス 1: 単位・語彙・構造から stock / auxiliary / constant のシグナルを集める。
 * 優先順位順に並べて返し、先頭が判定、以降の同じ kind は理由の補強になる。
 * flow は隣接ストックが決まらないと判定できないのでパス 2 で見る
 */
function collectSignals(node: SuggestNode, ctx: NodeContext): Signal[] {
  const signals: Signal[] = [];
  const name = node.name;
  const unit = node.unit?.trim() ?? "";

  const perTime =
    unit !== "" && (PER_TIME_UNIT.test(unit) || EVERY_TIME_UNIT.test(unit));
  const isRatioUnit = RATIO_UNITS.some((u) => unit.includes(u));

  if (perTime) {
    signals.push({
      id: "unit-per-time",
      kind: "flow",
      confidence: "high",
      reason: `単位「${unit}」が「〜あたり」の率。時間を止めると意味を失う量はフロー`,
    });
  }

  const accumulationWord = includesAny(name, ACCUMULATION_WORDS);
  if (accumulationWord) {
    signals.push({
      id: "name-accumulation",
      kind: "stock",
      confidence: "high",
      reason: `「${accumulationWord}」は過去の積み重ねを表す語。時間を止めても残る量はストック`,
    });
  }

  if (isRatioUnit) {
    signals.push({
      id: "unit-ratio",
      kind: "auxiliary",
      confidence: "high",
      reason: `単位「${unit}」は割合。その瞬間に他の値から計算される中間値`,
    });
  }

  const accumulationSuffix = ACCUMULATION_SUFFIXES.find((s) =>
    name.endsWith(s),
  );
  if (accumulationSuffix && !accumulationWord) {
    signals.push({
      id: "name-accumulation-suffix",
      kind: "stock",
      confidence: "mid",
      reason: `「〜${accumulationSuffix}」は溜まった量を指す言い方`,
    });
  }

  const ratioWord = includesAny(name, RATIO_WORDS);
  if (ratioWord) {
    signals.push({
      id: "name-ratio",
      kind: "auxiliary",
      confidence: "mid",
      reason: `「${ratioWord}」は他の値から計算される中間値を指す語`,
    });
  }

  if (unit !== "" && !perTime && !isRatioUnit) {
    signals.push({
      id: "unit-level",
      kind: "stock",
      confidence: "mid",
      reason: `単位「${unit}」は時点の量。時間を止めても残る`,
    });
  }

  if (
    ctx.loopLabels.length >= 1 &&
    ctx.inDegree >= 1 &&
    ctx.outDegree >= 1 &&
    ctx.inDegree + ctx.outDegree >= 3
  ) {
    signals.push({
      id: "loop-hub",
      kind: "stock",
      confidence: "mid",
      reason: `ループ ${ctx.loopLabels.join("・")} 上にあり、出入りが ${ctx.inDegree + ctx.outDegree} 本集まる要。ストックがループを断ち切って時間を運ぶ`,
    });
  }

  if (ctx.inDegree === 0) {
    signals.push({
      id: "no-incoming",
      kind: "constant",
      confidence: "mid",
      reason: "これを動かす原因のリンクが図に無く、外から与える固定値に見える",
    });
  }

  const constantWord = includesAny(name, CONSTANT_WORDS);
  if (constantWord) {
    signals.push({
      id: "name-constant",
      kind: "constant",
      confidence: "mid",
      reason: `「${constantWord}」は変化しない前提の値を指す語`,
    });
  }

  if (ctx.inDegree >= 1 && ctx.loopLabels.length === 0) {
    signals.push({
      id: "computed-only",
      kind: "auxiliary",
      confidence: "low",
      reason:
        "入ってくるリンクだけでループに入っておらず、他の変数から計算される途中の値に見える",
    });
  }

  return signals;
}

/** どのルールにも当たらないノードの落としどころ */
const FALLBACK_SIGNAL: Signal = {
  id: "fallback",
  kind: "auxiliary",
  confidence: "low",
  reason:
    "単位・語彙・構造のどれからも決め手が無い。まず補助変数として置き、一時停止テスト（時間を止めても残るか）で確かめる",
};

/** パス 2: ストックに接して増減を語るならフロー。パス 1 の判定を上書きする */
function flowSignal(
  node: SuggestNode,
  ctx: NodeContext,
  stockIds: ReadonlySet<string>,
  nameById: ReadonlyMap<string, string>,
): Signal | null {
  const flowWord = includesAny(node.name, FLOW_WORDS);
  if (!flowWord) return null;
  const neighborStock = ctx.neighborIds.find((id) => stockIds.has(id));
  if (neighborStock) {
    return {
      id: "flow-adjacent-stock",
      kind: "flow",
      confidence: "high",
      reason: `ストック候補「${nameById.get(neighborStock) ?? ""}」に接し、「${flowWord}」と増減の動きを表す。ストックを増減させる速さはフロー`,
    };
  }
  return {
    id: "flow-word-only",
    kind: "flow",
    confidence: "low",
    reason: `「${flowWord}」と増減の動きを表す語。ただし増減させるストックが図に見当たらない`,
  };
}

const CONFIDENCE_ORDER: Record<Confidence, number> = {
  high: 0,
  mid: 1,
  low: 2,
};

/**
 * 未分類ノードごとに昇格候補を返す。confidence の高い順 → 名前順で、同じ入力には
 * 常に同じ結果を返す。edges はループ検出と同じ集合（因果 + 式由来）を渡す想定
 */
export function suggestKinds(
  nodes: readonly SuggestNode[],
  edges: readonly SuggestEdge[],
  loops: readonly Loop[],
): KindSuggestion[] {
  const nameById = new Map(nodes.map((n) => [n.id, n.name]));
  const contextById = new Map<string, NodeContext>(
    nodes.map((n) => [
      n.id,
      { inDegree: 0, outDegree: 0, loopLabels: [], neighborIds: [] },
    ]),
  );

  for (const edge of edges) {
    const source = contextById.get(edge.sourceNodeId);
    const target = contextById.get(edge.targetNodeId);
    if (!source || !target) continue;
    source.outDegree += 1;
    target.inDegree += 1;
    if (edge.sourceNodeId === edge.targetNodeId) continue;
    source.neighborIds.push(edge.targetNodeId);
    target.neighborIds.push(edge.sourceNodeId);
  }

  for (const loop of loops) {
    for (const nodeId of new Set(loop.nodeIds)) {
      contextById.get(nodeId)?.loopLabels.push(loop.label);
    }
  }

  const unclassified = nodes.filter((n) => n.kind === null);

  // パス 1: 未分類ノードの暫定判定。フローの隣接判定に使うストック候補もここで決まる
  const pass1 = new Map<string, { decided: Signal; signals: Signal[] }>();
  for (const node of unclassified) {
    const ctx = contextById.get(node.id);
    if (!ctx) continue;
    const signals = collectSignals(node, ctx);
    pass1.set(node.id, { decided: signals[0] ?? FALLBACK_SIGNAL, signals });
  }

  const stockIds = new Set<string>([
    ...nodes.filter((n) => n.kind === "stock").map((n) => n.id),
    ...[...pass1].flatMap(([id, { decided }]) =>
      decided.kind === "stock" ? [id] : [],
    ),
  ]);

  // パス 2: ストックに接して増減を語るノードをフローへ上書きする
  const suggestions: KindSuggestion[] = [];
  for (const node of unclassified) {
    const ctx = contextById.get(node.id);
    const entry = pass1.get(node.id);
    if (!ctx || !entry) continue;
    const { decided, signals } = entry;
    const flow = RATIO_RULE_IDS.has(decided.id)
      ? null
      : flowSignal(node, ctx, stockIds, nameById);
    const final = flow ?? decided;
    const reasons = [
      final.reason,
      ...signals
        .filter((s) => s.id !== final.id && s.kind === final.kind)
        .map((s) => s.reason),
    ].slice(0, MAX_REASONS);
    suggestions.push({
      nodeId: node.id,
      name: node.name,
      suggestedKind: final.kind,
      confidence: final.confidence,
      reasons,
    });
  }

  return suggestions.sort(
    (a, b) =>
      CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] ||
      a.name.localeCompare(b.name, "ja"),
  );
}

/** 昇格候補の一言説明（アジェンダ / UI 共通）。例: 「ストック（確からしさ 中）」 */
export function describeSuggestion(suggestion: KindSuggestion): string {
  return `${NODE_KIND_LABELS[suggestion.suggestedKind]}（確からしさ ${describeConfidence(suggestion.confidence)}）`;
}
