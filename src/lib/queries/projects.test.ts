import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { edges, type NodeKind, nodes, projects } from "@/db/schema";
import { buildLoopEdges } from "@/lib/diagram/loop-edges";
import { detectLoops } from "@/lib/diagram/loops";
import { createProject, createUser } from "../../../tests/db/factories";
import { getProjectSummariesByUserId } from "./projects";

/**
 * 一覧（list_projects）は nodes / edges を columns 指定で絞って読む。
 * フェーズ判定に要る列を落とすと一覧だけ条件がすり抜けるため、
 * 「詳細ページと同じフェーズが出るか」を実データで固定する
 */

async function addNode(
  projectId: string,
  name: string,
  extra: { kind?: NodeKind | null; initialValue?: number | null } = {},
) {
  const [row] = await db
    .insert(nodes)
    .values({
      projectId,
      name,
      kind: extra.kind ?? null,
      initialValue: extra.initialValue ?? null,
    })
    .returning();
  return row;
}

async function addEdge(
  projectId: string,
  sourceNodeId: string,
  targetNodeId: string,
  polarity: "+" | "-",
) {
  await db.insert(edges).values({
    projectId,
    sourceNodeId,
    targetNodeId,
    polarity,
    rationale: "テスト",
    status: "confirmed",
  });
}

/** R ループ 1 つと B ループ 1 つを持ち、リンクがすべて confirmed の図を作る */
async function seedConfirmedDiagram(userId: string, promoted: boolean) {
  const project = await createProject(userId);
  const a = await addNode(
    project.id,
    "疲労",
    promoted ? { kind: "stock", initialValue: 30 } : {},
  );
  const b = await addNode(project.id, "ミス率");
  const c = await addNode(project.id, "残業時間");
  const d = await addNode(project.id, "休息");
  await addEdge(project.id, a.id, b.id, "+");
  await addEdge(project.id, b.id, a.id, "+"); // R（負リンク 0）
  await addEdge(project.id, c.id, d.id, "+");
  await addEdge(project.id, d.id, c.id, "-"); // B（負リンク 1）

  const nodeRows = await db.query.nodes.findMany({
    where: eq(nodes.projectId, project.id),
  });
  const edgeRows = await db.query.edges.findMany({
    where: eq(edges.projectId, project.id),
  });
  const { loops } = detectLoops(
    nodeRows,
    buildLoopEdges({ nodes: nodeRows, edges: edgeRows }),
  );
  await db
    .update(projects)
    .set({
      interviewNotes: JSON.stringify({
        confirmedLoopIds: loops.map((l) => l.id),
      }),
    })
    .where(eq(projects.id, project.id));
  return { project, loops };
}

describe("getProjectSummariesByUserId", () => {
  it("R と B を確認済みで昇格前ならインサイト", async () => {
    const user = await createUser();
    const { project, loops } = await seedConfirmedDiagram(user.id, false);
    expect(loops.map((l) => l.polarity).sort()).toEqual(["B", "R"]);

    const summaries = await getProjectSummariesByUserId(user.id);
    const summary = summaries.find((s) => s.id === project.id);
    expect(summary?.interviewPhase).toBe("insight");
  });

  it("昇格が始まり未分類が残っていれば定量化（columns 指定で kind / initialValue を落としていない）", async () => {
    const user = await createUser();
    const { project } = await seedConfirmedDiagram(user.id, true);

    const summaries = await getProjectSummariesByUserId(user.id);
    const summary = summaries.find((s) => s.id === project.id);
    expect(summary?.interviewPhase).toBe("quantify");
  });

  it("確認済みループ数と規模を添える", async () => {
    const user = await createUser();
    const { project } = await seedConfirmedDiagram(user.id, false);

    const summaries = await getProjectSummariesByUserId(user.id);
    const summary = summaries.find((s) => s.id === project.id);
    expect(summary?.nodeCount).toBe(4);
    expect(summary?.edgeCount).toBe(4);
    expect(summary?.loopCount).toBe(2);
    expect(summary?.confirmedLoopCount).toBe(2);
  });
});
