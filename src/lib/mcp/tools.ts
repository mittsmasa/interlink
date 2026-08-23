import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { planDiagramMutation } from "@/lib/diagram/apply-diff";
import { matchArchetypes } from "@/lib/diagram/archetypes";
import { diagramDiffSchema } from "@/lib/diagram/diff-schema";
import { lintDiagram } from "@/lib/diagram/lint";
import {
  buildLoopEdges,
  deriveLoopDependencies,
} from "@/lib/diagram/loop-edges";
import { detectLoops, MAX_LOOPS } from "@/lib/diagram/loops";
import { applyMutationPlan } from "@/lib/diagram/mutate";
import { loadDiagramSnapshot } from "@/lib/diagram/snapshot";
import { interviewNotesSchema } from "@/lib/interview/notes";
import { saveInterviewNotes } from "@/lib/interview/store";
import {
  buildMcpInterviewPrompt,
  deriveGuidance,
  loadGuidance,
} from "@/lib/mcp/interview";
import { diffStructure } from "@/lib/mcp/structure-diff";

/**
 * initialize レスポンスでクライアントへ渡る静的な使い方の案内。
 * 動的な現在地（フェーズ / アジェンダ）は prompt とツール応答が担う
 */
const SERVER_INSTRUCTIONS = `interlink は「問いの構造を図にする」アプリ。ユーザーの構造的な悩みを聞き取り、因果ループ図（CLD）として一緒に育てる。

- ユーザーの悩みを聞き取りながら図を作るときは、interview プロンプトを使うと聞き取りの方法論と現在地が手に入る（最短の入口）
- 図を読むには get_diagram。ループ（R/B）・lint 指摘・システム原型に加え、聞き取りノートと「次に聞くこと」（interview.phase / interview.agenda）も返る
- 図の書き込みは update_diagram（差分形式）。変数は増減を語れる名詞句にし、因果リンクには根拠（rationale）を必ず添える。相関しか確認できていない関係を因果にしない
- update_diagram は dryRun: true で適用せずに計画と警告だけ確認できる。適用すると閉じた/開いたループと新しい lint 指摘（structure）が返るので、get_diagram を読み直さなくても結果が分かる
- warnings は {code, target, message, suggestion} の配列。除外された操作は黙って落ちるので、必ず目を通して suggestion を踏まえて再送する
- 聞き取った事実（テーマ / 時間挙動 / 理想 / 関係者 / 変数候補）は update_notes に記録する。既定は append（差分だけ送れば既存とマージされる）。整理し直すときだけ mode: "replace" で全体を送る
- 並行編集を避けたいときは get_diagram / 書き込み応答の updatedAt を expectedUpdatedAt に渡す。不一致なら ok: false と最新の updatedAt が返る
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

/** get_diagram / 書き込み応答に載せる updatedAt（ms epoch）。楽観ロックの版として使う */
function versionOf(project: { updatedAt: number }) {
  return project.updatedAt;
}

/**
 * 楽観ロックの判定。expectedUpdatedAt が渡され現在値と違えば競合応答を返す。
 * 読み取り → 比較 → 適用の間の窓は残る（個人用途のため transaction 化はしない）
 */
function checkVersion(
  project: { updatedAt: number },
  expectedUpdatedAt: number | undefined,
) {
  if (expectedUpdatedAt === undefined) return null;
  const current = versionOf(project);
  if (expectedUpdatedAt === current) return null;
  return toResult({
    ok: false,
    error: "conflict",
    message:
      "プロジェクトが expectedUpdatedAt より後に更新されています。get_diagram で読み直してから再送してください",
    updatedAt: current,
    expectedUpdatedAt,
  });
}

const expectedUpdatedAtSchema = z
  .number()
  .int()
  .optional()
  .describe(
    "楽観ロック。直前の get_diagram / 書き込み応答の updatedAt を渡すと、他の編集が挟まっていた場合に ok: false（error: conflict）を返す",
  );

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
      annotations: { readOnlyHint: true, openWorldHint: false },
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ title }) => {
      const [project] = await db
        .insert(projects)
        .values({ userId, title })
        .returning({
          id: projects.id,
          title: projects.title,
          updatedAt: projects.updatedAt,
        });
      return toResult({ project });
    },
  );

  server.registerTool(
    "get_diagram",
    {
      description:
        "プロジェクトの因果ループ図の現在地を返す。変数・因果リンク・式由来の情報リンク（dependencies）に加え、導出済みの検証結果（フィードバックループと R/B 極性、lint 指摘、システム原型マッチ）を含む。loops[].id は update_notes の confirmedLoopIds と archetypeMatches[].loopIds が指す ID。極性 ? は式の符号が構造から決まらない極性未定、derived は式由来リンクを含む暫定ループ。updatedAt は update_* の expectedUpdatedAt に渡せる",
      inputSchema: z.object({
        projectId: z.string().min(1).describe("対象プロジェクトの ID"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ projectId }) => {
      const project = await findOwnedProject(projectId, userId);
      if (!project) {
        return toError("プロジェクトが見つかりません");
      }
      const diagram = await loadDiagramSnapshot(projectId);
      // キャンバスと同じ入力（因果エッジ + 式由来リンク）でループを導出する
      const dependencies = deriveLoopDependencies(diagram);
      const loopResult = detectLoops(diagram.nodes, buildLoopEdges(diagram));
      const guidance = deriveGuidance(project, diagram);
      const nameById = new Map(diagram.nodes.map((n) => [n.id, n.name]));
      return toResult({
        project: { id: project.id, title: project.title },
        updatedAt: versionOf(project),
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
        dependencies: dependencies.map((d) => ({
          from: nameById.get(d.fromNodeId) ?? "",
          to: nameById.get(d.toNodeId) ?? "",
          polarity: d.polarity,
        })),
        loops: loopResult.loops.map((l) => ({
          id: l.id,
          label: l.label,
          polarity: l.polarity,
          hasDelay: l.hasDelay,
          derived: l.derived === true,
          nodeNames: l.nodeNames,
          edges: l.nodeNames.map((source, i) => ({
            source,
            target: l.nodeNames[(i + 1) % l.nodeNames.length],
          })),
        })),
        loopLimit: {
          truncated: loopResult.truncated,
          shown: loopResult.loops.length,
          limit: MAX_LOOPS,
        },
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
        "因果ループ図を差分で更新する。変数・因果リンクの追加/更新/削除を一括で指定できる。既存の図への増分修正として使うこと。変数は ID ではなく名前で参照する。dryRun: true なら適用せずに計画（plan）と警告だけ返す。適用時は件数に加え、閉じた/開いたループと新しい lint 指摘（structure）を返す。warnings にある操作は除外されたまま残りが適用されるので、必ず確認して再送する",
      inputSchema: z.object({
        projectId: z.string().min(1).describe("対象プロジェクトの ID"),
        diff: diagramDiffSchema,
        dryRun: z
          .boolean()
          .optional()
          .describe("true なら検証だけ行い、図を変更しない"),
        expectedUpdatedAt: expectedUpdatedAtSchema,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectId, diff, dryRun, expectedUpdatedAt }) => {
      const project = await findOwnedProject(projectId, userId);
      if (!project) {
        return toError("プロジェクトが見つかりません");
      }
      const conflict = checkVersion(project, expectedUpdatedAt);
      if (conflict) return conflict;

      const current = await loadDiagramSnapshot(projectId);
      const planResult = planDiagramMutation(current, diff);
      if (!planResult.ok) {
        return toResult({
          ok: false,
          error: planResult.reason,
          warnings: planResult.warnings,
          updatedAt: versionOf(project),
        });
      }
      const { plan } = planResult;
      const planSummary = {
        createNodes: plan.createNodes.map((n) => n.name),
        updateNodes: plan.updateNodes.map(
          (n) => current.nodes.find((c) => c.id === n.id)?.name ?? n.id,
        ),
        deleteNodes: plan.deleteNodeIds.map(
          (id) => current.nodes.find((c) => c.id === id)?.name ?? id,
        ),
        createEdges: plan.createEdges.map(
          (e) => `${e.sourceName}→${e.targetName}`,
        ),
        updateEdges: plan.updateEdges.map((e) => {
          const edge = current.edges.find((c) => c.id === e.id);
          return edge ? `${edge.sourceName}→${edge.targetName}` : e.id;
        }),
        deleteEdges: plan.deleteEdgeIds.map((id) => {
          const edge = current.edges.find((c) => c.id === id);
          return edge ? `${edge.sourceName}→${edge.targetName}` : id;
        }),
      };
      if (dryRun) {
        return toResult({
          ok: true,
          dryRun: true,
          plan: planSummary,
          warnings: plan.warnings,
          updatedAt: versionOf(project),
        });
      }

      const before = {
        loops: detectLoops(current.nodes, current.edges).loops,
        findings: lintDiagram(current.nodes, current.edges),
      };
      await applyMutationPlan(projectId, plan);
      // 適用後の図で聞き取りの現在地を導出し、構造の変化と次の一手を同梱する
      const after = await loadDiagramSnapshot(projectId);
      const saved = (await findOwnedProject(projectId, userId)) ?? project;
      const guidance = deriveGuidance(saved, after);
      const structure = diffStructure(before, {
        loops: detectLoops(after.nodes, after.edges).loops,
        findings: lintDiagram(after.nodes, after.edges),
      });
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
        structure,
        updatedAt: versionOf(saved),
        interview: { phase: guidance.phase, agenda: guidance.agenda },
      });
    },
  );

  server.registerTool(
    "update_notes",
    {
      description:
        "聞き取りノートを更新する。テーマ・時間挙動・理想・関係者・変数候補・確認済みループ ID を聞き取ったら反映する。図に置く前の変数候補はここに貯める。既定の mode: append では送った差分が既存ノートとマージされる（配列は union、スカラーは非 null のみ上書き）ので、新しく分かった事実だけ送ればよい。mode: replace は全置換（既存の内容を欠落させないよう全体を送る）。応答に保存後の notes と、保持上限で落ちた件数（dropped）を返す",
      inputSchema: z.object({
        projectId: z.string().min(1).describe("対象プロジェクトの ID"),
        notes: interviewNotesSchema,
        mode: z
          .enum(["replace", "append"])
          .optional()
          .describe("append（既定）= 既存とマージ / replace = 全置換"),
        expectedUpdatedAt: expectedUpdatedAtSchema,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectId, notes, mode, expectedUpdatedAt }) => {
      const project = await findOwnedProject(projectId, userId);
      if (!project) {
        return toError("プロジェクトが見つかりません");
      }
      const conflict = checkVersion(project, expectedUpdatedAt);
      if (conflict) return conflict;

      const result = await saveInterviewNotes(projectId, notes, {
        mode: mode ?? "append",
      });
      // 保存後のノートと最新の図で現在地を導出する
      const saved = (await findOwnedProject(projectId, userId)) ?? project;
      const guidance = await loadGuidance(saved);
      return toResult({
        ok: true,
        mode: mode ?? "append",
        notes: result.notes,
        dropped: result.dropped,
        updatedAt: versionOf(saved),
        interview: { phase: guidance.phase, agenda: guidance.agenda },
      });
    },
  );

  return server;
}
