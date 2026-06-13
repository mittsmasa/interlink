import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { detectLoops } from "@/lib/diagram/loops";
import { loadDiagramSnapshot } from "@/lib/diagram/snapshot";
import { capInterviewNotes, type InterviewNotes } from "./notes";
import { deriveInterviewPhase } from "./phase";

/**
 * updateNotes ツールの本体。キャップ適用 → 全置換保存 → 現在フェーズの返却。
 * フェーズは同一ストリーム内の updateDiagram を反映した最新の図で導出する
 * （AI が自分の進捗を自覚できるようにする）。
 */
export async function saveInterviewNotes(
  projectId: string,
  input: InterviewNotes,
) {
  // 表示 = 保存の件数キャップ（全置換での静かな欠落を防ぐ）
  const capped = capInterviewNotes(input);
  await db
    .update(projects)
    .set({ interviewNotes: JSON.stringify(capped) })
    .where(eq(projects.id, projectId));

  const current = await loadDiagramSnapshot(projectId);
  const { loops } = detectLoops(current.nodes, current.edges);
  return {
    ok: true as const,
    phase: deriveInterviewPhase(capped, {
      nodes: current.nodes,
      edges: current.edges,
      loops,
    }),
  };
}
