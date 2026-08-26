import {
  type FunctionNode,
  type MathNode,
  type OperatorNode,
  parse,
  SymbolNode,
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
  /**
   * 因果が効くまでに目立った時間遅れがあるか（図の edges.hasDelay）。
   * true のリンクは値が `delaySteps` ステップ前のものとして読まれる（DELAY_NOTE 参照）
   */
  hasDelay?: boolean;
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
  /**
   * hasDelay が付いたリンクを何ステップ遅らせるか（既定 1、1 以上の整数）。
   * リンクごとではなく実行単位の一律指定。個別の時定数が要るときは式の
   * smooth / delay 関数を使う（DELAY_NOTE 参照）
   */
  delaySteps?: number;
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
 * smooth / delay は scope の関数ではなく、prepare が隠れストックへ書き換える
 * （SMOOTHING_FUNCTIONS / DELAY_NOTE 参照）。
 * ユーザー定義関数・代入・行列など、ここに無いものは全て拒否する。
 */
export const ALLOWED_FUNCTIONS = [
  "min",
  "max",
  "clamp",
  "pow",
  "smooth",
  "delay",
] as const;
const ALLOWED_FUNCTION_SET: ReadonlySet<string> = new Set(ALLOWED_FUNCTIONS);

/**
 * 遅れを表す関数。どちらも 1 次遅れ（ds/dt = (x − s) / tau）で中身は同じで、
 * smooth = 情報の平滑化 / delay = 物質の遅れ、という意味づけだけが違う。
 * 呼び出し 1 つにつき隠れストックを 1 つ持ち、stock と同じタイミングで更新する。
 */
export const SMOOTHING_FUNCTIONS: ReadonlySet<string> = new Set([
  "smooth",
  "delay",
]);

/** smooth / delay の引数の数（入力 x と時定数 tau） */
const SMOOTHING_ARITY = 2;

/** 許可される式の記法を一文で表した文言（エラーメッセージ / プロンプトで共用） */
export const EXPRESSION_SYNTAX_NOTE = `四則演算（+ - * /）・べき乗（^）・関数 ${ALLOWED_FUNCTIONS.join("/")} と変数参照のみ`;

/**
 * DELAY_NOTE — 遅れの入り口は 2 つある（設計ノート 7 章「遅れ」）。
 *
 * 1. リンクの遅れ（`SimEdge.hasDelay` × `SimConfig.delaySteps`）: 値をそのまま
 *    n ステップずらして読む（パイプライン遅延）。CLD の「遅れ」マークをそのまま
 *    数値に効かせるための粗い遅れ。ずらす量は実行単位で一律
 * 2. 式の関数（`smooth(x, tau)` / `delay(x, tau)`）: 1 次遅れ。リンクごとに時定数を
 *    変えられ、なまし（急な変化が鈍る）も表現できる
 */

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

/**
 * 式の中の変数参照を別名へ書き換える（ノードの改名に式を追従させる）。
 * 照合は substituteNames と同じ規律で、識別子トークンの完全一致だけを見る
 * （評価時の名前解決も正規化なしの完全一致のため）。関数呼び出しの名前は触らない。
 */
export function renameExpressionRefs(
  expression: string,
  from: string,
  to: string,
): { expression: string; renamed: boolean } {
  let renamed = false;
  const next = expression.replace(
    TOKEN_RE,
    (token, offset: number, full: string) => {
      if (token !== from) return token;
      if (isCallAhead(full, offset + token.length)) return token;
      renamed = true;
      return to;
    },
  );
  return { expression: next, renamed };
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
        const fn = n as FunctionNode;
        const name = fn.fn.name;
        if (!ALLOWED_FUNCTION_SET.has(name)) {
          violation = `関数 ${name} は使えません（${EXPRESSION_SYNTAX_NOTE}）`;
          return;
        }
        // smooth / delay は隠れストックへ書き換えるので引数の形を先に固定する
        if (
          SMOOTHING_FUNCTIONS.has(name) &&
          fn.args.length !== SMOOTHING_ARITY
        ) {
          violation = `関数 ${name} は引数を 2 つ取ります（${name}(値, 時定数)）`;
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

/** hasDelay のリンクで置き換えた参照。評価直前に scope[alias] へ遅延値を入れる */
type DelayedInput = {
  /** 式の中で元の参照を置き換えた ASCII エイリアス（_dN） */
  alias: string;
  /** 遅延して読む元ノード */
  source: SimNode;
};

/** smooth / delay 呼び出し 1 つに対応する隠れストック */
type HiddenState = {
  /** この呼び出しを含む式のノード（エラー報告用） */
  owner: SimNode;
  /** 呼び出しを置き換えた ASCII エイリアス（_hN）。scope 上の状態そのもの */
  alias: string;
  /** 入力 x */
  input: ReturnType<MathNode["compile"]>;
  /** 時定数 tau */
  tau: ReturnType<MathNode["compile"]>;
};

type Compiled = {
  node: SimNode;
  /** scope のキーになる ASCII プレースホルダ */
  placeholder: string;
  compiled: ReturnType<MathNode["compile"]>;
  /** この式が hasDelay のリンクで参照している値 */
  delayedInputs: DelayedInput[];
  /** この式が持つ隠れストック。内側の呼び出しが先に並ぶ */
  hidden: HiddenState[];
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
function prepare(nodes: SimNode[], edges: SimEdge[]): Prepared | SimError {
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

  // hasDelay のリンクを式の中の参照へ効かせる。X→T（T が式で X を参照）の X を
  // 遅延エイリアスへ置換し、評価直前に n ステップ前の値を入れる。依存抽出（上）は
  // 置換前の root に対して済ませてあるので、評価順序は遅れの有無で変わらない。
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const delayedSourcesByTargetId = new Map<string, SimNode[]>();
  for (const edge of edges) {
    if (!edge.hasDelay) continue;
    const source = nodeById.get(edge.sourceNodeId);
    if (!source) continue;
    const sources = delayedSourcesByTargetId.get(edge.targetNodeId);
    if (sources) sources.push(source);
    else delayedSourcesByTargetId.set(edge.targetNodeId, [source]);
  }

  let aliasIndex = 0;
  const rootByPlaceholder = new Map<string, MathNode>();
  const delayedByPlaceholder = new Map<string, DelayedInput[]>();
  const hiddenByPlaceholder = new Map<string, HiddenState[]>();

  for (const { node, placeholder, root } of computed) {
    const symbols = new Set(collectSymbols(root));
    const delayedInputs: DelayedInput[] = [];
    const aliasBySource = new Map<string, string>();
    for (const source of delayedSourcesByTargetId.get(node.id) ?? []) {
      const sourcePlaceholder = placeholderByNodeId.get(source.id);
      // 式が実際に参照していないリンクは遅らせようがない（情報リンクではない）
      if (!sourcePlaceholder || !symbols.has(sourcePlaceholder)) continue;
      if (aliasBySource.has(sourcePlaceholder)) continue;
      const alias = `_d${aliasIndex++}`;
      aliasBySource.set(sourcePlaceholder, alias);
      delayedInputs.push({ alias, source });
    }
    const withDelays =
      delayedInputs.length === 0
        ? root
        : root.transform((n) => {
            if (n.type !== "SymbolNode") return n;
            const alias = aliasBySource.get((n as SymbolNode).name);
            return alias ? new SymbolNode(alias) : n;
          });

    // smooth / delay を隠れストックへ切り出す。子を先に処理するので、入れ子は
    // 内側から順に _h 化され、外側の入力にはその状態シンボルが現れる
    const hidden: HiddenState[] = [];
    const extract = (n: MathNode): MathNode => {
      const mapped = n.map(extract);
      if (mapped.type !== "FunctionNode") return mapped;
      const fn = mapped as FunctionNode;
      if (!SMOOTHING_FUNCTIONS.has(fn.fn.name)) return mapped;
      const alias = `_h${aliasIndex++}`;
      hidden.push({
        owner: node,
        alias,
        input: fn.args[0].compile(),
        tau: fn.args[1].compile(),
      });
      return new SymbolNode(alias);
    };

    rootByPlaceholder.set(placeholder, extract(withDelays));
    delayedByPlaceholder.set(placeholder, delayedInputs);
    hiddenByPlaceholder.set(placeholder, hidden);
  }

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
      ordered.push({
        node,
        placeholder,
        compiled: root.compile(),
        delayedInputs: delayedByPlaceholder.get(placeholder) ?? [],
        hidden: hiddenByPlaceholder.get(placeholder) ?? [],
      });
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
  const delaySteps = config.delaySteps ?? 1;
  if (!Number.isInteger(delaySteps) || delaySteps < 1) {
    return {
      ok: false,
      error: {
        type: "invalid-config",
        message: "delaySteps は 1 以上の整数である必要があります",
      },
    };
  }

  const prepared = prepare(nodes, edges);
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
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // 各 stock に流入/流出する flow エッジを集める（source が flow のものだけ）。
  // flow はプレースホルダで参照する（scope のキーがプレースホルダのため）。
  // hasDelay が付いたリンクは現在値ではなく delaySteps 前の値を流す。
  const inflowsByStockId = new Map<
    string,
    { flow: SimNode; flowPlaceholder: string; sign: 1 | -1; delayed: boolean }[]
  >(stocks.map((s) => [s.id, []]));
  for (const edge of edges) {
    const target = inflowsByStockId.get(edge.targetNodeId);
    if (!target) continue; // target が stock でない
    if (kindById.get(edge.sourceNodeId) !== "flow") continue;
    const flowPlaceholder = placeholderByNodeId.get(edge.sourceNodeId);
    const flow = nodeById.get(edge.sourceNodeId);
    if (!flowPlaceholder || !flow) continue;
    target.push({
      flow,
      flowPlaceholder,
      sign: edge.polarity === "+" ? 1 : -1,
      delayed: edge.hasDelay === true,
    });
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

  const series: SimSnapshot[] = [];

  /**
   * hasDelay のリンクを通して読む値。series[i] は t=i 時点の値なので、clamp した
   * index を引くだけで「履歴が足りない間は t=0 の値が続いていた」とみなせる
   * （Vensim の DELAY FIXED と同じ慣例）。series がまだ空なのは t=0 の flow/aux
   * 評価中だけで、そのときは同じステップで計算済みの現在値が t=0 の値にあたる。
   */
  const delayedValue = (source: SimNode, t: number): number => {
    const snap = series[Math.max(0, t - delaySteps)];
    if (snap) return snap[source.name];
    const ph = placeholderByNodeId.get(source.id);
    return ph === undefined ? Number.NaN : num(ph);
  };

  /** このステップで積分する隠れストック（smooth / delay）。① で積み ② で使う */
  const pendingHidden: { state: HiddenState; input: number; tau: number }[] =
    [];

  /**
   * smooth / delay の隠れストックを 1 つ評価する。初回は入力の現在値で初期化し
   * （t=0 では入力と釣り合っている前提）、以降は ② の積分に渡す材料を積む。
   */
  const evaluateHidden = (state: HiddenState): SimError | null => {
    const evaluateArg = (
      arg: ReturnType<MathNode["compile"]>,
      what: string,
    ): number | SimError => {
      let raw: unknown;
      try {
        raw = arg.evaluate(scope);
      } catch (e) {
        return {
          type: "eval",
          message: `「${state.owner.name}」の smooth/delay の${what}の評価に失敗しました: ${(e as Error).message}`,
          nodeId: state.owner.id,
        };
      }
      const value = expectFinite(
        raw,
        `${state.owner.name}」の smooth/delay の${what}`,
      );
      if (typeof value !== "number")
        return { ...value, nodeId: state.owner.id };
      return value;
    };

    const input = evaluateArg(state.input, "入力");
    if (typeof input !== "number") return input;
    // 初回だけ入力の現在値で初期化する（隠れストックの初期値 = x(0)）
    if (scope[state.alias] === undefined) scope[state.alias] = input;
    const tau = evaluateArg(state.tau, "時定数");
    if (typeof tau !== "number") return tau;
    if (tau <= 0) {
      return {
        type: "eval",
        message: `「${state.owner.name}」の smooth/delay の時定数は正の数である必要があります`,
        nodeId: state.owner.id,
      };
    }
    pendingHidden.push({ state, input, tau });
    return null;
  };

  /** 確定順に flow/auxiliary を評価して scope を更新する。失敗したら SimError */
  const evaluateOrdered = (t: number): SimError | null => {
    pendingHidden.length = 0;
    for (const {
      node,
      placeholder,
      compiled,
      delayedInputs,
      hidden,
    } of ordered) {
      // 遅れ付きリンクの参照値と、隠れストックの現在値を先に scope へ入れる
      for (const { alias, source } of delayedInputs) {
        scope[alias] = delayedValue(source, t);
      }
      for (const state of hidden) {
        const hiddenError = evaluateHidden(state);
        if (hiddenError) return hiddenError;
      }
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

  for (let t = 0; t < config.steps; t++) {
    // ① 確定順に flow/auxiliary を計算
    const error = evaluateOrdered(t);
    if (error) return { ok: false, error };

    // ④ このステップ開始時点（stock 更新前）のスナップショットを記録
    series.push(snapshot(t));

    // ② 全 stock の次の値を計算（まだ書き換えない）
    const next = new Map<string, number>();
    for (const s of stocks) {
      const ph = placeholderByNodeId.get(s.id);
      if (ph === undefined) continue;
      let rate = 0;
      for (const {
        flow,
        flowPlaceholder,
        sign,
        delayed,
      } of inflowsByStockId.get(s.id) ?? []) {
        // 遅れ付きの流入/流出は delaySteps 前の流量で積む（パイプライン遅延）
        rate += sign * (delayed ? delayedValue(flow, t) : num(flowPlaceholder));
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

    // 隠れストック（smooth / delay の 1 次遅れ）も stock と同じ刻みで積む
    for (const { state, input, tau } of pendingHidden) {
      const current = scope[state.alias] as number;
      const value = current + ((input - current) / tau) * config.dt;
      if (!Number.isFinite(value)) {
        return {
          ok: false,
          error: {
            type: "diverged",
            message: `「${state.owner.name}」の smooth/delay が t=${t + 1} で発散しました（dt を小さくするか、時定数を見直してください）`,
            nodeId: state.owner.id,
            step: t + 1,
          },
        };
      }
      next.set(state.alias, value);
    }

    // ③ stock と隠れストックを一斉に書き換える
    for (const [ph, v] of next) scope[ph] = v;
  }

  // ⑤ 最終ステップで更新した stock と、それに基づく flow/aux を t=steps として記録する。
  // これが無いと steps 回更新した最後の値が series に現れない（steps+1 件になる）
  const finalError = evaluateOrdered(config.steps);
  if (finalError) return { ok: false, error: finalError };
  series.push(snapshot(config.steps));

  return { ok: true, series, order: ordered.map((o) => o.node.name) };
}
