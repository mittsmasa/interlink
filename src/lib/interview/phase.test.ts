import { describe, expect, it } from "vitest";
import type { Loop } from "@/lib/diagram/loops";
import { emptyInterviewNotes, type InterviewNotes } from "./notes";
import { deriveInterviewPhase, PHASE_THRESHOLDS } from "./phase";

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
  it("何もなければ時間軸分析（P1）", () => {
    expect(deriveInterviewPhase(emptyInterviewNotes(), emptyDiagram)).toBe(
      "time-axis",
    );
  });

  it("挙動が記録されたら関係者分析（P2）", () => {
    const notes = notesWith({
      behavior: { pattern: "increasing", description: "増え続けている" },
    });
    expect(deriveInterviewPhase(notes, emptyDiagram)).toBe("stakeholders");
  });

  it("関係者が閾値に達したら変数抽出（P3）", () => {
    const notes = notesWith({
      behavior: { pattern: "increasing", description: "増え続けている" },
      stakeholders: Array.from(
        { length: PHASE_THRESHOLDS.stakeholdersForVariables },
        (_, i) => ({ name: `関係者${i}`, concerns: [] }),
      ),
    });
    expect(deriveInterviewPhase(notes, emptyDiagram)).toBe("variables");
  });

  it("変数候補が閾値に達したら因果分析（P4）", () => {
    const notes = notesWith({
      variableCandidates: Array.from(
        { length: PHASE_THRESHOLDS.candidatesForCausality },
        (_, i) => ({ name: `変数${i}`, source: null }),
      ),
    });
    expect(deriveInterviewPhase(notes, emptyDiagram)).toBe("causality");
  });

  it("候補数はノートと図上ノード名を dedup して数える", () => {
    const n = PHASE_THRESHOLDS.candidatesForCausality;
    // ノートに n-1 個 + 図に同名 1 個 → 合計 n-1 のまま P4 に達しない
    const notes = notesWith({
      stakeholders: [{ name: "自分", concerns: [] }],
      variableCandidates: Array.from({ length: n - 1 }, (_, i) => ({
        name: `変数${i}`,
        source: null,
      })),
    });
    const diagram = { nodes: [{ name: "変数0" }], edges: [], loops: [] };
    expect(deriveInterviewPhase(notes, diagram)).not.toBe("causality");
    // 図に新顔 1 個 → n に達して P4
    const diagram2 = { nodes: [{ name: "新顔" }], edges: [], loops: [] };
    expect(deriveInterviewPhase(notes, diagram2)).toBe("causality");
  });

  it("ノートが空でもエッジが閾値以上なら因果分析（既存プロジェクト後方互換）", () => {
    const diagram = {
      nodes: [{ name: "a" }, { name: "b" }],
      edges: Array.from({ length: PHASE_THRESHOLDS.edgesForCausality }),
      loops: [],
    };
    expect(deriveInterviewPhase(emptyInterviewNotes(), diagram)).toBe(
      "causality",
    );
  });

  it("ループがあれば常に仮説の検証（P5）", () => {
    const diagram = { nodes: [], edges: [], loops: [loop] };
    expect(deriveInterviewPhase(emptyInterviewNotes(), diagram)).toBe(
      "hypothesis",
    );
  });
});
