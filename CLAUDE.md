# interlink

問いの構造を図にするアプリ。チャット聞き取り → 因果ループ図（CLD）生成・編集 → 検証（M2 済み）→ ストック&フロー + シミュレーション（M3 予定）。

## dev server の起動（重要）

`AI_GATEWAY_API_KEY` は `.env` でなく **envchain の `interlink` namespace**（macOS Keychain）に入っている。チャット機能を動かすには必ず envchain 経由で起動する:

```sh
envchain interlink pnpm dev:preview
```

- envchain を忘れるとページは表示されるがチャット送信だけ失敗する
- `pnpm dev:preview` は OAuth エミュレータ付き（Google 実クレデンシャル不要）。ログインはエミュレータ画面で任意のメールを入力
- モデル差し替えは `AI_GATEWAY_MODEL`（`<provider>/<model>` 形式、既定 `anthropic/claude-sonnet-4-6`）

### モデル選定の注意（2026-06 時点の実測）

- Vercel 無料枠では既定の `anthropic/claude-sonnet-4-6` が **403**（RestrictedModelsError）になる。有料クレジット投入で解禁
- 無料枠で使うなら `AI_GATEWAY_MODEL=google/gemini-2.5-flash`（updateDiagram ツール実行まで動作確認済み）
- `google/gemini-2.5-flash-lite` は「修正します」と言いながら**ツールを呼ばない**ので使わない

## 規約（lull 踏襲）

- 読み取り = `src/lib/queries/`（server-only + React cache）/ 書き込み = ページ co-located `_actions.ts` / RPC が要るものだけ Hono routes（`src/server/`）
- アイコンは @phosphor-icons/react（lucide 禁止。shadcn 生成物の lucide import は置換する）
- `pnpm check`（biome + 型）と `pnpm test`（unit / db）を変更後に通す
- DB はローカル `file:local.db`。テストデータの直接投入は sqlite3 で可（timestamp はミリ秒）

## ドメイン知識

- ループ・R/B 極性・lint・原型は**保存せず毎回導出**（`src/lib/diagram/loops.ts` / `lint.ts` / `archetypes.ts`）。R/B はループ内負リンク数の偶奇で決まる
- ノードは `kind` 列（現状 null）で将来ストック/フロー/補助変数へ段階昇格する設計。CLD/SFD の二重管理をしない
- AI の図更新は diff 形式 → サーバ側で決定的に検証（`apply-diff.ts`）してから適用
- 数式評価は mathjs を使う予定（expr-eval は CVE-2025-12735 のため禁止）

## 既知の罠

- `.ink-in` アニメーション（`animation-fill-mode: both`）は transform / opacity を終端値で保持し続けるため、インライン transform や opacity クラスと同居させると上書きされる。位置決め・減光は別のラッパー要素に分離する（M1 / M2 で各 1 回踏んだ）
