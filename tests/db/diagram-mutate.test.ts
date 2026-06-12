import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { planDiagramMutation } from "@/lib/diagram/apply-diff";
import { diagramDiffSchema } from "@/lib/diagram/diff-schema";
import { applyMutationPlan } from "@/lib/diagram/mutate";
import { loadDiagramSnapshot } from "@/lib/diagram/snapshot";
import { createProject, createUser } from "./factories";

async function applyDiff(projectId: string, diffInput: unknown) {
  const current = await loadDiagramSnapshot(projectId);
  const result = planDiagramMutation(
    current,
    diagramDiffSchema.parse(diffInput),
  );
  if (!result.ok) throw new Error(`plan failed: ${result.reason}`);
  await applyMutationPlan(projectId, result.plan);
  return result.plan;
}

describe("applyMutationPlan", () => {
  it("ノードとエッジを名前解決込みで作成できる", async () => {
    const user = await createUser();
    const project = await createProject(user.id);

    await applyDiff(project.id, {
      upsertNodes: [{ name: "残業時間", unit: "時間/週" }, { name: "疲労" }],
      upsertEdges: [
        {
          source: "残業時間",
          target: "疲労",
          polarity: "+",
          hasDelay: true,
          rationale: "残業が続くと疲れが溜まる",
        },
      ],
    });

    const snapshot = await loadDiagramSnapshot(project.id);
    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.edges).toHaveLength(1);
    expect(snapshot.edges[0]).toMatchObject({
      sourceName: "残業時間",
      targetName: "疲労",
      polarity: "+",
      hasDelay: true,
    });

    // 図ができたらプロジェクトは diagramming に進む
    const updated = await db.query.projects.findFirst({
      where: (p, { eq }) => eq(p.id, project.id),
    });
    expect(updated?.status).toBe("diagramming");
  });

  it("増分修正で既存の構造を保ったまま差分が反映される", async () => {
    const user = await createUser();
    const project = await createProject(user.id);

    await applyDiff(project.id, {
      upsertNodes: [{ name: "残業時間" }, { name: "疲労" }],
      upsertEdges: [
        {
          source: "残業時間",
          target: "疲労",
          polarity: "+",
          rationale: "初期",
        },
      ],
    });
    await applyDiff(project.id, {
      upsertNodes: [{ name: "生産性" }],
      upsertEdges: [
        {
          source: "疲労",
          target: "生産性",
          polarity: "-",
          rationale: "疲れると能率が落ちる",
        },
        {
          source: "生産性",
          target: "残業時間",
          polarity: "-",
          rationale: "能率が落ちると仕事が残り残業が増える…極性は対話で確認",
        },
      ],
    });

    const snapshot = await loadDiagramSnapshot(project.id);
    expect(snapshot.nodes).toHaveLength(3);
    expect(snapshot.edges).toHaveLength(3);
  });

  it("ノード削除で接続エッジも cascade で消える", async () => {
    const user = await createUser();
    const project = await createProject(user.id);

    await applyDiff(project.id, {
      upsertNodes: [{ name: "A" }, { name: "B" }, { name: "C" }],
      upsertEdges: [
        { source: "A", target: "B", polarity: "+", rationale: "x" },
        { source: "B", target: "C", polarity: "+", rationale: "x" },
      ],
    });
    await applyDiff(project.id, { deleteNodes: ["B"] });

    const snapshot = await loadDiagramSnapshot(project.id);
    expect(snapshot.nodes.map((n) => n.name).sort()).toEqual(["A", "C"]);
    expect(snapshot.edges).toHaveLength(0);
  });
});
