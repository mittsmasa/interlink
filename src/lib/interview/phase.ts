import type { Loop } from "@/lib/diagram/loops";
import type { InterviewNotes } from "./notes";

/**
 * 聞き取りの 3 フェーズ（ドラフト先行）。
 * 焦点（テーマと時間挙動を掴む）→ ドラフト（AI が変数と関係の叩き台を一枚描く）
 * → すり合わせ（ドラフトを実感と突き合わせ、違和感を直しループを確かめる）。
 * フェーズは保存せず、ノートと図の状態から毎回導出する。
 */
export const INTERVIEW_PHASES = ["focus", "draft", "refine"] as const;
export type InterviewPhase = (typeof INTERVIEW_PHASES)[number];

export const PHASE_LABELS: Record<InterviewPhase, string> = {
  focus: "焦点",
  draft: "ドラフト",
  refine: "すり合わせ",
};

type PhaseInput = {
  nodes: { name: string }[];
  edges: readonly unknown[];
  loops: readonly Loop[];
};

/**
 * 現在フェーズを導出する。ドラフト先行なので「描き始めたら draft、
 * ループが閉じたら refine」というシンプルな段階で、件数閾値を持たない。
 *
 * 上から評価:
 * 1. ループが 1 つでも閉じていれば refine（実感とのすり合わせへ）
 * 2. 図に変数かリンクが 1 つでもあれば draft（既に描き始めている）
 * 3. 図が空でも、テーマと時間挙動が掴めていれば draft（描く番）
 * 4. それ以外は focus（まず焦点を掴む）
 *
 * 図の状態も見るため、ノートのない既存プロジェクトも図があれば
 * draft/refine に着地し、対話が振り出しに戻らない。
 * フェーズは対話の重心であって硬いゲートではない。
 */
export function deriveInterviewPhase(
  notes: InterviewNotes,
  { nodes, edges, loops }: PhaseInput,
): InterviewPhase {
  if (loops.length >= 1) return "refine";
  if (nodes.length > 0 || edges.length > 0) return "draft";
  if (notes.theme !== null && notes.behavior !== null) return "draft";
  return "focus";
}
