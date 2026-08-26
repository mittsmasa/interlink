import type { NodeKind } from "@/db/schema";
import type { Loop } from "@/lib/diagram/loops";
import type { InterviewNotes } from "./notes";

/**
 * 聞き取りの 5 フェーズ（ドラフト先行）。
 * 焦点（テーマと時間挙動を掴む）→ ドラフト（AI が変数と関係の叩き台を一枚描く）
 * → すり合わせ（ドラフトを実感と突き合わせ、違和感を直しループを確かめる）
 * → インサイト（確かめた構造のどこに手を入れるか、仮説を立てて試す）
 * → 定量化（役割・初期値・式・時間軸を入れ、仮説を数値で試せる形にする）。
 * フェーズは保存せず、ノートと図の状態から毎回導出する。
 *
 * 定量化はインサイトの後に来るが、行き止まりではない。数値が入れば
 * インサイトへ戻り、立てた仮説を overrides で試す（下の deriveInterviewPhase）。
 */
export const INTERVIEW_PHASES = [
  "focus",
  "draft",
  "refine",
  "insight",
  "quantify",
] as const;
export type InterviewPhase = (typeof INTERVIEW_PHASES)[number];

export const PHASE_LABELS: Record<InterviewPhase, string> = {
  focus: "焦点",
  draft: "ドラフト",
  refine: "すり合わせ",
  insight: "インサイト",
  quantify: "定量化",
};

/**
 * insight へ移るのに要るリンクの確認率。edges.status は NOT NULL（既定 inferred）なので
 * 実データでは常に評価される。つまりループを確認しただけでは insight に入らず、
 * リンクの半分以上を confirmed にする必要がある。
 * status を 1 つも持たない入力（テスト fixture 等）でのみ、この条件を飛ばして
 * ループの確認だけで判定する
 */
export const INSIGHT_CONFIRMED_EDGE_RATIO = 0.5;

type PhaseInput = {
  /**
   * kind / initialValue は定量化の判定に使う。DB から引くときは status（edges）と
   * 同じく columns 指定で落とさないこと（落とすと quantify がすり抜ける）。
   * 旧 fixture が省略できるよう optional
   */
  nodes: {
    name: string;
    kind?: NodeKind | null;
    initialValue?: number | null;
  }[];
  /**
   * 呼び出し側の行型をそのまま受ける。status を落とした projection を渡すと
   * 確認率の条件がすり抜けるため、DB から引くときは status を必ず含めること
   * （queries/projects.ts の columns 指定）
   */
  edges: readonly unknown[];
  loops: readonly Loop[];
};

/** エッジの確認状態（status 列）。持たない入力なら null */
function readEdgeStatus(edge: unknown): string | null {
  if (typeof edge !== "object" || edge === null) return null;
  const status = (edge as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

/** status を持つエッジのうち confirmed の割合。status 付きが無ければ null */
function confirmedEdgeRatio(edges: readonly unknown[]): number | null {
  const statuses = edges
    .map(readEdgeStatus)
    .filter((s): s is string => s !== null);
  if (statuses.length === 0) return null;
  const confirmed = statuses.filter((s) => s === "confirmed").length;
  return confirmed / statuses.length;
}

/**
 * insight に進める状態か。主要ループ（R と B が各 1 つ以上）がユーザーの実感で
 * 確認済み（confirmedLoopIds）で、かつ（評価できるなら）リンクの確認率が閾値以上
 */
export function isReadyForInsight(
  notes: Pick<InterviewNotes, "confirmedLoopIds">,
  { edges, loops }: Pick<PhaseInput, "edges" | "loops">,
): boolean {
  const confirmed = new Set(notes.confirmedLoopIds);
  const confirmedLoops = loops.filter((l) => confirmed.has(l.id));
  const hasR = confirmedLoops.some((l) => l.polarity === "R");
  const hasB = confirmedLoops.some((l) => l.polarity === "B");
  if (!hasR || !hasB) return false;
  const ratio = confirmedEdgeRatio(edges);
  return ratio === null || ratio >= INSIGHT_CONFIRMED_EDGE_RATIO;
}

/**
 * 定量化が未完了か（この形ではシミュレーションを回せないか）。
 * 未分類のノードが残っている / ストックが 1 つも無い / ストックに初期値が無い、
 * のいずれかなら未完了。すべて埋まればシミュレーションが回せる状態
 */
export function needsQuantification(nodes: PhaseInput["nodes"]): boolean {
  if (nodes.some((n) => (n.kind ?? null) === null)) return true;
  const stocks = nodes.filter((n) => n.kind === "stock");
  if (stocks.length === 0) return true;
  return stocks.some((n) => n.initialValue == null);
}

/**
 * 定量化へ踏み出した合図 = 図の変数が 1 つでも昇格している。
 *
 * insight に着いた時点では全ノードが未分類（CLD のまま）なのが普通なので、
 * 「未分類が残っている」だけを条件にすると、insight に入った瞬間すべてが quantify に
 * なり、介入候補を挙げる対話が消えてしまう。
 *
 * 「未検証の仮説があること」も合図の候補だったが、仮説は refine の段階でも記録される
 * ため、それを合図にすると insight を素通りしてしまう（MCP のテストで露見）。
 * SFD 化はユーザーが明示的に求めたときだけ始める（doc 3 章 / プロンプト）ので、
 * 実際に昇格が起きたことだけを合図にする
 */
function hasQuantifySignal(nodes: PhaseInput["nodes"]): boolean {
  return nodes.some((n) => (n.kind ?? null) !== null);
}

/**
 * 現在フェーズを導出する。ドラフト先行なので「描き始めたら draft、
 * ループが閉じたら refine、主要ループを確かめたら insight」というシンプルな
 * 段階で、件数閾値を持たない。
 *
 * 上から評価:
 * 1. R/B の主要ループが確認済み（+ リンク確認率）なら insight。ただし定量化が
 *    途中で、かつ定量化へ踏み出した合図があるときは quantify（数値を入れる番）
 * 2. ループが 1 つでも閉じていれば refine（実感とのすり合わせへ）
 * 3. 図に変数かリンクが 1 つでもあれば draft（既に描き始めている）
 * 4. 図が空でも、テーマと時間挙動が掴めていれば draft（描く番）
 * 5. それ以外は focus（まず焦点を掴む）
 *
 * 図の状態も見るため、ノートのない既存プロジェクトも図があれば
 * draft/refine に着地し、対話が振り出しに戻らない。
 * フェーズは対話の重心であって硬いゲートではない。
 */
export function deriveInterviewPhase(
  notes: InterviewNotes,
  { nodes, edges, loops }: PhaseInput,
): InterviewPhase {
  if (isReadyForInsight(notes, { edges, loops })) {
    return needsQuantification(nodes) && hasQuantifySignal(nodes)
      ? "quantify"
      : "insight";
  }
  if (loops.length >= 1) return "refine";
  if (nodes.length > 0 || edges.length > 0) return "draft";
  if (notes.theme !== null && notes.behavior !== null) return "draft";
  return "focus";
}
