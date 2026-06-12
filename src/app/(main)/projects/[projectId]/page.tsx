import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { toUIMessage } from "@/lib/chat-store";
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
      />
    </div>
  );
}
