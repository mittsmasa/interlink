import { describe, expect, it } from "vitest";
import { describeRevisionDiff, diffRevisions } from "./revision-diff";
import type {
  RevisionSnapshot,
  SnapshotEdge,
  SnapshotNode,
} from "./revision-snapshot";

function node(
  id: string,
  name: string,
  overrides: Partial<SnapshotNode> = {},
): SnapshotNode {
  return {
    id,
    name,
    memo: null,
    unit: null,
    kind: null,
    expression: null,
    initialValue: null,
    value: null,
    x: null,
    y: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function edge(
  id: string,
  source: SnapshotNode,
  target: SnapshotNode,
  overrides: Partial<SnapshotEdge> = {},
): SnapshotEdge {
  return {
    id,
    sourceNodeId: source.id,
    targetNodeId: target.id,
    sourceName: source.name,
    targetName: target.name,
    polarity: "+",
    hasDelay: false,
    rationale: "根拠",
    status: "inferred",
    createdAt: 0,
    ...overrides,
  };
}

function snapshot(
  nodes: SnapshotNode[],
  edges: SnapshotEdge[] = [],
): RevisionSnapshot {
  return { nodes, edges };
}

const overtime = node("n1", "残業時間");
const fatigue = node("n2", "疲労");
const output = node("n3", "成果");

describe("diffRevisions", () => {
  it("空の図からの追加を added として返す", () => {
    const diff = diffRevisions(
      snapshot([]),
      snapshot([overtime, fatigue], [edge("e1", overtime, fatigue)]),
    );
    expect(diff.nodes.added.map((n) => n.name)).toEqual(["残業時間", "疲労"]);
    expect(diff.nodes.removed).toEqual([]);
    expect(diff.edges.added).toEqual([
      { id: "e1", source: "残業時間", target: "疲労" },
    ]);
    expect(diff.isEmpty).toBe(false);
  });

  it("削除されたノードとリンクを removed として返す", () => {
    const diff = diffRevisions(
      snapshot([overtime, fatigue], [edge("e1", overtime, fatigue)]),
      snapshot([overtime]),
    );
    expect(diff.nodes.removed.map((n) => n.name)).toEqual(["疲労"]);
    expect(diff.edges.removed.map((e) => e.id)).toEqual(["e1"]);
  });

  it("同じ内容なら isEmpty になる（座標の違いは変化と見なさない）", () => {
    const moved = { ...overtime, x: 100, y: 200 };
    const diff = diffRevisions(snapshot([overtime]), snapshot([moved]));
    expect(diff.isEmpty).toBe(true);
    expect(describeRevisionDiff(diff)).toBe("変更なし");
  });

  it("改名は ID を保つので削除 + 追加ではなく name の変更として出る", () => {
    const renamed = { ...overtime, name: "労働時間" };
    const diff = diffRevisions(snapshot([overtime]), snapshot([renamed]));
    expect(diff.nodes.added).toEqual([]);
    expect(diff.nodes.removed).toEqual([]);
    expect(diff.nodes.changed).toEqual([
      {
        id: "n1",
        name: "労働時間",
        changes: [{ field: "name", from: "残業時間", to: "労働時間" }],
      },
    ]);
  });

  it("SFD 列の変更を列ごとに拾う", () => {
    const before = node("n1", "残高");
    const after = node("n1", "残高", { kind: "stock", initialValue: 100 });
    const diff = diffRevisions(snapshot([before]), snapshot([after]));
    expect(diff.nodes.changed[0].changes).toEqual([
      { field: "kind", from: null, to: "stock" },
      { field: "initialValue", from: null, to: 100 },
    ]);
  });

  it("リンクの status 遷移を遷移ごとに数える", () => {
    const before = snapshot(
      [overtime, fatigue, output],
      [
        edge("e1", overtime, fatigue),
        edge("e2", fatigue, output, { status: "inferred" }),
      ],
    );
    const after = snapshot(
      [overtime, fatigue, output],
      [
        edge("e1", overtime, fatigue, { status: "confirmed" }),
        edge("e2", fatigue, output, { status: "confirmed" }),
      ],
    );
    const diff = diffRevisions(before, after);
    expect(diff.statusTransitions).toEqual([
      { from: "inferred", to: "confirmed", count: 2 },
    ]);
    expect(diff.edges.changed).toHaveLength(2);
  });

  it("同じ変数ペアに複数のリンクがあっても ID で区別する", () => {
    const before = snapshot(
      [overtime, fatigue],
      [edge("e1", overtime, fatigue)],
    );
    const after = snapshot(
      [overtime, fatigue],
      [
        edge("e1", overtime, fatigue),
        edge("e2", overtime, fatigue, { polarity: "-" }),
      ],
    );
    const diff = diffRevisions(before, after);
    expect(diff.edges.added.map((e) => e.id)).toEqual(["e2"]);
    expect(diff.edges.changed).toEqual([]);
  });

  it("ループが閉じたら closed に、消えたら opened に入る", () => {
    const open = snapshot([overtime, fatigue], [edge("e1", overtime, fatigue)]);
    const closed = snapshot(
      [overtime, fatigue],
      [edge("e1", overtime, fatigue), edge("e2", fatigue, overtime)],
    );

    const forward = diffRevisions(open, closed);
    expect(forward.loops.closed).toHaveLength(1);
    expect(forward.loops.closed[0]).toMatchObject({
      polarity: "R",
      nodeNames: ["残業時間", "疲労"],
    });
    expect(forward.loops.opened).toEqual([]);

    const backward = diffRevisions(closed, open);
    expect(backward.loops.opened).toHaveLength(1);
    expect(backward.loops.closed).toEqual([]);
  });

  it("負リンクを 1 本含むループは B として出る", () => {
    const open = snapshot([overtime, fatigue], [edge("e1", overtime, fatigue)]);
    const closed = snapshot(
      [overtime, fatigue],
      [
        edge("e1", overtime, fatigue),
        edge("e2", fatigue, overtime, { polarity: "-" }),
      ],
    );
    expect(diffRevisions(open, closed).loops.closed[0]).toMatchObject({
      polarity: "B",
    });
  });
});

describe("describeRevisionDiff", () => {
  it("追加件数と閉じたループを並べる", () => {
    const diff = diffRevisions(
      snapshot([]),
      snapshot(
        [overtime, fatigue],
        [edge("e1", overtime, fatigue), edge("e2", fatigue, overtime)],
      ),
    );
    expect(describeRevisionDiff(diff)).toBe(
      "+2 変数 / +2 リンク / R1 が閉じた",
    );
  });

  it("削除と変更も件数で表す", () => {
    const before = snapshot(
      [overtime, fatigue],
      [edge("e1", overtime, fatigue)],
    );
    const after = snapshot([{ ...overtime, memo: "気になっている" }], []);
    expect(describeRevisionDiff(diffRevisions(before, after))).toBe(
      "-1 変数 / 変数 1 件を変更 / -1 リンク",
    );
  });

  it("status 遷移を要約に含める", () => {
    const before = snapshot(
      [overtime, fatigue],
      [edge("e1", overtime, fatigue)],
    );
    const after = snapshot(
      [overtime, fatigue],
      [edge("e1", overtime, fatigue, { status: "confirmed" })],
    );
    expect(describeRevisionDiff(diffRevisions(before, after))).toBe(
      "リンク 1 件を変更 / リンク 1 件を confirmed に",
    );
  });

  it("4 本以上のループはラベルを 3 つに畳む", () => {
    // 4 ノードの完全循環を 2 つ作らず、独立した自己ループ 4 つで件数だけ確認する
    const selfLooped = [0, 1, 2, 3].map((i) => node(`s${i}`, `変数${i}`));
    const after = snapshot(
      selfLooped,
      selfLooped.map((n, i) => edge(`se${i}`, n, n)),
    );
    const summary = describeRevisionDiff(diffRevisions(snapshot([]), after));
    expect(summary).toContain("ほか 1 件");
  });
});
