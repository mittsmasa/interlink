import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { projects } from "@/db/schema";

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
