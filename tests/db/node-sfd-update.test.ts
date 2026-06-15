import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { updateNode } from "@/app/(main)/projects/[projectId]/_actions";
import { db } from "@/db";
import { nodes } from "@/db/schema";
import { createProject, createUser } from "./factories";

/** updateNode を呼べるようにセッションを差し込み、project と node を用意する */
async function setup() {
  const user = await createUser();
  const project = await createProject(user.id);
  (globalThis as { __mockSession?: unknown }).__mockSession = {
    user: { id: user.id },
  };
  const [node] = await db
    .insert(nodes)
    .values({ projectId: project.id, name: "量" })
    .returning();
  return { projectId: project.id, nodeId: node.id };
}

const base = { name: "量", memo: "", unit: "" };

async function readNode(nodeId: string) {
  return db.query.nodes.findFirst({ where: eq(nodes.id, nodeId) });
}

describe("updateNode の kind 別正規化", () => {
  beforeEach(() => {
    (globalThis as { __mockSession?: unknown }).__mockSession = null;
  });

  it("stock では initialValue だけ残り、式・定数値は null 化される", async () => {
    const { projectId, nodeId } = await setup();
    const result = await updateNode(projectId, nodeId, {
      ...base,
      kind: "stock",
      expression: "a+b",
      initialValue: 5,
      value: 9,
    });
    expect(result.ok).toBe(true);
    const node = await readNode(nodeId);
    expect(node?.kind).toBe("stock");
    expect(node?.initialValue).toBe(5);
    expect(node?.expression).toBeNull();
    expect(node?.value).toBeNull();
  });

  it("stock → flow に変えると旧 initialValue が消え expression が入る", async () => {
    const { projectId, nodeId } = await setup();
    await updateNode(projectId, nodeId, {
      ...base,
      kind: "stock",
      expression: "",
      initialValue: 5,
      value: null,
    });
    await updateNode(projectId, nodeId, {
      ...base,
      kind: "flow",
      expression: "a*2",
      initialValue: 5,
      value: null,
    });
    const node = await readNode(nodeId);
    expect(node?.kind).toBe("flow");
    expect(node?.expression).toBe("a*2");
    expect(node?.initialValue).toBeNull();
    expect(node?.value).toBeNull();
  });

  it("初期値の空欄（null）は 0 ではなく null として保存される", async () => {
    const { projectId, nodeId } = await setup();
    await updateNode(projectId, nodeId, {
      ...base,
      kind: "stock",
      expression: "",
      initialValue: null,
      value: null,
    });
    const node = await readNode(nodeId);
    expect(node?.initialValue).toBeNull();
  });

  it("未分類（kind=null）では 3 列とも null 化される", async () => {
    const { projectId, nodeId } = await setup();
    await updateNode(projectId, nodeId, {
      ...base,
      kind: "constant",
      expression: "",
      initialValue: null,
      value: 7,
    });
    await updateNode(projectId, nodeId, {
      ...base,
      kind: null,
      expression: "",
      initialValue: null,
      value: 7,
    });
    const node = await readNode(nodeId);
    expect(node?.kind).toBeNull();
    expect(node?.expression).toBeNull();
    expect(node?.initialValue).toBeNull();
    expect(node?.value).toBeNull();
  });

  it("flow に不正な式（関数）を渡すと保存されずエラーを返す", async () => {
    const { projectId, nodeId } = await setup();
    const result = await updateNode(projectId, nodeId, {
      ...base,
      kind: "flow",
      expression: "sqrt(x)",
      initialValue: null,
      value: null,
    });
    expect(result.ok).toBe(false);
    const node = await readNode(nodeId);
    expect(node?.expression).toBeNull();
    expect(node?.kind).toBeNull();
  });
});
