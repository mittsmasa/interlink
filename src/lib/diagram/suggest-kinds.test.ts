import { describe, expect, it } from "vitest";
import type { NodeKind } from "@/db/schema";
import type { Loop } from "./loops";
import {
  describeSuggestion,
  MAX_KIND_SUGGESTIONS,
  suggestKinds,
} from "./suggest-kinds";

type TestNode = {
  id: string;
  name: string;
  unit: string | null;
  kind: NodeKind | null;
};

function node(
  id: string,
  name: string,
  extra: { unit?: string | null; kind?: NodeKind | null } = {},
): TestNode {
  return {
    id,
    name,
    unit: extra.unit ?? null,
    kind: extra.kind ?? null,
  };
}

function edge(sourceNodeId: string, targetNodeId: string) {
  return { sourceNodeId, targetNodeId };
}

function loop(id: string, label: string, nodeIds: string[]): Loop {
  return {
    id,
    label,
    nodeIds,
    nodeNames: nodeIds,
    edgeIds: nodeIds.map((_, i) => `e${i}`),
    polarity: "R",
    hasDelay: false,
  };
}

/** 1 ノードだけの候補を引く（周辺は指定した edges / loops に従う） */
function suggestOne(
  nodes: TestNode[],
  edges: { sourceNodeId: string; targetNodeId: string }[] = [],
  loops: Loop[] = [],
  targetId = nodes[0].id,
) {
  const result = suggestKinds(nodes, edges, loops).find(
    (s) => s.nodeId === targetId,
  );
  if (!result) throw new Error(`候補が返らなかった: ${targetId}`);
  return result;
}

describe("suggestKinds", () => {
  it("単位の分母が時間ならフロー（doc 4 章のものさし 1）", () => {
    const s = suggestOne([node("a", "残業", { unit: "時間/週" })]);
    expect(s.suggestedKind).toBe("flow");
    expect(s.confidence).toBe("high");
    expect(s.reasons[0]).toContain("時間/週");
  });

  it("「毎日」のように分母を語で書く単位もフロー", () => {
    const s = suggestOne([node("a", "処理", { unit: "件（毎日）" })]);
    expect(s.suggestedKind).toBe("flow");
  });

  it("蓄積を表す語はストック（doc 4 章のものさし 2）", () => {
    const s = suggestOne([node("a", "疲労")]);
    expect(s.suggestedKind).toBe("stock");
    expect(s.confidence).toBe("high");
    expect(s.reasons[0]).toContain("積み重ね");
  });

  it("「残業時間」は文脈依存なので辞書で決めない（doc 4 章の例）", () => {
    const s = suggestOne([node("a", "残業時間")]);
    expect(s.suggestedKind).not.toBe("stock");
  });

  it("単位が割合なら補助変数", () => {
    const s = suggestOne([node("a", "達成", { unit: "%" })]);
    expect(s.suggestedKind).toBe("auxiliary");
    expect(s.confidence).toBe("high");
  });

  it("「〜量」「〜数」の接尾辞はストック（確からしさ 中）", () => {
    const s = suggestOne([node("a", "作業量")]);
    expect(s.suggestedKind).toBe("stock");
    expect(s.confidence).toBe("mid");
  });

  it("「〜率」は計算される中間値なので補助変数", () => {
    const s = suggestOne([node("a", "ミス率")]);
    expect(s.suggestedKind).toBe("auxiliary");
    expect(s.confidence).toBe("mid");
  });

  it("時点の量を表す単位が付いていればストック", () => {
    const s = suggestOne([node("a", "在席", { unit: "人" })]);
    expect(s.suggestedKind).toBe("stock");
    expect(s.confidence).toBe("mid");
  });

  it("ループ上で出入りが集まる要はストック候補", () => {
    const nodes = [node("a", "たまり"), node("b", "b"), node("c", "c")];
    const edges = [edge("b", "a"), edge("c", "a"), edge("a", "b")];
    const s = suggestOne(nodes, edges, [loop("l1", "R1", ["a", "b"])]);
    expect(s.suggestedKind).toBe("stock");
    expect(s.reasons[0]).toContain("R1");
  });

  it("入ってくるリンクが無ければ定数", () => {
    const nodes = [node("a", "外から与えるもの"), node("b", "b")];
    const s = suggestOne(nodes, [edge("a", "b")]);
    expect(s.suggestedKind).toBe("constant");
    expect(s.confidence).toBe("mid");
  });

  it("固定値を指す語は定数", () => {
    const nodes = [node("a", "予算の上限"), node("b", "b")];
    // 入次数を持たせて no-incoming ルールと切り分ける
    const s = suggestOne(nodes, [edge("b", "a")]);
    expect(s.suggestedKind).toBe("constant");
    expect(s.reasons[0]).toContain("上限");
  });

  it("入次数だけでループに入っていなければ補助変数（確からしさ 低）", () => {
    const nodes = [node("a", "とある値"), node("b", "b")];
    const s = suggestOne(nodes, [edge("b", "a")]);
    expect(s.suggestedKind).toBe("auxiliary");
    expect(s.confidence).toBe("low");
  });

  it("ストックに接して増減を語る変数はフローへ上書きされる", () => {
    const nodes = [node("a", "疲労増"), node("b", "疲労")];
    const s = suggestOne(nodes, [edge("a", "b"), edge("b", "a")]);
    expect(s.suggestedKind).toBe("flow");
    expect(s.confidence).toBe("high");
    expect(s.reasons[0]).toContain("疲労");
  });

  it("確定済みストックへの隣接でもフローと判じる", () => {
    const nodes = [node("a", "休息"), node("b", "余力", { kind: "stock" })];
    const s = suggestOne(nodes, [edge("a", "b")]);
    expect(s.suggestedKind).toBe("flow");
    expect(s.confidence).toBe("high");
  });

  it("増減の語だけでストックに接しないなら確からしさは低い", () => {
    const nodes = [node("a", "消費"), node("b", "ミス率")];
    const s = suggestOne(nodes, [edge("b", "a")]);
    expect(s.suggestedKind).toBe("flow");
    expect(s.confidence).toBe("low");
    expect(s.reasons[0]).toContain("見当たらない");
  });

  it("「〜率」は増減の語を含んでもフローへ上書きしない", () => {
    const nodes = [node("a", "離職率"), node("b", "従業員数")];
    const s = suggestOne(nodes, [edge("a", "b"), edge("b", "a")]);
    expect(s.suggestedKind).toBe("auxiliary");
  });

  it("kind が付いたノードは候補に出さない", () => {
    const result = suggestKinds(
      [node("a", "疲労", { kind: "stock" }), node("b", "ミス率")],
      [],
      [],
    );
    expect(result.map((s) => s.nodeId)).toEqual(["b"]);
  });

  it("どのルールにも当たらないノードにも理由付きの候補を返す", () => {
    // ループ上ではあるが出入りが 2 本しかなく、どの語彙にも当たらない変数
    const nodes = [node("a", "あれ"), node("b", "それ")];
    const s = suggestOne(
      nodes,
      [edge("a", "b"), edge("b", "a")],
      [loop("l1", "R1", ["a", "b"])],
    );
    expect(s.suggestedKind).toBe("auxiliary");
    expect(s.confidence).toBe("low");
    expect(s.reasons[0]).toContain("一時停止テスト");
  });

  it("理由は必ず 1 件以上・最大 3 件で、すべて日本語", () => {
    const nodes = [
      node("a", "在庫量", { unit: "個" }),
      node("b", "b"),
      node("c", "c"),
    ];
    const edges = [edge("b", "a"), edge("c", "a"), edge("a", "b")];
    const result = suggestKinds(nodes, edges, [loop("l1", "R1", ["a", "b"])]);
    for (const s of result) {
      expect(s.reasons.length).toBeGreaterThanOrEqual(1);
      expect(s.reasons.length).toBeLessThanOrEqual(3);
      expect(s.reasons.every((r) => /[ぁ-んァ-ヶ一-龠]/.test(r))).toBe(true);
    }
    // 同じ kind を指す他ルールが理由の補強になる
    const stock = result.find((s) => s.nodeId === "a");
    expect(stock?.suggestedKind).toBe("stock");
    expect(stock?.reasons.length).toBeGreaterThan(1);
  });

  it("確からしさ順 → 名前順に並び、同じ入力には同じ結果を返す", () => {
    const nodes = [
      node("a", "ミス率"),
      node("b", "疲労"),
      node("c", "信頼"),
      node("d", "とある値"),
    ];
    const edges = [edge("b", "a"), edge("a", "d")];
    const first = suggestKinds(nodes, edges, []);
    const second = suggestKinds(nodes, edges, []);
    expect(first).toEqual(second);
    expect(first.map((s) => s.name)).toEqual([
      "信頼", // high（蓄積語）
      "疲労", // high（蓄積語）
      "ミス率", // mid（率）
      "とある値", // low
    ]);
  });

  it("上限定数は 8 件（応答肥大の歯止め）", () => {
    expect(MAX_KIND_SUGGESTIONS).toBe(8);
  });
});

describe("describeSuggestion", () => {
  it("役割と確からしさを日本語で一言にする", () => {
    const s = suggestOne([node("a", "疲労")]);
    expect(describeSuggestion(s)).toBe("ストック（確からしさ 高）");
  });
});
