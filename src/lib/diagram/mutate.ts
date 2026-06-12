import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { edges, nodes, projects } from "@/db/schema";
import { type MutationPlan, normalizeName } from "./apply-diff";

/**
 * MutationPlan を DB に適用する。
 * createEdges の名前参照は、ノード insert 後に project 全ノードを
 * 読み直して ID へ解決する。
 */
export async function applyMutationPlan(projectId: string, plan: MutationPlan) {
  await db.transaction(async (tx) => {
    if (plan.deleteEdgeIds.length > 0) {
      await tx.delete(edges).where(inArray(edges.id, plan.deleteEdgeIds));
    }
    if (plan.deleteNodeIds.length > 0) {
      // nodes の FK は cascade のため接続エッジも消える
      await tx.delete(nodes).where(inArray(nodes.id, plan.deleteNodeIds));
    }
    if (plan.createNodes.length > 0) {
      await tx
        .insert(nodes)
        .values(plan.createNodes.map((n) => ({ ...n, projectId })));
    }
    for (const node of plan.updateNodes) {
      await tx
        .update(nodes)
        .set({ memo: node.memo, unit: node.unit })
        .where(eq(nodes.id, node.id));
    }
    for (const edge of plan.updateEdges) {
      await tx
        .update(edges)
        .set({
          polarity: edge.polarity,
          hasDelay: edge.hasDelay,
          rationale: edge.rationale,
        })
        .where(eq(edges.id, edge.id));
    }

    if (plan.createEdges.length > 0) {
      const currentNodes = await tx.query.nodes.findMany({
        where: eq(nodes.projectId, projectId),
        columns: { id: true, name: true },
      });
      const idByKey = new Map(
        currentNodes.map((n) => [normalizeName(n.name), n.id]),
      );
      const values = plan.createEdges.flatMap((e) => {
        const sourceNodeId = idByKey.get(normalizeName(e.sourceName));
        const targetNodeId = idByKey.get(normalizeName(e.targetName));
        // planDiagramMutation で検証済みのため通常は到達しない
        if (!sourceNodeId || !targetNodeId) return [];
        return [
          {
            projectId,
            sourceNodeId,
            targetNodeId,
            polarity: e.polarity,
            hasDelay: e.hasDelay,
            rationale: e.rationale,
          },
        ];
      });
      if (values.length > 0) {
        await tx.insert(edges).values(values);
      }
    }

    // 図ができたらプロジェクトを diagramming に進め、更新日時を刻む
    await tx
      .update(projects)
      .set({ status: "diagramming", updatedAt: Date.now() })
      .where(eq(projects.id, projectId));
  });
}
