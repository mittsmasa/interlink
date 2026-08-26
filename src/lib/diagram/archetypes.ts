import type { Loop, LoopEdge } from "./loops";

export type ArchetypeId =
  | "shifting-the-burden"
  | "tragedy-of-the-commons"
  | "fixes-that-fail"
  | "limits-to-growth"
  | "success-to-the-successful"
  | "drifting-goals"
  | "escalation"
  | "balancing-with-delay";

export type ArchetypeMatch = {
  archetypeId: ArchetypeId;
  name: string;
  /** どういう構造かの 1 文 */
  description: string;
  /** 対話で確かめるための問いかけ */
  question: string;
  /** その原型で効くとされる介入の定石 */
  prescription: string;
  /** その原型でよくある失敗（効かない手・やりがちな読み違い） */
  pitfalls: string;
  /** マッチに関与したループの ID */
  loopIds: string[];
};

/**
 * 検出済みループの構成（極性の組み合わせ + 変数共有 + 遅れ位置 + リンクの符号）から
 * 似ているシステム原型を推定する。完全なグラフ同型マッチではなく近似なので、
 * 提示は「似ています」+ 確認質問に留める前提。
 *
 * 判定は構造判別力の高い原型に限り、specificity の高い順に評価して
 * 使ったループは後続の判定から除く（同じ円環への重ね当てを避ける）。
 *
 * edges は detectLoops に渡したものと同じ集合。ループ内リンクの符号を引くために要る。
 * 「B が R の変数に負で戻っているか」まで見ないと、R と B が 1 変数を共有するだけの図が
 * すべて成功の限界になる。
 */
export function matchArchetypes(
  loops: Loop[],
  edges: readonly LoopEdge[],
): ArchetypeMatch[] {
  const matches: ArchetypeMatch[] = [];
  const used = new Set<string>();
  const polarityByEdgeId = new Map(edges.map((e) => [e.id, e.polarity]));

  const available = (polarity: Loop["polarity"]) =>
    loops.filter((l) => l.polarity === polarity && !used.has(l.id));
  const shares = (a: Loop, b: Loop) =>
    a.nodeIds.some((id) => b.nodeIds.includes(id));
  const take = (match: ArchetypeMatch) => {
    matches.push(match);
    for (const id of match.loopIds) used.add(id);
  };

  /**
   * ループ内で nodeId に入ってくるリンクが負か。
   * edgeIds[i] は nodeIds[i] → nodeIds[(i+1) % n] なので、nodeIds[i] に入るのは
   * 1 つ手前の edgeIds[i-1]（自己ループは n=1 で自分自身）
   */
  const entersNegatively = (loop: Loop, nodeId: string) => {
    const index = loop.nodeIds.indexOf(nodeId);
    if (index < 0) return false;
    const n = loop.nodeIds.length;
    const edgeId = loop.edgeIds[(index - 1 + n) % n];
    return polarityByEdgeId.get(edgeId) === "-";
  };

  /** バランスループ b が、r の変数のどれかへ負リンクで戻っている（制約として効いている） */
  const constrains = (b: Loop, r: Loop) =>
    r.nodeIds.some((id) => b.nodeIds.includes(id) && entersNegatively(b, id));

  // 共有地の悲劇: 2 つの成長 R がそれぞれ別の B に抑えられ、その 2 つの B が
  // 同じ変数（共有資源）を通っている。関与ループが 4 本と最も specific なので先に評価する
  tragedyOfTheCommons: for (const r1 of available("R")) {
    for (const r2 of available("R")) {
      if (r1.id >= r2.id) continue;
      for (const b1 of available("B")) {
        if (!constrains(b1, r1)) continue;
        for (const b2 of available("B")) {
          if (b1.id === b2.id || !constrains(b2, r2) || !shares(b1, b2)) {
            continue;
          }
          const commons = b1.nodeIds.filter((id) => b2.nodeIds.includes(id));
          const commonsName =
            b1.nodeNames[b1.nodeIds.indexOf(commons[0])] ?? "同じ変数";
          take({
            archetypeId: "tragedy-of-the-commons",
            name: "共有地の悲劇",
            description:
              "それぞれ成長する複数の自己強化ループが、同じ変数を通る制約に抑えられる構造",
            question: `${r1.label} と ${r2.label} は「${commonsName}」を分け合っていませんか? 全体の残りは誰が見ているでしょう`,
            prescription:
              "共有資源の総量と残りを全員から見えるようにし、取り分の上限か配分の決め方を先に合意する",
            pitfalls:
              "個々に節度を呼びかけるだけでは止まらない。先に控えた人が損をする限り、使い切るほうが合理的なままになる",
            loopIds: [r1.id, r2.id, b1.id, b2.id],
          });
          break tragedyOfTheCommons;
        }
      }
    }
  }

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
          prescription:
            "対症療法は時間を買う手だと割り切って上限を決め、空いた余力を根本対策の能力を育てるほうへ回す",
          pitfalls:
            "対症療法をやめるだけでは症状が戻る。根本対策が育つまでの時間を見込まずに切り替えると、痛みだけが先に来る",
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
        prescription:
          "副作用が現れるまでの時間を見込んで判断する。対処を強める前に、副作用の側を測って比べる",
        pitfalls:
          "効き目が続かないのを「対処が足りないから」と読み、同じ手を強めてしまう",
        loopIds: [b.id, r.id],
      });
      break fixesThatFail;
    }
  }

  // 成功の限界: 成長の R に、制約の B が負リンクで戻っている。
  // 「変数を共有している」だけでは成立しない（R と B を含むほぼ全図が該当してしまう）
  limitsToGrowth: for (const r of available("R")) {
    for (const b of available("B")) {
      if (!constrains(b, r)) continue;
      take({
        archetypeId: "limits-to-growth",
        name: "成功の限界",
        description: "成長の自己強化ループを、制約のバランスループが抑える構造",
        question: `${r.label} の成長を ${b.label} が抑えているなら、制約になっているものは何でしょう?`,
        prescription:
          "成長を押すのではなく、いま効いている制約のほうを取り除く。制約は緩めると別のものへ移るので、都度どれが効いているか見直す",
        pitfalls:
          "もっと頑張る・もっと投入する、はループを強めるだけ。制約が動かない限り伸びは天井に張り付いたままになる",
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
        prescription:
          "配分を実績連動から切り離す。遅れて伸びる側にも試行の機会と資源を確保しておく",
        pitfalls:
          "実績で配分する仕組みを残したまま公平を掲げても、配分ルールのほうが差を広げ続ける",
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
          prescription:
            "目標を実績から切り離し、外の基準か絶対値で固定する。下げるなら、いつ・なぜ下げたかを残す",
          pitfalls:
            "ギャップが縮んだことを改善と読む。目標が下がっただけなら、実績は同じ場所にいる",
          loopIds: [b1.id, b2.id],
        });
      } else {
        take({
          archetypeId: "escalation",
          name: "エスカレーション",
          description:
            "互いの結果への反応が相手の行動を促し、全体として強め合う 2 つのバランスループ",
          question: `${b1.label} と ${b2.label} は互いの動きへの反応になっていませんか。どこで止まれるでしょう?`,
          prescription:
            "相手との比較をやめ、自分の絶対的な基準で動く。可能なら双方で上限を取り決める",
          pitfalls:
            "降りたほうが不利になるという読みが、降りられない理由を互いに作り続ける",
          loopIds: [b1.id, b2.id],
        });
      }
      break balancingPair;
    }
  }

  // 遅れを伴うバランス: 他の原型に組み込まれずに残った、遅れ付きの B 単独。
  // 単独でも振動（行き過ぎと揺り戻し）を説明できるので最後に拾う
  for (const b of available("B")) {
    if (!b.hasDelay) continue;
    take({
      archetypeId: "balancing-with-delay",
      name: "遅れを伴うバランス",
      description:
        "効果が遅れて現れるバランスループ。行き過ぎと揺り戻しの振動を生みやすい構造",
      question: `${b.label} は手を打ってから効き目が出るまでどれくらいかかりますか? 待ちきれずに次の手を重ねていませんか?`,
      prescription:
        "反応の速さを落とし、打った手が効くまで待つ。測る間隔を遅れの長さに合わせる",
      pitfalls:
        "効かないと見て手を重ねる。遅れて届いた分と足し合わさり、行き過ぎと揺り戻しがかえって大きくなる",
      loopIds: [b.id],
    });
    break;
  }

  return matches;
}
