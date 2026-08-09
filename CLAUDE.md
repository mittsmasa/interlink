# interlink

問いの構造を図にするアプリ。チャット聞き取り → 因果ループ図（CLD）生成・編集 → 検証（M2 済み）→ ストック&フロー + シミュレーション（M3 予定）。

## dev server の起動（重要）

`AI_GATEWAY_API_KEY` / `BETTER_AUTH_SECRET` などは **fnox**（age 暗号化 + macOS Keychain）で管理。`dev` / `dev:preview` は script 自体が `fnox exec` を挟むので、非対話シェル（GUI 起動 / cron / エージェント経由）でもそのまま起動できる:

```sh
pnpm dev:preview
```

- `build` は fnox を挟んでいない。Vercel のデプロイビルドには age 鍵も Keychain も無く、`fnox exec` を入れると壊れるため。ローカルで本番ビルドを確認するときだけ `fnox exec -- pnpm build` と明示する（省くと better-auth が既定 secret の警告を出す）
- secret が無いとページは表示されるがチャット送信だけ失敗する
- `pnpm dev:preview` は OAuth エミュレータ付き（Google 実クレデンシャル不要）。ログインはエミュレータ画面で任意のメールを入力
- モデル差し替えは `AI_GATEWAY_MODEL`（`<provider>/<model>` 形式、既定 `google/gemini-2.5-flash`）

### モデル選定の注意（2026-06 時点の実測）

- 既定の `google/gemini-2.5-flash` は無料枠で updateDiagram ツール実行まで動作確認済み
- `anthropic/claude-sonnet-4-6` は品質最良だが Vercel 無料枠では **403**（RestrictedModelsError）。有料クレジット投入後に `AI_GATEWAY_MODEL` で切り替える
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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
