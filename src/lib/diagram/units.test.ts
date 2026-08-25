import { describe, expect, it } from "vitest";
import { formatRate, normalizeQuantity, parseUnit } from "./units";

describe("parseUnit", () => {
  it("スラッシュ区切りは率として読む", () => {
    expect(parseUnit("時間/日")).toEqual({
      quantity: "時間",
      per: { canonical: "日", raw: "日" },
    });
    expect(parseUnit("人/月")).toEqual({
      quantity: "人",
      per: { canonical: "月", raw: "月" },
    });
    expect(parseUnit("件/週")).toEqual({
      quantity: "件",
      per: { canonical: "週", raw: "週" },
    });
  });

  it("分母を持たない単位は時点量として読む", () => {
    expect(parseUnit("時間")).toEqual({ quantity: "時間" });
    expect(parseUnit("人")).toEqual({ quantity: "人" });
    expect(parseUnit("円")).toEqual({ quantity: "円" });
  });

  it("全角スラッシュ・前後の空白を吸収する", () => {
    expect(parseUnit(" 時間 ／ 日 ")).toEqual({
      quantity: "時間",
      per: { canonical: "日", raw: "日" },
    });
  });

  it("英語の単位と per 区切りを読む", () => {
    expect(parseUnit("hours/day")).toEqual({
      quantity: "hours",
      per: { canonical: "日", raw: "day" },
    });
    expect(parseUnit("people per month")).toEqual({
      quantity: "people",
      per: { canonical: "月", raw: "month" },
    });
  });

  it("分母の表記ゆれ（大文字・複数形・略記）を同じ時間単位に寄せる", () => {
    expect(parseUnit("件/Days")?.per?.canonical).toBe("日");
    expect(parseUnit("件/hrs")?.per?.canonical).toBe("時");
    expect(parseUnit("件/ヶ月")?.per?.canonical).toBe("月");
    // raw は図に書かれたままを保つ（message で見せ返すため）
    expect(parseUnit("件/Days")?.per?.raw).toBe("Days");
  });

  it("分母が時間単位でなければ判定対象外にする", () => {
    expect(parseUnit("円/人")).toBeNull();
    expect(parseUnit("件/店舗")).toBeNull();
  });

  it("区切りが 2 つ以上ある単位は読まない", () => {
    expect(parseUnit("m/s/s")).toBeNull();
  });

  it("空・記号だけ・分子の無い単位は読まない", () => {
    expect(parseUnit(null)).toBeNull();
    expect(parseUnit(undefined)).toBeNull();
    expect(parseUnit("")).toBeNull();
    expect(parseUnit("   ")).toBeNull();
    expect(parseUnit("-")).toBeNull();
    expect(parseUnit("/日")).toBeNull();
  });

  it("% は量として扱う", () => {
    expect(parseUnit("%/年")).toEqual({
      quantity: "%",
      per: { canonical: "年", raw: "年" },
    });
  });
});

describe("normalizeQuantity", () => {
  it("全角・大文字・空白・英語の複数形を吸収する", () => {
    expect(normalizeQuantity("Points")).toBe(normalizeQuantity("point"));
    expect(normalizeQuantity("ＰＯＩＮＴ")).toBe(normalizeQuantity("point"));
    expect(normalizeQuantity("man hours")).toBe(normalizeQuantity("manhours"));
  });

  it("ss で終わる語の s は落とさない", () => {
    expect(normalizeQuantity("loss")).toBe("loss");
  });

  it("違う量は違うまま", () => {
    expect(normalizeQuantity("ポイント")).not.toBe(normalizeQuantity("回"));
  });
});

describe("formatRate", () => {
  it("率の見本を組む", () => {
    expect(formatRate("ポイント", "日")).toBe("ポイント/日");
  });
});
