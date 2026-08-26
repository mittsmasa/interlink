import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { toUIMessage } from "@/lib/chat-store";
import { renderDiagramExport } from "@/lib/diagram/export";
import { detectLoops } from "@/lib/diagram/loops";
import { parseSimConfig } from "@/lib/diagram/sim-config";
import { parseInterviewNotes } from "@/lib/interview/notes";
import { deriveInterviewPhase } from "@/lib/interview/phase";
import { getDiagramByProjectId } from "@/lib/queries/diagrams";
import { getMessagesByProjectId } from "@/lib/queries/messages";
import { getProjectById } from "@/lib/queries/projects";
import { requireSession } from "@/lib/session";
import { ExportMenu } from "./_components/export-menu";
import { ProjectTitle } from "./_components/project-title";
import { Workspace } from "./_components/workspace";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await requireSession();
  const project = await getProjectById(projectId, session.user.id);
  if (!project) notFound();

  const [messageRows, diagram] = await Promise.all([
    getMessagesByProjectId(projectId),
    getDiagramByProjectId(projectId),
  ]);

  // 聞き取りノートと現在フェーズ（chat 経路と同じ導出をパネル表示用に行う）
  const notes = parseInterviewNotes(project.interviewNotes);
  const { loops } = detectLoops(diagram.nodes, diagram.edges);
  const phase = deriveInterviewPhase(notes, {
    nodes: diagram.nodes,
    edges: diagram.edges,
    loops,
  });

  // 書き出しテキストはサーバーで作って渡す。図の更新後は router.refresh で追随する
  const exportInput = { title: project.title, ...diagram, notes };
  const exports = {
    mermaid: renderDiagramExport("mermaid", exportInput),
    markdown: renderDiagramExport("markdown", exportInput),
  };

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader
        user={session.user}
        subtitle={<ProjectTitle project={project} />}
        actions={<ExportMenu title={project.title} exports={exports} />}
      />
      <Workspace
        project={project}
        initialMessages={messageRows.map(toUIMessage)}
        diagram={diagram}
        notes={notes}
        phase={phase}
        simConfig={parseSimConfig(project.simConfig)}
      />
    </div>
  );
}
