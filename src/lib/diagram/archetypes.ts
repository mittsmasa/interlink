import type { Loop } from "./loops";

export type ArchetypeId =
  | "shifting-the-burden"
  | "fixes-that-fail"
  | "limits-to-growth"
  | "success-to-the-successful"
  | "drifting-goals"
  | "escalation";

export type ArchetypeMatch = {
  archetypeId: ArchetypeId;
  name: string;
  /** どういう構造かの 1 文 */
  description: string;
  /** 対話で確かめるための問いかけ */
  question: string;
  /** マッチに関与したループの ID */
  loopIds: string[];
};

/**
 * 検出済みループの構成（極性の組み合わせ + 変数共有 + 遅れ位置）から
 * 似ているシステム原型を推定する。完全なグラフ同型マッチではなく近似なので、
 * 提示は「似ています」+ 確認質問に留める前提。
 *
 * 判定は構造判別力の高い原型に限り、specificity の高い順に評価して
 * 使ったループは後続の判定から除く（同じ円環への重ね当てを避ける）。
 */
export function matchArchetypes(loops: Loop[]): ArchetypeMatch[] {
  const matches: ArchetypeMatch[] = [];
  const used = new Set<string>();

  const available = (polarity: Loop["polarity"]) =>
    loops.filter((l) => l.polarity === polarity && !used.has(l.id));
  const shares = (a: Loop, b: Loop) =>
    a.nodeIds.some((id) => b.nodeIds.includes(id));
  const take = (match: ArchetypeMatch) => {
    matches.push(match);
    for (const id of match.loopIds) used.add(id);
  };

  // 問題のすり替わり: 同じ症状を共有する 2 つの B（対症療法と根本対策）に
  // 対症療法の副作用 R が絡む
  shiftingTheBurden: for (const b1 of available("B")) {
    for (const b2 of available("B")) {
      if (b1.id >= b2.id || !shares(b1, b2)) continue;
      for (const r of available("R")) {
        if (!shares(r, b1) && !shares(r, b2)) continue;
        take({
          archetypeId: "shifting-the-burden",
          name: "問題のすり替わり",
          description:
            "対症療法と根本対策の 2 つのバランスループに、対症療法の副作用が絡む構造",
          question: `${b1.label} と ${b2.label} のうち、根本対策はどちらでしょう。手早い対処のほうに頼りすぎていませんか?`,
          loopIds: [b1.id, b2.id, r.id],
        });
        break shiftingTheBurden;
      }
    }
  }

  // 応急処置の失敗: 対処の B と、遅れて効いてくる副作用の R
  fixesThatFail: for (const b of available("B")) {
    for (const r of available("R")) {
      if (!shares(b, r) || !r.hasDelay) continue;
      take({
        archetypeId: "fixes-that-fail",
        name: "応急処置の失敗",
        description:
          "対処のバランスループに、遅れを伴う副作用の自己強化ループが重なる構造",
        question: `${b.label} の対処が、時間差で ${r.label} 側の悪化を生んでいないでしょうか?`,
        loopIds: [b.id, r.id],
      });
      break fixesThatFail;
    }
  }

  // 成功の限界: 成長の R にどこかで制約の B がかかる
  limitsToGrowth: for (const r of available("R")) {
    for (const b of available("B")) {
      if (!shares(r, b)) continue;
      take({
        archetypeId: "limits-to-growth",
        name: "成功の限界",
        description: "成長の自己強化ループを、制約のバランスループが抑える構造",
        question: `${r.label} の成長を ${b.label} が抑えているなら、制約になっているものは何でしょう?`,
        loopIds: [r.id, b.id],
      });
      break limitsToGrowth;
    }
  }

  // 強者はますます強く: 同じ資源を取り合う 2 つの R
  successToTheSuccessful: for (const r1 of available("R")) {
    for (const r2 of available("R")) {
      if (r1.id >= r2.id || !shares(r1, r2)) continue;
      take({
        archetypeId: "success-to-the-successful",
        name: "強者はますます強く",
        description:
          "共通の資源や評価を介して、片方の成功がもう片方の機会を奪う 2 つの自己強化ループ",
        question: `${r1.label} と ${r2.label} は同じ資源を取り合っていませんか? 配分は何で決まっているでしょう`,
        loopIds: [r1.id, r2.id],
      });
      break successToTheSuccessful;
    }
  }

  // 変数を共有する 2 つの B は、遅れがあれば目標のなし崩し、なければエスカレーションに近い
  balancingPair: for (const b1 of available("B")) {
    for (const b2 of available("B")) {
      if (b1.id >= b2.id || !shares(b1, b2)) continue;
      if (b1.hasDelay || b2.hasDelay) {
        take({
          archetypeId: "drifting-goals",
          name: "目標のなし崩し",
          description:
            "ギャップを実績の改善で埋めるか、目標を下げて埋めるかの 2 つのバランスループ",
          question: `目標そのものが少しずつ下がってきていないでしょうか。${b1.label} の基準は何で決まりますか?`,
          loopIds: [b1.id, b2.id],
        });
      } else {
        take({
          archetypeId: "escalation",
          name: "エスカレーション",
          description:
            "互いの結果への反応が相手の行動を促し、全体として強め合う 2 つのバランスループ",
          question: `${b1.label} と ${b2.label} は互いの動きへの反応になっていませんか。どこで止まれるでしょう?`,
          loopIds: [b1.id, b2.id],
        });
      }
      break balancingPair;
    }
  }

  return matches;
}
