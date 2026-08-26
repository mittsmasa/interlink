import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { planDiagramMutation } from "@/lib/diagram/apply-diff";
import { matchArchetypes } from "@/lib/diagram/archetypes";
import { diagramDiffSchema } from "@/lib/diagram/diff-schema";
import { renderDiagramExport } from "@/lib/diagram/export";
import { lintDiagram } from "@/lib/diagram/lint";
import {
  buildLoopEdges,
  deriveLoopDependencies,
} from "@/lib/diagram/loop-edges";
import { detectLoops, MAX_LOOPS } from "@/lib/diagram/loops";
import {
  computeDiagramMetrics,
  describeCandidate,
  MAX_INTERVENTION_CANDIDATES,
  MAX_METRIC_NODES,
} from "@/lib/diagram/metrics";
import { applyMutationPlan } from "@/lib/diagram/mutate";
import { toSimEdges, toSimNodes } from "@/lib/diagram/sim-inputs";
import {
  findBehaviorMismatch,
  type SimulationSummary,
  summarizeSimulation,
} from "@/lib/diagram/sim-summary";
import {
  ALLOWED_FUNCTIONS,
  type SimConfig,
  type SimError,
  simulate,
} from "@/lib/diagram/simulate";
import { loadDiagramSnapshot } from "@/lib/diagram/snapshot";
import { checkBehaviorConsistency } from "@/lib/interview/consistency";
import {
  interviewNotesSchema,
  parseInterviewNotes,
} from "@/lib/interview/notes";
import { saveInterviewNotes } from "@/lib/interview/store";
import {
  buildMcpInterviewPrompt,
  deriveGuidance,
  loadGuidance,
} from "@/lib/mcp/interview";
import { diffStructure } from "@/lib/mcp/structure-diff";
import { deleteOwnedProject, renameOwnedProject } from "@/lib/projects/manage";
import { getProjectSummariesByUserId } from "@/lib/queries/projects";

/**
 * initialize レスポンスでクライアントへ渡る静的な使い方の案内。
 * 動的な現在地（フェーズ / アジェンダ）は prompt とツール応答が担う
 */
const SERVER_INSTRUCTIONS = `interlink は「問いの構造を図にする」アプリ。ユーザーの構造的な悩みを聞き取り、因果ループ図（CLD）として一緒に育てる。

- ユーザーの悩みを聞き取りながら図を作るときは、interview プロンプトを使うと聞き取りの方法論と現在地が手に入る（最短の入口）
- 図を読むには get_diagram。ループ（R/B）・lint 指摘・システム原型・構造指標（metrics: ループの交点 = 介入候補）・挙動と構造の整合（consistency）に加え、聞き取りノートと「次に聞くこと」（interview.phase / interview.agenda）も返る
- 図の書き込みは update_diagram（差分形式）。変数は増減を語れる名詞句にし、因果リンクには根拠（rationale）を必ず添える。相関しか確認できていない関係を因果にしない
- 図を持ち出すときは export_diagram（mermaid はそのまま描画できる。markdown は根拠付きの表）。プロジェクトの改名は update_project、削除は delete_project（取り消せない。ユーザーの明示的な指示があるときだけ）
- resources でも読める: interlink://projects（一覧）、interlink://projects/{id}/diagram.md（図の markdown）、interlink://projects/{id}/notes.json（聞き取りノート）
- update_diagram は dryRun: true で適用せずに計画と警告だけ確認できる。適用すると閉じた/開いたループと新しい lint 指摘（structure）が返るので、get_diagram を読み直さなくても結果が分かる
- warnings は {code, target, message, suggestion} の配列。除外された操作は黙って落ちるので、必ず目を通して suggestion を踏まえて再送する
- 聞き取った事実（テーマ / 時間挙動 / 理想 / 関係者 / 変数候補）は update_notes に記録する。既定は append（差分だけ送れば既存とマージされる）。整理し直すときだけ mode: "replace" で全体を送る
- 並行編集を避けたいときは get_diagram / 書き込み応答の updatedAt を expectedUpdatedAt に渡す。不一致なら ok: false と最新の updatedAt が返る
- 書き込み系ツールの応答に含まれる interview.phase / interview.agenda は聞き取りの誘導。対話を進めるときはこれに従う
- ストック&フロー化した図（kind / 式 / 初期値あり）は run_simulation で時間発展を計算し、stock ごとの要約（初期値・最終値・挙動パターン）で実感と突き合わせる。what-if は compare_scenarios（図は変更しない）`;

/** run_simulation / compare_scenarios の既定値（UI のシミュレーションパネルと同じ） */
const DEFAULT_SIM_DT = 1;
const DEFAULT_SIM_STEPS = 20;
/** 1 回の呼び出しで回せるステップ数の上限（応答肥大・計算時間の歯止め） */
const MAX_SIM_STEPS = 1000;
const MAX_SCENARIOS = 8;
/** 「遅れ」付きリンクの既定の遅らせ幅と上限（simulate の delaySteps） */
const DEFAULT_DELAY_STEPS = 1;
const MAX_DELAY_STEPS = 100;

/** SFD 整合の lint ルール（simulate の前に気づける構造上の問題） */
const SFD_LINT_RULES = new Set([
  "flow-without-stock",
  "stock-without-flow",
  "stock-to-stock-edge",
  "undefined-reference",
]);

const simConfigInput = {
  dt: z
    .number()
    .positive()
    .optional()
    .describe(`時間刻み（既定 ${DEFAULT_SIM_DT}）`),
  steps: z
    .number()
    .int()
    .min(1)
    .max(MAX_SIM_STEPS)
    .optional()
    .describe(
      `計算ステップ数（既定 ${DEFAULT_SIM_STEPS}、最大 ${MAX_SIM_STEPS}）`,
    ),
  nonNegativeStocks: z
    .boolean()
    .optional()
    .describe(
      "true なら stock が負にならないよう 0 で止める（在庫・人数など負が無意味な量に）",
    ),
  delaySteps: z
    .number()
    .int()
    .min(1)
    .max(MAX_DELAY_STEPS)
    .optional()
    .describe(
      `「遅れ」が付いたリンクを何ステップ遅らせるか（既定 ${DEFAULT_DELAY_STEPS}、最大 ${MAX_DELAY_STEPS}）。遅れを大きくすると振動が出やすくなる`,
    ),
};

const overridesInput = z
  .record(z.string(), z.number())
  .optional()
  .describe(
    "変数名 → 値の上書き（図は変更しない）。stock の初期値と constant の値だけ指定できる",
  );

type SimRunOutcome =
  | { ok: true; summary: SimulationSummary }
  | { ok: false; error: SimError };

/** 図の現在地から 1 本シミュレーションを回し、要約または構造化エラーを返す */
function runSimulationOn(
  diagram: Awaited<ReturnType<typeof loadDiagramSnapshot>>,
  config: SimConfig,
): SimRunOutcome {
  const simNodes = toSimNodes(diagram.nodes);
  const result = simulate(simNodes, toSimEdges(diagram.edges), config);
  if (!result.ok) return { ok: false, error: result.error };
  const stockNames = simNodes
    .filter((n) => n.kind === "stock")
    .map((n) => n.name);
  return {
    ok: true,
    summary: summarizeSimulation(result.series, config, stockNames),
  };
}

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
        "自分のプロジェクト（問い）の一覧を返す。図を操作する前に projectId を調べるために使う。各プロジェクトにテーマ・聞き取りフェーズ・変数/リンク/ループ数・確認済みループ数を添える",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      return toResult({ projects: await getProjectSummariesByUserId(userId) });
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
        "プロジェクトの因果ループ図の現在地を返す。変数・因果リンク・式由来の情報リンク（dependencies）に加え、導出済みの検証結果（フィードバックループと R/B 極性、lint 指摘、システム原型マッチ = 構造の説明と確認の問いに加え、定石の介入 prescription とよくある失敗 pitfalls）、構造指標（metrics: ノードごとの次数とループ参加数の上位、介入候補 = 複数ループの交点・R と B の接点）、時間挙動と構造の整合判定（consistency: 期待する構造 / 見つかった構造 / 探り方）を含む。loops[].id は update_notes の confirmedLoopIds / hypotheses[].loopIds と archetypeMatches[].loopIds が指す ID。極性 ? は式の符号が構造から決まらない極性未定、derived は式由来リンクを含む暫定ループ。updatedAt は update_* の expectedUpdatedAt に渡せる",
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
      const loopEdges = buildLoopEdges(diagram);
      const loopResult = detectLoops(diagram.nodes, loopEdges);
      const guidance = deriveGuidance(project, diagram);
      const metrics = computeDiagramMetrics(
        diagram.nodes,
        loopEdges,
        loopResult.loops,
      );
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
          status: e.status,
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
        lintFindings: lintDiagram(diagram.nodes, diagram.edges, {
          loops: loopResult.loops,
          confirmedLoopIds: guidance.notes.confirmedLoopIds,
        }),
        archetypeMatches: matchArchetypes(loopResult.loops, loopEdges),
        metrics: {
          nodes: metrics.nodes.slice(0, MAX_METRIC_NODES).map((m) => ({
            name: m.name,
            inDegree: m.inDegree,
            outDegree: m.outDegree,
            loopCount: m.loopCount,
            reinforcingLoopCount: m.reinforcingLoopCount,
            balancingLoopCount: m.balancingLoopCount,
          })),
          interventionCandidates: metrics.interventionCandidates
            .slice(0, MAX_INTERVENTION_CANDIDATES)
            .map((c) => ({
              name: c.name,
              reason: c.reason,
              description: describeCandidate(c),
              loopIds: c.loopIds,
              loopLabels: c.loopLabels,
            })),
        },
        consistency: checkBehaviorConsistency(guidance.notes, loopResult.loops),
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
        loops: detectLoops(current.nodes, buildLoopEdges(current)).loops,
        findings: lintDiagram(current.nodes, current.edges),
      };
      await applyMutationPlan(projectId, plan);
      // 適用後の図で聞き取りの現在地を導出し、構造の変化と次の一手を同梱する
      const after = await loadDiagramSnapshot(projectId);
      const saved = (await findOwnedProject(projectId, userId)) ?? project;
      const guidance = deriveGuidance(saved, after);
      const structure = diffStructure(before, {
        loops: detectLoops(after.nodes, buildLoopEdges(after)).loops,
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
        "聞き取りノートを更新する。テーマ・時間挙動・理想・関係者・変数候補・確認済みループ ID・時間軸（timeHorizon）・変数ごとの挙動（variableBehaviors）・介入仮説（hypotheses: leveragePoint / expectedEffect / loopIds / status）を聞き取ったら反映する。図に置く前の変数候補はここに貯める。hypotheses は同じ leveragePoint を送ると status / expectedEffect が上書きされるので、試した結果（tested / rejected）の反映に使う。既定の mode: append では送った差分が既存ノートとマージされる（配列は union、スカラーは非 null のみ上書き）ので、新しく分かった事実だけ送ればよい。mode: replace は全置換（既存の内容を欠落させないよう全体を送る）。応答に保存後の notes と、保持上限で落ちた件数（dropped）を返す",
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

  server.registerTool(
    "export_diagram",
    {
      description:
        "因果ループ図をテキストで持ち出す。mermaid は graph LR（極性をエッジラベル、遅れを点線、ストック/フロー等の役割をノード形状で表し、末尾にループ一覧をコメントで添える）。markdown は変数表・根拠付きリンク表・ループ・システム原型・聞き取りノート要約。どこにも保存せずテキストを返すだけ",
      inputSchema: z.object({
        projectId: z.string().min(1).describe("対象プロジェクトの ID"),
        format: z
          .enum(["mermaid", "markdown"])
          .describe("mermaid: そのまま描画できる図 / markdown: 共有用の文書"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ projectId, format }) => {
      const project = await findOwnedProject(projectId, userId);
      if (!project) {
        return toError("プロジェクトが見つかりません");
      }
      const text = await renderExport(project, format);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.registerTool(
    "update_project",
    {
      description:
        "プロジェクトのタイトル（問いの一行要約）を変える。聞き取りでテーマが定まったら付け直すのに使う",
      inputSchema: z.object({
        projectId: z.string().min(1).describe("対象プロジェクトの ID"),
        title: z.string().min(1).describe("新しいタイトル"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, title }) => {
      const result = await renameOwnedProject(projectId, userId, title);
      if (!result.ok) {
        return toError(
          result.reason === "empty-title"
            ? "タイトルが空です"
            : "プロジェクトが見つかりません",
        );
      }
      return toResult({
        ok: true,
        project: { id: projectId, title: result.title },
      });
    },
  );

  server.registerTool(
    "delete_project",
    {
      description:
        "プロジェクトを削除する。図・聞き取りノート・チャット履歴もすべて消え、取り消せない。ユーザーが明示的に削除を求めたときだけ使うこと",
      inputSchema: z.object({
        projectId: z.string().min(1).describe("削除するプロジェクトの ID"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId }) => {
      const deleted = await deleteOwnedProject(projectId, userId);
      if (!deleted) {
        return toError("プロジェクトが見つかりません");
      }
      return toResult({ ok: true, deleted: { id: projectId } });
    },
  );

  // --- resources: 読み取り専用の入口。ツールを呼ばずに現在地を参照できる ---

  server.registerResource(
    "projects",
    "interlink://projects",
    {
      title: "プロジェクト一覧",
      description:
        "自分のプロジェクト一覧（list_projects と同じ内容）。各プロジェクトの図は interlink://projects/{id}/diagram.md で読める",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            { projects: await getProjectSummariesByUserId(userId) },
            null,
            2,
          ),
        },
      ],
    }),
  );

  /** 所有プロジェクトを template の一覧として列挙する（diagram.md / notes.json 共用） */
  const listProjectResources =
    (suffix: string, describe: string) => async () => {
      const summaries = await getProjectSummariesByUserId(userId);
      return {
        resources: summaries.map((p) => ({
          uri: `interlink://projects/${p.id}/${suffix}`,
          name: `${p.title} — ${describe}`,
        })),
      };
    };

  server.registerResource(
    "project-diagram",
    new ResourceTemplate("interlink://projects/{id}/diagram.md", {
      list: listProjectResources("diagram.md", "図"),
    }),
    {
      title: "因果ループ図（markdown）",
      description:
        "プロジェクトの因果ループ図を markdown で読む（export_diagram の markdown と同じ）",
      mimeType: "text/markdown",
    },
    async (uri, { id }) => {
      const projectId = Array.isArray(id) ? id[0] : id;
      const project = await findOwnedProject(projectId, userId);
      if (!project) {
        throw new Error("プロジェクトが見つかりません");
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: await renderExport(project, "markdown"),
          },
        ],
      };
    },
  );

  server.registerResource(
    "project-notes",
    new ResourceTemplate("interlink://projects/{id}/notes.json", {
      list: listProjectResources("notes.json", "聞き取りノート"),
    }),
    {
      title: "聞き取りノート（JSON）",
      description:
        "プロジェクトの聞き取りノート（テーマ / 時間挙動 / 理想 / 関係者 / 変数候補 / 確認済みループ ID）。update_notes に渡す形と同じ",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      const projectId = Array.isArray(id) ? id[0] : id;
      const project = await findOwnedProject(projectId, userId);
      if (!project) {
        throw new Error("プロジェクトが見つかりません");
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              parseInterviewNotes(project.interviewNotes),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "run_simulation",
    {
      description: `ストック&フロー化した図をシミュレーションし、stock ごとの要約（初期値 / 最終値 / 最小 / 最大 / 向き / 挙動パターン）と間引いた時系列を返す。図は変更しない。式は ${ALLOWED_FUNCTIONS.join("/")} の関数が使える（smooth(値, 時定数) / delay(値, 時定数) は 1 次遅れ）。図の「遅れ」付きリンクは delaySteps ステップぶん遅れて効く。ok: false のときは error.type（missing-field / undefined-reference / cycle / diverged など）を見て update_diagram で図を直す。聞き取りノートの時間挙動と食い違えば mismatch が付く`,
      inputSchema: z.object({
        projectId: z.string().min(1).describe("対象プロジェクトの ID"),
        ...simConfigInput,
        overrides: overridesInput,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({
      projectId,
      dt,
      steps,
      nonNegativeStocks,
      delaySteps,
      overrides,
    }) => {
      const project = await findOwnedProject(projectId, userId);
      if (!project) {
        return toError("プロジェクトが見つかりません");
      }
      const diagram = await loadDiagramSnapshot(projectId);
      const config: SimConfig = {
        dt: dt ?? DEFAULT_SIM_DT,
        steps: steps ?? DEFAULT_SIM_STEPS,
        overrides,
        nonNegativeStocks,
        delaySteps: delaySteps ?? DEFAULT_DELAY_STEPS,
      };
      const warnings = lintDiagram(diagram.nodes, diagram.edges)
        .filter((f) => SFD_LINT_RULES.has(f.rule))
        .map((f) => f.message);
      const outcome = runSimulationOn(diagram, config);
      if (!outcome.ok) {
        return toResult({ ok: false, error: outcome.error, warnings });
      }
      const guidance = deriveGuidance(project, diagram);
      const mismatch = findBehaviorMismatch(
        guidance.notes.behavior?.pattern,
        outcome.summary.stocks,
      );
      return toResult({
        ok: true,
        ...outcome.summary,
        warnings,
        mismatch,
      });
    },
  );

  server.registerTool(
    "compare_scenarios",
    {
      description:
        "what-if 比較。図を変更せずに stock の初期値 / constant の値を上書きした複数シナリオを同じ設定で回し、baseline（上書きなし）と並べて stock ごとの要約と最終値の差分を返す。レバレッジポイント（どの定数を動かすと挙動が変わるか）の議論に使う",
      inputSchema: z.object({
        projectId: z.string().min(1).describe("対象プロジェクトの ID"),
        ...simConfigInput,
        scenarios: z
          .array(
            z.object({
              label: z.string().min(1).describe("シナリオ名（例: 採用倍増）"),
              overrides: z
                .record(z.string(), z.number())
                .describe(
                  "変数名 → 値の上書き（stock の初期値 / constant の値）",
                ),
            }),
          )
          .min(1)
          .max(MAX_SCENARIOS)
          .describe(`比較するシナリオ（最大 ${MAX_SCENARIOS}）`),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({
      projectId,
      dt,
      steps,
      nonNegativeStocks,
      delaySteps,
      scenarios,
    }) => {
      const project = await findOwnedProject(projectId, userId);
      if (!project) {
        return toError("プロジェクトが見つかりません");
      }
      const diagram = await loadDiagramSnapshot(projectId);
      const base: SimConfig = {
        dt: dt ?? DEFAULT_SIM_DT,
        steps: steps ?? DEFAULT_SIM_STEPS,
        nonNegativeStocks,
        delaySteps: delaySteps ?? DEFAULT_DELAY_STEPS,
      };
      const baseline = runSimulationOn(diagram, base);
      if (!baseline.ok) {
        return toResult({ ok: false, error: baseline.error });
      }
      const baselineFinal = new Map(
        baseline.summary.stocks.map((s) => [s.name, s.final]),
      );
      const results = scenarios.map(({ label, overrides }) => {
        const outcome = runSimulationOn(diagram, { ...base, overrides });
        if (!outcome.ok) {
          return { label, overrides, ok: false as const, error: outcome.error };
        }
        return {
          label,
          overrides,
          ok: true as const,
          stocks: outcome.summary.stocks.map((s) => ({
            ...s,
            delta: s.final - (baselineFinal.get(s.name) ?? s.final),
          })),
        };
      });
      return toResult({
        ok: true,
        dt: base.dt,
        steps: base.steps,
        baseline: { stocks: baseline.summary.stocks },
        scenarios: results,
      });
    },
  );

  return server;
}

/** export_diagram と diagram.md resource が共有する描画。図を読んでテキストにする */
async function renderExport(
  project: { id: string; title: string; interviewNotes: string | null },
  format: "mermaid" | "markdown",
) {
  const diagram = await loadDiagramSnapshot(project.id);
  return renderDiagramExport(format, {
    title: project.title,
    nodes: diagram.nodes,
    edges: diagram.edges,
    notes: parseInterviewNotes(project.interviewNotes),
  });
}
