import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createNode,
  updateNodePosition,
} from "@/app/(main)/projects/[projectId]/_actions";
import { db } from "@/db";
import { nodes } from "@/db/schema";
import { planDiagramMutation } from "@/lib/diagram/apply-diff";
import { diagramDiffSchema } from "@/lib/diagram/diff-schema";
import { applyMutationPlan } from "@/lib/diagram/mutate";
import type { RevisionDiff } from "@/lib/diagram/revision-diff";
import {
  listRevisions,
  MAX_REVISIONS_PER_PROJECT,
  saveRevision,
} from "@/lib/diagram/revisions";
import { loadDiagramSnapshot } from "@/lib/diagram/snapshot";
import { buildMcpServer } from "@/lib/mcp/tools";
import { createProject, createUser } from "./factories";

async function connectClient(userId: string) {
  const server = buildMcpServer(userId);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

function payloadOf<T>(result: Awaited<ReturnType<Client["callTool"]>>): T {
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0]?.text ?? "{}") as T;
}

/** チャット経路と同じ検証を通して図を更新する */
async function applyDiff(projectId: string, diffInput: unknown) {
  const current = await loadDiagramSnapshot(projectId);
  const result = planDiagramMutation(
    current,
    diagramDiffSchema.parse(diffInput),
  );
  if (!result.ok) throw new Error(`plan failed: ${result.reason}`);
  await applyMutationPlan(projectId, result.plan, { source: "chat" });
}

/** 残業時間 → 疲労 → 生産性 → 残業時間 の R ループを閉じる 2 段階の diff */
const OPEN_DIFF = {
  upsertNodes: [{ name: "残業時間" }, { name: "疲労" }],
  upsertEdges: [
    {
      source: "残業時間",
      target: "疲労",
      polarity: "+",
      rationale: "残業が続くと疲れる",
    },
  ],
};

const CLOSE_DIFF = {
  upsertEdges: [
    {
      source: "疲労",
      target: "残業時間",
      polarity: "+",
      rationale: "疲れると効率が落ちて残業が増える",
    },
  ],
};

function mockSession(userId: string) {
  (globalThis as { __mockSession?: unknown }).__mockSession = {
    user: { id: userId },
  };
}

describe("リビジョンの保存", () => {
  it("最初の更新は基点が無くても保存でき、追加件数が summary に載る", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    await applyDiff(project.id, OPEN_DIFF);

    const revisions = await listRevisions(project.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].source).toBe("chat");
    expect(revisions[0].summary).toBe("+2 変数 / +1 リンク");
  });

  it("更新のたびに積まれ、summary は直前のリビジョンとの差分を表す", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    await applyDiff(project.id, OPEN_DIFF);
    await applyDiff(project.id, CLOSE_DIFF);

    const revisions = await listRevisions(project.id);
    expect(revisions).toHaveLength(2);
    // 新しい順
    expect(revisions[0].summary).toBe("+1 リンク / R1 が閉じた");
    expect(revisions[1].summary).toBe("+2 変数 / +1 リンク");
  });

  it("UI からの書き込みは source: ui で積まれる", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    mockSession(user.id);

    const result = await createNode(project.id, "締切", 0, 0);
    expect(result.ok).toBe(true);

    const revisions = await listRevisions(project.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].source).toBe("ui");
    expect(revisions[0].summary).toBe("+1 変数");
  });

  it("位置の更新ではリビジョンが増えない", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    mockSession(user.id);
    await createNode(project.id, "締切", 0, 0);
    const [node] = await db
      .select()
      .from(nodes)
      .where(eq(nodes.projectId, project.id));

    await updateNodePosition(project.id, node.id, 120, 340);

    expect(await listRevisions(project.id)).toHaveLength(1);
  });

  it("保持上限を超えると古いものから消える", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    await applyDiff(project.id, OPEN_DIFF);

    // 上限 + 5 件になるまで積む（内容は変わらないので summary は「変更なし」）
    for (let i = 0; i < MAX_REVISIONS_PER_PROJECT + 4; i++) {
      await saveRevision(db, project.id, { source: "mcp" });
    }

    const revisions = await listRevisions(
      project.id,
      MAX_REVISIONS_PER_PROJECT,
    );
    expect(revisions).toHaveLength(MAX_REVISIONS_PER_PROJECT);
    // 最初の 1 件（+2 変数 / +1 リンク）は押し出されている
    expect(revisions.some((r) => r.summary.includes("変数"))).toBe(false);
  });

  it("purge も差分の基点も projectId で閉じている", async () => {
    const user = await createUser();
    const kept = await createProject(user.id, { title: "残る方" });
    const busy = await createProject(user.id, { title: "積む方" });

    await applyDiff(kept.id, OPEN_DIFF);
    const keptBefore = await listRevisions(kept.id);

    await applyDiff(busy.id, OPEN_DIFF);
    for (let i = 0; i < MAX_REVISIONS_PER_PROJECT + 4; i++) {
      await saveRevision(db, busy.id, { source: "mcp" });
    }

    // 他プロジェクトの purge に巻き込まれない
    expect(await listRevisions(kept.id)).toEqual(keptBefore);

    // 他プロジェクトの新しいリビジョンを基点にしない
    // （kept は 1 件しか無いので、2 件目の差分は kept 自身との比較になる）
    await applyDiff(kept.id, CLOSE_DIFF);
    const keptAfter = await listRevisions(kept.id);
    expect(keptAfter[0].summary).toBe("+1 リンク / R1 が閉じた");
  });
});

describe("MCP: list_revisions / diff_revisions / restore_revision", () => {
  it("誤って消した変数をリビジョンから戻せて、履歴も残る", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);

    await applyDiff(project.id, OPEN_DIFF);
    await applyDiff(project.id, CLOSE_DIFF);
    const closed = await listRevisions(project.id);
    const closedRevisionId = closed[0].id;

    // 「疲労」を消してループを壊す
    await applyDiff(project.id, { deleteNodes: ["疲労"] });
    expect((await loadDiagramSnapshot(project.id)).nodes).toHaveLength(1);

    const restore = await client.callTool({
      name: "restore_revision",
      arguments: { projectId: project.id, revisionId: closedRevisionId },
    });
    const payload = payloadOf<{
      ok: boolean;
      diff: RevisionDiff;
      revision: { id: number; summary: string };
      restoredFrom: { id: number };
    }>(restore);

    expect(payload.ok).toBe(true);
    expect(payload.restoredFrom.id).toBe(closedRevisionId);
    // 応答に「何が変わるか」が入る
    expect(payload.diff.nodes.added.map((n) => n.name)).toEqual(["疲労"]);
    expect(payload.diff.loops.closed).toHaveLength(1);

    // 図が戻っている
    const snapshot = await loadDiagramSnapshot(project.id);
    expect(snapshot.nodes.map((n) => n.name).sort()).toEqual([
      "残業時間",
      "疲労",
    ]);
    expect(snapshot.edges).toHaveLength(2);

    // 履歴は消えず、復元ぶんが 1 件増えている
    const after = await listRevisions(project.id);
    expect(after).toHaveLength(4);
    expect(after[0].id).toBe(payload.revision.id);
    expect(after[0].summary).toContain(`復元 #${closedRevisionId}`);
    expect(after.some((r) => r.id === closedRevisionId)).toBe(true);
  });

  it("list_revisions は新しい順に id / source / summary を返す", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);
    await applyDiff(project.id, OPEN_DIFF);
    await applyDiff(project.id, CLOSE_DIFF);

    const listed = await client.callTool({
      name: "list_revisions",
      arguments: { projectId: project.id },
    });
    const { revisions, retained } = payloadOf<{
      revisions: { id: number; source: string; summary: string }[];
      retained: number;
    }>(listed);
    expect(retained).toBe(MAX_REVISIONS_PER_PROJECT);
    expect(revisions).toHaveLength(2);
    expect(revisions[0].id).toBeGreaterThan(revisions[1].id);
    expect(revisions[0].source).toBe("chat");
  });

  it("diff_revisions は to を省略すると現在の図と比べる", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);

    await applyDiff(project.id, OPEN_DIFF);
    const [first] = await listRevisions(project.id);
    await applyDiff(project.id, CLOSE_DIFF);

    const diffed = await client.callTool({
      name: "diff_revisions",
      arguments: { projectId: project.id, fromRevisionId: first.id },
    });
    const payload = payloadOf<{
      ok: boolean;
      to: { current?: boolean };
      diff: RevisionDiff;
    }>(diffed);
    expect(payload.ok).toBe(true);
    expect(payload.to.current).toBe(true);
    expect(payload.diff.edges.added).toHaveLength(1);
    expect(payload.diff.loops.closed).toHaveLength(1);
  });

  it("diff_revisions は status 遷移も返す", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);

    await applyDiff(project.id, OPEN_DIFF);
    const [before] = await listRevisions(project.id);
    await applyDiff(project.id, {
      upsertEdges: [
        {
          source: "残業時間",
          target: "疲労",
          polarity: "+",
          rationale: "残業が続くと疲れる",
          status: "confirmed",
        },
      ],
    });

    const diffed = await client.callTool({
      name: "diff_revisions",
      arguments: { projectId: project.id, fromRevisionId: before.id },
    });
    const { diff } = payloadOf<{ diff: RevisionDiff }>(diffed);
    expect(diff.statusTransitions).toEqual([
      { from: "inferred", to: "confirmed", count: 1 },
    ]);
  });

  it("存在しないリビジョン ID は ok: false（not-found）で返る", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);
    await applyDiff(project.id, OPEN_DIFF);

    const diffed = await client.callTool({
      name: "diff_revisions",
      arguments: { projectId: project.id, fromRevisionId: 999_999 },
    });
    expect(payloadOf<{ ok: boolean; error: string }>(diffed)).toMatchObject({
      ok: false,
      error: "not-found",
    });
  });

  it("古い expectedUpdatedAt では復元されず、リビジョンも増えない", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);

    await applyDiff(project.id, OPEN_DIFF);
    const [target] = await listRevisions(project.id);
    await applyDiff(project.id, CLOSE_DIFF);
    const before = await listRevisions(project.id);

    const restore = await client.callTool({
      name: "restore_revision",
      arguments: {
        projectId: project.id,
        revisionId: target.id,
        expectedUpdatedAt: 1,
      },
    });
    expect(payloadOf<{ ok: boolean; error: string }>(restore)).toMatchObject({
      ok: false,
      error: "conflict",
    });
    expect(await listRevisions(project.id)).toEqual(before);
    expect((await loadDiagramSnapshot(project.id)).edges).toHaveLength(2);
  });

  it("他ユーザーのプロジェクトでは 3 ツールとも見つからない", async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const project = await createProject(owner.id);
    await applyDiff(project.id, OPEN_DIFF);
    const [revision] = await listRevisions(project.id);
    const client = await connectClient(attacker.id);

    for (const call of [
      { name: "list_revisions", arguments: { projectId: project.id } },
      {
        name: "diff_revisions",
        arguments: { projectId: project.id, fromRevisionId: revision.id },
      },
      {
        name: "restore_revision",
        arguments: { projectId: project.id, revisionId: revision.id },
      },
    ]) {
      const result = await client.callTool(call);
      expect(result.isError).toBe(true);
    }
    // 図も履歴も汚れていない
    expect(await listRevisions(project.id)).toHaveLength(1);
    expect((await loadDiagramSnapshot(project.id)).nodes).toHaveLength(2);
  });
});
