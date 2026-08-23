import { describe, expect, it } from "vitest";
import type { Loop } from "@/lib/diagram/loops";
import { checkBehaviorConsistency, describeInconsistency } from "./consistency";
import { emptyInterviewNotes } from "./notes";

function loop(partial: Partial<Loop> & Pick<Loop, "id" | "label">): Loop {
  return {
    nodeIds: ["a", "b"],
    nodeNames: ["残業時間", "疲労"],
    edgeIds: [],
    polarity: "R",
    hasDelay: false,
    ...partial,
  };
}

const r1 = loop({ id: "loop:r", label: "R1" });
const b1 = loop({ id: "loop:b", label: "B1", polarity: "B" });
const b1Delayed = loop({ ...b1, hasDelay: true });

describe("checkBehaviorConsistency（テーマ全体）", () => {
  it("増え続け: R があれば整合、無ければ不整合と hint", () => {
    const notes = {
      ...emptyInterviewNotes(),
      behavior: { pattern: "increasing" as const, description: "-" },
    };
    expect(checkBehaviorConsistency(notes, [r1])[0]).toMatchObject({
      variable: null,
      consistent: true,
      found: "R: R1",
      hint: "",
    });
    const bad = checkBehaviorConsistency(notes, [b1])[0];
    expect(bad.consistent).toBe(false);
    expect(bad.found).toBe("R: なし");
    expect(bad.hint).toContain("加速");
  });

  it("振動: 遅れ付き B が要る。B はあるが遅れなしなら、その旨を found に書く", () => {
    const notes = {
      ...emptyInterviewNotes(),
      behavior: { pattern: "oscillating" as const, description: "-" },
    };
    expect(checkBehaviorConsistency(notes, [b1Delayed])[0].consistent).toBe(
      true,
    );
    const noDelay = checkBehaviorConsistency(notes, [b1])[0];
    expect(noDelay.consistent).toBe(false);
    expect(noDelay.found).toContain("遅れなし");
    expect(noDelay.hint).toContain("hasDelay");
    expect(checkBehaviorConsistency(notes, [r1])[0].found).toBe("B: なし");
  });

  it("頭打ち: B が要る / 一度良くなって悪化: R と B の両方が要る", () => {
    const plateau = {
      ...emptyInterviewNotes(),
      behavior: { pattern: "plateau" as const, description: "-" },
    };
    expect(checkBehaviorConsistency(plateau, [r1])[0].consistent).toBe(false);
    expect(checkBehaviorConsistency(plateau, [b1])[0].consistent).toBe(true);

    const fix = {
      ...emptyInterviewNotes(),
      behavior: { pattern: "improved-then-worse" as const, description: "-" },
    };
    expect(checkBehaviorConsistency(fix, [r1])[0].consistent).toBe(false);
    expect(checkBehaviorConsistency(fix, [r1, b1])[0].consistent).toBe(true);
  });

  it("other と未記録は判定しない", () => {
    expect(checkBehaviorConsistency(emptyInterviewNotes(), [r1])).toEqual([]);
    expect(
      checkBehaviorConsistency(
        {
          ...emptyInterviewNotes(),
          behavior: { pattern: "other", description: "-" },
        },
        [r1],
      ),
    ).toEqual([]);
  });
});

describe("checkBehaviorConsistency（変数ごと）", () => {
  it("その変数を通るループだけを母集合にする（表記ゆれは吸収）", () => {
    const notes = {
      ...emptyInterviewNotes(),
      variableBehaviors: [
        { name: " 疲労", pattern: "oscillating" as const, description: "-" },
        { name: "売上", pattern: "increasing" as const, description: "-" },
      ],
    };
    const farB = loop({
      id: "loop:far",
      label: "B2",
      polarity: "B",
      hasDelay: true,
      nodeNames: ["売上", "投資"],
    });
    const checks = checkBehaviorConsistency(notes, [b1Delayed, farB]);
    expect(checks).toHaveLength(2);
    expect(checks[0]).toMatchObject({
      variable: " 疲労",
      consistent: true,
      found: "遅れ付き B: B1",
    });
    // 売上を通る R は無い（B2 のみ）
    expect(checks[1]).toMatchObject({ variable: "売上", consistent: false });
    expect(checks[1].expected).toContain("「売上」を通る");
  });
});

describe("describeInconsistency", () => {
  it("主語・パターン・期待・実際・hint を一文にする", () => {
    const text = describeInconsistency({
      variable: "疲労",
      pattern: "oscillating",
      expected: "「疲労」を通る遅れを含むバランス（B）ループ",
      found: "B: なし",
      consistent: false,
      hint: "時間差を探る",
    });
    expect(text).toBe(
      "変数「疲労」の挙動は「振動している」なのに、「疲労」を通る遅れを含むバランス（B）ループがない（B: なし）。時間差を探る",
    );
  });
});
