import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { loadDiagramSnapshot } from "@/lib/diagram/snapshot";
import { buildMcpServer } from "@/lib/mcp/tools";
import { createProject, createUser } from "./factories";

/** userId に束縛した MCP サーバーへ in-memory で接続したクライアントを返す */
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

function textOf(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content as { type: string; text: string }[];
  return content[0]?.text ?? "";
}

describe("MCP tools", () => {
  it("tools/list で 4 ツールが列挙される", async () => {
    const user = await createUser();
    const client = await connectClient(user.id);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_project",
      "get_diagram",
      "list_projects",
      "update_diagram",
      "update_notes",
    ]);
    // diff スキーマが JSON Schema へ変換されて公開されていること（zod 4 互換の確認）
    const update = tools.find((t) => t.name === "update_diagram");
    const diffSchema = update?.inputSchema.properties?.diff as
      | { properties?: Record<string, unknown> }
      | undefined;
    expect(diffSchema?.properties).toHaveProperty("upsertNodes");
    expect(update?.inputSchema.properties).toHaveProperty("dryRun");
    expect(update?.inputSchema.properties).toHaveProperty("expectedUpdatedAt");
  });

  it("tools/list で読み取り系に readOnlyHint、書き込み系に destructiveHint が付く", async () => {
    const user = await createUser();
    const client = await connectClient(user.id);
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t.annotations]));
    expect(byName.get("list_projects")).toMatchObject({ readOnlyHint: true });
    expect(byName.get("get_diagram")).toMatchObject({ readOnlyHint: true });
    expect(byName.get("create_project")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(byName.get("update_diagram")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(byName.get("update_notes")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it("list_projects は自分のプロジェクトだけ返す", async () => {
    const user = await createUser();
    const other = await createUser();
    const mine = await createProject(user.id, { title: "自分の問い" });
    await createProject(other.id, { title: "他人の問い" });

    const client = await connectClient(user.id);
    const result = await client.callTool({ name: "list_projects" });
    const payload = JSON.parse(textOf(result)) as {
      projects: { id: string; title: string }[];
    };
    expect(payload.projects.map((p) => p.id)).toContain(mine.id);
    expect(payload.projects.map((p) => p.title)).not.toContain("他人の問い");
  });

  it("update_diagram で図を作り get_diagram で検証結果込みで読める", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);

    const update = await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId: project.id,
        diff: {
          upsertNodes: [{ name: "残業時間" }, { name: "疲労" }],
          upsertEdges: [
            {
              source: "残業時間",
              target: "疲労",
              polarity: "+",
              rationale: "残業が続くと疲れが溜まる",
            },
            {
              source: "疲労",
              target: "残業時間",
              polarity: "+",
              rationale: "疲れると作業効率が落ち残業が増える",
            },
          ],
        },
      },
    });
    expect(update.isError).toBeFalsy();
    const applied = JSON.parse(textOf(update)) as {
      applied: { createdNodes: number; createdEdges: number };
    };
    expect(applied.applied).toMatchObject({ createdNodes: 2, createdEdges: 2 });

    const read = await client.callTool({
      name: "get_diagram",
      arguments: { projectId: project.id },
    });
    const diagram = JSON.parse(textOf(read)) as {
      nodes: { name: string }[];
      dependencies: { from: string; to: string; polarity: string | null }[];
      loops: {
        id: string;
        label: string;
        polarity: string;
        hasDelay: boolean;
        derived: boolean;
        nodeNames: string[];
        edges: { source: string; target: string }[];
      }[];
      loopLimit: { truncated: boolean; shown: number; limit: number };
      archetypeMatches: { loopIds: string[] }[];
    };
    expect(diagram.nodes.map((n) => n.name).sort()).toEqual([
      "残業時間",
      "疲労",
    ]);
    expect(diagram.dependencies).toEqual([]);
    // 正リンク 2 本のループ → 自己強化（R）。confirmedLoopIds に使える id と辿れる edges を返す
    expect(diagram.loops).toHaveLength(1);
    const [loop] = diagram.loops;
    expect(loop).toMatchObject({
      label: "R1",
      polarity: "R",
      hasDelay: false,
      derived: false,
    });
    expect(loop.id).toMatch(/^loop:/);
    expect(loop.edges).toHaveLength(2);
    expect(loop.edges.map((e) => `${e.source}→${e.target}`).sort()).toEqual(
      ["残業時間→疲労", "疲労→残業時間"].sort(),
    );
    expect(loop.edges[0].source).toBe(loop.nodeNames[0]);
    expect(diagram.loopLimit).toEqual({
      truncated: false,
      shown: 1,
      limit: 50,
    });

    // 返した id で確認済みループとして記録でき、agenda から未確認の指示が消える
    const confirm = await client.callTool({
      name: "update_notes",
      arguments: {
        projectId: project.id,
        notes: { confirmedLoopIds: [loop.id] },
      },
    });
    expect(confirm.isError).toBeFalsy();
    const reread = await client.callTool({
      name: "get_diagram",
      arguments: { projectId: project.id },
    });
    const after = JSON.parse(textOf(reread)) as {
      interviewNotes: { confirmedLoopIds: string[] };
      interview: { agenda: string[] };
    };
    expect(after.interviewNotes.confirmedLoopIds).toEqual([loop.id]);
    expect(after.interview.agenda.join("\n")).not.toContain(loop.id);
  });

  it("get_diagram は式由来リンクを dependencies に返し、それで閉じる円環を derived ループとして含める", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);

    const update = await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId: project.id,
        diff: {
          upsertNodes: [
            { name: "残高", kind: "stock", initialValue: 100 },
            { name: "利息", kind: "flow", expression: "残高*0.1" },
          ],
          upsertEdges: [
            {
              source: "利息",
              target: "残高",
              polarity: "+",
              rationale: "利息が残高に積み上がる",
            },
          ],
        },
      },
    });
    expect(update.isError).toBeFalsy();

    const read = await client.callTool({
      name: "get_diagram",
      arguments: { projectId: project.id },
    });
    const diagram = JSON.parse(textOf(read)) as {
      dependencies: { from: string; to: string; polarity: string | null }[];
      loops: { polarity: string; derived: boolean; nodeNames: string[] }[];
    };
    // 残高 →(式) 利息 は因果エッジが無いので情報リンクとして現れる
    expect(diagram.dependencies).toEqual([
      { from: "残高", to: "利息", polarity: "+" },
    ]);
    // 因果 1 本 + 式由来 1 本で閉じた暫定 R ループ
    expect(diagram.loops).toHaveLength(1);
    expect(diagram.loops[0]).toMatchObject({ polarity: "R", derived: true });
  });

  it("他ユーザーの project は get_diagram / update_diagram とも見つからない", async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const project = await createProject(owner.id);
    const client = await connectClient(attacker.id);

    const read = await client.callTool({
      name: "get_diagram",
      arguments: { projectId: project.id },
    });
    expect(read.isError).toBe(true);

    const update = await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId: project.id,
        diff: { upsertNodes: [{ name: "侵入" }] },
      },
    });
    expect(update.isError).toBe(true);
    // 図が汚れていないこと
    const snapshot = await loadDiagramSnapshot(project.id);
    expect(snapshot.nodes).toHaveLength(0);
  });

  it("全消去になる diff は拒否される", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);

    await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId: project.id,
        diff: { upsertNodes: [{ name: "唯一の変数" }] },
      },
    });
    const wipe = await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId: project.id,
        diff: { deleteNodes: ["唯一の変数"] },
      },
    });
    // 検証で弾いた diff は isError ではなく ok:false（理由と構造化 warnings 付き）
    expect(wipe.isError).toBeFalsy();
    const payload = JSON.parse(textOf(wipe)) as { ok: boolean; error: string };
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("すべての変数を削除");
    const snapshot = await loadDiagramSnapshot(project.id);
    expect(snapshot.nodes).toHaveLength(1);
  });

  it("dryRun は計画と警告だけ返し図を変更しない", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);
    await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId: project.id,
        diff: { upsertNodes: [{ name: "残業時間" }] },
      },
    });

    const result = await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId: project.id,
        dryRun: true,
        diff: {
          upsertNodes: [{ name: "疲労" }],
          upsertEdges: [
            { source: "残業", target: "疲労", polarity: "+", rationale: "x" },
          ],
        },
      },
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result)) as {
      ok: boolean;
      dryRun: boolean;
      plan: { createNodes: string[]; createEdges: string[] };
      warnings: { code: string; target: string; suggestion?: string[] }[];
      updatedAt: number;
    };
    expect(payload).toMatchObject({ ok: true, dryRun: true });
    expect(payload.plan.createNodes).toEqual(["疲労"]);
    expect(payload.plan.createEdges).toEqual([]);
    expect(payload.warnings).toEqual([
      expect.objectContaining({
        code: "unresolved-edge",
        target: "残業→疲労",
        suggestion: ["残業時間"],
      }),
    ]);
    expect(typeof payload.updatedAt).toBe("number");
    const snapshot = await loadDiagramSnapshot(project.id);
    expect(snapshot.nodes.map((n) => n.name)).toEqual(["残業時間"]);
  });

  it("適用すると閉じた / 開いたループと新しい lint 指摘が structure として返る", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);

    const first = await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId: project.id,
        diff: {
          upsertNodes: [{ name: "残業時間" }, { name: "疲労" }],
          upsertEdges: [
            {
              source: "残業時間",
              target: "疲労",
              polarity: "+",
              rationale: "a",
            },
            {
              source: "疲労",
              target: "残業時間",
              polarity: "+",
              rationale: "b",
            },
          ],
        },
      },
    });
    const firstPayload = JSON.parse(textOf(first)) as {
      structure: {
        closedLoops: { id: string; polarity: string; nodeNames: string[] }[];
        openedLoops: unknown[];
        newFindings: unknown[];
      };
      updatedAt: number;
    };
    expect(firstPayload.structure.closedLoops).toHaveLength(1);
    expect(firstPayload.structure.closedLoops[0].polarity).toBe("R");
    expect(firstPayload.structure.openedLoops).toEqual([]);

    // ループを切り、孤立ノードを足す → openedLoops 1 件 + isolated-node の新指摘
    const second = await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId: project.id,
        diff: {
          upsertNodes: [{ name: "睡眠時間" }],
          deleteEdges: [{ source: "疲労", target: "残業時間" }],
        },
      },
    });
    const secondPayload = JSON.parse(textOf(second)) as {
      structure: {
        closedLoops: unknown[];
        openedLoops: { id: string }[];
        newFindings: { rule: string }[];
      };
      updatedAt: number;
    };
    expect(secondPayload.structure.closedLoops).toEqual([]);
    expect(secondPayload.structure.openedLoops.map((l) => l.id)).toEqual([
      firstPayload.structure.closedLoops[0].id,
    ]);
    expect(secondPayload.structure.newFindings.map((f) => f.rule)).toContain(
      "isolated-node",
    );
    expect(secondPayload.updatedAt).toBeGreaterThanOrEqual(
      firstPayload.updatedAt,
    );
  });

  it("無効操作だけの diff は isError ではなく ok:false と構造化 warnings を返す", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);
    const result = await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId: project.id,
        diff: { deleteNodes: ["存在しない"] },
      },
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result)) as {
      ok: boolean;
      error: string;
      warnings: { code: string }[];
    };
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("有効な操作がありません");
    expect(payload.warnings[0].code).toBe("missing-node");
  });

  it("expectedUpdatedAt が古ければ conflict を返し図を変えない", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);

    const read = await client.callTool({
      name: "get_diagram",
      arguments: { projectId: project.id },
    });
    const { updatedAt } = JSON.parse(textOf(read)) as { updatedAt: number };
    expect(updatedAt).toBe(project.updatedAt);

    // 同じ版を渡せば通る
    const ok = await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId: project.id,
        expectedUpdatedAt: updatedAt,
        diff: { upsertNodes: [{ name: "残業時間" }] },
      },
    });
    const okPayload = JSON.parse(textOf(ok)) as {
      ok: boolean;
      updatedAt: number;
    };
    expect(okPayload.ok).toBe(true);

    // 古い版を渡すと conflict
    const stale = await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId: project.id,
        expectedUpdatedAt: updatedAt - 1,
        diff: { upsertNodes: [{ name: "疲労" }] },
      },
    });
    expect(stale.isError).toBeFalsy();
    const stalePayload = JSON.parse(textOf(stale)) as {
      ok: boolean;
      error: string;
      updatedAt: number;
      expectedUpdatedAt: number;
    };
    expect(stalePayload).toMatchObject({
      ok: false,
      error: "conflict",
      updatedAt: okPayload.updatedAt,
      expectedUpdatedAt: updatedAt - 1,
    });
    const snapshot = await loadDiagramSnapshot(project.id);
    expect(snapshot.nodes.map((n) => n.name)).toEqual(["残業時間"]);

    // update_notes も同じロックに従う
    const notesStale = await client.callTool({
      name: "update_notes",
      arguments: {
        projectId: project.id,
        expectedUpdatedAt: updatedAt - 1,
        notes: { theme: "x" },
      },
    });
    const notesPayload = JSON.parse(textOf(notesStale)) as { error: string };
    expect(notesPayload.error).toBe("conflict");
  });

  it("create_project で新規プロジェクトを作れる", async () => {
    const user = await createUser();
    const client = await connectClient(user.id);
    const result = await client.callTool({
      name: "create_project",
      arguments: { title: "MCP からの問い" },
    });
    const payload = JSON.parse(textOf(result)) as {
      project: { id: string; title: string };
    };
    expect(payload.project.title).toBe("MCP からの問い");
  });
});

describe("MCP interview context", () => {
  it("prompts/list に interview が列挙される", async () => {
    const user = await createUser();
    const client = await connectClient(user.id);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["interview"]);
  });

  it("interview プロンプトは図・ノート・projectId 入りで、ツール名が MCP 表記に置換される", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);
    await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId: project.id,
        diff: { upsertNodes: [{ name: "残業時間" }] },
      },
    });

    const result = await client.getPrompt({
      name: "interview",
      arguments: { projectId: project.id },
    });
    const text = (result.messages[0].content as { text: string }).text;
    expect(text).toContain("いまのフェーズ");
    expect(text).toContain("残業時間");
    expect(text).toContain(project.id);
    expect(text).toContain("update_notes");
    expect(text).toContain("update_diagram");
    // アプリ内チャットのツール名表記が残っていないこと
    expect(text).not.toMatch(/updateNotes|updateDiagram/);
  });

  it("interview プロンプトは projectId 未指定なら導入文、所有外なら不存在の案内を返す", async () => {
    const user = await createUser();
    const other = await createUser();
    const otherProject = await createProject(other.id);
    const client = await connectClient(user.id);

    const intro = await client.getPrompt({ name: "interview", arguments: {} });
    const introText = (intro.messages[0].content as { text: string }).text;
    expect(introText).toContain("list_projects");
    expect(introText).toContain("create_project");

    const denied = await client.getPrompt({
      name: "interview",
      arguments: { projectId: otherProject.id },
    });
    const deniedText = (denied.messages[0].content as { text: string }).text;
    expect(deniedText).toContain("見つかりません");
  });

  it("update_notes が保存とフェーズ返却を行い、テーマ+挙動で draft へ進む", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);

    const result = await client.callTool({
      name: "update_notes",
      arguments: {
        projectId: project.id,
        notes: {
          theme: "残業が減らない",
          behavior: {
            pattern: "increasing",
            description: "半年前から増え続けている",
          },
          idealBehavior: null,
          stakeholders: [],
          variableCandidates: [],
          confirmedLoopIds: [],
        },
      },
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result)) as {
      ok: boolean;
      interview: { phase: string; agenda: string[] };
    };
    expect(payload.ok).toBe(true);
    expect(payload.interview.phase).toBe("draft");
    expect(payload.interview.agenda.length).toBeGreaterThan(0);
  });

  it("update_notes は既定で append、差分だけ送ると既存とマージされ保存後の notes と dropped が返る", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);

    await client.callTool({
      name: "update_notes",
      arguments: {
        projectId: project.id,
        notes: {
          theme: "残業が減らない",
          stakeholders: [{ name: "自分", concerns: ["睡眠"] }],
        },
      },
    });
    const appended = await client.callTool({
      name: "update_notes",
      arguments: {
        projectId: project.id,
        notes: {
          stakeholders: [{ name: "上司", concerns: ["納期"] }],
          variableCandidates: [{ name: "残業時間" }],
        },
      },
    });
    const payload = JSON.parse(textOf(appended)) as {
      ok: boolean;
      mode: string;
      notes: {
        theme: string | null;
        stakeholders: { name: string }[];
        variableCandidates: { name: string }[];
      };
      dropped: { stakeholders: number; variableCandidates: number };
      updatedAt: number;
    };
    expect(payload.mode).toBe("append");
    expect(payload.notes.theme).toBe("残業が減らない");
    expect(payload.notes.stakeholders.map((s) => s.name)).toEqual([
      "自分",
      "上司",
    ]);
    expect(payload.notes.variableCandidates.map((v) => v.name)).toEqual([
      "残業時間",
    ]);
    expect(payload.dropped).toEqual({ stakeholders: 0, variableCandidates: 0 });
    expect(typeof payload.updatedAt).toBe("number");

    // replace は全置換
    const replaced = await client.callTool({
      name: "update_notes",
      arguments: {
        projectId: project.id,
        mode: "replace",
        notes: { theme: "整理し直し" },
      },
    });
    const replacedPayload = JSON.parse(textOf(replaced)) as {
      notes: { theme: string | null; stakeholders: unknown[] };
    };
    expect(replacedPayload.notes.theme).toBe("整理し直し");
    expect(replacedPayload.notes.stakeholders).toEqual([]);
  });

  it("interview プロンプトは MCP 向け文言で、画面位置への言及を含まない", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);
    const result = await client.getPrompt({
      name: "interview",
      arguments: { projectId: project.id },
    });
    const text = (result.messages[0].content as { text: string }).text;
    expect(text).not.toContain("画面左下");
    expect(text).toContain("シミュレーション結果を確認");
  });

  it("update_diagram / get_diagram の応答に interview の誘導が同梱される", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);

    const update = await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId: project.id,
        diff: { upsertNodes: [{ name: "疲労" }] },
      },
    });
    const updatePayload = JSON.parse(textOf(update)) as {
      interview: { phase: string; agenda: string[] };
    };
    // 図に変数が置かれたのでフェーズは draft
    expect(updatePayload.interview.phase).toBe("draft");

    const read = await client.callTool({
      name: "get_diagram",
      arguments: { projectId: project.id },
    });
    const readPayload = JSON.parse(textOf(read)) as {
      interviewNotes: { theme: string | null };
      interview: { phase: string; agenda: string[] };
    };
    expect(readPayload.interviewNotes).toHaveProperty("theme");
    expect(readPayload.interview.phase).toBe("draft");
    expect(readPayload.interview.agenda.length).toBeGreaterThan(0);
  });
});
