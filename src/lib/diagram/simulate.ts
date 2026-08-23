import {
  type FunctionNode,
  type MathNode,
  type OperatorNode,
  parse,
  type SymbolNode,
} from "mathjs";

/**
 * シミュレーション用のノード役割。DB schema の NODE_KINDS と対応するが、
 * simulate は純粋関数なので DB 行ではなく必要 field だけ受ける（loops.ts と同思想）。
 */
export type SimNodeKind = "stock" | "flow" | "auxiliary" | "constant";

export type SimNode = {
  id: string;
  /** 式の中で参照される変数名。一意かつ有効な識別子であること */
  name: string;
  kind: SimNodeKind;
  /** flow / auxiliary が他ノードを参照して計算する式（mathjs 構文） */
  expression?: string | null;
  /** stock の初期値（t=0 の量） */
  initialValue?: number | null;
  /** constant の固定値 */
  value?: number | null;
};

export type SimEdge = {
  sourceNodeId: string;
  targetNodeId: string;
  /** flow → stock のとき + = 流入 / - = 流出 */
  polarity: "+" | "-";
};

export type SimConfig = {
  /** 時間刻み。> 0 */
  dt: number;
  /** 計算ステップ数。>= 1 */
  steps: number;
  /**
   * ノード名 → 値の上書き（what-if 用。図は変更しない）。
   * stock の initialValue と constant の value だけ許可し、flow / auxiliary や
   * 未知の名前は invalid-override エラーにする
   */
  overrides?: Record<string, number>;
  /** true なら stock を積分した直後に 0 でクランプし、負の量にならないようにする */
  nonNegativeStocks?: boolean;
};

export type SimErrorType =
  | "invalid-config"
  | "invalid-override"
  | "duplicate-name"
  | "invalid-identifier"
  | "missing-field"
  | "parse"
  | "disallowed"
  | "undefined-reference"
  | "cycle"
  | "eval"
  | "diverged";

export type SimError = {
  type: SimErrorType;
  message: string;
  /** 原因ノード（該当する場合） */
  nodeId?: string;
  /** 循環に関与したノード ID 列（type === "cycle"） */
  nodeIds?: string[];
  /** 未定義参照の変数名（type === "undefined-reference"） / 上書き対象の名前（invalid-override） */
  refName?: string;
  /** 発散を検出したステップ（type === "diverged"） */
  step?: number;
};

/** 1 ステップ分のスナップショット。t と各ノード名 → 値 */
export type SimSnapshot = { t: number } & Record<string, number>;

export type SimResult =
  | { ok: true; series: SimSnapshot[]; order: string[] }
  | { ok: false; error: SimError };

/**
 * 四則演算・べき乗・単項マイナス/プラスのみ許可（設計ノート 5 章: 評価モードを制限する）。
 * mathjs の OperatorNode.fn 名で判定する。`^` は関数 pow と同じ fn 名になる。
 */
const ALLOWED_OPERATOR_FNS = new Set([
  "add",
  "subtract",
  "multiply",
  "divide",
  "pow",
  "unaryMinus",
  "unaryPlus",
]);

/**
 * 式で呼べる関数のホワイトリスト。mathjs 組み込み（min / max / pow）に加え、
 * mathjs に無い clamp は評価 scope へ関数として渡す（SCOPE_FUNCTIONS）。
 * ユーザー定義関数・代入・行列など、ここに無いものは全て拒否する。
 */
export const ALLOWED_FUNCTIONS = ["min", "max", "clamp", "pow"] as const;
const ALLOWED_FUNCTION_SET: ReadonlySet<string> = new Set(ALLOWED_FUNCTIONS);

/** 許可される式の記法を一文で表した文言（エラーメッセージ / プロンプトで共用） */
export const EXPRESSION_SYNTAX_NOTE = `四則演算（+ - * /）・べき乗（^）・関数 ${ALLOWED_FUNCTIONS.join("/")} と変数参照のみ`;

/** mathjs 組み込みに無い関数を scope 経由で供給する */
const SCOPE_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
};

/**
 * 参照可能なノード名か。先頭は文字/_/$、以降は文字/数字/_/$。
 * \p{L} は CJK 統合漢字（疲労 など）も含むので日本語名も通る。
 */
export const IDENTIFIER_RE = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;

/**
 * 式中の識別子トークンを拾う正規表現。直前が数字/小数点でない位置から始まる
 * 文字列で、`1e3` の指数部 `e3` を識別子と誤認しないようにしている。
 * mathjs は識別子に CJK を許さず日本語名を直接パースできないため、ここで
 * ノード名を ASCII プレースホルダへ置換してから mathjs に渡す。
 */
const TOKEN_RE = /(?<![\d.])[\p{L}_$][\p{L}\p{N}_$]*/gu;

/**
 * ノード名 → mathjs 用 ASCII プレースホルダに置換する。
 * 既知の名前に一致しない識別子トークンは unknown として集める（未定義参照）。
 * 数値リテラルは TOKEN_RE が拾わないため対象外。
 */
export function substituteNames(
  expr: string,
  nameToPlaceholder: Map<string, string>,
): { code: string; unknown: string[] } {
  const unknown: string[] = [];
  const code = expr.replace(TOKEN_RE, (token, offset: number, full: string) => {
    // 直後が `(` の識別子は関数呼び出し。ノード名と同名でも変数参照ではないので
    // そのまま残し（dependencies.ts と同じ規律）、mathjs パース後の whitelist に委ねる。
    if (isCallAhead(full, offset + token.length)) return token;
    const placeholder = nameToPlaceholder.get(token);
    if (placeholder) return placeholder;
    unknown.push(token);
    return token;
  });
  return { code, unknown };
}

/** 位置 from 以降が空白を挟んで `(` で始まるか（= 直前のトークンが関数呼び出し） */
function isCallAhead(full: string, from: number): boolean {
  return /^\s*\(/.test(full.slice(from));
}

/**
 * パース済み式が許可された記法だけで構成されるか検証する。
 * 四則演算・べき乗・変数参照・ホワイトリストの関数呼び出しだけを通し、
 * それ以外（未知の関数・代入・行列など）は最初の違反を返す。
 */
function findDisallowed(node: MathNode): string | null {
  let violation: string | null = null;
  node.traverse((n) => {
    if (violation) return;
    switch (n.type) {
      case "ConstantNode":
      case "SymbolNode":
      case "ParenthesisNode":
        return;
      case "OperatorNode": {
        const fn = (n as OperatorNode).fn;
        if (!ALLOWED_OPERATOR_FNS.has(fn)) {
          violation = `演算子 ${(n as OperatorNode).op} は使えません（${EXPRESSION_SYNTAX_NOTE}）`;
        }
        return;
      }
      case "FunctionNode": {
        const name = (n as FunctionNode).fn.name;
        if (!ALLOWED_FUNCTION_SET.has(name)) {
          violation = `関数 ${name} は使えません（${EXPRESSION_SYNTAX_NOTE}）`;
        }
        return;
      }
      default:
        violation = `使えない記法が含まれています（${EXPRESSION_SYNTAX_NOTE}）`;
    }
  });
  return violation;
}

/** 式が参照する変数名を集める（whitelist 通過後に呼ぶ前提） */
function collectSymbols(node: MathNode): string[] {
  const names = new Set<string>();
  node.traverse((n) => {
    if (n.type === "SymbolNode") names.add((n as SymbolNode).name);
  });
  return [...names];
}

/**
 * 式の構文と演算子だけを検証する（保存時の軽い検証用）。参照解決・循環チェックは
 * しない。変数参照のトークンをダミーに置換してから parse するので、参照名の有無や
 * 定義順に依存せず、構文と whitelist だけを見る。関数呼び出し `f(...)` の名前は
 * 残し、ホワイトリスト外なら disallowed になる。空文字は OK（null を返す）。
 */
export function validateExpressionStructure(
  expression: string,
): SimError | null {
  const expr = expression.trim();
  if (!expr) return null;
  const code = expr.replace(TOKEN_RE, (token, offset: number, full: string) =>
    isCallAhead(full, offset + token.length) ? token : "_x",
  );
  let root: MathNode;
  try {
    root = parse(code);
  } catch (e) {
    return {
      type: "parse",
      message: `式を解釈できません: ${(e as Error).message}`,
    };
  }
  const disallowed = findDisallowed(root);
  if (disallowed) return { type: "disallowed", message: disallowed };
  return null;
}

type Compiled = {
  node: SimNode;
  /** scope のキーになる ASCII プレースホルダ */
  placeholder: string;
  compiled: ReturnType<MathNode["compile"]>;
};

type Prepared = {
  /** nodeId → ASCII プレースホルダ */
  placeholderByNodeId: Map<string, string>;
  stocks: SimNode[];
  constants: SimNode[];
  /** トポロジカル順に並んだ flow/auxiliary */
  ordered: Compiled[];
};

/**
 * シミュレーションの準備（1 回だけ）。名前→プレースホルダ割り当て・式のパース・
 * whitelist 検証・依存抽出・循環チェック + トポロジカルソートまで。
 * 失敗時は SimError を返す。
 *
 * stock は「ひとつ前の記憶」として現在値をそのまま読むだけなので依存に数えない
 * （設計ノート 6 章: ストックがループを断ち切る）。constant も事前に scope へ
 * 入るため順序づけ不要。順序づけ対象は flow/auxiliary 同士の参照のみ。
 */
function prepare(nodes: SimNode[]): Prepared | SimError {
  // 全ノードに一意な ASCII プレースホルダを割り当てる。日本語名でも mathjs が
  // パースできるよう、式中の名前参照をこのプレースホルダへ置換して評価する。
  const byName = new Map<string, SimNode>();
  const nameToPlaceholder = new Map<string, string>();
  const placeholderByNodeId = new Map<string, string>();
  let index = 0;
  for (const node of nodes) {
    if (!IDENTIFIER_RE.test(node.name)) {
      return {
        type: "invalid-identifier",
        message: `ノード名「${node.name}」は式で参照できる識別子ではありません`,
        nodeId: node.id,
      };
    }
    if (byName.has(node.name)) {
      return {
        type: "duplicate-name",
        message: `ノード名「${node.name}」が重複しています`,
        nodeId: node.id,
      };
    }
    const placeholder = `_v${index++}`;
    byName.set(node.name, node);
    nameToPlaceholder.set(node.name, placeholder);
    placeholderByNodeId.set(node.id, placeholder);
  }

  const stocks: SimNode[] = [];
  const constants: SimNode[] = [];
  const computed: { node: SimNode; placeholder: string; root: MathNode }[] = [];

  for (const node of nodes) {
    const placeholder = placeholderByNodeId.get(node.id) ?? "";
    switch (node.kind) {
      case "stock":
        if (typeof node.initialValue !== "number") {
          return {
            type: "missing-field",
            message: `stock「${node.name}」に initialValue がありません`,
            nodeId: node.id,
          };
        }
        stocks.push(node);
        break;
      case "constant":
        if (typeof node.value !== "number") {
          return {
            type: "missing-field",
            message: `constant「${node.name}」に value がありません`,
            nodeId: node.id,
          };
        }
        constants.push(node);
        break;
      default: {
        // flow / auxiliary
        const expr = node.expression?.trim();
        if (!expr) {
          return {
            type: "missing-field",
            message: `${node.kind}「${node.name}」に expression がありません`,
            nodeId: node.id,
          };
        }
        const { code, unknown } = substituteNames(expr, nameToPlaceholder);
        if (unknown.length > 0) {
          return {
            type: "undefined-reference",
            message: `「${node.name}」の式が未定義の変数「${unknown[0]}」を参照しています`,
            nodeId: node.id,
            refName: unknown[0],
          };
        }
        let root: MathNode;
        try {
          root = parse(code);
        } catch (e) {
          return {
            type: "parse",
            message: `「${node.name}」の式を解釈できません: ${(e as Error).message}`,
            nodeId: node.id,
          };
        }
        const disallowed = findDisallowed(root);
        if (disallowed) {
          return {
            type: "disallowed",
            message: `「${node.name}」の式: ${disallowed}`,
            nodeId: node.id,
          };
        }
        computed.push({ node, placeholder, root });
      }
    }
  }

  // flow/auxiliary 間の依存グラフをプレースホルダ単位で作りトポロジカルソート。
  // 参照シンボルは置換済みなので全てプレースホルダ。stock/constant の
  // プレースホルダは computedPlaceholders に含まれず、依存に数えられない。
  const computedPlaceholders = new Set(computed.map((c) => c.placeholder));
  const depsByPlaceholder = new Map<string, string[]>();
  for (const { placeholder, root } of computed) {
    // 自己参照（ref === placeholder）も依存に含める。flow/auxiliary が自分を
    // 参照するのは循環であり、トポロジカルソートで cycle として検出させる。
    const deps = collectSymbols(root).filter((ref) =>
      computedPlaceholders.has(ref),
    );
    depsByPlaceholder.set(placeholder, deps);
  }

  const rootByPlaceholder = new Map(
    computed.map((c) => [c.placeholder, c.root]),
  );
  const nodeByPlaceholder = new Map(
    computed.map((c) => [c.placeholder, c.node]),
  );
  const ordered: Compiled[] = [];
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (placeholder: string): SimError | null => {
    const s = state.get(placeholder);
    if (s === "done") return null;
    if (s === "visiting") {
      // stack 上の placeholder から先が循環している区間
      const start = stack.indexOf(placeholder);
      const cyclePlaceholders = stack.slice(start);
      const cycleNames = cyclePlaceholders.map(
        (p) => nodeByPlaceholder.get(p)?.name ?? p,
      );
      return {
        type: "cycle",
        message: `flow/auxiliary の依存が循環しています: ${cycleNames.join(" → ")}（ループは stock を挟んで閉じる必要があります）`,
        nodeIds: cyclePlaceholders.map(
          (p) => nodeByPlaceholder.get(p)?.id ?? p,
        ),
      };
    }
    state.set(placeholder, "visiting");
    stack.push(placeholder);
    for (const dep of depsByPlaceholder.get(placeholder) ?? []) {
      const err = visit(dep);
      if (err) return err;
    }
    stack.pop();
    state.set(placeholder, "done");
    const node = nodeByPlaceholder.get(placeholder);
    const root = rootByPlaceholder.get(placeholder);
    if (node && root)
      ordered.push({ node, placeholder, compiled: root.compile() });
    return null;
  };

  for (const { placeholder } of computed) {
    const err = visit(placeholder);
    if (err) return err;
  }

  return { placeholderByNodeId, stocks, constants, ordered };
}

/** scope から数値を取り出す。非有限値はエラー扱い */
function expectFinite(value: unknown, name: string): number | SimError {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      type: "eval",
      message: `「${name}」の評価結果が数値になりません`,
    };
  }
  return value;
}

/**
 * 図（nodes + edges）と設定からシミュレーションを実行する純粋・決定的関数。
 * 結果は保存せず毎回ここで導出する（loops.ts / lint.ts と同思想）。
 *
 * オイラー法で dt ずつ steps 回更新し、各ステップ開始時点のスナップショット
 * （その時の stock 値 + そこから計算した flow/auxiliary）を時系列で返す。
 * stock の更新は flow → stock エッジの極性（+ 流入 / - 流出）で決まる。
 */
export function simulate(
  nodes: SimNode[],
  edges: SimEdge[],
  config: SimConfig,
): SimResult {
  if (!Number.isFinite(config.dt) || config.dt <= 0) {
    return {
      ok: false,
      error: {
        type: "invalid-config",
        message: "dt は正の数である必要があります",
      },
    };
  }
  if (!Number.isInteger(config.steps) || config.steps < 1) {
    return {
      ok: false,
      error: {
        type: "invalid-config",
        message: "steps は 1 以上の整数である必要があります",
      },
    };
  }

  const prepared = prepare(nodes);
  if ("type" in prepared) return { ok: false, error: prepared };
  const { placeholderByNodeId, stocks, constants, ordered } = prepared;

  // overrides は stock の初期値 / constant の値にだけ効く（図は変更しない）
  const overrides = new Map<string, number>();
  if (config.overrides) {
    const byName = new Map(nodes.map((n) => [n.name, n]));
    for (const [name, value] of Object.entries(config.overrides)) {
      const node = byName.get(name);
      if (!node) {
        return {
          ok: false,
          error: {
            type: "invalid-override",
            message: `上書き対象「${name}」は図にありません`,
            refName: name,
          },
        };
      }
      if (node.kind !== "stock" && node.kind !== "constant") {
        return {
          ok: false,
          error: {
            type: "invalid-override",
            message: `「${name}」は ${node.kind} なので上書きできません（stock の初期値と constant の値のみ）`,
            nodeId: node.id,
            refName: name,
          },
        };
      }
      if (!Number.isFinite(value)) {
        return {
          ok: false,
          error: {
            type: "invalid-override",
            message: `「${name}」の上書き値は有限の数値である必要があります`,
            nodeId: node.id,
            refName: name,
          },
        };
      }
      overrides.set(node.id, value);
    }
  }

  const kindById = new Map(nodes.map((n) => [n.id, n.kind]));

  // 各 stock に流入/流出する flow エッジを集める（source が flow のものだけ）。
  // flow はプレースホルダで参照する（scope のキーがプレースホルダのため）。
  const inflowsByStockId = new Map<
    string,
    { flowPlaceholder: string; sign: 1 | -1 }[]
  >(stocks.map((s) => [s.id, []]));
  for (const edge of edges) {
    const target = inflowsByStockId.get(edge.targetNodeId);
    if (!target) continue; // target が stock でない
    if (kindById.get(edge.sourceNodeId) !== "flow") continue;
    const flowPlaceholder = placeholderByNodeId.get(edge.sourceNodeId);
    if (!flowPlaceholder) continue;
    target.push({ flowPlaceholder, sign: edge.polarity === "+" ? 1 : -1 });
  }

  // scope を初期化（constant と stock の初期値。overrides があればそちらを優先）。
  // キーはプレースホルダ。ホワイトリスト関数のうち mathjs に無いものも scope で供給する。
  const scope: Record<string, number | ((...args: number[]) => number)> = {
    ...SCOPE_FUNCTIONS,
  };
  const num = (ph: string) => scope[ph] as number;
  for (const c of constants) {
    const ph = placeholderByNodeId.get(c.id);
    if (ph) scope[ph] = overrides.get(c.id) ?? (c.value as number);
  }
  for (const s of stocks) {
    const ph = placeholderByNodeId.get(s.id);
    if (ph) scope[ph] = overrides.get(s.id) ?? (s.initialValue as number);
  }

  /** scope（プレースホルダ key）をノード名 key のスナップショットへ写す */
  const snapshot = (t: number): SimSnapshot => {
    const snap: SimSnapshot = { t };
    for (const node of nodes) {
      const ph = placeholderByNodeId.get(node.id);
      if (ph !== undefined) snap[node.name] = num(ph);
    }
    return snap;
  };

  /** 確定順に flow/auxiliary を評価して scope を更新する。失敗したら SimError */
  const evaluateOrdered = (): SimError | null => {
    for (const { node, placeholder, compiled } of ordered) {
      let raw: unknown;
      try {
        raw = compiled.evaluate(scope);
      } catch (e) {
        return {
          type: "eval",
          message: `「${node.name}」の評価に失敗しました: ${(e as Error).message}`,
          nodeId: node.id,
        };
      }
      const val = expectFinite(raw, node.name);
      if (typeof val !== "number") return val;
      scope[placeholder] = val;
    }
    return null;
  };

  const series: SimSnapshot[] = [];

  for (let t = 0; t < config.steps; t++) {
    // ① 確定順に flow/auxiliary を計算
    const error = evaluateOrdered();
    if (error) return { ok: false, error };

    // ④ このステップ開始時点（stock 更新前）のスナップショットを記録
    series.push(snapshot(t));

    // ② 全 stock の次の値を計算（まだ書き換えない）
    const next = new Map<string, number>();
    for (const s of stocks) {
      const ph = placeholderByNodeId.get(s.id);
      if (ph === undefined) continue;
      let rate = 0;
      for (const { flowPlaceholder, sign } of inflowsByStockId.get(s.id) ??
        []) {
        rate += sign * num(flowPlaceholder);
      }
      let value = num(ph) + rate * config.dt;
      // 発散ガード: stock が非有限（Infinity / NaN）になったら打ち切る。
      // 以降のステップは意味を持たず、flow の評価エラーより原因が分かりにくいため
      if (!Number.isFinite(value)) {
        return {
          ok: false,
          error: {
            type: "diverged",
            message: `stock「${s.name}」が t=${t + 1} で発散しました（dt を小さくするか、式や初期値を見直してください）`,
            nodeId: s.id,
            step: t + 1,
          },
        };
      }
      if (config.nonNegativeStocks && value < 0) value = 0;
      next.set(ph, value);
    }

    // ③ stock を一斉に書き換える
    for (const [ph, v] of next) scope[ph] = v;
  }

  // ⑤ 最終ステップで更新した stock と、それに基づく flow/aux を t=steps として記録する。
  // これが無いと steps 回更新した最後の値が series に現れない（steps+1 件になる）
  const finalError = evaluateOrdered();
  if (finalError) return { ok: false, error: finalError };
  series.push(snapshot(config.steps));

  return { ok: true, series, order: ordered.map((o) => o.node.name) };
}
