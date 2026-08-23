import { matchArchetypes } from "@/lib/diagram/archetypes";
import { lintDiagram } from "@/lib/diagram/lint";
import { buildLoopEdges } from "@/lib/diagram/loop-edges";
import { detectLoops } from "@/lib/diagram/loops";
import { loadDiagramSnapshot } from "@/lib/diagram/snapshot";
import { buildInterviewAgenda } from "@/lib/interview/agenda";
import {
  type InterviewNotes,
  parseInterviewNotes,
} from "@/lib/interview/notes";
import {
  deriveInterviewPhase,
  type InterviewPhase,
} from "@/lib/interview/phase";
import { buildInterviewSystemPrompt } from "@/lib/prompts/interview";

type ProjectRow = { id: string; interviewNotes: string | null };

type DiagramSnapshot = Awaited<ReturnType<typeof loadDiagramSnapshot>>;

export type InterviewGuidance = {
  phase: InterviewPhase;
  agenda: string[];
  notes: InterviewNotes;
};

/**
 * 読み込み済みの図から聞き取りの現在地（フェーズ / 次に聞くこと）を導出する。
 * アプリ内チャット（chat.ts）と同じ決定的導出を MCP ツール応答用に切り出したもの
 */
export function deriveGuidance(
  project: ProjectRow,
  diagram: DiagramSnapshot,
): InterviewGuidance {
  const notes = parseInterviewNotes(project.interviewNotes);
  const { loops } = detectLoops(diagram.nodes, buildLoopEdges(diagram));
  const phaseInput = { nodes: diagram.nodes, edges: diagram.edges, loops };
  const phase = deriveInterviewPhase(notes, phaseInput);
  const agenda = buildInterviewAgenda(notes, phaseInput, phase);
  return { phase, agenda, notes };
}

/** 図を読み直して guidance を導出する（書き込み系ツールの応答用） */
export async function loadGuidance(
  project: ProjectRow,
): Promise<InterviewGuidance> {
  const diagram = await loadDiagramSnapshot(project.id);
  return deriveGuidance(project, diagram);
}

/**
 * MCP の interview プロンプト本文を組み立てる。
 * アプリ内チャットのシステムプロンプトを再利用し、ツール名の表記だけ
 * MCP のツール名（update_notes / update_diagram）へ決定的に置換する。
 * 置換対象 2 語はプロンプト本文でツール名以外に登場しない（テストで固定）
 */
export async function buildMcpInterviewPrompt(
  project: ProjectRow,
): Promise<string> {
  const diagram = await loadDiagramSnapshot(project.id);
  const loopResult = detectLoops(diagram.nodes, buildLoopEdges(diagram));
  const verification = {
    loopResult,
    findings: lintDiagram(diagram.nodes, diagram.edges),
    matches: matchArchetypes(loopResult.loops),
  };
  const guidance = deriveGuidance(project, diagram);
  const prompt = buildInterviewSystemPrompt(diagram, verification, guidance, {
    surface: "mcp",
  });
  return `${prompt}

## このセッションでの図の操作
図とノートの操作は interlink の MCP ツールで行う。対象プロジェクトの projectId は「${project.id}」。update_diagram / update_notes / get_diagram / run_simulation の呼び出しには必ずこの projectId を渡すこと。`
    .replaceAll("updateNotes", "update_notes")
    .replaceAll("updateDiagram", "update_diagram");
}
