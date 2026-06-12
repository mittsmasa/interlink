import "server-only";
import { asc, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { edges, nodes } from "@/db/schema";

/** プロジェクトの因果ループ図（ノードとエッジ）を取得する */
export const getDiagramByProjectId = cache(async (projectId: string) => {
  const [diagramNodes, diagramEdges] = await Promise.all([
    db.query.nodes.findMany({
      where: eq(nodes.projectId, projectId),
      orderBy: [asc(nodes.createdAt)],
    }),
    db.query.edges.findMany({
      where: eq(edges.projectId, projectId),
      orderBy: [asc(edges.createdAt)],
    }),
  ]);
  return { nodes: diagramNodes, edges: diagramEdges };
});

export type Diagram = Awaited<ReturnType<typeof getDiagramByProjectId>>;
export type DiagramNode = Diagram["nodes"][number];
export type DiagramEdge = Diagram["edges"][number];
