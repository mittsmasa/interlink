import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { toUIMessage } from "@/lib/chat-store";
import { detectLoops } from "@/lib/diagram/loops";
import { parseInterviewNotes } from "@/lib/interview/notes";
import { deriveInterviewPhase } from "@/lib/interview/phase";
import { getDiagramByProjectId } from "@/lib/queries/diagrams";
import { getMessagesByProjectId } from "@/lib/queries/messages";
import { getProjectById } from "@/lib/queries/projects";
import { requireSession } from "@/lib/session";
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

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader
        user={session.user}
        subtitle={<ProjectTitle project={project} />}
      />
      <Workspace
        project={project}
        initialMessages={messageRows.map(toUIMessage)}
        diagram={diagram}
        notes={notes}
        phase={phase}
      />
    </div>
  );
}
