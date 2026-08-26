import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIM_DT,
  DEFAULT_SIM_STEPS,
  defaultSimConfig,
  MAX_SIM_STEPS,
  MAX_TIME_UNIT_LENGTH,
  mergeSimConfig,
  parseSimConfig,
  serializeSimConfig,
} from "./sim-config";

describe("parseSimConfig", () => {
  it("null は既定値（dt=1 / steps=20 / 時間単位なし）", () => {
    expect(parseSimConfig(null)).toEqual({
      dt: DEFAULT_SIM_DT,
      steps: DEFAULT_SIM_STEPS,
      timeUnit: null,
    });
  });

  it("保存した値を復元する", () => {
    const raw = serializeSimConfig({ dt: 0.5, steps: 40, timeUnit: "週" });
    expect(parseSimConfig(raw)).toEqual({ dt: 0.5, steps: 40, timeUnit: "週" });
  });

  it("壊れた JSON は既定値", () => {
    expect(parseSimConfig("{ dt: ")).toEqual(defaultSimConfig());
  });

  it("形が違う JSON は既定値", () => {
    expect(parseSimConfig(JSON.stringify([1, 2, 3]))).toEqual(
      defaultSimConfig(),
    );
  });

  it("欠けたキーは既定値で埋める", () => {
    expect(parseSimConfig(JSON.stringify({ dt: 2 }))).toEqual({
      dt: 2,
      steps: DEFAULT_SIM_STEPS,
      timeUnit: null,
    });
  });

  it("範囲外（dt<=0 / steps 過大 / 非整数 steps）は既定値へ倒す", () => {
    expect(parseSimConfig(JSON.stringify({ dt: 0 }))).toEqual(
      defaultSimConfig(),
    );
    expect(parseSimConfig(JSON.stringify({ dt: -1 }))).toEqual(
      defaultSimConfig(),
    );
    expect(
      parseSimConfig(JSON.stringify({ steps: MAX_SIM_STEPS + 1 })),
    ).toEqual(defaultSimConfig());
    expect(parseSimConfig(JSON.stringify({ steps: 1.5 }))).toEqual(
      defaultSimConfig(),
    );
  });

  it("空白だけの時間単位は未設定に倒す", () => {
    expect(parseSimConfig(JSON.stringify({ timeUnit: "  " })).timeUnit).toBe(
      null,
    );
  });

  it("長すぎる時間単位は切り詰める", () => {
    const long = "あ".repeat(MAX_TIME_UNIT_LENGTH + 10);
    expect(parseSimConfig(JSON.stringify({ timeUnit: long })).timeUnit).toBe(
      "あ".repeat(MAX_TIME_UNIT_LENGTH),
    );
  });
});

describe("mergeSimConfig", () => {
  const base = { dt: 1, steps: 20, timeUnit: "週" };

  it("指定したキーだけ差し替える", () => {
    expect(mergeSimConfig(base, { steps: 50 })).toEqual({
      dt: 1,
      steps: 50,
      timeUnit: "週",
    });
  });

  it("timeUnit に null を渡せば未設定へ戻せる", () => {
    expect(mergeSimConfig(base, { timeUnit: null }).timeUnit).toBe(null);
  });

  it("timeUnit 未指定なら既存を保つ", () => {
    expect(mergeSimConfig(base, { dt: 2 }).timeUnit).toBe("週");
  });

  it("時間単位の前後の空白は落とす", () => {
    expect(mergeSimConfig(base, { timeUnit: " 四半期 " }).timeUnit).toBe(
      "四半期",
    );
  });

  it("不正な値のマージは元の設定を保つ（壊さない）", () => {
    expect(mergeSimConfig(base, { dt: 0 })).toEqual(base);
    expect(mergeSimConfig(base, { steps: MAX_SIM_STEPS + 1 })).toEqual(base);
  });
});
