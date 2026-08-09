import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { planDiagramMutation } from "@/lib/diagram/apply-diff";
import { matchArchetypes } from "@/lib/diagram/archetypes";
import { diagramDiffSchema } from "@/lib/diagram/diff-schema";
import { lintDiagram } from "@/lib/diagram/lint";
import { detectLoops } from "@/lib/diagram/loops";
import { applyMutationPlan } from "@/lib/diagram/mutate";
import { loadDiagramSnapshot } from "@/lib/diagram/snapshot";

/** ツールの実行結果を MCP の text content に包む */
function toResult(payload: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
}

function toError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

/** 認証ユーザー所有の project のみ返す（他ユーザーの ID を渡されても見つからない） */
async function findOwnedProject(projectId: string, userId: string) {
  return db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, userId)),
  });
}

/**
 * 認証済みユーザーに束縛された MCP サーバーを組み立てる。
 * Vercel serverless の stateless 運用を前提に、リクエストごとに生成して使い捨てる。
 * 図の書き込みはチャットの updateDiagram と同じ検証経路
 * （planDiagramMutation → applyMutationPlan）だけを通す。
 */
export function buildMcpServer(userId: string) {
  const server = new McpServer({
    name: "interlink",
    version: "0.1.0",
  });

  server.registerTool(
    "list_projects",
    {
      description:
        "自分のプロジェクト（問い）の一覧を返す。図を操作する前に projectId を調べるために使う",
    },
    async () => {
      const rows = await db.query.projects.findMany({
        where: eq(projects.userId, userId),
        columns: { id: true, title: true, status: true, updatedAt: true },
        orderBy: [asc(projects.createdAt)],
      });
      return toResult({ projects: rows });
    },
  );

  server.registerTool(
    "create_project",
    {
      description:
        "新しいプロジェクト（問い）を作る。作成後は update_diagram で因果ループ図を作れる",
      inputSchema: z.object({
        title: z
          .string()
          .min(1)
          .describe("プロジェクトのタイトル（問いの一行要約）"),
      }),
    },
    async ({ title }) => {
      const [project] = await db
        .insert(projects)
        .values({ userId, title })
        .returning({ id: projects.id, title: projects.title });
      return toResult({ project });
    },
  );

  server.registerTool(
    "get_diagram",
    {
      description:
        "プロジェクトの因果ループ図の現在地を返す。変数・因果リンクに加え、導出済みの検証結果（フィードバックループと R/B 極性、lint 指摘、システム原型マッチ）を含む",
      inputSchema: z.object({
        projectId: z.string().min(1).describe("対象プロジェクトの ID"),
      }),
    },
    async ({ projectId }) => {
      const project = await findOwnedProject(projectId, userId);
      if (!project) {
        return toError("プロジェクトが見つかりません");
      }
      const diagram = await loadDiagramSnapshot(projectId);
      const loopResult = detectLoops(diagram.nodes, diagram.edges);
      return toResult({
        project: { id: project.id, title: project.title },
        nodes: diagram.nodes.map((n) => ({
          name: n.name,
          memo: n.memo,
          unit: n.unit,
          kind: n.kind,
          expression: n.expression,
          initialValue: n.initialValue,
          value: n.value,
        })),
        edges: diagram.edges.map((e) => ({
          source: e.sourceName,
          target: e.targetName,
          polarity: e.polarity,
          hasDelay: e.hasDelay,
          rationale: e.rationale,
        })),
        loops: loopResult.loops.map((l) => ({
          polarity: l.polarity,
          nodeNames: l.nodeNames,
        })),
        truncated: loopResult.truncated,
        lintFindings: lintDiagram(diagram.nodes, diagram.edges),
        archetypeMatches: matchArchetypes(loopResult.loops),
      });
    },
  );

  server.registerTool(
    "update_diagram",
    {
      description:
        "因果ループ図を差分で更新する。変数・因果リンクの追加/更新/削除を一括で指定できる。既存の図への増分修正として使うこと。変数は ID ではなく名前で参照する",
      inputSchema: z.object({
        projectId: z.string().min(1).describe("対象プロジェクトの ID"),
        diff: diagramDiffSchema,
      }),
    },
    async ({ projectId, diff }) => {
      const project = await findOwnedProject(projectId, userId);
      if (!project) {
        return toError("プロジェクトが見つかりません");
      }
      const current = await loadDiagramSnapshot(projectId);
      const planResult = planDiagramMutation(current, diff);
      if (!planResult.ok) {
        return toError(planResult.reason);
      }
      await applyMutationPlan(projectId, planResult.plan);
      const { plan } = planResult;
      return toResult({
        ok: true,
        warnings: plan.warnings,
        applied: {
          createdNodes: plan.createNodes.length,
          updatedNodes: plan.updateNodes.length,
          deletedNodes: plan.deleteNodeIds.length,
          createdEdges: plan.createEdges.length,
          updatedEdges: plan.updateEdges.length,
          deletedEdges: plan.deleteEdgeIds.length,
        },
      });
    },
  );

  return server;
}
