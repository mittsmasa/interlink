/**
 * 単位文字列の軽量パーサ。stock / flow の単位整合（lint.ts）のためだけに使う。
 *
 * unit は自由文字列で、ユーザーも AI も表記を揃えてくれない。読めない表記は黙って
 * null（判定対象外）にして、確実に言えるときだけ lint を出す。誤検知を出さないことを優先する。
 *
 * 対応するのは「時間/日」「人/月」のスラッシュ区切りの率と、「時間」「人」「円」の時点量だけ。
 * 分母が時間単位でないもの（「円/人」など）は率ではあっても「時間あたり」ではないので
 * 判定対象外にする。
 */

const CANONICAL_TIME_UNITS = [
  "秒",
  "分",
  "時",
  "日",
  "週",
  "月",
  "四半期",
  "年",
] as const;

export type CanonicalTimeUnit = (typeof CANONICAL_TIME_UNITS)[number];

export type TimeUnit = {
  canonical: CanonicalTimeUnit;
  /** 図に書かれていたままの表記（message で見せ返すため） */
  raw: string;
};

export type ParsedUnit = {
  /** 分子。時点量ならこれだけを持つ */
  quantity: string;
  /** 分母の時間単位。持つなら率（flow の単位になりうる） */
  per?: TimeUnit;
};

/**
 * 日本語と英語の代表的な時間単位だけを持つ小さな辞書。
 * キーは normalizeToken 済みの形（小文字・複数形を落とした形）で引く
 */
const TIME_UNITS: Record<string, CanonicalTimeUnit> = {
  秒: "秒",
  s: "秒",
  sec: "秒",
  second: "秒",
  分: "分",
  min: "分",
  minute: "分",
  時: "時",
  時間: "時",
  h: "時",
  hr: "時",
  hour: "時",
  日: "日",
  day: "日",
  週: "週",
  週間: "週",
  wk: "週",
  week: "週",
  月: "月",
  ヶ月: "月",
  か月: "月",
  mo: "月",
  month: "月",
  四半期: "四半期",
  quarter: "四半期",
  年: "年",
  年間: "年",
  yr: "年",
  year: "年",
};

/**
 * 比較のための正規化。全角/半角・大文字小文字・空白・英語の複数形を吸収する。
 * 「loss」のような ss 終わりを削らないよう、直前が s でないときだけ複数形の s を落とす
 */
export function normalizeQuantity(quantity: string): string {
  const text = quantity.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  if (/^[a-z]{3,}$/.test(text) && /[^s]s$/.test(text)) {
    return text.slice(0, -1);
  }
  return text;
}

/** 単位として意味を持つ文字（文字・数字・%）を 1 つでも含むか */
function hasSubstance(text: string): boolean {
  return /[\p{L}\p{N}%]/u.test(text);
}

function lookupTimeUnit(denominator: string): CanonicalTimeUnit | undefined {
  return TIME_UNITS[normalizeQuantity(denominator)];
}

/**
 * 単位文字列を `{ quantity, per? }` に正規化する。読めなければ null。
 *
 * - 「時間/日」→ `{ quantity: "時間", per: { canonical: "日", raw: "日" } }`
 * - 「ポイント」→ `{ quantity: "ポイント" }`
 * - 「円/人」→ null（分母が時間単位でない）
 * - 「m/s/s」→ null（区切りが 2 つ以上）
 */
export function parseUnit(raw: string | null | undefined): ParsedUnit | null {
  if (!raw) return null;
  // NFKC で全角スラッシュ「／」も半角に寄る。英語の "per" は区切りとして扱う
  const text = raw
    .normalize("NFKC")
    .replace(/\s+per\s+/gi, "/")
    .trim();
  const parts = text.split("/");
  if (parts.length > 2) return null;

  const quantity = parts[0].trim();
  if (!hasSubstance(quantity)) return null;
  if (parts.length === 1) return { quantity };

  const denominator = parts[1].trim();
  const canonical = lookupTimeUnit(denominator);
  if (!canonical) return null;
  return { quantity, per: { canonical, raw: denominator } };
}

/** 「ポイント/日」のような率の見本を組む（lint の message で「どう直すか」を見せるため） */
export function formatRate(quantity: string, per: string): string {
  return `${quantity}/${per}`;
}
