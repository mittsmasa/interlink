/**
 * 式（expression）が含む依存リンクに「極性（+/−）」を後付けする。
 *
 * 依存の存在は dependencies.ts の `deriveDependencies` に単一ソース化し（破線描画・lint と
 * 同じ集合）、ここでは各リンクの符号だけを式から導出する。符号が決まらないリンクは polarity:null。
 *
 * 符号は System Dynamics の慣例「変数は正の量」で **構造的に** 決める（値を使わない）。
 * to の式を AST 化し、from について「from が増えたとき to は増えるか減るか」を、from 以外の
 * 変数をすべて正と仮定して偏微分の符号として伝播する。同じ変数が +/− 両方の文脈で現れる式
 * （例 `残高 - 残高*0.1`）は構造だけでは決まらないため null（不定）にする。実質単調でも誤って
 * R/B 断定するより、ループ側で "?" と正直に出すための割り切り。
 *
 * mathjs を使うため、mathjs フリーに保つ dependencies.ts / lint.ts からは import しない。
 * このモジュールは canvas / loops 経路（mathjs 許容）からのみ参照する。
 */
import {
  type MathNode,
  type OperatorNode,
  type ParenthesisNode,
  parse,
  type SymbolNode,
} from "mathjs";
import { type DependencyLink, deriveDependencies } from "./dependencies";
import { IDENTIFIER_RE, substituteNames } from "./simulate";

export type SignedDependency = DependencyLink & {
  /** from→to の極性。構造から決まらなければ null（不定） */
  polarity: "+" | "-" | null;
};

type PolarityNode = {
  id: string;
  name: string;
  expression?: string | null;
};

/** 偏微分の符号。"0" = target に依存しない / "mixed" = 符号が定まらない */
type Sign = "+" | "-" | "0" | "mixed";

function flip(s: Sign): Sign {
  if (s === "+") return "-";
  if (s === "-") return "+";
  return s; // "0" / "mixed" はそのまま
}

/** 2 項の符号を畳む。0 は無視、同符号は維持、相反・不明は mixed */
function combine(a: Sign, b: Sign): Sign {
  if (a === "0") return b;
  if (b === "0") return a;
  if (a === "mixed" || b === "mixed") return "mixed";
  return a === b ? a : "mixed";
}

/** node の部分木が target シンボルを参照するか */
function containsSymbol(node: MathNode, target: string): boolean {
  let found = false;
  node.traverse((n) => {
    if (n.type === "SymbolNode" && (n as SymbolNode).name === target) {
      found = true;
    }
  });
  return found;
}

/**
 * target を変数、それ以外を正の定数とみなしたときの ∂node/∂target の符号。
 * 四則演算と単項±のみ構造解析し、関数など未対応構文は target を含めば mixed にする。
 */
function partialSign(node: MathNode, target: string): Sign {
  switch (node.type) {
    case "ConstantNode":
      return "0";
    case "SymbolNode":
      return (node as SymbolNode).name === target ? "+" : "0";
    case "ParenthesisNode":
      return partialSign((node as ParenthesisNode).content, target);
    case "OperatorNode": {
      const op = node as OperatorNode;
      const args = op.args;
      switch (op.fn) {
        case "add":
          return args.reduce<Sign>(
            (acc, a) => combine(acc, partialSign(a, target)),
            "0",
          );
        case "multiply":
          // 各因子以外を正と仮定すると d(∏)/dtarget の符号は各因子の符号の畳み込み
          return args.reduce<Sign>(
            (acc, a) => combine(acc, partialSign(a, target)),
            "0",
          );
        case "subtract":
          return combine(
            partialSign(args[0], target),
            flip(partialSign(args[1], target)),
          );
        case "divide":
          // 分母が正と仮定すると分子は同符号、分母は逆符号に効く
          return combine(
            partialSign(args[0], target),
            flip(partialSign(args[1], target)),
          );
        case "unaryMinus":
          return flip(partialSign(args[0], target));
        case "unaryPlus":
          return partialSign(args[0], target);
        default:
          return containsSymbol(node, target) ? "mixed" : "0";
      }
    }
    default:
      return containsSymbol(node, target) ? "mixed" : "0";
  }
}

/**
 * 依存リンクごとに式から極性を導出する。存在は deriveDependencies に委ね、符号だけ付ける。
 * リンクは符号が null でも必ず残す（描画・ループ参加の集合を deriveDependencies と一致させる）。
 */
export function deriveSignedDependencies(
  nodes: PolarityNode[],
): SignedDependency[] {
  const links = deriveDependencies(nodes);
  if (links.length === 0) return [];

  // 名前→プレースホルダ（simulate と同じく CJK 名を mathjs 用 ASCII に置換するため）
  const nameToPlaceholder = new Map<string, string>();
  let index = 0;
  for (const node of nodes) {
    if (!IDENTIFIER_RE.test(node.name)) continue;
    if (!nameToPlaceholder.has(node.name)) {
      nameToPlaceholder.set(node.name, `_v${index++}`);
    }
  }
  const nameById = new Map(nodes.map((n) => [n.id, n.name]));
  const exprById = new Map(nodes.map((n) => [n.id, n.expression ?? null]));

  return links.map((link) => ({
    ...link,
    polarity: signOf(link, exprById, nameById, nameToPlaceholder),
  }));
}

function signOf(
  link: DependencyLink,
  exprById: Map<string, string | null>,
  nameById: Map<string, string>,
  nameToPlaceholder: Map<string, string>,
): "+" | "-" | null {
  const expr = exprById.get(link.toNodeId)?.trim();
  if (!expr) return null;
  const fromName = nameById.get(link.fromNodeId);
  const target = fromName ? nameToPlaceholder.get(fromName) : undefined;
  if (!target) return null;

  const { code } = substituteNames(expr, nameToPlaceholder);
  let ast: MathNode;
  try {
    ast = parse(code);
  } catch {
    return null; // パース不能な式は符号不定
  }
  const sign = partialSign(ast, target);
  return sign === "+" ? "+" : sign === "-" ? "-" : null;
}
