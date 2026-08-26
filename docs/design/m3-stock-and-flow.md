# M3: ストック&フロー + シミュレーション 設計ノート

ステータス: 実装済み（schema 拡張 / kind 昇格 / 式検証 / simulate / グラフ / MCP ツール / 遅れ / 昇格候補の提案 / 設定の永続化）。本ノートは背景の考え方と、実装で確定した挙動の両方を記す。確定 DDL・関数シグネチャはコードを正とし、ここでは「なぜそうなっているか」を残す。
読者: M3 を触る人。前提知識（システムダイナミクス）は本ノートで補う。

実装の対応表:

| 関心 | コード |
|---|---|
| schema（kind / unit / expression / initialValue / value） | [`src/db/schema.ts`](../../src/db/schema.ts) |
| diff の kind 別正規化と式の保存時検証 | [`src/lib/diagram/apply-diff.ts`](../../src/lib/diagram/apply-diff.ts) `normalizeSfdFields` |
| 式からの情報リンク導出（依存 / 極性） | [`src/lib/diagram/dependencies.ts`](../../src/lib/diagram/dependencies.ts) / [`dependency-polarity.ts`](../../src/lib/diagram/dependency-polarity.ts) |
| SFD 整合 lint | [`src/lib/diagram/lint.ts`](../../src/lib/diagram/lint.ts) `lintStockFlow` |
| シミュレーションエンジン | [`src/lib/diagram/simulate.ts`](../../src/lib/diagram/simulate.ts) |
| 遅れ（hasDelay × delaySteps / smooth / delay） | [`simulate.ts`](../../src/lib/diagram/simulate.ts) `DELAY_NOTE` |
| 図 → simulate 入力の変換 | [`src/lib/diagram/sim-inputs.ts`](../../src/lib/diagram/sim-inputs.ts) |
| 結果の要約（BOT 語彙） | [`src/lib/diagram/sim-summary.ts`](../../src/lib/diagram/sim-summary.ts) |
| kind 昇格候補のヒューリスティック | [`src/lib/diagram/suggest-kinds.ts`](../../src/lib/diagram/suggest-kinds.ts) |
| シミュレーション設定の永続化（dt / steps / timeUnit） | [`src/lib/diagram/sim-config.ts`](../../src/lib/diagram/sim-config.ts) |
| 聞き取りの定量化フェーズ | [`src/lib/interview/phase.ts`](../../src/lib/interview/phase.ts) `quantify` / [`agenda.ts`](../../src/lib/interview/agenda.ts) |
| MCP ツール `run_simulation` / `compare_scenarios` / `update_sim_config` | [`src/lib/mcp/tools.ts`](../../src/lib/mcp/tools.ts) |
| UI（シミュレーションパネル / グラフ） | `src/app/(main)/projects/[projectId]/_components/simulation-panel.tsx` |

---

## 1. これは何か / ゴール

M3 は CLD（因果ループ図）を、数値が時間に沿って動くシミュレーション可能な図（SFD）へ拡張する。

M2 までの CLD は「何が何に影響するか」を矢印と極性（+/-）で描くだけで、数値を持たない。M3 では各変数に役割（kind）・単位・初期値・数式を与え、時間ステップを回して「このまま行くとどう推移するか」を計算する。CLD で「+ のループが回っている」としか言えなかった構造を、「このペースで積み上がる」と具体的な数列・グラフにするのがゴール。

---

## 2. 用語集

| 用語 | 意味 |
|---|---|
| CLD | Causal Loop Diagram / 因果ループ図。ノード + 極性付きリンク。数値なし。M2 まで |
| SFD | Stock and Flow Diagram / ストック&フロー図。CLD に量と時間を足したもの。M3 |
| stock（ストック） | 溜まっている量。時間を止めても残る。例: 疲労、在庫、残高 |
| flow（フロー） | 単位時間あたりの流入・流出の速さ。ストックを増減させる。例: 残業による疲労増 |
| auxiliary（補助変数） | その瞬間に他の値から計算される中間値。蓄積しない。例: ミス率 |
| constant（定数） | 時間が経っても変わらない固定値。例: 体力の上限 |
| シミュレーション | 初期値から `dt`（時間刻み）ずつ状態を更新し、時系列データを得る計算 |

stock / flow の直感は「お風呂」で掴める。浴槽の水の量が stock、蛇口と排水口の流量が flow。

---

## 3. 設計の背骨: kind 昇格モデル

CLD と SFD を別グラフとして二重管理しない。同一ノードの `kind` を `null` から `stock` / `flow` / `auxiliary` / `constant` へ書き換えて段階的に詳細化する。

- CLD 段階: 全ノードの `kind` は `null`（役割未分類のただの変数）
- M3 で昇格: 同じノードの `kind` を具体的な役割に書き換える

「昇格」とは、図を作り直すことではなく、既存ノードに後から役割ラベルを与えること。図は 1 つのまま、CLD/SFD の不整合が原理的に起きない。

対応コード:

- [`src/db/schema.ts`](../../src/db/schema.ts) の `NODE_KINDS = ["stock", "flow", "auxiliary", "constant"]`
- `nodes.kind`（現状 null）/ `nodes.unit`（単位の布石、現状 null）

昇格は機械的に一意には決まらない。同じ「残業時間」でも、文脈で kind が変わる（4 章参照）。よって昇格は対話的に行う。AI が kind を提案し、ユーザーが確定する。M2 の「AI が図を提案 → ユーザーが直す」流れの延長で実装する。

### 提案の出どころ（実装で確定）

提案の材料は `suggestKinds`（[`suggest-kinds.ts`](../../src/lib/diagram/suggest-kinds.ts)）が決定的に導出する。4 章の「補助のものさし」を優先順位付きのルールに落とし、未分類ノードごとに `{ suggestedKind, confidence（高 / 中 / 低）, reasons（日本語） }` を返す。保存せず毎回導出する（ループ・lint と同じ）。

- 外部エージェントには `get_diagram` の `sfdHints` として届く
- アプリでは変数を選んだときに inspector へ「提案: ストック（確からしさ 中）」と根拠が出て、1 クリックで確定できる
- **どちらも自動適用しない**。確定はユーザーの操作か、ユーザーの合意を得た AI の `update_diagram`

聞き取りの側では、昇格が始まって定量化が途中の状態を `quantify` フェーズとして導出し（[`phase.ts`](../../src/lib/interview/phase.ts)）、残った未分類・初期値・式・時間軸をアジェンダで順に問う。数値が揃えば `insight` へ戻り、仮説を `overrides` で試す段になる。

---

## 4. ストックとフローの見分け方

判定の主軸は「一時停止テスト」。頭の中で時間を止めて、まだ存在するものが stock、消えるものが flow。

- 浴槽の水の量（150 リットル）は止めても在る → stock
- 蛇口の流量（毎分 10 リットル）は止めると「毎分」が言えず意味を失う → flow

補助のものさし 3 つ:

1. 単位に「/時間」が付くか。「リットル」「人」など時点の量は stock。「リットル/分」「人/年」など率は flow
2. 過去のフローの積み重ねか。積み重ねの結果なら stock（例: 疲労 = ずっとの残業の蓄積）
3. 何を直接増減させるか。ストックを直接動かすものは flow（ストックは自分では増減せず、必ず flow を通して変わる）

### 文脈依存の例

同じ言葉でも、その問いの中での使われ方で kind が変わる。

- 「1 日あたりの残業時間（疲労を増やす速さ）」→ flow
- 「今月の累積残業時間（積み上がる量）」→ stock

この曖昧さがあるため、昇格は AI 提案 + ユーザー確定の対話で決める（3 章）。

補足（実装上の注意）: 判定の主軸である一時停止テストは人の判断で、コードにはできない。上の補助のものさし 3 つだけは `suggestKinds` がルール化していて、`unit` 列を読むのはここだけ（「〜/週」のように分母が時間なら flow、時点の量なら stock）。単位の整合チェック（`unit-mismatch`）は引き続き未実装（8 章 Open Questions）。

### 疲労の問いを例にした分類

```
  残業時間 ──(+)──→ 疲労 ──(+)──→ ミス ──(+)──→ 残業時間   （R ループ: 悪循環）
                     ↑
  休息 ──(−)─────────┘
```

| ノード | kind | 理由 |
|---|---|---|
| 疲労 | stock | 体に溜まる。過去の積み重ね |
| 残業増 | flow | 疲労を増やす速さ（流入） |
| 休息 | flow | 疲労を減らす速さ（流出） |
| ミス率 | auxiliary | 疲労からその場で計算される中間値 |
| 体力上限 | constant | 固定値 |

---

## 5. 式の設計

kind ごとに持つものが異なる。

| kind | 持つもの | 例 |
|---|---|---|
| stock | 初期値のみ（式は持たない） | 疲労 = 最初 30 |
| flow | 式（毎ステップの速さ） | 残業増 = `残業時間 * 0.5` |
| auxiliary | 式（その場の計算） | ミス率 = `疲労 / 100` |
| constant | 固定値のみ | 体力上限 = 100 |

stock は式を持たない。stock の値は計算されるのではなく、flow の出入りで更新される（7 章）。式を持つのは flow と auxiliary のみ。

式の中身は、他のノードの現在値を変数として使った計算。式の中の「疲労」「ミス率」はノード名で、評価時にその瞬間の値へ置き換わる。式は文字列でそのまま保存し、実行時にパースして評価する。

### データモデル拡張案（イメージ。確定 DDL はコードに語らせる）

`nodes` テーブルに列を足す想定:

```ts
expression: text("expression"),      // flow / auxiliary 用。式の文字列
initialValue: real("initial_value"), // stock 用。初期値
value: real("value"),                // constant 用。固定値
```

### 式の評価ライブラリ: mathjs（expr-eval 禁止）

ユーザー入力や AI 生成の式文字列を評価するため、安全性が要る。

- `expr-eval`: 任意コード実行の脆弱性 CVE-2025-12735 のため使わない
- `mathjs`: `evaluate(式, スコープ)` のスコープに渡した変数しか見えない。`process` や `require` には触れられない

注意: mathjs も関数定義などの高度な機能まで許すと抜け道が出る。評価モードを制限する。

### 許可される記法（実装で確定）

`parse` した AST を走査し、以下だけを通す（`simulate.ts` の `findDisallowed`）。それ以外（代入・行列・未知の関数など）は `disallowed` エラー。

- 四則演算 `+ - * /`、単項 `+ -`、べき乗 `^`
- 変数参照（図にあるノード名）
- 関数 `min` / `max` / `clamp(x, lo, hi)` / `pow`。`clamp` は mathjs に無いので評価 scope に関数として渡す
- 関数 `smooth(x, tau)` / `delay(x, tau)`（引数 2 つ固定）。これらは scope の関数ではなく、`prepare` が隠れストックへ書き換える（7 章「遅れ」）

結果が数値でない（`pow(-8, 1/3)` の複素数など）式は `eval` エラーになる。

### 日本語ノード名の扱い（プレースホルダ置換）

mathjs は識別子に CJK を許さないため、式をそのまま parse できない。評価前に式中のノード名トークンを `_v0`, `_v1`, … の ASCII プレースホルダへ置換し（`substituteNames`）、scope もプレースホルダをキーにして評価する。結果（`series`）はノード名キーに戻して返す。`name(` 形のトークンは関数呼び出しとみなし、同名ノードがあっても置換しない。

### 式の保存時検証と黙殺（実装で確定）

- diff で `kind` を指定せず式/初期値/定数値だけ送ると、**無視して warning** を返す（`normalizeSfdFields`）。kind を決めるのは対話の責務（3 章）なので、式だけで昇格させない
- `kind` が flow/auxiliary で式が構文・記法の検証（`validateExpressionStructure`）に落ちた場合、**エラーにはせず式を null で保存し warning** を返す。変数の追加や他の更新を式 1 つの不備で丸ごと失敗させないため。参照解決（図にある名前か）は保存時には見ず、lint の `undefined-reference` と実行時の `undefined-reference` エラーで拾う
- `kind: null` を送ると未分類へ戻し、式・初期値・定数値を消す

### 式からの情報リンク導出

System Dynamics では flow/auxiliary の式が他変数に依存しているとき、その依存は図に情報リンクとして現れる。依存の真実は式にあるので、保存せず毎回導出する（`deriveDependencies`）。キャンバスは因果エッジに無い依存を破線で描き、lint は同じ集合を `missing-dependency-link` として出す。各リンクの極性は式の AST から構造的に決める（`deriveSignedDependencies`。関数の引数やべき乗の中に現れる変数は符号不定 = null）。

---

## 6. ストックがループを断ち切る（本ノートの核）

CLD のループは、計算上は「ストックを経由する時間のループ」に変わる。これが M3 全体の背骨。

CLD ではループが主役で、「疲労 → ミス → 残業 → 疲労」と循環する。式の計算もこの循環で無限ループになりそうに見えるが、ならない。ストックがループを断ち切るため。

理由は stock の評価方法にある。flow / auxiliary を計算するとき、stock は「いまの値をそのまま読むだけ」で、式で計算し直さない。stock は次のステップで「ひとつ前の自分 + 出入り」として更新される。stock は「ひとつ前の記憶」として振る舞う。

したがって:

- flow / auxiliary の式の依存は循環してはいけない（一方向。非循環 = DAG）
- ループは必ず stock を通って閉じる。flow → stock は「いま → 次」の時間の段差があり、同一瞬間の循環参照にならない

「なぜ stock という概念が必要か」の答えがこれ。stock があるからこそ、循環する世界を計算できる。4 章の「止めても在るもの」は、この「記憶」を指す。

---

## 7. シミュレーションエンジン

### 原則: 純粋・決定的・保存しない

シミュレーション結果は保存せず、図（nodes + edges）から毎回導出する。`loops.ts` / `lint.ts` / `archetypes.ts` と同じ思想。

- 保存しない: 図を 1 ヶ所いじれば結果は古くなる。毎回導出なら「図は変わったのに古いグラフが残る」不整合が起きない
- 決定的: 同じ図 + 同じ設定 → 必ず同じ結果。乱数を使わない。固定値でテストできる

配置: `src/lib/diagram/simulate.ts`（既存の導出ロジック群と同列）。純粋関数なのでサーバ・クライアント両方から呼べる。

### 入出力

```
入力                          出力
nodes (kind/式/初期値)         時系列データ
edges (依存関係)        ──→    [{ t:0, 疲労:30, ミス率:0.30, ... },
config (dt, ステップ数)          { t:1, 疲労:34, ... }, ...]
```

`simulate(nodes, edges, config)` という純粋関数。中身は準備とループの 2 段階。

### 段階 1: 準備（1 回だけ）

ループ前の下ごしらえ。毎ステップやると無駄なので 1 回で済ませる。

1. 式をパースする（mathjs でコンパイル）
2. 依存グラフを作る（各 flow/auxiliary がどのノードを参照するか抽出。stock は参照されても依存に数えない）
3. 循環チェック + トポロジカルソート。flow/auxiliary の依存が循環していたらエラーを返す。OK なら計算順を確定する

### 段階 2: ループ（dt ずつ N 回）

```
現在値 = { 各 stock の初期値, 各 constant の値 }

for (t = 0; t < ステップ数; t++) {
  ① 確定した順で flow/auxiliary を計算
       ミス率   = eval("疲労/100",     現在値)
       残業時間 = eval("8+ミス率*20",  現在値)
       残業増   = eval("残業時間*0.5", 現在値)
       回復     = eval("疲労*0.1",      現在値)

  ② 全 stock の「次の値」を計算（まだ書き換えない）
       次の疲労 = 疲労 + (残業増 − 回復) * dt

  ③ stock を一斉に書き換える
       疲労 = 次の疲労

  ④ このステップのスナップショットを記録
}
```

### 同時更新の罠（②③を分ける理由）

stock が複数あるとき、全 stock の「次の値」を計算し終えてから一斉に書き換える。

stock A を先に書き換えると、stock B の計算が「もう更新済みの A」を参照し、同一瞬間のはずが片方だけ未来になる。これがズレを生む。「②全部の次の値を箱に取る → ③せーので入れ替える」で同時刻の状態を守る。

### 数値積分: オイラー法から始める

上記は最も素朴な数値積分（オイラー法）。「次 = いま + 変化 × dt」の直線近似。

- `dt` が大きすぎると行き過ぎてカクつき、ありもしない振動・発散を起こす
- より正確な RK4（ルンゲ＝クッタ法）もあるが、最初はオイラー法でよい。コードが短く、挙動を追いやすい。`dt` を小さくすれば実用上問題ない。精度が問題化してから RK4 へ差し替える

最初から RK4 を書くのは過剰実装。

### 計算例（dt = 1）

| t | 疲労 | ミス率 | 残業時間 | 残業増 | 回復 | 次の疲労 |
|---|---|---|---|---|---|---|
| 0 | 30.0 | 0.30 | 14.0 | 7.0 | 3.0 | 34.0 |
| 1 | 34.0 | 0.34 | 14.8 | 7.4 | 3.4 | 38.0 |
| 2 | 38.0 | 0.38 | 15.6 | 7.8 | 3.8 | 42.0 |
| 3 | 42.0 | 0.42 | 16.4 | 8.2 | 4.2 | 46.0 |

R ループ（悪循環）が数列として現れている。回復の式しだいでは、どこかで釣り合って横ばい（均衡）に落ち着く場合もある。

### エッジの解釈と実行前の整合チェック

simulate が使うエッジは **flow → stock** だけ（極性 + = 流入 / − = 流出）。stock → stock や auxiliary → stock など他のエッジは stock の更新に関与せず、黙って無視される。実行して初めて分かると不親切なので、lint が warning で先に出す（`lintStockFlow`）:

| ルール | 意味 |
|---|---|
| `flow-without-stock` | flow から stock へのリンクが無い（どの量も動かさない flow） |
| `stock-without-flow` | stock に流入/流出する flow が無い（初期値のまま動かない） |
| `stock-to-stock-edge` | stock 同士のリンク（量は flow を通してしか動かない） |
| `undefined-reference` | 式が図に無い名前を参照（実行時エラーになる） |

### 設定と安全装置（実装で確定）

`SimConfig` は `dt` / `steps` に加えて:

- `overrides`: ノード名 → 値。**stock の初期値と constant の値だけ** 上書きできる。図は変更しない（what-if 用）。flow/auxiliary や未知の名前は `invalid-override`
- `nonNegativeStocks`: true なら stock を積分した直後に 0 でクランプ（在庫・人数など負が無意味な量に）
- `delaySteps`: `hasDelay` 付きリンクを何ステップ遅らせるか（既定 1、1 以上の整数）。「遅れ」節を参照
- 発散ガード: stock が非有限（Infinity / NaN）になったら `{ type: "diverged", nodeId, step }` で打ち切る。dt 過大や正帰還の暴走に気づかせるため

`dt` / `steps` は **プロジェクトに永続化する**（`projects.sim_config` の JSON。`{ dt, steps, timeUnit }`）。当初は「永続化せず UI は useState、MCP は引数」としていたが、同じ問いを見るたびに時間軸を決め直すのは無駄で、外部エージェントと UI で設定がずれる原因にもなるため 8 章 Open Questions を実装した。

- 読み書きは [`sim-config.ts`](../../src/lib/diagram/sim-config.ts)。壊れた JSON や範囲外の値は既定（dt=1 / steps=20）へ倒す
- 優先順は **引数 → 保存値 → 既定値**。`run_simulation` / `compare_scenarios` で `dt` / `steps` を渡せば 1 回限りその値で回る
- `timeUnit` は「1 ステップが何を表すか」（週 / 月 …）の表示用ラベルで、計算には使わない。聞き取りノートの `timeHorizon.unit`（ユーザーが問題を語るときの時間粒度）とは別物で、多くの場合それを叩き台に決まる
- 書き込みは MCP の `update_sim_config` と、アプリのシミュレーションパネル（入力欄を離れたときと実行時に保存）
- `delaySteps` は**永続化しない**。こちらは実行ごとの試行なので引数・入力欄のまま

### 遅れ（`hasDelay` / `smooth` / `delay`）

CLD では「効くまでに時間がかかる」リンクに遅れマークを付ける。遅れのある B ループは、行き過ぎては戻る**振動**として現れる。M3 ではこれを 2 つの入り口で数値に効かせる。使い分けは「粗いか、時定数を持つか」。

| | リンクの遅れ | 式の関数 |
|---|---|---|
| 書き方 | エッジの `hasDelay` + 実行時の `delaySteps` | `smooth(値, 時定数)` / `delay(値, 時定数)` |
| 遅れ方 | 値をそのまま n ステップずらす（パイプライン遅延） | 1 次遅れ（なまして追従する） |
| 粒度 | 実行単位で一律 | 呼び出しごとに時定数を変えられる |
| 出どころ | CLD の遅れマークをそのまま使える | 式を書くときに明示する |

**リンクの遅れ**は、CLD 段階で付けた遅れマークを SFD でもそのまま活かすための粗い遅れ。`delaySteps`（既定 1）は永続化せず、UI は入力欄、MCP は引数で受ける。効く先は 2 つ:

- flow → stock の遅れ: stock を積むとき、いまの流量ではなく `delaySteps` 前の流量を使う
- 式の参照リンクの遅れ: 式が参照している変数の値を `delaySteps` 前のものにする（例: 「認識在庫 = 在庫」のリンクに遅れを付けると、認識が n ステップ遅れる）

実装は既存の `series` を引くだけ。`series[i]` は t=i 時点の値なので、`series[max(0, t - delaySteps)]` を読めば「履歴が足りない間は t=0 の値が続いていた」とみなせる（Vensim の DELAY FIXED と同じ慣例）。専用のバッファは持たない。

参照リンクの遅れは、式の AST 中のその変数を内部エイリアスへ置き換えて実現する。**依存の抽出は置き換える前に済ませる**ので、遅れの有無で評価順序（トポロジカル順）は変わらない。遅れを入れても flow/auxiliary の循環は循環のままで、ループは従来どおり stock を通って閉じる。

**式の関数** `smooth(x, tau)` / `delay(x, tau)` は 1 次遅れ（`ds/dt = (x − s) / tau`）。中身は同じで、smooth = 情報の平滑化 / delay = 物質の遅れ、という意味づけだけが違う。呼び出し 1 つにつき隠れストックを 1 つ持ち、stock と同じタイミング（②③ の同時更新）で積む。初期値は t=0 の入力値（最初は釣り合っている前提）。入れ子（`smooth(smooth(x,2),2)`）は内側から順に隠れストック化される。時定数が 0 以下なら `eval` エラー、隠れストックが非有限になれば `diverged`。

隠れストックは `nonNegativeStocks` のクランプ対象ではない（均している対象が負を取りうるため）。

### 結果の要約（`sim-summary.ts`）

外部エージェント（MCP）には全ステップを返さず、stock ごとの `{ initial, final, min, max, trend, pattern }` と等間隔に間引いた series（既定 21 点）を返す。`pattern` は聞き取りノートの時間挙動（BOT）と同じ語彙（increasing / decreasing / oscillating / plateau / improved-then-worse / other）で、値域に対する相対判定で決める（有意な向きの反転 2 回以上 = oscillating、単調増加で末尾が平ら = plateau など）。ノートの `behavior.pattern` とどの stock も一致しなければ `mismatch` を添え、構造と実感のずれを対話へ戻す。`final` は series 末尾の値。

### MCP から回す

- `run_simulation({ projectId, dt?, steps?, overrides?, nonNegativeStocks? })`: 要約 + 間引き series + SFD lint の warning + mismatch。失敗時は `SimError` をそのまま構造化して返す（`ok: false`）
- `compare_scenarios({ projectId, dt?, steps?, scenarios: [{ label, overrides }] })`: baseline（上書きなし）と各シナリオを同じ設定で回し、stock ごとの要約と baseline に対する `final` の差分（`delta`）を並べる。不正なシナリオはそのシナリオだけ error になり、他を巻き込まない

---

## 8. 実装の段取り（済）

1. スキーマ拡張（`expression` / `initialValue` / `value` 列、マイグレーション）— 済
2. 昇格 UI（kind を AI が提案 → ユーザー確定）— 済
3. 式の保存と検証（依存抽出、循環チェック、mathjs 制限モード）— 済
4. シミュレーションエンジン（`simulate.ts`、純粋関数）— 済
5. グラフ描画（クライアントでインタラクティブに再計算）— 済（SVG 自前描画。ライブラリは使っていない）
6. MCP から回す（`run_simulation` / `compare_scenarios`、要約、SFD lint、関数ホワイトリスト）— 済
7. 遅れの反映（`hasDelay` × `delaySteps` のパイプライン遅延、式の `smooth` / `delay`）— 済
8. 昇格の支援（`suggestKinds` / `sfdHints` / inspector の提案）と設定の永続化（`sim_config`）、聞き取りの `quantify` フェーズ — 済

### 決まったこと

- `dt` / `steps` / `timeUnit` はプロジェクトに永続化する（`projects.sim_config`）。`delaySteps` と `overrides` は実行ごとの引数のまま
- 初期値の上書き・シナリオ比較は `overrides` として**実行時の引数**で受け、保存しない
- 遅れは 2 段構え。CLD の `hasDelay` は実行時の `delaySteps` で一律に効かせ、リンクごとの時定数が要るときは式の `smooth` / `delay` を使う。リンクごとの遅れ量は列として持たない
- kind の昇格候補は決定的なヒューリスティックで出し、確定は必ず人が行う（3 章）

### Open Questions（未決）

- シナリオ（`overrides` の組み合わせ）の永続化。dt / steps は永続化したが、シナリオは名前付きで保存する器が要るので別途
- 単位の整合チェックをどこまでやるか（`unit` を読むのは `suggestKinds` だけで、`unit-mismatch` lint は未実装）
- 昇格ヒューリスティックの語彙をどう育てるか（今は小さな辞書。誤検知が続く語を運用しながら足し引きする）
- 式エディタの UX（補完、ノード名参照の入力支援）
- 数値積分の精度（オイラー法のまま。RK4 が要るかは実例待ち）

---

## 9. 罠・注意メモ

- 同時更新: stock が複数なら「全 stock の次の値を計算 → 一斉更新」を守る（7 章）
- dt 過大: オイラー法は `dt` が大きいと発散・振動する。小さくするか RK4 へ
- mathjs 制限モード: 四則演算・べき乗・参照・ホワイトリスト関数（min/max/clamp/pow/smooth/delay）に絞る。関数定義などを許さない。許可記法を増やすときは `simulate.ts` の whitelist と、`diff-schema.ts` / `prompts/interview.ts` の AI 向け文言を同時に更新する
- 遅れの二重掛け: 同じ関係にリンクの `hasDelay` と式の `smooth` の両方を掛けると遅れが重なる。どちらか一方で表す
- 循環の扱い: flow/auxiliary の依存は非循環（DAG）。ループは stock を通って閉じる。循環をエラーにする際は「stock を挟まないと閉じない」とユーザーに伝える
- 発散: stock が非有限になったら `diverged` で打ち切る。flow 側が先に非有限になると `eval` エラーになる（どちらも「式か dt を見直す」合図）
- エッジの黙殺: simulate は flow → stock 以外を無視する。図の上では意味がありそうなエッジが計算に効かないことがあるので、SFD lint の warning を必ず見る
