import { describe, expect, it } from "vitest";
import type { Loop } from "@/lib/diagram/loops";
import { emptyInterviewNotes, type InterviewNotes } from "./notes";
import { deriveInterviewPhase, isReadyForInsight } from "./phase";

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

    it("status を持つエッジが 1 本も無ければ（列未導入）ループの確認だけで判定する", () => {
      const notes = notesWith({ confirmedLoopIds: [loop.id, bLoop.id] });
      const noStatus = { ...both, edges: [{}, { status: null }] };
      expect(isReadyForInsight(notes, noStatus)).toBe(true);
    });
  });
});
