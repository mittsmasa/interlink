import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { detectLoops } from "@/lib/diagram/loops";
import { loadDiagramSnapshot } from "@/lib/diagram/snapshot";
import {
  capInterviewNotes,
  countCapDropped,
  type InterviewNotes,
  mergeInterviewNotes,
  parseInterviewNotes,
} from "./notes";
import { deriveInterviewPhase } from "./phase";

export type SaveNotesMode = "replace" | "append";

/**
 * updateNotes ツールの本体。（append なら既存とマージ →）キャップ適用 →
 * 保存 → 現在フェーズの返却。
 * フェーズは同一ストリーム内の updateDiagram を反映した最新の図で導出する
 * （AI が自分の進捗を自覚できるようにする）。
 * 既定は replace（チャットの updateNotes の従来挙動）。MCP は append を既定にする
 */
export async function saveInterviewNotes(
  projectId: string,
  input: InterviewNotes,
  options: { mode?: SaveNotesMode } = {},
) {
  const mode = options.mode ?? "replace";
  let merged = input;
  if (mode === "append") {
    const row = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      columns: { interviewNotes: true },
    });
    merged = mergeInterviewNotes(
      parseInterviewNotes(row?.interviewNotes ?? null),
      input,
    );
  }
  // 表示 = 保存の件数キャップ（全置換での静かな欠落を防ぐ）。落ちた件数は応答に載せる
  const dropped = countCapDropped(merged);
  const capped = capInterviewNotes(merged);
  await db
    .update(projects)
    .set({ interviewNotes: JSON.stringify(capped) })
    .where(eq(projects.id, projectId));

  const current = await loadDiagramSnapshot(projectId);
  const { loops } = detectLoops(current.nodes, current.edges);
  return {
    ok: true as const,
    notes: capped,
    dropped,
    phase: deriveInterviewPhase(capped, {
      nodes: current.nodes,
      edges: current.edges,
      loops,
    }),
  };
}
