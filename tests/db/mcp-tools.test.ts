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
    ]);
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
