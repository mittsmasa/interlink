import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { edges, nodes, projects, type RevisionSource } from "@/db/schema";
import { type MutationPlan, normalizeName } from "./apply-diff";
import { saveRevision } from "./revisions";

/**
 * MutationPlan を DB に適用する。
 * createEdges の名前参照は、ノード insert 後に project 全ノードを
 * 読み直して ID へ解決する。
 *
 * 適用後の図は同じトランザクション内でリビジョンとして 1 行積む。source は必須にして
 * ある（既定値を持たせると呼び出し元の追加時に出所を取り違えても気づけない）。
 */
export async function applyMutationPlan(
  projectId: string,
  plan: MutationPlan,
  options: { source: RevisionSource },
) {
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
      // 指定された列だけ更新する（undefined の列は触らない）。SFD 列は kind 指定が
      // あったノードにのみ含まれ、memo/unit のみの更新で既存の役割を消さない。
      // name は改名するノードにのみ含まれ、接続エッジは ID 参照なので影響を受けない
      await tx
        .update(nodes)
        .set({
          ...(node.name !== undefined ? { name: node.name } : {}),
          ...(node.memo !== undefined ? { memo: node.memo } : {}),
          ...(node.unit !== undefined ? { unit: node.unit } : {}),
          ...(node.kind !== undefined ? { kind: node.kind } : {}),
          ...(node.expression !== undefined
            ? { expression: node.expression }
            : {}),
          ...(node.initialValue !== undefined
            ? { initialValue: node.initialValue }
            : {}),
          ...(node.value !== undefined ? { value: node.value } : {}),
        })
        .where(eq(nodes.id, node.id));
    }
    for (const edge of plan.updateEdges) {
      await tx
        .update(edges)
        .set({
          polarity: edge.polarity,
          hasDelay: edge.hasDelay,
          rationale: edge.rationale,
          ...(edge.status !== undefined ? { status: edge.status } : {}),
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
            status: e.status,
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

    await saveRevision(tx, projectId, { source: options.source });
  });
}
