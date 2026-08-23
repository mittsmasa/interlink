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
  it("tools/list で 8 ツールが列挙され、delete_project に destructiveHint が付く", async () => {
    const user = await createUser();
    const client = await connectClient(user.id);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_project",
      "delete_project",
      "export_diagram",
      "get_diagram",
      "list_projects",
      "update_diagram",
      "update_notes",
      "update_project",
    ]);
    expect(
      tools.find((t) => t.name === "delete_project")?.annotations,
    ).toMatchObject({ destructiveHint: true });
    // diff スキーマが JSON Schema へ変換されて公開されていること（zod 4 互換の確認）
    const update = tools.find((t) => t.name === "update_diagram");
    const diffSchema = update?.inputSchema.properties?.diff as
      | { properties?: Record<string, unknown> }
      | undefined;
    expect(diffSchema?.properties).toHaveProperty("upsertNodes");
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
      loops: { polarity: string; nodeNames: string[] }[];
    };
    expect(diagram.nodes.map((n) => n.name).sort()).toEqual([
      "残業時間",
      "疲労",
    ]);
    // 正リンク 2 本のループ → 自己強化（R）
    expect(diagram.loops).toHaveLength(1);
    expect(diagram.loops[0].polarity).toBe("R");
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
    expect(wipe.isError).toBe(true);
    const snapshot = await loadDiagramSnapshot(project.id);
    expect(snapshot.nodes).toHaveLength(1);
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
