import { describe, expect, it } from "vitest";
import type { NodeKind } from "@/db/schema";
import type { Loop } from "@/lib/diagram/loops";
import { emptyInterviewNotes, type InterviewNotes } from "./notes";
import {
  deriveInterviewPhase,
  isReadyForInsight,
  needsQuantification,
} from "./phase";

const loop: Loop = {
  id: "loop:a→b",
  label: "R1",
  nodeIds: ["a", "b"],
  nodeNames: ["残業時間", "疲労"],
  edgeIds: ["e1", "e2"],
  polarity: "R",
  hasDelay: false,
};

const emptyDiagram = { nodes: [], edges: [], loops: [] };

function notesWith(partial: Partial<InterviewNotes>): InterviewNotes {
  return { ...emptyInterviewNotes(), ...partial };
}

describe("deriveInterviewPhase", () => {
  it("何もなければ焦点（focus）", () => {
    expect(deriveInterviewPhase(emptyInterviewNotes(), emptyDiagram)).toBe(
      "focus",
    );
  });

  it("テーマだけでは焦点のまま（時間挙動が要る）", () => {
    const notes = notesWith({ theme: "残業が減らない" });
    expect(deriveInterviewPhase(notes, emptyDiagram)).toBe("focus");
  });

  it("テーマと時間挙動が掴めたらドラフト（draft）", () => {
    const notes = notesWith({
      theme: "残業が減らない",
      behavior: { pattern: "increasing", description: "増え続けている" },
    });
    expect(deriveInterviewPhase(notes, emptyDiagram)).toBe("draft");
  });

  it("ノートが空でも図に変数があればドラフト（描き始めている）", () => {
    const diagram = { nodes: [{ name: "残業時間" }], edges: [], loops: [] };
    expect(deriveInterviewPhase(emptyInterviewNotes(), diagram)).toBe("draft");
  });

  it("ノートが空でもエッジがあればドラフト（既存プロジェクト後方互換）", () => {
    const diagram = {
      nodes: [{ name: "a" }, { name: "b" }],
      edges: [{}],
      loops: [],
    };
    expect(deriveInterviewPhase(emptyInterviewNotes(), diagram)).toBe("draft");
  });

  it("ループが閉じたらすり合わせ（refine）", () => {
    const diagram = { nodes: [], edges: [], loops: [loop] };
    expect(deriveInterviewPhase(emptyInterviewNotes(), diagram)).toBe("refine");
  });

  it("ループがあれば焦点未達でもすり合わせ（図優先）", () => {
    const diagram = {
      nodes: [{ name: "a" }],
      edges: [{}],
      loops: [loop],
    };
    expect(deriveInterviewPhase(emptyInterviewNotes(), diagram)).toBe("refine");
  });

  describe("insight", () => {
    const bLoop: Loop = {
      ...loop,
      id: "loop:b→c",
      label: "B1",
      polarity: "B",
    };
    const both = {
      nodes: [{ name: "a" }],
      edges: [{}, {}],
      loops: [loop, bLoop],
    };

    it("R と B が各 1 つ以上 confirmed ならインサイト（insight）", () => {
      const notes = notesWith({ confirmedLoopIds: [loop.id, bLoop.id] });
      expect(deriveInterviewPhase(notes, both)).toBe("insight");
    });

    it("R だけ（または B だけ）の確認ではすり合わせのまま", () => {
      expect(
        deriveInterviewPhase(notesWith({ confirmedLoopIds: [loop.id] }), both),
      ).toBe("refine");
      expect(
        deriveInterviewPhase(notesWith({ confirmedLoopIds: [bLoop.id] }), both),
      ).toBe("refine");
    });

    it("図から消えたループの ID は確認済みに数えない", () => {
      const notes = notesWith({ confirmedLoopIds: [loop.id, "loop:gone"] });
      expect(deriveInterviewPhase(notes, both)).toBe("refine");
    });

    it("status 付きエッジがあるときは confirmed 率が閾値未満なら insight に入らない", () => {
      const notes = notesWith({ confirmedLoopIds: [loop.id, bLoop.id] });
      const lowRatio = {
        ...both,
        edges: [
          { status: "confirmed" },
          { status: "inferred" },
          { status: "inferred" },
        ],
      };
      expect(isReadyForInsight(notes, lowRatio)).toBe(false);
      expect(deriveInterviewPhase(notes, lowRatio)).toBe("refine");
      const highRatio = {
        ...both,
        edges: [{ status: "confirmed" }, { status: "inferred" }],
      };
      expect(deriveInterviewPhase(notes, highRatio)).toBe("insight");
    });

    it("status を持たない入力（fixture 等）ならループの確認だけで判定する", () => {
      const notes = notesWith({ confirmedLoopIds: [loop.id, bLoop.id] });
      const noStatus = { ...both, edges: [{}, { status: null }] };
      expect(isReadyForInsight(notes, noStatus)).toBe(true);
    });
  });

  describe("quantify", () => {
    const bLoop: Loop = {
      ...loop,
      id: "loop:b→c",
      label: "B1",
      polarity: "B",
    };
    const confirmed = notesWith({ confirmedLoopIds: [loop.id, bLoop.id] });
    /** insight 到達済みの図（R と B が確認済み） */
    const reached = (
      nodes: {
        name: string;
        kind?: NodeKind | null;
        initialValue?: number | null;
      }[],
    ) => ({ nodes, edges: [{}, {}], loops: [loop, bLoop] });

    it("insight 到達でも、昇格も仮説も無ければインサイトのまま", () => {
      const diagram = reached([{ name: "疲労" }, { name: "ミス率" }]);
      expect(deriveInterviewPhase(confirmed, diagram)).toBe("insight");
    });

    it("昇格が始まり未分類が残っていれば定量化（quantify）", () => {
      const diagram = reached([
        { name: "疲労", kind: "stock", initialValue: 30 },
        { name: "ミス率" },
      ]);
      expect(deriveInterviewPhase(confirmed, diagram)).toBe("quantify");
    });

    it("未検証の仮説があっても、昇格が始まっていなければインサイトのまま", () => {
      // 仮説は refine の段階でも記録される。これを合図にすると
      // 介入候補を挙げる対話を素通りしてしまう
      const notes = notesWith({
        confirmedLoopIds: [loop.id, bLoop.id],
        hypotheses: [
          {
            leveragePoint: "休息",
            expectedEffect: "疲労が下がる",
            loopIds: [],
            status: "proposed",
          },
        ],
      });
      const diagram = reached([{ name: "疲労" }, { name: "ミス率" }]);
      expect(deriveInterviewPhase(notes, diagram)).toBe("insight");
    });

    it("ストックに初期値が無ければ、全ノード昇格済みでも定量化", () => {
      const diagram = reached([
        { name: "疲労", kind: "stock", initialValue: null },
        { name: "残業増", kind: "flow" },
      ]);
      expect(deriveInterviewPhase(confirmed, diagram)).toBe("quantify");
    });

    it("ストックが 1 つも無ければ定量化（時間発展する量が無い）", () => {
      const diagram = reached([
        { name: "ミス率", kind: "auxiliary" },
        { name: "上限", kind: "constant" },
      ]);
      expect(deriveInterviewPhase(confirmed, diagram)).toBe("quantify");
    });

    it("数値が揃えばインサイトへ戻る（仮説を試す番）", () => {
      const diagram = reached([
        { name: "疲労", kind: "stock", initialValue: 30 },
        { name: "残業増", kind: "flow" },
        { name: "ミス率", kind: "auxiliary" },
      ]);
      expect(deriveInterviewPhase(confirmed, diagram)).toBe("insight");
    });

    it("insight に達していなければ、昇格していても定量化にはならない", () => {
      const diagram = {
        nodes: [{ name: "疲労", kind: "stock" as const, initialValue: null }],
        edges: [{}],
        loops: [loop],
      };
      expect(deriveInterviewPhase(emptyInterviewNotes(), diagram)).toBe(
        "refine",
      );
    });
  });
});

describe("needsQuantification", () => {
  it("未分類が残っていれば未完了", () => {
    expect(
      needsQuantification([
        { name: "疲労", kind: "stock", initialValue: 1 },
        { name: "ミス率" },
      ]),
    ).toBe(true);
  });

  it("すべて昇格しストックに初期値があれば完了", () => {
    expect(
      needsQuantification([
        { name: "疲労", kind: "stock", initialValue: 0 },
        { name: "残業増", kind: "flow" },
      ]),
    ).toBe(false);
  });

  it("初期値 0 は「無い」扱いにしない", () => {
    expect(
      needsQuantification([{ name: "疲労", kind: "stock", initialValue: 0 }]),
    ).toBe(false);
  });
});
