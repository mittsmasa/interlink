import { describe, expect, it } from "vitest";
import type { Loop } from "@/lib/diagram/loops";
import {
  buildInterviewSystemPrompt,
  buildVerificationPromptSection,
  type DiagramVerification,
} from "./interview";

const loop = (n: number, polarity: Loop["polarity"] = "R"): Loop => ({
  id: `loop:${n}`,
  label: `${polarity}${n}`,
  nodeIds: [`a${n}`, `b${n}`],
  nodeNames: [`変数A${n}`, `変数B${n}`],
  edgeIds: [`e${n}-1`, `e${n}-2`],
  polarity,
  hasDelay: false,
});

const emptyVerification: DiagramVerification = {
  loopResult: { loops: [], truncated: false },
  findings: [],
  matches: [],
};

describe("buildVerificationPromptSection", () => {
  it("ループがなければその旨を伝える", () => {
    const text = buildVerificationPromptSection(emptyVerification);
    expect(text).toContain("まだ閉じたループはありません");
    expect(text).not.toContain("気になる点");
    expect(text).not.toContain("似ているシステム原型");
  });

  it("ループは上位 10 件に制限され、省略件数が示される", () => {
    const loops = Array.from({ length: 12 }, (_, i) => loop(i + 1));
    const text = buildVerificationPromptSection({
      ...emptyVerification,
      loopResult: { loops, truncated: false },
    });
    expect(text).toContain("R1（自己強化）: 変数A1 → 変数B1 → 変数A1");
    expect(text).toContain("R10");
    expect(text).not.toContain("R11");
    expect(text).toContain("2 件以上省略");
  });

  it("lint 指摘は上位 5 件に制限される", () => {
    const findings = Array.from({ length: 7 }, (_, i) => ({
      rule: "isolated-node" as const,
      severity: "info" as const,
      message: `指摘その${i + 1}`,
      nodeIds: [`n${i}`],
    }));
    const text = buildVerificationPromptSection({
      ...emptyVerification,
      findings,
    });
    expect(text).toContain("指摘その5");
    expect(text).not.toContain("指摘その6");
    expect(text).toContain("…ほか 2 件");
  });

  it("一致原型がなければ「似ているシステム原型」の節を出さない", () => {
    const text = buildVerificationPromptSection({
      ...emptyVerification,
      loopResult: { loops: [loop(1)], truncated: false },
    });
    expect(text).not.toContain("似ているシステム原型");
  });

  it("一致原型があれば名前と確認の問いを含む", () => {
    const text = buildVerificationPromptSection({
      ...emptyVerification,
      matches: [
        {
          archetypeId: "limits-to-growth",
          name: "成功の限界",
          description:
            "成長の自己強化ループを、制約のバランスループが抑える構造",
          question:
            "R1 の成長を B1 が抑えているなら、制約になっているものは何でしょう?",
          loopIds: ["loop:1", "loop:2"],
        },
      ],
    });
    expect(text).toContain("「成功の限界」");
    expect(text).toContain("制約になっているもの");
  });
});

describe("buildInterviewSystemPrompt", () => {
  it("検証セクションと検証の進め方を含む", () => {
    const prompt = buildInterviewSystemPrompt(
      { nodes: [], edges: [] },
      emptyVerification,
    );
    expect(prompt).toContain("## 図の検証");
    expect(prompt).toContain("## 検証の進め方");
    expect(prompt).toContain("### 現在のループ");
  });
});
