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
});
