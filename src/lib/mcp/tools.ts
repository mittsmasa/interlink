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
import { interviewNotesSchema } from "@/lib/interview/notes";
import { saveInterviewNotes } from "@/lib/interview/store";
import {
  buildMcpInterviewPrompt,
  deriveGuidance,
  loadGuidance,
} from "@/lib/mcp/interview";

/**
 * initialize レスポンスでクライアントへ渡る静的な使い方の案内。
 * 動的な現在地（フェーズ / アジェンダ）は prompt とツール応答が担う
 */
const SERVER_INSTRUCTIONS = `interlink は「問いの構造を図にする」アプリ。ユーザーの構造的な悩みを聞き取り、因果ループ図（CLD）として一緒に育てる。

- ユーザーの悩みを聞き取りながら図を作るときは、interview プロンプトを使うと聞き取りの方法論と現在地が手に入る（最短の入口）
- 図を読むには get_diagram。ループ（R/B）・lint 指摘・システム原型に加え、聞き取りノートと「次に聞くこと」（interview.phase / interview.agenda）も返る
- 図の書き込みは update_diagram（差分形式）。変数は増減を語れる名詞句にし、因果リンクには根拠（rationale）を必ず添える。相関しか確認できていない関係を因果にしない
- 聞き取った事実（テーマ / 時間挙動 / 理想 / 関係者 / 変数候補）は update_notes に記録する（全置換。既存内容に加えた全体を送る）
- 書き込み系ツールの応答に含まれる interview.phase / interview.agenda は聞き取りの誘導。対話を進めるときはこれに従う`;

/** 未指定・不正な projectId のときに interview プロンプトが返す導入文 */
const INTERVIEW_INTRO_PROMPT = `interlink で聞き取りを始めます。まだ対象プロジェクトが決まっていません。

1. list_projects で既存プロジェクトを確認する（続きから再開する場合）
2. 新しい問いなら create_project でプロジェクトを作る
3. projectId が決まったら、interview プロンプトに projectId を渡して再実行するか、get_diagram で現在地を読んでから聞き取りを始める

ユーザーに「いま、どんなことが気がかりですか」と尋ねるところから始めてください。`;

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
  const server = new McpServer(
    {
      name: "interlink",
      version: "0.1.0",
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerPrompt(
    "interview",
    {
      title: "聞き取りを始める",
      description:
        "ユーザーの悩みを聞き取りながら因果ループ図を育てるための方法論と、プロジェクトの現在地（図・ノート・フェーズ・次に聞くこと）を読み込む",
      argsSchema: {
        projectId: z
          .string()
          .optional()
          .describe("対象プロジェクトの ID（未指定なら選択の導入から始まる）"),
      },
    },
    async ({ projectId }) => {
      let text = INTERVIEW_INTRO_PROMPT;
      if (projectId) {
        const project = await findOwnedProject(projectId, userId);
        if (project) {
          text = await buildMcpInterviewPrompt(project);
        } else {
          text = `プロジェクト「${projectId}」が見つかりません。list_projects で正しい projectId を確認してください。`;
        }
      }
      return {
        messages: [
          { role: "user" as const, content: { type: "text" as const, text } },
        ],
      };
    },
  );

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
      const guidance = deriveGuidance(project, diagram);
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
        interviewNotes: guidance.notes,
        interview: { phase: guidance.phase, agenda: guidance.agenda },
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
      // 適用後の図で聞き取りの現在地を導出し、次の一手を同梱する
      const guidance = await loadGuidance(project);
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
        interview: { phase: guidance.phase, agenda: guidance.agenda },
      });
    },
  );

  server.registerTool(
    "update_notes",
    {
      description:
        "聞き取りノートを全置換で更新する。テーマ・時間挙動・理想・関係者・変数候補・確認済みループ ID を聞き取ったら反映する。図に置く前の変数候補はここに貯める。現在のノートの内容に新しい事実を加えた全体を送る（既存の内容を欠落させない）",
      inputSchema: z.object({
        projectId: z.string().min(1).describe("対象プロジェクトの ID"),
        notes: interviewNotesSchema,
      }),
    },
    async ({ projectId, notes }) => {
      const project = await findOwnedProject(projectId, userId);
      if (!project) {
        return toError("プロジェクトが見つかりません");
      }
      await saveInterviewNotes(projectId, notes);
      // 保存後のノートと最新の図で現在地を導出する
      const saved = await findOwnedProject(projectId, userId);
      const guidance = await loadGuidance(saved ?? project);
      return toResult({
        ok: true,
        interview: { phase: guidance.phase, agenda: guidance.agenda },
      });
    },
  );

  return server;
}
