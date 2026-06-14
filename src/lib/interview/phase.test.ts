import { describe, expect, it } from "vitest";
import type { Loop } from "@/lib/diagram/loops";
import { emptyInterviewNotes, type InterviewNotes } from "./notes";
import { deriveInterviewPhase } from "./phase";

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
});
