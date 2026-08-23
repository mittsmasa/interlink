import {
  BEHAVIOR_PATTERN_LABELS,
  type BehaviorPattern,
} from "@/lib/interview/notes";
import type { SimConfig, SimSnapshot } from "./simulate";

/** initial → final の向き */
export type StockTrend = "up" | "down" | "flat";

export type StockSummary = {
  name: string;
  initial: number;
  final: number;
  min: number;
  max: number;
  trend: StockTrend;
  /** 時系列の形を聞き取りノートの時間挙動（BOT）語彙で分類したもの */
  pattern: BehaviorPattern;
};

export type SimulationSummary = {
  dt: number;
  steps: number;
  stocks: StockSummary[];
  /** 間引いた時系列（先頭と末尾は必ず含む） */
  series: SimSnapshot[];
  /** 間引く前の点数 */
  totalPoints: number;
};

export type BehaviorMismatch = {
  noted: BehaviorPattern;
  observed: { name: string; pattern: BehaviorPattern }[];
  message: string;
};

/** 応答に含める時系列の既定点数（外部エージェントに全ステップを返さない） */
export const DEFAULT_MAX_POINTS = 21;

/** 値の変化を「有意」とみなす閾値（値域に対する比率） */
const SIGNIFICANT_RATIO = 0.01;
/** 末尾区間の変化が全体変化のこの比率未満なら「頭打ち」とみなす */
const PLATEAU_TAIL_RATIO = 0.05;
/** 頭打ち判定に必要な最小点数（これ未満では末尾区間が短すぎて判定できない） */
const PLATEAU_MIN_POINTS = 8;

/**
 * 1 本の時系列を BEHAVIOR_PATTERNS の語彙で分類する（値域に対する相対判定なので
 * 単位に依存しない）。決定的で、同じ数列には同じ分類を返す。
 * - 符号反転 2 回以上 → oscillating
 * - 1 回（上がって下がる）→ improved-then-worse / （下がって上がる）→ other
 * - 単調増加で末尾が平らになる → plateau、それ以外の単調増加 → increasing
 * - 単調減少 → decreasing
 * - ほぼ変化なし → plateau
 */
export function classifyBehavior(values: number[]): BehaviorPattern {
  if (values.length < 2) return "other";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const magnitude = Math.max(1, Math.abs(max), Math.abs(min));
  if (range <= magnitude * Number.EPSILON * 100) return "plateau";
  const tol = range * SIGNIFICANT_RATIO;

  // 有意な変化だけ見て向きの反転回数を数える
  const signs: (1 | -1)[] = [];
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (Math.abs(d) <= tol) continue;
    const s = d > 0 ? 1 : -1;
    if (signs.length === 0 || signs[signs.length - 1] !== s) signs.push(s);
  }
  if (signs.length === 0) return "plateau";
  const reversals = signs.length - 1;
  if (reversals >= 2) return "oscillating";
  if (reversals === 1) return signs[0] === 1 ? "improved-then-worse" : "other";

  const direction = signs[0];
  if (direction === -1) return "decreasing";
  if (values.length >= PLATEAU_MIN_POINTS) {
    const tailStart = Math.floor(values.length * 0.75);
    const tailChange = Math.abs(values[values.length - 1] - values[tailStart]);
    if (tailChange < range * PLATEAU_TAIL_RATIO) return "plateau";
  }
  return "increasing";
}

/** 値域の 1% 未満の差は変化なしとみなして向きを決める */
function trendOf(values: number[]): StockTrend {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const tol = Math.max(
    (max - min) * SIGNIFICANT_RATIO,
    Math.max(1, Math.abs(max), Math.abs(min)) * Number.EPSILON * 100,
  );
  const delta = values[values.length - 1] - values[0];
  if (delta > tol) return "up";
  if (delta < -tol) return "down";
  return "flat";
}

/**
 * 時系列を等間隔に maxPoints 点へ間引く。先頭と末尾は必ず残す。
 * 点数が maxPoints 以下ならそのまま返す
 */
export function thinSeries<T>(series: T[], maxPoints: number): T[] {
  const n = series.length;
  if (maxPoints < 2 || n <= maxPoints) return series;
  const picked: T[] = [];
  let last = -1;
  for (let i = 0; i < maxPoints; i++) {
    const index = Math.round((i * (n - 1)) / (maxPoints - 1));
    if (index === last) continue;
    picked.push(series[index]);
    last = index;
  }
  return picked;
}

/**
 * simulate の結果を、外部エージェントが読める粒度に要約する。
 * stock ごとに初期値・最終値・最小/最大・向き・挙動パターンを出し、時系列は間引く。
 * `final` は series 末尾の値（= 最終ステップ後の stock 値）として定義する
 */
export function summarizeSimulation(
  series: SimSnapshot[],
  config: Pick<SimConfig, "dt" | "steps">,
  stockNames: string[],
  options: { maxPoints?: number } = {},
): SimulationSummary {
  const maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS;
  const stocks: StockSummary[] = [];
  for (const name of stockNames) {
    const values = series.map((s) => s[name]).filter(Number.isFinite);
    if (values.length === 0) continue;
    stocks.push({
      name,
      initial: values[0],
      final: values[values.length - 1],
      min: Math.min(...values),
      max: Math.max(...values),
      trend: trendOf(values),
      pattern: classifyBehavior(values),
    });
  }
  return {
    dt: config.dt,
    steps: config.steps,
    stocks,
    series: thinSeries(series, maxPoints),
    totalPoints: series.length,
  };
}

/**
 * 聞き取りノートの時間挙動（テーマ単位の 1 パターン）とシミュレーション結果を突き合わせる。
 * いずれかの stock がノートのパターンと一致すれば整合とみなし null を返す。
 * どの stock も一致しなければ、図の構造がユーザーの実感を再現できていない可能性として
 * mismatch を返す（ノート未記入なら null）
 */
export function findBehaviorMismatch(
  noted: BehaviorPattern | null | undefined,
  stocks: Pick<StockSummary, "name" | "pattern">[],
): BehaviorMismatch | null {
  if (!noted || stocks.length === 0) return null;
  if (stocks.some((s) => s.pattern === noted)) return null;
  const observed = stocks.map((s) => ({ name: s.name, pattern: s.pattern }));
  const observedText = observed
    .map((o) => `${o.name}=${BEHAVIOR_PATTERN_LABELS[o.pattern]}`)
    .join("、");
  return {
    noted,
    observed,
    message: `聞き取りノートの時間挙動は「${BEHAVIOR_PATTERN_LABELS[noted]}」ですが、シミュレーションではどの stock もその形になっていません（${observedText}）。式・初期値・ループ構造のどこが実感と違うかをユーザーに確かめてください`,
  };
}
