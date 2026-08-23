import { describe, expect, it } from "vitest";
import {
  capInterviewNotes,
  countCapDropped,
  emptyInterviewNotes,
  type InterviewNotes,
  MAX_HYPOTHESES,
  MAX_STAKEHOLDERS,
  MAX_VARIABLE_BEHAVIORS,
  MAX_VARIABLE_CANDIDATES,
  mergeInterviewNotes,
  parseInterviewNotes,
} from "./notes";

const fullNotes: InterviewNotes = {
  theme: "残業が減らない",
  behavior: { pattern: "increasing", description: "半年前から増え続けている" },
  idealBehavior: "横ばいに落ち着いてほしい",
  stakeholders: [{ name: "自分", concerns: ["睡眠を確保したい"] }],
  variableCandidates: [{ name: "残業時間", source: "自分" }],
  confirmedLoopIds: ["loop:a→b"],
  timeHorizon: { from: "半年前", to: "現在", unit: "月" },
  variableBehaviors: [
    { name: "残業時間", pattern: "increasing", description: "月 20h → 45h" },
  ],
  hypotheses: [
    {
      leveragePoint: "依頼の受付基準",
      expectedEffect: "残業時間の増加が止まる",
      loopIds: ["loop:a→b"],
      status: "proposed",
    },
  ],
};

describe("parseInterviewNotes", () => {
  it("null は空ノートになる", () => {
    expect(parseInterviewNotes(null)).toEqual(emptyInterviewNotes());
  });

  it("壊れた JSON は空ノートになる", () => {
    expect(parseInterviewNotes("{not json")).toEqual(emptyInterviewNotes());
  });

  it("形が合わない JSON は空ノートになる", () => {
    expect(parseInterviewNotes('{"stakeholders":"佐藤"}')).toEqual(
      emptyInterviewNotes(),
    );
  });

  it("保存 → 復元の往復で一致する", () => {
    expect(parseInterviewNotes(JSON.stringify(fullNotes))).toEqual(fullNotes);
  });

  it("欠けたフィールドは default で補完される（空オブジェクト → 空ノート）", () => {
    expect(parseInterviewNotes("{}")).toEqual(emptyInterviewNotes());
  });

  it("hypotheses の status と loopIds は省略時に proposed / [] になる（旧ノートとの互換）", () => {
    const parsed = parseInterviewNotes(
      JSON.stringify({
        hypotheses: [{ leveragePoint: "受付基準", expectedEffect: "止まる" }],
      }),
    );
    expect(parsed.hypotheses).toEqual([
      {
        leveragePoint: "受付基準",
        expectedEffect: "止まる",
        loopIds: [],
        status: "proposed",
      },
    ]);
  });
});

describe("capInterviewNotes", () => {
  it("ステークホルダと変数候補を上限件数で打ち切る", () => {
    const over: InterviewNotes = {
      ...emptyInterviewNotes(),
      stakeholders: Array.from({ length: MAX_STAKEHOLDERS + 3 }, (_, i) => ({
        name: `関係者${i}`,
        concerns: [],
      })),
      variableCandidates: Array.from(
        { length: MAX_VARIABLE_CANDIDATES + 5 },
        (_, i) => ({ name: `変数${i}`, source: null }),
      ),
    };
    const capped = capInterviewNotes(over);
    expect(capped.stakeholders).toHaveLength(MAX_STAKEHOLDERS);
    expect(capped.variableCandidates).toHaveLength(MAX_VARIABLE_CANDIDATES);
    // 先頭から保持される
    expect(capped.stakeholders[0]?.name).toBe("関係者0");
  });

  it("上限以下はそのまま", () => {
    expect(capInterviewNotes(fullNotes)).toEqual(fullNotes);
  });

  it("hypotheses と variableBehaviors も上限で打ち切る", () => {
    const over: InterviewNotes = {
      ...emptyInterviewNotes(),
      hypotheses: Array.from({ length: MAX_HYPOTHESES + 1 }, (_, i) => ({
        leveragePoint: `h${i}`,
        expectedEffect: "-",
        loopIds: [],
        status: "proposed" as const,
      })),
      variableBehaviors: Array.from(
        { length: MAX_VARIABLE_BEHAVIORS + 2 },
        (_, i) => ({
          name: `v${i}`,
          pattern: "other" as const,
          description: "-",
        }),
      ),
    };
    const capped = capInterviewNotes(over);
    expect(capped.hypotheses).toHaveLength(MAX_HYPOTHESES);
    expect(capped.variableBehaviors).toHaveLength(MAX_VARIABLE_BEHAVIORS);
  });
});

describe("mergeInterviewNotes", () => {
  it("スカラーは patch が非 null のときだけ上書きする", () => {
    const merged = mergeInterviewNotes(fullNotes, {
      ...emptyInterviewNotes(),
      idealBehavior: "減ってほしい",
    });
    expect(merged.theme).toBe(fullNotes.theme);
    expect(merged.behavior).toEqual(fullNotes.behavior);
    expect(merged.idealBehavior).toBe("減ってほしい");
  });

  it("stakeholders は同名なら concerns を union、別名なら追加する", () => {
    const merged = mergeInterviewNotes(fullNotes, {
      ...emptyInterviewNotes(),
      stakeholders: [
        {
          name: " 自分",
          concerns: ["睡眠を確保したい", "評価を落としたくない"],
        },
        { name: "上司", concerns: ["納期"] },
      ],
    });
    expect(merged.stakeholders).toEqual([
      { name: "自分", concerns: ["睡眠を確保したい", "評価を落としたくない"] },
      { name: "上司", concerns: ["納期"] },
    ]);
  });

  it("variableCandidates は同名を重複させず、source は null のときだけ補う", () => {
    const base: InterviewNotes = {
      ...emptyInterviewNotes(),
      variableCandidates: [
        { name: "残業時間", source: "自分" },
        { name: "納期圧力", source: null },
      ],
    };
    const merged = mergeInterviewNotes(base, {
      ...emptyInterviewNotes(),
      variableCandidates: [
        { name: "残業時間", source: "上司" },
        { name: "納期圧力", source: "上司" },
        { name: "疲労", source: null },
      ],
    });
    expect(merged.variableCandidates).toEqual([
      { name: "残業時間", source: "自分" },
      { name: "納期圧力", source: "上司" },
      { name: "疲労", source: null },
    ]);
  });

  it("confirmedLoopIds は union で順序を保つ", () => {
    const merged = mergeInterviewNotes(fullNotes, {
      ...emptyInterviewNotes(),
      confirmedLoopIds: ["loop:b→c", "loop:a→b"],
    });
    expect(merged.confirmedLoopIds).toEqual(["loop:a→b", "loop:b→c"]);
  });

  it("variableBehaviors は同名なら patch で上書き、別名なら追加する", () => {
    const merged = mergeInterviewNotes(fullNotes, {
      ...emptyInterviewNotes(),
      variableBehaviors: [
        { name: "残業時間", pattern: "plateau", description: "45h で頭打ち" },
        { name: "疲労", pattern: "oscillating", description: "波がある" },
      ],
    });
    expect(merged.variableBehaviors).toEqual([
      { name: "残業時間", pattern: "plateau", description: "45h で頭打ち" },
      { name: "疲労", pattern: "oscillating", description: "波がある" },
    ]);
  });

  it("hypotheses は同じ leveragePoint なら status / expectedEffect を上書きし loopIds を union する", () => {
    const merged = mergeInterviewNotes(fullNotes, {
      ...emptyInterviewNotes(),
      hypotheses: [
        {
          leveragePoint: "依頼の受付基準",
          expectedEffect: "残業時間が横ばいになった",
          loopIds: ["loop:b→c"],
          status: "tested",
        },
        {
          leveragePoint: "休息",
          expectedEffect: "疲労が減る",
          loopIds: [],
          status: "proposed",
        },
      ],
    });
    expect(merged.hypotheses).toEqual([
      {
        leveragePoint: "依頼の受付基準",
        expectedEffect: "残業時間が横ばいになった",
        loopIds: ["loop:a→b", "loop:b→c"],
        status: "tested",
      },
      {
        leveragePoint: "休息",
        expectedEffect: "疲労が減る",
        loopIds: [],
        status: "proposed",
      },
    ]);
  });

  it("timeHorizon は patch が非 null のときだけ上書きする", () => {
    const kept = mergeInterviewNotes(fullNotes, emptyInterviewNotes());
    expect(kept.timeHorizon).toEqual(fullNotes.timeHorizon);
    const replaced = mergeInterviewNotes(fullNotes, {
      ...emptyInterviewNotes(),
      timeHorizon: { from: "2024-04", to: "2025-03", unit: "四半期" },
    });
    expect(replaced.timeHorizon?.unit).toBe("四半期");
  });

  it("base を変更しない", () => {
    const base = structuredClone(fullNotes);
    mergeInterviewNotes(base, {
      ...emptyInterviewNotes(),
      stakeholders: [{ name: "自分", concerns: ["追加"] }],
    });
    expect(base).toEqual(fullNotes);
  });
});

describe("countCapDropped", () => {
  it("上限以内なら 0、超えた分だけ数える", () => {
    expect(countCapDropped(fullNotes)).toEqual({
      stakeholders: 0,
      variableCandidates: 0,
      variableBehaviors: 0,
      hypotheses: 0,
    });
    const over: InterviewNotes = {
      ...emptyInterviewNotes(),
      stakeholders: Array.from({ length: MAX_STAKEHOLDERS + 2 }, (_, i) => ({
        name: `人${i}`,
        concerns: [],
      })),
      variableCandidates: Array.from(
        { length: MAX_VARIABLE_CANDIDATES + 1 },
        (_, i) => ({ name: `v${i}`, source: null }),
      ),
    };
    expect(countCapDropped(over)).toEqual({
      stakeholders: 2,
      variableCandidates: 1,
      variableBehaviors: 0,
      hypotheses: 0,
    });
  });
});
