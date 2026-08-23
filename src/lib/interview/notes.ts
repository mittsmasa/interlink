import { z } from "zod";

/**
 * 聞き取りノート — AI が updateNotes ツールで維持する構造化メモ。
 * 5 フェーズ聞き取り（時間軸 → 関係者 → 変数抽出 → 因果 → 仮説）の
 * 発散側の受け皿で、図に置く前の材料をここに貯める。
 * projects.interview_notes に JSON 文字列で保存する。
 */

/**
 * 保持件数の上限。プロンプト表示と保存の両方で同じ値を使う。
 * チャットの updateNotes は全置換方式のため、モデルはプロンプトに表示された
 * ノートを元に次のペイロードを再構成する。表示だけ打ち切ると超過分が置換の
 * たびに静かに消えるので、「表示 = モデルが echo する全件 = 保存件数」を
 * 一致させ、上限超過分は仕様として保持しない。落ちた件数は countCapDropped
 * で数えて応答に載せる（MCP の update_notes）。
 */
export const MAX_STAKEHOLDERS = 8;
export const MAX_VARIABLE_CANDIDATES = 15;
export const MAX_HYPOTHESES = 8;
export const MAX_VARIABLE_BEHAVIORS = 10;

/** 時間挙動（BOT graph のテキスト版）のパターン分類 */
export const BEHAVIOR_PATTERNS = [
  "increasing",
  "decreasing",
  "oscillating",
  "plateau",
  "improved-then-worse",
  "other",
] as const;
export type BehaviorPattern = (typeof BEHAVIOR_PATTERNS)[number];

export const BEHAVIOR_PATTERN_LABELS: Record<BehaviorPattern, string> = {
  increasing: "増え続けている",
  decreasing: "減り続けている",
  oscillating: "振動している",
  plateau: "頭打ち",
  "improved-then-worse": "一度良くなって悪化",
  other: "その他",
};

/** 介入仮説の検証状態。proposed = 立てただけ / tested = 試して効果が見えた / rejected = 試して棄却 */
export const HYPOTHESIS_STATUSES = ["proposed", "tested", "rejected"] as const;
export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];

export const HYPOTHESIS_STATUS_LABELS: Record<HypothesisStatus, string> = {
  proposed: "仮説",
  tested: "検証済み",
  rejected: "棄却",
};

const behaviorPatternSchema = z.enum(BEHAVIOR_PATTERNS);

export const interviewNotesSchema = z.object({
  theme: z
    .string()
    .nullable()
    .default(null)
    .describe("ユーザーが困っているテーマ（一文）"),
  behavior: z
    .object({
      pattern: behaviorPatternSchema,
      description: z.string().describe("挙動の説明（いつから・どんな形か）"),
    })
    .nullable()
    .default(null)
    .describe("テーマの時間挙動。出来事ではなく変化のパターン"),
  idealBehavior: z
    .string()
    .nullable()
    .default(null)
    .describe("理想的にはどう推移してほしいか"),
  stakeholders: z
    .array(
      z.object({
        name: z.string(),
        concerns: z.array(z.string()).describe("その人が望むこと・恐れること"),
      }),
    )
    .default([])
    .describe("問題に関わる人・組織と関心事"),
  variableCandidates: z
    .array(
      z.object({
        name: z.string().describe("増減を語れる名詞句"),
        source: z
          .string()
          .nullable()
          .default(null)
          .describe("由来ステークホルダ名"),
      }),
    )
    .default([])
    .describe("図に置く前の変数候補プール"),
  confirmedLoopIds: z
    .array(z.string())
    .default([])
    .describe("ユーザーが実感を確認済みのループ ID"),
  timeHorizon: z
    .object({
      from: z.string().describe("いつから（例: 2024-04、半年前）"),
      to: z.string().describe("いつまで（例: 現在、来年度末）"),
      unit: z.string().describe("語られている時間の粒度（例: 週、月、四半期）"),
    })
    .nullable()
    .default(null)
    .describe(
      "問題を眺める時間軸。挙動の期間とシミュレーションの時間単位の手がかり",
    ),
  variableBehaviors: z
    .array(
      z.object({
        name: z.string().describe("図の変数名（一致させる）"),
        pattern: behaviorPatternSchema,
        description: z.string().describe("その変数の推移の説明"),
      }),
    )
    .default([])
    .describe(
      "変数ごとの時間挙動（BOT）。テーマ全体の behavior とは別に、個別の変数がどう推移したか",
    ),
  hypotheses: z
    .array(
      z.object({
        leveragePoint: z.string().describe("手を入れる場所（変数名やリンク）"),
        expectedEffect: z
          .string()
          .describe("そこに手を入れると何が起きると考えたか"),
        loopIds: z.array(z.string()).default([]).describe("関係するループ ID"),
        status: z.enum(HYPOTHESIS_STATUSES).default("proposed"),
      }),
    )
    .default([])
    .describe(
      "介入仮説。insight フェーズで立て、シミュレーションの overrides 等で試した結果を status に反映する",
    ),
});

export type InterviewNotes = z.infer<typeof interviewNotesSchema>;

export function emptyInterviewNotes(): InterviewNotes {
  return {
    theme: null,
    behavior: null,
    idealBehavior: null,
    stakeholders: [],
    variableCandidates: [],
    confirmedLoopIds: [],
    timeHorizon: null,
    variableBehaviors: [],
    hypotheses: [],
  };
}

/** 保持件数の上限を適用する。保存とプロンプト表示の前に必ず通す */
export function capInterviewNotes(notes: InterviewNotes): InterviewNotes {
  return {
    ...notes,
    stakeholders: notes.stakeholders.slice(0, MAX_STAKEHOLDERS),
    variableCandidates: notes.variableCandidates.slice(
      0,
      MAX_VARIABLE_CANDIDATES,
    ),
    variableBehaviors: notes.variableBehaviors.slice(0, MAX_VARIABLE_BEHAVIORS),
    hypotheses: notes.hypotheses.slice(0, MAX_HYPOTHESES),
  };
}

/** cap で落ちる件数（保存前に数えて応答へ載せる） */
export function countCapDropped(notes: InterviewNotes) {
  return {
    stakeholders: Math.max(0, notes.stakeholders.length - MAX_STAKEHOLDERS),
    variableCandidates: Math.max(
      0,
      notes.variableCandidates.length - MAX_VARIABLE_CANDIDATES,
    ),
    variableBehaviors: Math.max(
      0,
      notes.variableBehaviors.length - MAX_VARIABLE_BEHAVIORS,
    ),
    hypotheses: Math.max(0, notes.hypotheses.length - MAX_HYPOTHESES),
  };
}

/** 配列要素の照合キー（表記ゆれを吸収） */
function mergeKey(name: string) {
  return name.trim().normalize("NFKC").toLowerCase();
}

/** 重複を除いて後ろへ足す（先勝ち、順序維持） */
function unionBy<T>(base: T[], patch: T[], key: (item: T) => string): T[] {
  const out = [...base];
  const seen = new Set(base.map(key));
  for (const item of patch) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/**
 * append モードのマージ。スカラー（theme / behavior / idealBehavior）は
 * patch が非 null のときだけ上書きし、配列は union にする。
 * stakeholders は同名なら concerns を union、variableCandidates は同名なら
 * 既存を保持（source は既存が null のときだけ補う）。
 * variableBehaviors は同名なら patch で上書き（最新の観察が勝つ）、hypotheses は
 * 同じ leveragePoint なら expectedEffect / status を patch で上書きし loopIds を union
 * （検証の進捗を反映できるように）。cap はここでは適用しない
 */
export function mergeInterviewNotes(
  base: InterviewNotes,
  patch: InterviewNotes,
): InterviewNotes {
  const stakeholders = base.stakeholders.map((s) => ({
    ...s,
    concerns: [...s.concerns],
  }));
  const stakeholderByKey = new Map(
    stakeholders.map((s) => [mergeKey(s.name), s]),
  );
  for (const s of patch.stakeholders) {
    const existing = stakeholderByKey.get(mergeKey(s.name));
    if (existing) {
      existing.concerns = unionBy(existing.concerns, s.concerns, mergeKey);
    } else {
      const added = { ...s, concerns: [...s.concerns] };
      stakeholders.push(added);
      stakeholderByKey.set(mergeKey(s.name), added);
    }
  }

  const variableCandidates = base.variableCandidates.map((v) => ({ ...v }));
  const candidateByKey = new Map(
    variableCandidates.map((v) => [mergeKey(v.name), v]),
  );
  for (const v of patch.variableCandidates) {
    const existing = candidateByKey.get(mergeKey(v.name));
    if (existing) {
      if (existing.source === null && v.source !== null) {
        existing.source = v.source;
      }
    } else {
      const added = { ...v };
      variableCandidates.push(added);
      candidateByKey.set(mergeKey(v.name), added);
    }
  }

  const variableBehaviors = base.variableBehaviors.map((v) => ({ ...v }));
  const behaviorByKey = new Map(
    variableBehaviors.map((v) => [mergeKey(v.name), v]),
  );
  for (const v of patch.variableBehaviors) {
    const existing = behaviorByKey.get(mergeKey(v.name));
    if (existing) {
      existing.pattern = v.pattern;
      existing.description = v.description;
    } else {
      const added = { ...v };
      variableBehaviors.push(added);
      behaviorByKey.set(mergeKey(v.name), added);
    }
  }

  const hypotheses = base.hypotheses.map((h) => ({
    ...h,
    loopIds: [...h.loopIds],
  }));
  const hypothesisByKey = new Map(
    hypotheses.map((h) => [mergeKey(h.leveragePoint), h]),
  );
  for (const h of patch.hypotheses) {
    const existing = hypothesisByKey.get(mergeKey(h.leveragePoint));
    if (existing) {
      existing.expectedEffect = h.expectedEffect;
      existing.status = h.status;
      existing.loopIds = unionBy(existing.loopIds, h.loopIds, (id) => id);
    } else {
      const added = { ...h, loopIds: [...h.loopIds] };
      hypotheses.push(added);
      hypothesisByKey.set(mergeKey(h.leveragePoint), added);
    }
  }

  return {
    theme: patch.theme ?? base.theme,
    behavior: patch.behavior ?? base.behavior,
    idealBehavior: patch.idealBehavior ?? base.idealBehavior,
    stakeholders,
    variableCandidates,
    confirmedLoopIds: unionBy(
      base.confirmedLoopIds,
      patch.confirmedLoopIds,
      (id) => id,
    ),
    timeHorizon: patch.timeHorizon ?? base.timeHorizon,
    variableBehaviors,
    hypotheses,
  };
}

/** DB の JSON 文字列からノートを復元する。null・壊れた JSON・形不一致は空ノート扱い */
export function parseInterviewNotes(raw: string | null): InterviewNotes {
  if (!raw) return emptyInterviewNotes();
  try {
    const result = interviewNotesSchema.safeParse(JSON.parse(raw));
    return result.success
      ? capInterviewNotes(result.data)
      : emptyInterviewNotes();
  } catch {
    return emptyInterviewNotes();
  }
}
