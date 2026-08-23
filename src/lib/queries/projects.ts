import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { buildLoopEdges } from "@/lib/diagram/loop-edges";
import { detectLoops } from "@/lib/diagram/loops";
import { parseInterviewNotes } from "@/lib/interview/notes";
import { deriveInterviewPhase } from "@/lib/interview/phase";

/** ユーザーのプロジェクト一覧（更新日降順）。ノード数も添える */
export const getProjectsByUserId = cache(async (userId: string) => {
  const rows = await db.query.projects.findMany({
    where: eq(projects.userId, userId),
    orderBy: [desc(projects.updatedAt)],
    with: {
      nodes: { columns: { id: true } },
    },
  });
  return rows.map(({ nodes, ...project }) => ({
    ...project,
    nodeCount: nodes.length,
  }));
});

/** プロジェクト単体（所有者チェック込み）。見つからなければ null */
export const getProjectById = cache(
  async (projectId: string, userId: string) => {
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.userId, userId)),
    });
    return project ?? null;
  },
);

/**
 * MCP の list_projects 用に、プロジェクトごとの規模と聞き取りの現在地を添えた一覧。
 * nodes / edges を relation で 1 往復にまとめて読み、ループとフェーズは
 * in-memory で導出する（プロジェクト数ぶん図を読み直す N+1 を避ける）
 */
export const getProjectSummariesByUserId = cache(async (userId: string) => {
  const rows = await db.query.projects.findMany({
    where: eq(projects.userId, userId),
    orderBy: [asc(projects.createdAt)],
    with: {
      nodes: { columns: { id: true, name: true, expression: true } },
      edges: {
        columns: {
          id: true,
          sourceNodeId: true,
          targetNodeId: true,
          polarity: true,
          hasDelay: true,
          // insight フェーズの判定が confirmed 率を見るため必須。
          // 落とすと一覧だけ条件をすり抜け、詳細ページと phase が食い違う
          status: true,
        },
      },
    },
  });
  return rows.map(({ nodes, edges, ...project }) => {
    const notes = parseInterviewNotes(project.interviewNotes);
    const { loops } = detectLoops(nodes, buildLoopEdges({ nodes, edges }));
    const loopIds = new Set(loops.map((l) => l.id));
    return {
      id: project.id,
      title: project.title,
      status: project.status,
      updatedAt: project.updatedAt,
      theme: notes.theme,
      interviewPhase: deriveInterviewPhase(notes, { nodes, edges, loops }),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      loopCount: loops.length,
      // 図から消えたループの ID が残っていても数えない
      confirmedLoopCount: notes.confirmedLoopIds.filter((id) => loopIds.has(id))
        .length,
    };
  });
});

export type ProjectSummary = Awaited<
  ReturnType<typeof getProjectSummariesByUserId>
>[number];
