# interlink

問いの構造を、図にする。

構造的な悩みを AI との対話で聞き取り、システム思考の因果ループ図（CLD）を自動生成・編集できるアプリ。将来的にはストック&フロー図への変換とシステムダイナミクスシミュレーションまでを目指す。

## 技術スタック

- Next.js 16 (App Router) / React 19 / TypeScript
- Hono（`/api` 配下の RPC）+ Better Auth（Google OAuth）
- Turso (libsql) + Drizzle ORM
- AI SDK v6 + Vercel AI Gateway
- @xyflow/react（因果ループ図キャンバス）+ d3-force
- Tailwind CSS v4 + shadcn/ui
- Biome / Lefthook / Vitest

## セットアップ

```sh
pnpm install
cp .env.example .env  # 値を設定
pnpm db:migrate       # ローカルは file:local.db に適用される
pnpm dev
```

環境変数は [.env.example](.env.example) を参照。

- DB: 未設定なら `file:local.db`（ローカル開発はそのままで OK）
- チャット機能には `AI_GATEWAY_API_KEY`（[Vercel AI Gateway](https://vercel.com/docs/ai-gateway)）が必要
- Google ログインを実クレデンシャルなしで動かす場合は `pnpm dev:preview`（`@emulators/google` による OAuth エミュレータが有効になる）

### AI_GATEWAY_API_KEY は fnox（age 暗号化 + macOS Keychain）で渡す

`.env` には書かず、[fnox](https://fnox.jdx.dev/) で管理する。値は age 公開鍵で暗号化して `fnox.toml`（暗号文なので git コミット可）に格納し、復号鍵だけ macOS Keychain に置く。

```sh
# 値を投入/更新するとき（プロンプトに貼り付け。画面にも履歴にも残らない）
fnox set AI_GATEWAY_API_KEY -p age

# 起動: fnox.toml のあるディレクトリに cd すれば .zshrc の `fnox activate` が自動注入する
pnpm dev:preview

# activate を入れていない環境（GUI 起動 / cron / 非対話シェル等）は明示注入
fnox exec -- pnpm dev:preview
```

モデルは既定で `google/gemini-2.5-flash`（無料枠で動作確認済み）。`anthropic/claude-sonnet-4-6` 等へは `AI_GATEWAY_MODEL` で差し替え可能だが Vercel 有料クレジットが必要（`gemini-2.5-flash-lite` はツールを呼ばないため不可）。

## コマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` | 開発サーバ |
| `pnpm dev:preview` | OAuth エミュレータ付き開発サーバ |
| `pnpm check` | biome + 型チェック |
| `pnpm test` | vitest（unit / db） |
| `pnpm db:generate` / `db:migrate` | Drizzle migration |

## 構成

- `src/app` — ルーティング。ページ固有の部品は `_components` / `_actions.ts` に co-locate
- `src/server` — Hono app（チャット API・認証ルーティング）
- `src/db/schema.ts` — 全テーブル定義。CLD のノードは `kind` 列で将来ストック&フロー役割へ段階昇格する設計
- `src/lib/queries` — server-only の読み取り層
- `src/lib/diagram` — 図の diff 検証・適用（AI 出力をサーバ側で決定的に検証する）
- `src/lib/prompts` — システムプロンプト
