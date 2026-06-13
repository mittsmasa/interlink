import { describe, expect, it } from "vitest";
import {
  capInterviewNotes,
  emptyInterviewNotes,
  type InterviewNotes,
  MAX_STAKEHOLDERS,
  MAX_VARIABLE_CANDIDATES,
  parseInterviewNotes,
} from "./notes";

const fullNotes: InterviewNotes = {
  theme: "残業が減らない",
  behavior: { pattern: "increasing", description: "半年前から増え続けている" },
  idealBehavior: "横ばいに落ち着いてほしい",
  stakeholders: [{ name: "自分", concerns: ["睡眠を確保したい"] }],
  variableCandidates: [{ name: "残業時間", source: "自分" }],
  confirmedLoopIds: ["loop:a→b"],
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
});
