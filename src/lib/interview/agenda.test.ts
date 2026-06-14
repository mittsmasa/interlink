import { describe, expect, it } from "vitest";
import type { Loop } from "@/lib/diagram/loops";
import { buildInterviewAgenda, MAX_AGENDA_ITEMS } from "./agenda";
import { emptyInterviewNotes, type InterviewNotes } from "./notes";

function makeLoop(partial: Partial<Loop>): Loop {
  return {
    id: "loop:a→b",
    label: "R1",
    nodeIds: ["a", "b"],
    nodeNames: ["残業時間", "疲労"],
    edgeIds: ["e1", "e2"],
    polarity: "R",
    hasDelay: false,
    ...partial,
  };
}

function notesWith(partial: Partial<InterviewNotes>): InterviewNotes {
  return { ...emptyInterviewNotes(), ...partial };
}

const emptyDiagram = { nodes: [], edges: [], loops: [] };

describe("buildInterviewAgenda", () => {
  describe("focus フェーズ", () => {
    it("テーマと時間挙動をまとめて聞く指示を 1 件返す", () => {
      const agenda = buildInterviewAgenda(
        emptyInterviewNotes(),
        emptyDiagram,
        "focus",
      );
      expect(agenda).toHaveLength(1);
      expect(agenda[0]).toContain("テーマ");
      expect(agenda[0]).toContain("時間挙動");
    });
  });

  describe("draft フェーズ", () => {
    it("図が空なら、まず叩き台を一枚描く指示が先頭に出る", () => {
      const notes = notesWith({
        theme: "残業が減らない",
        behavior: { pattern: "increasing", description: "増え続けている" },
      });
      const agenda = buildInterviewAgenda(notes, emptyDiagram, "draft");
      expect(agenda[0]).toContain("変数 5〜8 個");
      expect(agenda[0]).toContain("updateDiagram");
      // 描いたドラフトの違和感を一括で問う指示が末尾に出る
      expect(agenda.some((i) => i.includes("違和感"))).toBe(true);
    });

    it("描き始めてループ未成立なら、閉じにいく指示と端点指摘が出る", () => {
      const notes = notesWith({
        theme: "x",
        behavior: { pattern: "other", description: "-" },
      });
      const diagram = {
        nodes: [
          { id: "a", name: "依頼量" },
          { id: "b", name: "残業時間" },
        ],
        edges: [{ sourceNodeId: "a", targetNodeId: "b" }],
        loops: [],
      };
      const agenda = buildInterviewAgenda(notes, diagram, "draft");
      expect(agenda.some((i) => i.includes("ループが閉じていない"))).toBe(true);
      expect(
        agenda.some((i) => i.includes("「依頼量」を動かしている原因")),
      ).toBe(true);
      expect(agenda.some((i) => i.includes("「残業時間」がどこへ影響"))).toBe(
        true,
      );
    });
  });

  describe("refine フェーズ", () => {
    it("未確認ループの読み上げ指示が最優先で出る", () => {
      const loop = makeLoop({});
      const agenda = buildInterviewAgenda(
        notesWith({ theme: "x" }),
        { ...emptyDiagram, loops: [loop] },
        "refine",
      );
      expect(agenda[0]).toContain("R1");
      expect(agenda[0]).toContain('confirmedLoopIds に "loop:a→b"');
    });

    it("確認済みループには読み上げ指示が出ない", () => {
      const loop = makeLoop({});
      const notes = notesWith({ confirmedLoopIds: [loop.id] });
      const agenda = buildInterviewAgenda(
        notes,
        { ...emptyDiagram, loops: [loop] },
        "refine",
      );
      expect(agenda.some((i) => i.includes("実感で確かめていない"))).toBe(
        false,
      );
    });

    it("挙動が増加なのに R ループがなければ不整合を指摘する", () => {
      const bLoop = makeLoop({ id: "loop:x→y", label: "B1", polarity: "B" });
      const notes = notesWith({
        theme: "x",
        behavior: { pattern: "increasing", description: "増え続けている" },
        confirmedLoopIds: ["loop:x→y"],
      });
      const agenda = buildInterviewAgenda(
        notes,
        { ...emptyDiagram, loops: [bLoop] },
        "refine",
      );
      expect(agenda.some((i) => i.includes("自己強化（R）ループがない"))).toBe(
        true,
      );
    });

    it("振動なのに遅れ付き B ループがなければ不整合を指摘する", () => {
      const rLoop = makeLoop({});
      const notes = notesWith({
        theme: "x",
        behavior: {
          pattern: "oscillating",
          description: "良くなったり悪くなったり",
        },
        confirmedLoopIds: [rLoop.id],
      });
      const agenda = buildInterviewAgenda(
        notes,
        { ...emptyDiagram, loops: [rLoop] },
        "refine",
      );
      expect(agenda.some((i) => i.includes("振動を生む遅れ付き"))).toBe(true);
    });

    it("件数は MAX_AGENDA_ITEMS で打ち切られ、優先 1 が先頭に残る", () => {
      const loop = makeLoop({});
      const notes = notesWith({
        theme: "x",
        behavior: { pattern: "increasing", description: "-" },
      });
      const diagram = {
        nodes: [
          { id: "a", name: "依頼量" },
          { id: "b", name: "残業時間" },
          { id: "c", name: "疲労" },
          { id: "d", name: "ミス" },
        ],
        edges: [
          { sourceNodeId: "a", targetNodeId: "b" },
          { sourceNodeId: "b", targetNodeId: "c" },
        ],
        loops: [loop],
      };
      const agenda = buildInterviewAgenda(notes, diagram, "refine");
      expect(agenda.length).toBeLessThanOrEqual(MAX_AGENDA_ITEMS);
      expect(agenda[0]).toContain("R1");
    });
  });
});
