import { z } from "zod";
import { NODE_KINDS } from "@/db/schema";

/**
 * AI が出力する因果ループ図の差分。
 * ノードは ID ではなく「名前」で参照する。新規ノードとそこへ張るエッジを
 * 同一 diff 内で表現でき、AI に ID を生成させずに済む。
 * 名前 → ID の解決とバリデーションはサーバ側（apply-diff）で決定的に行う。
 */
export const diagramDiffSchema = z.object({
  upsertNodes: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .describe(
            "変数名。増減を語れる中立的な名詞句（例: 残業時間、信頼）。動詞や「増加/減少」を含めない",
          ),
        memo: z
          .string()
          .optional()
          .describe("変数の補足説明（任意。ユーザーの文脈での意味）"),
        unit: z
          .string()
          .optional()
          .describe("単位（任意。例: 時間/週、人、円）。わかる場合のみ"),
        kind: z
          .enum(NODE_KINDS)
          .nullable()
          .optional()
          .describe(
            "ストック&フロー化の役割。stock=溜まる量 / flow=stock を変える速度 / auxiliary=途中計算 / constant=固定パラメータ。CLD のままなら指定しない（null で未分類に戻す）",
          ),
        expression: z
          .string()
          .optional()
          .describe(
            "flow / auxiliary の計算式。四則演算（+ - * /）と既存の変数名のみ。関数・べき乗は不可。変数名は図にある名前を正確に書く（例: 残高 * 0.05）。stock / constant では使わない",
          ),
        initialValue: z
          .number()
          .nullable()
          .optional()
          .describe("stock の初期値（t=0 の量）。stock のときに付ける"),
        value: z
          .number()
          .nullable()
          .optional()
          .describe("constant の固定値。constant のときに付ける"),
      }),
    )
    .default([])
    .describe(
      "追加または更新する変数。同名の変数があれば memo/unit を更新する。ストック&フロー化のときは kind と式/初期値/定数値も指定する",
    ),
  deleteNodes: z
    .array(z.string().min(1))
    .default([])
    .describe("削除する変数の名前。その変数に接続するリンクも一緒に消える"),
  upsertEdges: z
    .array(
      z.object({
        source: z.string().min(1).describe("原因側の変数名"),
        target: z.string().min(1).describe("結果側の変数名"),
        polarity: z
          .enum(["+", "-"])
          .describe(
            "+: 原因が増えると結果も増える（同方向）/ -: 原因が増えると結果は減る（逆方向）",
          ),
        hasDelay: z
          .boolean()
          .optional()
          .describe("因果が効くまでに目立った時間遅れがある場合 true"),
        rationale: z
          .string()
          .min(1)
          .describe(
            "なぜ因果と言えるかの根拠。ユーザーの発言を引用または要約する。相関しか確認できていないなら因果リンクにしない",
          ),
      }),
    )
    .default([])
    .describe(
      "追加または更新する因果リンク。同じ source→target のリンクがあれば極性・遅れ・根拠を更新する",
    ),
  deleteEdges: z
    .array(
      z.object({
        source: z.string().min(1),
        target: z.string().min(1),
      }),
    )
    .default([])
    .describe("削除する因果リンク（source→target の変数名ペア）"),
});

export type DiagramDiff = z.infer<typeof diagramDiffSchema>;
