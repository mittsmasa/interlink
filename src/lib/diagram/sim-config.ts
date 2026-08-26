import { z } from "zod";

/**
 * プロジェクトに保存するシミュレーション設定（`projects.sim_config` の JSON）。
 *
 * `simulate.ts` の `SimConfig` は 1 回の実行に渡す引数（overrides や delaySteps を含む
 * 使い捨ての設定）で、こちらは「この問いをどの時間軸で眺めるか」という**保存される決め事**。
 * 名前が紛らわしいので型名を `SimConfigRecord` と分けている。
 *
 * doc（m3-stock-and-flow.md 7 章）は当初「dt / steps は永続化しない」としていたが、
 * 8 章 Open Questions の「dt / steps の永続化」を実装してここへ移した。UI の入力欄と
 * MCP の run_simulation / compare_scenarios が同じ既定値を見るようになる。
 */

export const DEFAULT_SIM_DT = 1;
export const DEFAULT_SIM_STEPS = 20;
/** 1 回の呼び出しで回せるステップ数の上限（応答肥大・計算時間の歯止め） */
export const MAX_SIM_STEPS = 1000;
/** 時間単位の文字列長の上限（「週」「四半期」程度を想定） */
export const MAX_TIME_UNIT_LENGTH = 20;

export const simConfigRecordSchema = z.object({
  dt: z.number().positive().finite().default(DEFAULT_SIM_DT),
  steps: z.number().int().min(1).max(MAX_SIM_STEPS).default(DEFAULT_SIM_STEPS),
  /**
   * 1 ステップが何を表すか（週 / 月 …）。表示と対話のためのラベルで、計算には使わない。
   * 聞き取りノートの timeHorizon.unit（ユーザーが問題を語るときの時間粒度）とは別物で、
   * こちらは「シミュレーションの 1 ステップの意味」。多くの場合は前者を叩き台に決まる
   */
  timeUnit: z.string().nullable().default(null),
});

export type SimConfigRecord = z.infer<typeof simConfigRecordSchema>;

export function defaultSimConfig(): SimConfigRecord {
  return {
    dt: DEFAULT_SIM_DT,
    steps: DEFAULT_SIM_STEPS,
    timeUnit: null,
  };
}

/** 時間単位の正規化。空白のみは未設定に倒し、長すぎる入力は切り詰める */
function normalizeTimeUnit(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, MAX_TIME_UNIT_LENGTH);
}

/**
 * DB の JSON 文字列から設定を復元する。null・壊れた JSON・形不一致・範囲外は既定値。
 * 図の導出物（ループ / lint）と同じく「読めなければ既定に倒す」方針で、
 * 設定 1 つの不備で画面や MCP 応答を落とさない
 */
export function parseSimConfig(raw: string | null): SimConfigRecord {
  if (!raw) return defaultSimConfig();
  try {
    const result = simConfigRecordSchema.safeParse(JSON.parse(raw));
    if (!result.success) return defaultSimConfig();
    return {
      ...result.data,
      timeUnit: normalizeTimeUnit(result.data.timeUnit),
    };
  } catch {
    return defaultSimConfig();
  }
}

/**
 * 部分更新をマージする。undefined のキーは既存を保つ（dt だけ変えたい呼び出しに応える）。
 * timeUnit は null を明示的に渡せば未設定へ戻せる
 */
export function mergeSimConfig(
  base: SimConfigRecord,
  patch: Partial<SimConfigRecord>,
): SimConfigRecord {
  const merged = {
    dt: patch.dt ?? base.dt,
    steps: patch.steps ?? base.steps,
    timeUnit: patch.timeUnit === undefined ? base.timeUnit : patch.timeUnit,
  };
  const result = simConfigRecordSchema.safeParse(merged);
  if (!result.success) return base;
  return { ...result.data, timeUnit: normalizeTimeUnit(result.data.timeUnit) };
}

/** 保存用の JSON 文字列にする */
export function serializeSimConfig(config: SimConfigRecord): string {
  return JSON.stringify(config);
}
