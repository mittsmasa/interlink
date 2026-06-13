import type { Loop } from "@/lib/diagram/loops";
import type { InterviewNotes } from "./notes";

/**
 * 聞き取りの 5 フェーズ（実践システム・シンキングの流れ）。
 * 時間軸分析 → ステークホルダ分析 → 変数抽出 → 因果分析 → 仮説構築。
 * フェーズは保存せず、ノートと図の状態から毎回導出する。
 */
export const INTERVIEW_PHASES = [
  "time-axis",
  "stakeholders",
  "variables",
  "causality",
  "hypothesis",
] as const;
export type InterviewPhase = (typeof INTERVIEW_PHASES)[number];

export const PHASE_LABELS: Record<InterviewPhase, string> = {
  "time-axis": "時間軸分析",
  stakeholders: "関係者分析",
  variables: "変数抽出",
  causality: "因果分析",
  hypothesis: "仮説の検証",
};

/**
 * フェーズ移行の閾値。実対話の手応えで調整する想定の発明値なので、
 * ここに集約して一箇所で変えられるようにする。
 */
export const PHASE_THRESHOLDS = {
  /** エッジがこれだけあれば集約（因果分析）に入っているとみなす */
  edgesForCausality: 3,
  /** 変数候補（ノート ∪ 図上ノード名）がこれだけ揃えば因果分析へ */
  candidatesForCausality: 8,
  /** 関係者がこれだけ出れば変数抽出へ */
  stakeholdersForVariables: 2,
} as const;

type PhaseInput = {
  nodes: { name: string }[];
  edges: readonly unknown[];
  loops: readonly Loop[];
};

/**
 * 現在フェーズを「達成済みマイルストーンの次」方式で導出する。
 * ノートだけでなく図の状態も見るため、ノートのない既存プロジェクトも
 * 図があれば P4/P5 に着地する（対話が振り出しに戻らない）。
 * フェーズは対話の重心であって硬いゲートではない。
 */
export function deriveInterviewPhase(
  notes: InterviewNotes,
  { nodes, edges, loops }: PhaseInput,
): InterviewPhase {
  if (loops.length >= 1) return "hypothesis";

  const candidateNames = new Set([
    ...notes.variableCandidates.map((c) => c.name),
    ...nodes.map((n) => n.name),
  ]);
  if (
    edges.length >= PHASE_THRESHOLDS.edgesForCausality ||
    candidateNames.size >= PHASE_THRESHOLDS.candidatesForCausality
  ) {
    return "causality";
  }

  if (notes.stakeholders.length >= PHASE_THRESHOLDS.stakeholdersForVariables) {
    return "variables";
  }

  if (notes.behavior !== null) return "stakeholders";

  return "time-axis";
}
