import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { detectLoops } from "@/lib/diagram/loops";
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
  it("tools/list で 10 ツールが列挙される", async () => {
    const user = await createUser();
    const client = await connectClient(user.id);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "compare_scenarios",
      "create_project",
      "delete_project",
      "export_diagram",
      "get_diagram",
      "list_projects",
      "run_simulation",
      "update_diagram",
      "update_notes",
      "update_project",
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
    expect(byName.get("export_diagram")).toMatchObject({ readOnlyHint: true });
    expect(byName.get("delete_project")).toMatchObject({
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

  it("list_projects は規模指標・フェーズ・テーマを添える", async () => {
    const user = await createUser();
    const empty = await createProject(user.id, { title: "空の問い" });
    const looped = await createProject(user.id, { title: "ループのある問い" });
    const client = await connectClient(user.id);
    await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId: looped.id,
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
    const read = await client.callTool({
      name: "get_diagram",
      arguments: { projectId: looped.id },
    });
    // 実ループ ID 1 つ + 図に無い ID 1 つを確認済みにする
    const loops = (JSON.parse(textOf(read)) as { loops: unknown[] }).loops;
    expect(loops).toHaveLength(1);
    const snapshot = await loadDiagramSnapshot(looped.id);
    const loopId = detectLoops(snapshot.nodes, snapshot.edges).loops[0].id;
    await client.callTool({
      name: "update_notes",
      arguments: {
        projectId: looped.id,
        notes: {
          theme: "残業が減らない",
          behavior: null,
          idealBehavior: null,
          stakeholders: [],
          variableCandidates: [],
          confirmedLoopIds: [loopId, "loop:stale"],
        },
      },
    });

    const result = await client.callTool({ name: "list_projects" });
    const { projects: list } = JSON.parse(textOf(result)) as {
      projects: Record<string, unknown>[];
    };
    expect(list.find((p) => p.id === empty.id)).toMatchObject({
      nodeCount: 0,
      edgeCount: 0,
      loopCount: 0,
      confirmedLoopCount: 0,
      interviewPhase: "focus",
      theme: null,
    });
    expect(list.find((p) => p.id === looped.id)).toMatchObject({
      nodeCount: 2,
      edgeCount: 2,
      loopCount: 1,
      confirmedLoopCount: 1,
      interviewPhase: "refine",
      theme: "残業が減らない",
    });
  });

  it("export_diagram は mermaid / markdown を返し、他人の図は見えない", async () => {
    const user = await createUser();
    const other = await createUser();
    const project = await createProject(user.id, { title: "持ち出す問い" });
    const client = await connectClient(user.id);
    await client.callTool({
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
              polarity: "-",
              hasDelay: true,
              rationale: "b",
            },
          ],
        },
      },
    });

    const mermaid = await client.callTool({
      name: "export_diagram",
      arguments: { projectId: project.id, format: "mermaid" },
    });
    const mermaidText = textOf(mermaid);
    expect(mermaidText.startsWith("graph LR")).toBe(true);
    expect(mermaidText).toContain('n0 -- "+" --> n1');
    expect(mermaidText).toContain('n1 -. "-" .-> n0');
    expect(mermaidText).toContain("%% B1（バランス、遅れあり）");

    const markdown = await client.callTool({
      name: "export_diagram",
      arguments: { projectId: project.id, format: "markdown" },
    });
    const markdownText = textOf(markdown);
    expect(markdownText.startsWith("# 持ち出す問い")).toBe(true);
    expect(markdownText).toContain("| 残業時間 | 疲労 | + |  | a |");
    expect(markdownText).toContain("- B1（バランス、遅れあり）");

    const denied = await (await connectClient(other.id)).callTool({
      name: "export_diagram",
      arguments: { projectId: project.id, format: "mermaid" },
    });
    expect(denied.isError).toBe(true);
  });

  it("update_project / delete_project は所有分だけ操作できる", async () => {
    const user = await createUser();
    const other = await createUser();
    const mine = await createProject(user.id, { title: "前の題" });
    const theirs = await createProject(other.id, { title: "他人の題" });
    const client = await connectClient(user.id);

    const renamed = await client.callTool({
      name: "update_project",
      arguments: { projectId: mine.id, title: " 後の題 " },
    });
    expect(renamed.isError).toBeFalsy();
    expect(JSON.parse(textOf(renamed))).toMatchObject({
      ok: true,
      project: { id: mine.id, title: "後の題" },
    });
    const renameDenied = await client.callTool({
      name: "update_project",
      arguments: { projectId: theirs.id, title: "乗っ取り" },
    });
    expect(renameDenied.isError).toBe(true);
    const emptyTitle = await client.callTool({
      name: "update_project",
      arguments: { projectId: mine.id, title: "   " },
    });
    expect(emptyTitle.isError).toBe(true);

    const deleteDenied = await client.callTool({
      name: "delete_project",
      arguments: { projectId: theirs.id },
    });
    expect(deleteDenied.isError).toBe(true);
    const deleted = await client.callTool({
      name: "delete_project",
      arguments: { projectId: mine.id },
    });
    expect(deleted.isError).toBeFalsy();

    const list = JSON.parse(
      textOf(await client.callTool({ name: "list_projects" })),
    ) as { projects: { id: string }[] };
    expect(list.projects.map((p) => p.id)).not.toContain(mine.id);
    const otherList = JSON.parse(
      textOf(
        await (await connectClient(other.id)).callTool({
          name: "list_projects",
        }),
      ),
    ) as { projects: { id: string; title: string }[] };
    expect(otherList.projects).toMatchObject([
      { id: theirs.id, title: "他人の題" },
    ]);
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

describe("MCP resources", () => {
  it("resources/list に一覧が、templates に diagram.md / notes.json が載る", async () => {
    const user = await createUser();
    const project = await createProject(user.id, { title: "資源の問い" });
    const client = await connectClient(user.id);

    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain("interlink://projects");
    // template の list コールバックで所有プロジェクトが具体 URI として列挙される
    expect(uris).toContain(`interlink://projects/${project.id}/diagram.md`);
    expect(uris).toContain(`interlink://projects/${project.id}/notes.json`);

    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual([
      "interlink://projects/{id}/diagram.md",
      "interlink://projects/{id}/notes.json",
    ]);
  });

  it("各 resource を読める。他人のプロジェクトは読めない", async () => {
    const user = await createUser();
    const other = await createUser();
    const project = await createProject(user.id, { title: "資源の問い" });
    const theirs = await createProject(other.id);
    const client = await connectClient(user.id);
    await client.callTool({
      name: "update_notes",
      arguments: {
        projectId: project.id,
        notes: {
          theme: "テーマ",
          behavior: null,
          idealBehavior: null,
          stakeholders: [],
          variableCandidates: [],
          confirmedLoopIds: [],
        },
      },
    });

    const list = await client.readResource({ uri: "interlink://projects" });
    const listText = (list.contents[0] as { text: string }).text;
    expect(JSON.parse(listText).projects).toMatchObject([
      { id: project.id, theme: "テーマ" },
    ]);

    const diagram = await client.readResource({
      uri: `interlink://projects/${project.id}/diagram.md`,
    });
    expect(diagram.contents[0]).toMatchObject({ mimeType: "text/markdown" });
    expect((diagram.contents[0] as { text: string }).text).toContain(
      "# 資源の問い",
    );

    const notes = await client.readResource({
      uri: `interlink://projects/${project.id}/notes.json`,
    });
    expect(
      JSON.parse((notes.contents[0] as { text: string }).text),
    ).toMatchObject({ theme: "テーマ" });

    await expect(
      client.readResource({
        uri: `interlink://projects/${theirs.id}/notes.json`,
      }),
    ).rejects.toThrow(/見つかりません/);
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
    expect(text).toContain("run_simulation で動きを確認");
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

describe("MCP simulation tools", () => {
  /** 疲労モデル（stock 1 / flow 2 / constant 1）を update_diagram で作る */
  async function createFatigueModel(client: Client, projectId: string) {
    const update = await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId,
        diff: {
          upsertNodes: [
            { name: "疲労", kind: "stock", initialValue: 30 },
            { name: "回復率", kind: "constant", value: 0.1 },
            { name: "残業増", kind: "flow", expression: "疲労 * 0.2" },
            { name: "回復", kind: "flow", expression: "疲労 * 回復率" },
          ],
          upsertEdges: [
            {
              source: "残業増",
              target: "疲労",
              polarity: "+",
              rationale: "残業が疲労を積み上げる",
            },
            {
              source: "回復",
              target: "疲労",
              polarity: "-",
              rationale: "休むと疲労が抜ける",
            },
          ],
        },
      },
    });
    expect(update.isError).toBeFalsy();
  }

  type RunPayload = {
    ok: boolean;
    dt?: number;
    steps?: number;
    stocks?: {
      name: string;
      initial: number;
      final: number;
      trend: string;
      pattern: string;
    }[];
    series?: { t: number }[];
    totalPoints?: number;
    warnings?: string[];
    mismatch?: { noted: string } | null;
    error?: { type: string; refName?: string };
  };

  it("run_simulation は stock 要約と間引いた series を返す", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);
    await createFatigueModel(client, project.id);

    const result = await client.callTool({
      name: "run_simulation",
      arguments: { projectId: project.id, steps: 100 },
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result)) as RunPayload;
    expect(payload.ok).toBe(true);
    expect(payload.dt).toBe(1);
    expect(payload.steps).toBe(100);
    expect(payload.stocks).toHaveLength(1);
    expect(payload.stocks?.[0]).toMatchObject({
      name: "疲労",
      initial: 30,
      trend: "up",
      pattern: "increasing",
    });
    // 全ステップは返さない（series は t=0..steps の steps+1 点）
    expect(payload.series?.length).toBeLessThanOrEqual(21);
    expect(payload.totalPoints).toBe(101);
    expect(payload.warnings).toEqual([]);
    expect(payload.mismatch).toBeNull();
  });

  it("run_simulation はノートの時間挙動と食い違えば mismatch を添える", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);
    await createFatigueModel(client, project.id);
    await client.callTool({
      name: "update_notes",
      arguments: {
        projectId: project.id,
        notes: {
          theme: "疲労が抜けない",
          behavior: {
            pattern: "oscillating",
            description: "良くなったり悪くなったり",
          },
        },
      },
    });

    const result = await client.callTool({
      name: "run_simulation",
      arguments: { projectId: project.id },
    });
    const payload = JSON.parse(textOf(result)) as RunPayload;
    expect(payload.ok).toBe(true);
    expect(payload.mismatch?.noted).toBe("oscillating");
  });

  it("run_simulation は SimError を構造化して返し、SFD lint の warning を添える", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);
    // flow が stock に繋がっていない + 式が未定義変数を参照
    await client.callTool({
      name: "update_diagram",
      arguments: {
        projectId: project.id,
        diff: {
          upsertNodes: [
            { name: "疲労", kind: "stock", initialValue: 30 },
            { name: "残業増", kind: "flow", expression: "残業時間 * 0.5" },
          ],
        },
      },
    });

    const result = await client.callTool({
      name: "run_simulation",
      arguments: { projectId: project.id },
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result)) as RunPayload;
    expect(payload.ok).toBe(false);
    expect(payload.error?.type).toBe("undefined-reference");
    expect(payload.error?.refName).toBe("残業時間");
    const warnings = payload.warnings ?? [];
    expect(
      warnings.some((w) => w.includes("stock へのリンクがありません")),
    ).toBe(true);
    expect(warnings.some((w) => w.includes("図にない変数「残業時間」"))).toBe(
      true,
    );
  });

  it("run_simulation の overrides は図を変えずに効き、不正なら invalid-override", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);
    await createFatigueModel(client, project.id);

    const result = await client.callTool({
      name: "run_simulation",
      arguments: { projectId: project.id, overrides: { 疲労: 100 } },
    });
    const payload = JSON.parse(textOf(result)) as RunPayload;
    expect(payload.stocks?.[0].initial).toBe(100);
    const snapshot = await loadDiagramSnapshot(project.id);
    expect(snapshot.nodes.find((n) => n.name === "疲労")?.initialValue).toBe(
      30,
    );

    const bad = await client.callTool({
      name: "run_simulation",
      arguments: { projectId: project.id, overrides: { 残業増: 1 } },
    });
    const badPayload = JSON.parse(textOf(bad)) as RunPayload;
    expect(badPayload.ok).toBe(false);
    expect(badPayload.error?.type).toBe("invalid-override");
  });

  it("compare_scenarios は baseline と各シナリオの要約・差分を並べる", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);
    await createFatigueModel(client, project.id);

    const result = await client.callTool({
      name: "compare_scenarios",
      arguments: {
        projectId: project.id,
        steps: 10,
        scenarios: [
          { label: "回復を倍に", overrides: { 回復率: 0.2 } },
          { label: "回復を 3 倍に", overrides: { 回復率: 0.3 } },
          { label: "不正", overrides: { 残業増: 0 } },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result)) as {
      ok: boolean;
      baseline: { stocks: { name: string; final: number }[] };
      scenarios: (
        | {
            label: string;
            ok: true;
            stocks: {
              name: string;
              final: number;
              delta: number;
              pattern: string;
            }[];
          }
        | { label: string; ok: false; error: { type: string } }
      )[];
    };
    expect(payload.ok).toBe(true);
    const baselineFinal = payload.baseline.stocks[0].final;
    expect(payload.scenarios).toHaveLength(3);
    const [doubled, tripled, invalid] = payload.scenarios;
    expect(doubled.label).toBe("回復を倍に");
    if (!doubled.ok || !tripled.ok) throw new Error("シナリオが失敗した");
    // 回復率 0.2 = 残業増 0.2 と釣り合い、疲労は初期値のまま
    expect(doubled.stocks[0].final).toBeCloseTo(30, 6);
    expect(doubled.stocks[0].delta).toBeCloseTo(30 - baselineFinal, 6);
    expect(doubled.stocks[0].pattern).toBe("plateau");
    // 回復率 0.3 なら減り続ける
    expect(tripled.stocks[0].pattern).toBe("decreasing");
    expect(tripled.stocks[0].delta).toBeLessThan(doubled.stocks[0].delta);
    // 不正なシナリオは他を巻き込まず、そのシナリオだけ error
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.error.type).toBe("invalid-override");
  });

  it("他ユーザーの project では run_simulation / compare_scenarios とも見つからない", async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const project = await createProject(owner.id);
    const client = await connectClient(attacker.id);

    const run = await client.callTool({
      name: "run_simulation",
      arguments: { projectId: project.id },
    });
    expect(run.isError).toBe(true);
    const compare = await client.callTool({
      name: "compare_scenarios",
      arguments: {
        projectId: project.id,
        scenarios: [{ label: "x", overrides: {} }],
      },
    });
    expect(compare.isError).toBe(true);
  });

  it("interview プロンプトは画面左下ではなく run_simulation へ誘導する", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    const client = await connectClient(user.id);
    const result = await client.getPrompt({
      name: "interview",
      arguments: { projectId: project.id },
    });
    const text = (result.messages[0].content as { text: string }).text;
    expect(text).not.toContain("画面左下");
    expect(text).toContain("run_simulation");
  });
});
