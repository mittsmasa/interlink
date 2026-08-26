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

    it("確認済みループ内の推測リンク本数と最弱リンク（disputed 優先）を問う", () => {
      const loop = makeLoop({ edgeIds: ["e1", "e2"] });
      const notes = notesWith({
        theme: "x",
        behavior: { pattern: "other", description: "-" },
        confirmedLoopIds: [loop.id],
      });
      const diagram = {
        nodes: [
          { id: "a", name: "残業時間" },
          { id: "b", name: "疲労" },
        ],
        edges: [
          {
            id: "e1",
            sourceNodeId: "a",
            targetNodeId: "b",
            status: "inferred" as const,
          },
          {
            id: "e2",
            sourceNodeId: "b",
            targetNodeId: "a",
            status: "disputed" as const,
          },
        ],
        loops: [loop],
      };
      const agenda = buildInterviewAgenda(notes, diagram, "refine");
      const item = agenda.find((i) => i.includes("確認済みのループ R1"));
      expect(item).toBeDefined();
      expect(item).toContain("推測のままのリンクが 1 本");
      expect(item).toContain("ユーザーが疑問視した「疲労→残業時間」");
      expect(item).toContain("disputed");
    });

    it("確認済みループのリンクがすべて confirmed なら最弱リンク項目は出ない", () => {
      const loop = makeLoop({ edgeIds: ["e1", "e2"] });
      const notes = notesWith({
        theme: "x",
        behavior: { pattern: "other", description: "-" },
        confirmedLoopIds: [loop.id],
      });
      const diagram = {
        nodes: [
          { id: "a", name: "残業時間" },
          { id: "b", name: "疲労" },
        ],
        edges: [
          {
            id: "e1",
            sourceNodeId: "a",
            targetNodeId: "b",
            status: "confirmed" as const,
          },
          {
            id: "e2",
            sourceNodeId: "b",
            targetNodeId: "a",
            status: "confirmed" as const,
          },
        ],
        loops: [loop],
      };
      const agenda = buildInterviewAgenda(notes, diagram, "refine");
      expect(agenda.some((i) => i.includes("確認済みのループ"))).toBe(false);
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

  describe("insight フェーズ", () => {
    const rLoop = makeLoop({
      id: "loop:a→b→c",
      label: "R1",
      nodeIds: ["a", "b", "c"],
      nodeNames: ["残業時間", "疲労", "ミス"],
    });
    const bLoop = makeLoop({
      id: "loop:b→d",
      label: "B1",
      polarity: "B",
      nodeIds: ["b", "d"],
      nodeNames: ["疲労", "休息"],
    });
    const diagram = {
      nodes: [
        { id: "a", name: "残業時間" },
        { id: "b", name: "疲労" },
        { id: "c", name: "ミス" },
        { id: "d", name: "休息" },
      ],
      edges: [
        { sourceNodeId: "a", targetNodeId: "b" },
        { sourceNodeId: "b", targetNodeId: "c" },
        { sourceNodeId: "c", targetNodeId: "a" },
        { sourceNodeId: "b", targetNodeId: "d" },
        { sourceNodeId: "d", targetNodeId: "b" },
      ],
      loops: [rLoop, bLoop],
    };
    const confirmedNotes = notesWith({
      confirmedLoopIds: [rLoop.id, bLoop.id],
    });

    it("介入候補（R と B の接点）を先頭で提示し、overrides での検証と hypotheses への記録を促す", () => {
      const agenda = buildInterviewAgenda(confirmedNotes, diagram, "insight");
      expect(agenda[0]).toContain("介入候補: 「疲労」（B1 と R1 の接点）");
      expect(agenda[0]).toContain("run_simulation");
      expect(agenda[0]).toContain("hypotheses");
    });

    it("交点が無ければ、仮説を一緒に考える指示になる", () => {
      const agenda = buildInterviewAgenda(
        notesWith({ confirmedLoopIds: [rLoop.id] }),
        { ...diagram, loops: [rLoop] },
        "insight",
      );
      expect(agenda[0]).toContain("交点になる変数がまだ無い");
    });

    it("変数ごとの挙動と構造の不整合を指摘する", () => {
      const notes = notesWith({
        ...confirmedNotes,
        variableBehaviors: [
          { name: "疲労", pattern: "oscillating", description: "波がある" },
        ],
      });
      const agenda = buildInterviewAgenda(notes, diagram, "insight");
      expect(
        agenda.some((i) => i.includes("変数「疲労」の挙動は「振動している」")),
      ).toBe(true);
    });

    it("未検証の仮説があれば試すよう促し、未確認ループの残件も添える", () => {
      const notes = notesWith({
        confirmedLoopIds: [rLoop.id],
        hypotheses: [
          {
            leveragePoint: "休息",
            expectedEffect: "疲労の波が収まる",
            loopIds: [bLoop.id],
            status: "proposed",
          },
          {
            leveragePoint: "依頼量",
            expectedEffect: "-",
            loopIds: [],
            status: "tested",
          },
        ],
      });
      const agenda = buildInterviewAgenda(notes, diagram, "insight");
      const hyp = agenda.find((i) => i.includes("まだ試していない"));
      expect(hyp).toContain("「休息 → 疲労の波が収まる」");
      expect(hyp).not.toContain("依頼量");
      expect(agenda.some((i) => i.includes("未確認のループが 1 件"))).toBe(
        true,
      );
      expect(agenda.length).toBeLessThanOrEqual(MAX_AGENDA_ITEMS);
    });
  });

  describe("quantify フェーズ", () => {
    const defaultSim = { dt: 1, steps: 20, timeUnit: null };

    it("未分類の変数があれば、根拠付きの昇格候補を提案する", () => {
      const diagram = {
        nodes: [
          { id: "a", name: "疲労" },
          { id: "b", name: "ミス率" },
        ],
        edges: [
          { sourceNodeId: "a", targetNodeId: "b" },
          { sourceNodeId: "b", targetNodeId: "a" },
        ],
        loops: [makeLoop({})],
      };
      const agenda = buildInterviewAgenda(
        emptyInterviewNotes(),
        diagram,
        "quantify",
      );
      const promote = agenda.find((i) => i.includes("昇格候補"));
      expect(promote).toContain("「疲労」はストック");
      expect(promote).toContain("根拠:");
      expect(promote).toContain("一時停止テスト");
      // 確定するのはユーザー（doc 3 章）
      expect(promote).toContain("ユーザー確定");
    });

    it("時間単位が未設定なら、dt と期間の問いを出す", () => {
      const diagram = {
        nodes: [
          { id: "a", name: "疲労", kind: "stock" as const, initialValue: 30 },
        ],
        edges: [],
        loops: [],
        simConfig: defaultSim,
      };
      const agenda = buildInterviewAgenda(
        emptyInterviewNotes(),
        diagram,
        "quantify",
      );
      const axis = agenda.find((i) => i.includes("時間軸"));
      expect(axis).toContain("1 ステップを何と見ますか");
      expect(axis).toContain("どのくらい先まで");
    });

    it("聞き取り済みの時間粒度があれば叩き台として添える", () => {
      const notes = notesWith({
        timeHorizon: { from: "半年前", to: "現在", unit: "週" },
      });
      const agenda = buildInterviewAgenda(
        notes,
        { nodes: [], edges: [], loops: [], simConfig: defaultSim },
        "quantify",
      );
      expect(agenda.find((i) => i.includes("時間軸"))).toContain(
        "「週」の粒度",
      );
    });

    it("時間単位が決まっていれば時間軸の項目を出さない", () => {
      const agenda = buildInterviewAgenda(
        emptyInterviewNotes(),
        {
          nodes: [],
          edges: [],
          loops: [],
          simConfig: { dt: 1, steps: 20, timeUnit: "週" },
        },
        "quantify",
      );
      expect(agenda.some((i) => i.includes("時間軸"))).toBe(false);
    });

    it("simConfig を渡さない呼び出し（旧 fixture）では時間軸を問わない", () => {
      const agenda = buildInterviewAgenda(
        emptyInterviewNotes(),
        { nodes: [], edges: [], loops: [] },
        "quantify",
      );
      expect(agenda.some((i) => i.includes("時間軸"))).toBe(false);
    });

    it("初期値の無いストックと式の無いフローを名指しで促す", () => {
      const diagram = {
        nodes: [
          { id: "a", name: "疲労", kind: "stock" as const, initialValue: null },
          { id: "b", name: "残業増", kind: "flow" as const, expression: null },
          {
            id: "c",
            name: "ミス率",
            kind: "auxiliary" as const,
            expression: "疲労/100",
          },
        ],
        edges: [],
        loops: [],
        simConfig: { dt: 1, steps: 20, timeUnit: "週" },
      };
      const agenda = buildInterviewAgenda(
        emptyInterviewNotes(),
        diagram,
        "quantify",
      );
      const initial = agenda.find((i) => i.includes("初期値の無いストック"));
      expect(initial).toContain("「疲労」");
      expect(initial).toContain("initialValue");
      const expr = agenda.find((i) => i.includes("式の無いフロー"));
      expect(expr).toContain("「残業増」");
      // 式のある補助変数は挙げない
      expect(expr).not.toContain("ミス率");
    });

    it("すべて埋まっていれば促す項目が無くなる", () => {
      const agenda = buildInterviewAgenda(
        emptyInterviewNotes(),
        {
          nodes: [
            { id: "a", name: "疲労", kind: "stock" as const, initialValue: 30 },
            { id: "b", name: "残業増", kind: "flow" as const, expression: "8" },
          ],
          edges: [],
          loops: [],
          simConfig: { dt: 1, steps: 20, timeUnit: "週" },
        },
        "quantify",
      );
      expect(agenda).toEqual([]);
    });

    it("項目数は上限を超えない", () => {
      const diagram = {
        nodes: [
          { id: "a", name: "疲労" },
          { id: "b", name: "ミス率" },
          { id: "c", name: "余力", kind: "stock" as const, initialValue: null },
          { id: "d", name: "回復", kind: "flow" as const, expression: null },
        ],
        edges: [{ sourceNodeId: "a", targetNodeId: "b" }],
        loops: [],
        simConfig: defaultSim,
      };
      const agenda = buildInterviewAgenda(
        emptyInterviewNotes(),
        diagram,
        "quantify",
      );
      expect(agenda.length).toBeLessThanOrEqual(MAX_AGENDA_ITEMS);
    });
  });
});
