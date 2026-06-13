import { z } from "zod";

/**
 * 聞き取りノート — AI が updateNotes ツールで維持する構造化メモ。
 * 5 フェーズ聞き取り（時間軸 → 関係者 → 変数抽出 → 因果 → 仮説）の
 * 発散側の受け皿で、図に置く前の材料をここに貯める。
 * projects.interview_notes に JSON 文字列で保存する。
 */

/**
 * 保持件数の上限。プロンプト表示と保存の両方で同じ値を使う。
 * updateNotes は全置換方式のため、モデルはプロンプトに表示されたノートを
 * 元に次のペイロードを再構成する。表示だけ打ち切ると超過分が置換のたびに
 * 静かに消えるので、「表示 = モデルが echo する全件 = 保存件数」を一致させ、
 * 上限超過分は仕様として保持しない。
 */
export const MAX_STAKEHOLDERS = 8;
export const MAX_VARIABLE_CANDIDATES = 15;

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

export const interviewNotesSchema = z.object({
  theme: z
    .string()
    .nullable()
    .default(null)
    .describe("ユーザーが困っているテーマ（一文）"),
  behavior: z
    .object({
      pattern: z.enum(BEHAVIOR_PATTERNS),
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
