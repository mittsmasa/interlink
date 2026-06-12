import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { edges, nodes } from "@/db/schema";

/**
 * 図の現在地を読む（Hono route / tool execute 用）。
 * React の cache() でメモ化しない素の読み取り。同一ストリーム内で
 * ツールが複数回呼ばれても常に最新の図を見るために queries/ とは分ける。
 */
export async function loadDiagramSnapshot(projectId: string) {
  const [nodeRows, edgeRows] = await Promise.all([
    db.query.nodes.findMany({
      where: eq(nodes.projectId, projectId),
      orderBy: [asc(nodes.createdAt)],
    }),
    db.query.edges.findMany({
      where: eq(edges.projectId, projectId),
      orderBy: [asc(edges.createdAt)],
    }),
  ]);
  const nameById = new Map(nodeRows.map((n) => [n.id, n.name]));
  return {
    nodes: nodeRows,
    edges: edgeRows.map((e) => ({
      ...e,
      sourceName: nameById.get(e.sourceNodeId) ?? "",
      targetName: nameById.get(e.targetNodeId) ?? "",
    })),
  };
}
