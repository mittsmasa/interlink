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
  it("未確認ループの読み上げ指示が最優先で出る", () => {
    const loop = makeLoop({});
    const notes = notesWith({ theme: "x", behavior: null });
    const agenda = buildInterviewAgenda(
      notes,
      { ...emptyDiagram, loops: [loop] },
      "hypothesis",
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
      "hypothesis",
    );
    expect(agenda.some((i) => i.includes("実感で確かめていない"))).toBe(false);
  });

  it("挙動が増加なのに R ループがなければ不整合を指摘する（P5 のみ）", () => {
    const bLoop = makeLoop({ id: "loop:x→y", label: "B1", polarity: "B" });
    const notes = notesWith({
      theme: "x",
      behavior: { pattern: "increasing", description: "増え続けている" },
      confirmedLoopIds: ["loop:x→y"],
    });
    const agenda = buildInterviewAgenda(
      notes,
      { ...emptyDiagram, loops: [bLoop] },
      "hypothesis",
    );
    expect(agenda.some((i) => i.includes("自己強化（R）ループがない"))).toBe(
      true,
    );
    // P4 では出ない
    const agendaP4 = buildInterviewAgenda(
      notes,
      { ...emptyDiagram, loops: [bLoop] },
      "causality",
    );
    expect(agendaP4.some((i) => i.includes("自己強化（R）ループがない"))).toBe(
      false,
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
      "hypothesis",
    );
    expect(agenda.some((i) => i.includes("振動を生む遅れ付き"))).toBe(true);
  });

  it("端点ノードの深掘り指示が出る（原因なし / 影響なし）", () => {
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
    const agenda = buildInterviewAgenda(notes, diagram, "causality");
    expect(agenda.some((i) => i.includes("「依頼量」を動かしている原因"))).toBe(
      true,
    );
    expect(agenda.some((i) => i.includes("「残業時間」がどこへ影響"))).toBe(
      true,
    );
  });

  it("エッジが 1 本もない図では端点指摘を出さない", () => {
    const notes = notesWith({
      theme: "x",
      behavior: { pattern: "other", description: "-" },
    });
    const diagram = {
      nodes: [{ id: "a", name: "依頼量" }],
      edges: [],
      loops: [],
    };
    const agenda = buildInterviewAgenda(notes, diagram, "variables");
    expect(agenda.some((i) => i.includes("動かしている原因"))).toBe(false);
  });

  it("テーマ・挙動が空なら聴取指示が出る", () => {
    const agenda = buildInterviewAgenda(
      emptyInterviewNotes(),
      emptyDiagram,
      "time-axis",
    );
    expect(agenda.some((i) => i.includes("テーマと時間挙動"))).toBe(true);
  });

  it("変数化されていない関係者の深掘り指示が出る", () => {
    const notes = notesWith({
      theme: "x",
      behavior: { pattern: "other", description: "-" },
      stakeholders: [
        { name: "上司", concerns: ["納期を守りたい"] },
        { name: "自分", concerns: [] },
      ],
      variableCandidates: [{ name: "残業時間", source: "自分" }],
    });
    const agenda = buildInterviewAgenda(notes, emptyDiagram, "variables");
    expect(agenda.some((i) => i.includes("関係者「上司」"))).toBe(true);
  });

  it("件数は MAX_AGENDA_ITEMS で打ち切られる", () => {
    // ルール 1 + 端点 2 件 + 空欄系で 4 件以上発火する状況を作る
    const loop = makeLoop({});
    const notes = notesWith({
      theme: "x",
      behavior: { pattern: "increasing", description: "-" },
      stakeholders: [{ name: "上司", concerns: [] }],
    });
    const diagram = {
      nodes: [
        { id: "a", name: "依頼量" },
        { id: "b", name: "残業時間" },
        { id: "c", name: "疲労" },
      ],
      edges: [
        { sourceNodeId: "a", targetNodeId: "b" },
        { sourceNodeId: "b", targetNodeId: "c" },
      ],
      loops: [loop],
    };
    const agenda = buildInterviewAgenda(notes, diagram, "hypothesis");
    expect(agenda.length).toBeLessThanOrEqual(MAX_AGENDA_ITEMS);
    expect(agenda[0]).toContain("R1"); // 優先 1 が先頭に残る
  });
});
