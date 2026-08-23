import { describe, expect, it } from "vitest";
import { detectLoops, MAX_LOOPS } from "./loops";

const node = (id: string, name = `変数${id}`) => ({ id, name });
const edge = (
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  polarity: "+" | "-" = "+",
  hasDelay = false,
) => ({ id, sourceNodeId, targetNodeId, polarity, hasDelay });

describe("detectLoops", () => {
  it("ループがなければ空", () => {
    const result = detectLoops(
      [node("a"), node("b"), node("c")],
      [edge("e1", "a", "b"), edge("e2", "b", "c")],
    );
    expect(result.loops).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("正リンクだけの双方向ペアは R（負リンク 0 = 偶数）", () => {
    const result = detectLoops(
      [node("a"), node("b")],
      [edge("e1", "a", "b", "+"), edge("e2", "b", "a", "+")],
    );
    expect(result.loops).toHaveLength(1);
    const loop = result.loops[0];
    expect(loop.polarity).toBe("R");
    expect(loop.label).toBe("R1");
    expect(loop.nodeIds).toEqual(["a", "b"]);
    expect(loop.edgeIds).toEqual(["e1", "e2"]);
  });

  it("負リンクが奇数なら B、偶数なら R", () => {
    const balancing = detectLoops(
      [node("a"), node("b"), node("c")],
      [
        edge("e1", "a", "b", "+"),
        edge("e2", "b", "c", "-"),
        edge("e3", "c", "a", "+"),
      ],
    );
    expect(balancing.loops[0].polarity).toBe("B");

    const reinforcing = detectLoops(
      [node("a"), node("b"), node("c")],
      [
        edge("e1", "a", "b", "-"),
        edge("e2", "b", "c", "-"),
        edge("e3", "c", "a", "+"),
      ],
    );
    expect(reinforcing.loops[0].polarity).toBe("R");
  });

  it("自己ループ（負）は B として検出される", () => {
    const result = detectLoops([node("a")], [edge("e1", "a", "a", "-")]);
    expect(result.loops).toHaveLength(1);
    expect(result.loops[0].nodeIds).toEqual(["a"]);
    expect(result.loops[0].polarity).toBe("B");
  });

  it("ノードの並び順が違っても同じループ ID になる（回転正規化）", () => {
    const edgeSet = [
      edge("e1", "a", "b"),
      edge("e2", "b", "c"),
      edge("e3", "c", "a"),
    ];
    const first = detectLoops([node("a"), node("b"), node("c")], edgeSet);
    const second = detectLoops([node("c"), node("a"), node("b")], edgeSet);
    expect(first.loops[0].id).toBe(second.loops[0].id);
    expect(first.loops[0].nodeIds).toEqual(second.loops[0].nodeIds);
  });

  it("ループ内に遅れリンクが 1 本でもあれば hasDelay", () => {
    const result = detectLoops(
      [node("a"), node("b")],
      [edge("e1", "a", "b", "+", true), edge("e2", "b", "a", "+")],
    );
    expect(result.loops[0].hasDelay).toBe(true);
  });

  it("nodeNames は nodeIds と同順で名前を返す", () => {
    const result = detectLoops(
      [node("a", "残業時間"), node("b", "疲労")],
      [edge("e1", "a", "b"), edge("e2", "b", "a")],
    );
    expect(result.loops[0].nodeNames).toEqual(["残業時間", "疲労"]);
  });

  it("R と B が混在しても極性ごとに番号が振られる", () => {
    // a⇄b（R）と a⇄c（B、片方が負）
    const result = detectLoops(
      [node("a"), node("b"), node("c")],
      [
        edge("e1", "a", "b", "+"),
        edge("e2", "b", "a", "+"),
        edge("e3", "a", "c", "+"),
        edge("e4", "c", "a", "-"),
      ],
    );
    const labels = result.loops.map((l) => l.label).sort();
    expect(labels).toEqual(["B1", "R1"]);
  });

  it("図に存在しないノードを参照するエッジは無視する", () => {
    const result = detectLoops(
      [node("a"), node("b")],
      [edge("e1", "a", "b"), edge("e2", "b", "a"), edge("e3", "b", "ghost")],
    );
    expect(result.loops).toHaveLength(1);
  });

  it("ループが上限を超えたら打ち切って truncated を立てる", () => {
    // 6 ノードの完全有向グラフ。elementary circuits は 409 個 > MAX_LOOPS
    const ids = ["a", "b", "c", "d", "e", "f"];
    const nodes = ids.map((id) => node(id));
    const edges = ids.flatMap((s) =>
      ids.filter((t) => t !== s).map((t) => edge(`${s}-${t}`, s, t)),
    );
    const result = detectLoops(nodes, edges);
    expect(result.truncated).toBe(true);
    expect(result.loops).toHaveLength(MAX_LOOPS);
  });

  it("上限を超える密な図でも自己ループは落ちない", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const nodes = ids.map((id) => node(id));
    const edges = [
      ...ids.flatMap((s) =>
        ids.filter((t) => t !== s).map((t) => edge(`${s}-${t}`, s, t)),
      ),
      edge("self-f", "f", "f", "-"),
    ];
    const result = detectLoops(nodes, edges);
    expect(result.truncated).toBe(true);
    expect(result.loops).toHaveLength(MAX_LOOPS);
    expect(result.loops[0]).toMatchObject({
      id: "loop:f",
      label: "B1",
      nodeIds: ["f"],
    });
  });

  it("打ち切り後も短いループが優先され、ラベルは切り捨て後に振られる", () => {
    // 5 ノード完全有向グラフ（circuits 84 個 > MAX_LOOPS）に 2 ノードループだけの別成分を足す。
    // 列挙順に依存せず、長さ 2 のループ（完全グラフ内 10 + 別成分 1）が全て先頭に残る
    const ids = ["a", "b", "c", "d", "e"];
    const nodes = [...ids.map((id) => node(id)), node("y"), node("z")];
    const edges = [
      ...ids.flatMap((s) =>
        ids.filter((t) => t !== s).map((t) => edge(`${s}-${t}`, s, t)),
      ),
      edge("y-z", "y", "z"),
      edge("z-y", "z", "y", "-"),
    ];
    const result = detectLoops(nodes, edges);
    expect(result.truncated).toBe(true);
    expect(result.loops).toHaveLength(MAX_LOOPS);
    const twoNodeLoops = result.loops.filter((l) => l.nodeIds.length === 2);
    expect(twoNodeLoops).toHaveLength(11);
    expect(result.loops.slice(0, 11)).toEqual(twoNodeLoops);
    expect(result.loops.map((l) => l.id)).toContain("loop:y→z");
    // 極性ごとの連番が 1 から欠番なく続く
    const bLabels = result.loops
      .filter((l) => l.polarity === "B")
      .map((l) => l.label);
    expect(bLabels).toEqual(bLabels.map((_, i) => `B${i + 1}`));
  });

  describe("式由来（derived）リンクの取り込み", () => {
    // 式由来エッジ（極性 null もありうる・derived フラグ付き）
    const dep = (
      id: string,
      sourceNodeId: string,
      targetNodeId: string,
      polarity: "+" | "-" | null,
    ) => ({
      id,
      sourceNodeId,
      targetNodeId,
      polarity,
      hasDelay: false,
      derived: true,
    });

    it("因果エッジ + 式由来エッジで閉じたループを暫定（derived）として拾う", () => {
      // 利息→残高（因果 +）+ 残高→利息（式由来 +）で R ループ
      const result = detectLoops(
        [node("balance", "残高"), node("interest", "利息")],
        [
          edge("e1", "interest", "balance", "+"),
          dep("dep:balance->interest", "balance", "interest", "+"),
        ],
      );
      expect(result.loops).toHaveLength(1);
      const loop = result.loops[0];
      expect(loop.polarity).toBe("R");
      expect(loop.derived).toBe(true);
      expect(loop.edgeIds).toContain("dep:balance->interest");
    });

    it("因果エッジのみのループは derived=false", () => {
      const result = detectLoops(
        [node("a"), node("b")],
        [edge("e1", "a", "b", "+"), edge("e2", "b", "a", "+")],
      );
      expect(result.loops[0].derived).toBe(false);
    });

    it("式由来エッジの極性が null ならループ極性は '?'", () => {
      const result = detectLoops(
        [node("a"), node("b")],
        [edge("e1", "a", "b", "+"), dep("dep:b->a", "b", "a", null)],
      );
      expect(result.loops).toHaveLength(1);
      expect(result.loops[0].polarity).toBe("?");
      expect(result.loops[0].derived).toBe(true);
    });

    it("'?' ループにも極性ごとの連番が振られる", () => {
      // a⇄b（R, 因果のみ）と c⇄d（?, null を含む式由来）
      const result = detectLoops(
        [node("a"), node("b"), node("c"), node("d")],
        [
          edge("e1", "a", "b", "+"),
          edge("e2", "b", "a", "+"),
          edge("e3", "c", "d", "+"),
          dep("dep:d->c", "d", "c", null),
        ],
      );
      const byLabel = Object.fromEntries(
        result.loops.map((l) => [l.label, l.polarity]),
      );
      expect(byLabel).toEqual({ R1: "R", "?1": "?" });
    });
  });
});
