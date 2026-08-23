import type { Loop } from "@/lib/diagram/loops";
import {
  BEHAVIOR_PATTERN_LABELS,
  type BehaviorPattern,
  type InterviewNotes,
} from "./notes";

/**
 * 時間挙動（BOT）と図の構造の整合判定。
 * 「増え続けているなら R があるはず」「振動しているなら遅れ付き B があるはず」のような
 * システム思考の定石を、テーマ全体（notes.behavior）と変数ごと（notes.variableBehaviors）
 * に当てて、期待する構造 / 見つかった構造 / 探り方を返す。保存せず毎回導出する。
 */
export type ConsistencyCheck = {
  /** null = テーマ全体の挙動。文字列 = その変数の挙動 */
  variable: string | null;
  pattern: BehaviorPattern;
  /** 構造から期待される要素 */
  expected: string;
  /** 図に実際にあるもの */
  found: string;
  consistent: boolean;
  /** 不整合のときの探り方（整合なら空文字） */
  hint: string;
};

/** 表記ゆれを吸収した照合キー（notes.ts の mergeKey と同じ規則） */
function nameKey(name: string) {
  return name.trim().normalize("NFKC").toLowerCase();
}

function labels(loops: readonly Loop[]) {
  return loops.length > 0 ? loops.map((l) => l.label).join(", ") : "なし";
}

/**
 * パターンごとの期待構造と判定。scope は文言用（「図に」/「この変数を通る」）
 */
function judge(
  pattern: BehaviorPattern,
  loops: readonly Loop[],
  scope: string,
): Omit<ConsistencyCheck, "variable" | "pattern"> | null {
  const r = loops.filter((l) => l.polarity === "R");
  const b = loops.filter((l) => l.polarity === "B");
  const delayedB = b.filter((l) => l.hasDelay);

  switch (pattern) {
    case "increasing":
    case "decreasing": {
      const ok = r.length > 0;
      return {
        expected: `${scope}自己強化（R）ループ`,
        found: `R: ${labels(r)}`,
        consistent: ok,
        hint: ok
          ? ""
          : "変化を駆動し続けている強化構造がまだ描けていない可能性が高い。「何がこの変化をさらに加速させていますか?」と探る",
      };
    }
    case "oscillating": {
      const ok = delayedB.length > 0;
      return {
        expected: `${scope}遅れを含むバランス（B）ループ`,
        found:
          delayedB.length > 0
            ? `遅れ付き B: ${labels(delayedB)}`
            : b.length > 0
              ? `B: ${labels(b)}（いずれも遅れなし）`
              : "B: なし",
        consistent: ok,
        hint: ok
          ? ""
          : b.length > 0
            ? "振動は調整の効果が遅れて現れるときに起きる。B ループのどのリンクに時間差があるか（hasDelay）を確かめる"
            : "振動を生む遅れ付きのバランス（B）ループが図にない。対処や調整の効果が現れるまでに時間差がないかを探る",
      };
    }
    case "plateau": {
      const ok = b.length > 0;
      return {
        expected: `${scope}バランス（B）ループ（成長を抑えている限界）`,
        found: `B: ${labels(b)}`,
        consistent: ok,
        hint: ok
          ? ""
          : "頭打ちは何かの限界に当たっている印。「何が伸びを止めていますか?」と、抑制している要因を探る",
      };
    }
    case "improved-then-worse": {
      const ok = r.length > 0 && b.length > 0;
      return {
        expected: `${scope}対処の B ループと、副作用の R ループの両方`,
        found: `R: ${labels(r)} / B: ${labels(b)}`,
        consistent: ok,
        hint: ok
          ? ""
          : "一度良くなって悪化するのは、対処（B）の副作用が遅れて効く構造（応急処置の失敗）の典型。対処が何を犠牲にしたかを探る",
      };
    }
    case "other":
      return null;
  }
}

/**
 * テーマ全体と変数ごとの整合判定を返す。判定できないパターン（other）は含めない。
 * 変数ごとの判定は、その変数名を通るループだけを母集合にする
 */
export function checkBehaviorConsistency(
  notes: Pick<InterviewNotes, "behavior" | "variableBehaviors">,
  loops: readonly Loop[],
): ConsistencyCheck[] {
  const checks: ConsistencyCheck[] = [];

  if (notes.behavior) {
    const result = judge(notes.behavior.pattern, loops, "図に");
    if (result) {
      checks.push({
        variable: null,
        pattern: notes.behavior.pattern,
        ...result,
      });
    }
  }

  for (const vb of notes.variableBehaviors) {
    const key = nameKey(vb.name);
    const through = loops.filter((l) =>
      l.nodeNames.some((n) => nameKey(n) === key),
    );
    const result = judge(vb.pattern, through, `「${vb.name}」を通る`);
    if (result) {
      checks.push({ variable: vb.name, pattern: vb.pattern, ...result });
    }
  }

  return checks;
}

/** agenda / パネル向けの一文（不整合のものだけ使う想定） */
export function describeInconsistency(check: ConsistencyCheck): string {
  const subject =
    check.variable === null ? "実際の挙動" : `変数「${check.variable}」の挙動`;
  return `${subject}は「${BEHAVIOR_PATTERN_LABELS[check.pattern]}」なのに、${check.expected}がない（${check.found}）。${check.hint}`;
}
