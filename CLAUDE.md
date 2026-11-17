# loss-note

トレードの **損失ノート**（売買の記録と振り返り）の SaaS。トレーダーが売買を記録し、気づきを結び付け、集計と AI の振り返りで「同じ負け方を繰り返さない」ようにする。リポジトリは **公開**。

規約は `../option-simulator` の CLAUDE.md・`.claude/skills/` から、プロジェクト固有の部分を除いて移植した（2026-11-17）。

## 目的（すべての判断の基準）

裁量トレードで最も大切なのは **損失のコントロール**。「エントリーの根拠が崩れた」と判断できる状態（例: 価格が思惑と逆に動き、サポートと見ていた価格を割った）になったときに決済できていて、かつ損失が許容範囲（資金の 1〜2%）に収まっていること。

それには、ポジションを持つ時点で次を決めておく必要がある。

1. 明確な **エントリーの根拠**
2. その根拠が **崩れる条件 = LC**（金額ではなく、思惑が外れたと確認できる価格）
3. **TP**（エントリー時の根拠からの推定でよい）
4. LC での損失が資金の 1〜2% に収まる **数量**

このアプリは、それが **できているかを振り返り、客観視し、心理的な影響を排除できるようになるための道具**。機能・画面・指標は、計画（エントリー時に決めたこと）と実行（実際の決済）を比べられるかどうかで判断する。

**この開発の動機は「入力が面倒で記録が続かない」こと**（オーナー「そう！！！！！！！それ！この開発の動機もそれ！」）。スプレッドシートでは、良い列を足しても入力が重くて運用されなくなった。記録の手間の予算（**事後に 1 回、30 秒以内**。設計書 1.1 の 0）を第一原則にし、入力を増やす機能はその予算と引き換えにする。入力は事後が基本（オーナー「事後で良い気がするけどね。入力は」）で、中心は決済明細のスクショ（事実）と根拠にした足のチャートのスクショ（証拠）。手で入れるのは LC と崩れの条件の一言、それに 3 つのタップ（LC を入る前に決めていたか・LC を動かしたか・時間足を変えたか）だけ。

## 決まっていること（2026-11-17）

- SaaS として提供する。リポジトリは公開で、作りは誰でも clone して自分の環境で使える汎用のものにする（下の「リポジトリに置くもの / 置かないもの」）
- 画面は **モダンでかっこいい Web の SPA**（シングルページアプリ）。見た目と操作の気持ちよさを機能と同じ重さで扱う（オーナー「かっちょいいモダンなWebベースのSPAにしようよ」）
- スタックは option-simulator と同じ: GCP（Cloud Run・Terraform・Firestore）、画面は TypeScript + Vite + Preact、API は Python（Flask / gunicorn、uv）
- 本番は loss-note 専用の GCP プロジェクト（optionchan とは分ける）
- MVP は無料。課金は後の EPIC で足す
- MVP の範囲: 記録と一覧 / 気づきと集計 / AI の振り返り
- スプレッドシート「損失ノート」はオーナー自身のデータを一度だけ移すためのもの（製品の機能にしない。移行の手段は使い捨てでよく、実データはリポジトリに入れない）

## 元データ（オーナーの Google スプレッドシート「損失ノート」。データ構造の参考）

タブは 3 つ。

- **損益**: 1 行 1 トレード。列は 日時 / 銘柄（マスタのプルダウン）/（非表示の列）/ イン / 数量 / 取引（L / S）/ TP / LC / C（決済）/ 為替 / 損益 / 損失種別（A / B）/ 優位性 / 総評 / チャート 1〜3（画像）。損益 = (C − イン) × 数量 × 為替（S は符号が逆）
  - 損失種別（オーナーの定義。アプリはこれに従わなくてよい）: **A** = いい損失（決めた LC ポイントで LC）/ **B** = 悪い損失（LC を下げた、過剰リスク、許容リスクありきの LC ポイントなど）/ **C** = 極悪な損失（LC を決めておらず LC が遅れた）。シートでは A / B だけが使われている
  - 非表示の列（実際には運用していなかったらしい）: 実際に行った取引は「○」、躊躇したり入れなかった取引は「×」とし、そのときの感情を記録する。見える列の「優位性」にも【○】【×】の書き込みがある
- **気づき**: 日付 / 内容。トレードの振り返りで得た気づきを自由記述で残す
- **マスタ**: 銘柄 / 説明。損益タブの銘柄の選択肢（株価指数・VIX・FX・商品・仮想通貨）

## 作り

設計は `docs/design.md`（第 2 版）。

| パス | 役割 |
|---|---|
| `ui/` | 画面（Vite の root）。`index.html`・`src/main.tsx`（起動。テーマを描く前に当て、実物の history・localStorage を渡す）・`src/App.tsx`（アプリの殻）。`src/styles/`（`tokens.css` = 色・文字・余白などのトークン。色の値はテーマの 2 つの定義の中だけ、`base.css`・`layout.css`・`components.css`）、`src/lib/`（整形 `format.ts`・判定のバッジ `badge.ts`・テーマ `theme.ts`・経路 `routes.ts`・`/api` の窓口 `api.ts` の純関数と、履歴の薄い層 `router.tsx`。テストは `tests/ui/`）、`src/components/`（部品）、`src/auth/`（ログイン: 接続先 `config.ts`（開発のときだけの既定値は `devDefaults.ts`。本番のビルドに入らない）・門の純関数 `gate.ts`（見た目の門。守りは #4 の API）・失敗の文言 `errors.ts`・打ち切りの純関数 `race.ts`・Firebase Authentication の薄い層 `session.ts`（`/api` への要求 `api` もここ）。ADR-0003）、`src/layout/`（枠と行き先）、`src/pages/`（画面。`pages/dev/` は開発の時だけの部品の見本 `/dev/parts` とその CSS `parts.css`。本番のビルドに入らない）。画面の原則は `docs/ui-guidelines.md`。ビルド結果は `dist/`（コミットしない） |
| `core/` | 計算・判定の純関数（TypeScript。設計書 5 章）。入口は `evaluate.ts` の `evaluateTrade`（検査 → 数値 → 判定）。`trade.ts` = 計算の入力の型（保存の形はこれに写す）、`numeric.ts` = 誤差の約束と刻みの切り捨て、`validate.ts` = 入力の検査（LC の向き・有限でない数）、`pnl.ts` = 損益（円）・R 倍数・1R・リスク（%）、`sizing.ts` = 数量の提案、`pre-plan.ts` = 事前の計画あり、`judge.ts` = 判定（A / B / C・危ない勝ち・計画どおりの勝ち）と理由、`record.ts` = 保存の形（記録の API が返す取引・銘柄・設定の型）と計算の入力への写し `toTradeInput`（銘柄の値・資金は取引の `snapshot` だけから取る。C36） |
| `tests/` | 画面と `core/` のテスト（vitest）。ソースに対応して `tests/ui/`・`tests/core/` に置く。設計書 5.6 の例の表のテスト（`tests/core/design-table.test.ts`）は設計書の表を読んで `#` の列で行を数える（表に行を足したら `tests/core/design-table-cases.ts` に場面を足し、`UPDATE_FIXTURES=1 npx vitest run tests/core/record.test.ts` で fixture を作り直す）。`tests/fixtures/records/` は TS と API のテストが共有する合成の保存の形（5.6 の全場面の `design-table.json` と、全項目の取引の `full-record.json`） |
| `api/` | API（Python 3.13・Flask・uv。ADR-0004）。`src/loss_note_api/`: `app.py` = 入口 `create_app(env, store=, clock=)`、`runtime.py` = 起動の判定の純関数 `decide_runtime`（エミュレーターの接続先があってプロジェクト ID が `demo-` で無ければ起動しない）、`auth.py` = ID トークンの検証（firebase-admin）と `check_claims`、`schema.py` = 本文の検査の純関数（C11・入力の上限）、`store.py` = 保存先の約束 `Store` と `FirestoreStore`、`routes.py` = 記録の API（取引・銘柄・設定）、`logs.py` = 構造化ログ（中身・メール・トークンを出さない）。テストは `api/tests/`（pytest。記憶の保存先 `tests/helpers/memory_store.py` とエミュレーターの Firestore の両方で同じテストを回す）、エミュレーターの結合のテストは `api/tests/emulator/` |
| `tools/statement-eval/` | 決済明細の AI による読み取りを測る道具（Python 3.13・uv の独立したプロジェクト。アプリの依存ではない。#14・ADR-0001）。採点の純関数は `src/statement_eval/score.py`（テストは `tests/test_score.py`）、合成の明細（架空の値の画像・正解）は `synthetic/`（`python -m statement_eval generate` で作り直す）。実物の明細と正解は `data/local/statement-eval/real/` だけに置く。実際の AI を呼ぶのは手元で `eval` を回したときだけ（依存グループ `ai`・資格情報の環境変数） |
| `scripts/` | 手元の道具（`emulators.sh` = エミュレーターの起動、`check-pinned.mjs` = 直接の依存が正確な版かの検査、`ui-check.mjs` = 画面の検査 `npm run ui:check`（Playwright。手元だけ。Auth のエミュレーターが動いていること）） |
| `.github/` | CI（`workflows/ci.yml`）とビルド成果物の検査（`scripts/csp-check.sh`・自己テスト `csp-check.test.sh`） |
| `firebase.json`・`firestore.rules`・`storage.rules` | 手元のエミュレーター（Firestore・Auth・Storage）の設定。ルールはすべて拒否（画面から直接読み書きさせない） |
| `docs/` | 設計書・ADR |
| `data/local/` | 手元だけのデータ（gitignore）。実際の記録の写しと、エミュレーターの書き出し `data/local/emulator/`。開発サーバーからも配らない（`vite.config.ts` の `server.fs.deny`） |

- **計算を置く場所**: 損益・R・判定・集計などの計算は `core/` の副作用の無い純関数に置き、DOM・通信・Firebase を import しない。テストは `tests/core/` で、架空の値の手計算の例と性質テストで固定する。画面の整形のロジックも DOM から切り離した関数にしてテストする
- **データの読み書きの経路**: 画面 → `/api/...`（同一オリジン。開発時は Vite の proxy が API へ渡す）→ API → Firestore / Storage（手元はエミュレーター、本番は後の Issue）。画面は Firestore / Storage を直接読み書きしない。API は ID トークンを検証し `users/{uid}/...` だけを読み書きする（ほかの利用者の記録は 404）。取引は記録したときの銘柄の値・資金・許容リスクを `snapshot` に写して持ち、判定・R は保存しない。画面が `core/record.ts` の `toTradeInput` で計算の入力に写す
- **手元のポート**: 画面の開発サーバー 5173 / API 8000 / Firestore 8080 / Auth 9099 / Storage 9199 / エミュレーターの UI 4000・hub 4400。エミュレーターのプロジェクト ID は架空の `demo-loss-note`（GCP のプロジェクトもログインも要らない）

## 開発

確認コマンド（CI と同じもの。手元は `mise exec -- bash -c '<この 1 行>'` で Node 24・uv・Java を使う。`npm run test:api:emulator` はエミュレーターを自分で起動して API のテストを流すので、`npm run emulators` を動かしているとポートがぶつかる。止めてから流す）:

```
npm ci && npm run check:pinned && npm run typecheck && npm run lint && npm test && npm run build && .github/scripts/csp-check.test.sh && .github/scripts/csp-check.sh dist/index.html && (cd api && uv sync --locked && uv run --locked ruff check && uv run --locked pytest -q) && npm run test:api:emulator && (cd tools/statement-eval && uv sync --locked && uv run --locked ruff check && uv run --locked pytest -q)
```

スキル（`.claude/skills/implement-issue` ほか）はこの確認コマンドを検証の正として使う。画面を触る PR は、あわせて `npm run ui:check`（画面の検査。CI には入れない）を手元で流し、出力の要約を PR に貼る（`docs/ui-guidelines.md` 6 章）。Terraform の検査（fmt・validate・test）は `infra/` を作る Issue で足す。

- 手元の道具の版は `mise.toml` でパッチまで固定する（Node 24.22.3・Java 21.0.13（Temurin。エミュレーター用）・uv 0.13.6）。Node の版は `.node-version`（CI が読む）、uv の版とハッシュは `.github/uv-requirements.txt`（CI が pip の `--require-hashes` で入れる）にも書いてあるので、変えるときは両方を直す。Python 3.13 は uv が `api/.python-version`・`tools/statement-eval/.python-version` を見て入れる
- 手元の起動は `README.md`（`npm run emulators`・`npm run dev:api`・`npm run dev`）
- 依存はバージョンを固定する（lock ファイルをコミットする）。画面の直接の依存は正確な版（`.npmrc` の `save-exact=true`。`npm run check:pinned` で検査）、API は `api/pyproject.toml` の範囲 + `[tool.uv] exclude-newer` + `api/uv.lock`（`tools/statement-eval/` も同じ形。AI の SDK は依存グループ `ai` に入れ、確認コマンドと CI では入れない）。CI は `npm ci` と `uv sync --locked`（lock と食い違うと失敗）
- 直接の依存は、公開から 14 日以上たった版を使う（サプライチェーン対策）。npm は `npm view <pkg> time --json` で公開日を調べる。API は `exclude-newer` の日付を進めて `uv lock` する（API は推移的な依存にも同じ日付の上限が掛かる。画面の推移的な依存には日付の上限をまだ掛けていない）
- 設計判断は必要に応じて `docs/adr-NNNN-<slug>.md`（0001 から連番。状態・日付・背景・決定・選択肢・結果・関連）に残す

## 作業の進め方

- Issue の起票・実装はスキルを Skill ツールで呼んで、その手順どおりに進める（SKILL.md を読んで手でなぞらない）
  - `/create-issue`: Issue を骨格で起票する
  - `/create-epic`: 複数の Issue を束ねる EPIC を作る・再整理する
  - `/implement-issue`: リファインメント → 計画 → 実装 → 独立レビュー → PR →（あれば）デプロイ
  - `/implement-issue-lite`: why / what / AC が揃った小さな変更の簡易フロー（ユーザーが明示したときだけ）
  - `/implement-epic`: EPIC の子 Issue を依存順に `/implement-issue` へ渡す
- レビューの指摘は block でなくても、直せるもの（端のケース・取りこぼし・文書）は同じ PR で直す。残すのは設計判断やスコープの拡大になるものだけで、理由を PR に書く
- 作業用ファイル（handoff など）は `.claude/handoff/`（gitignore）に置く。`/tmp` は再起動で消える

## リポジトリに置くもの / 置かないもの

リポジトリは公開で、誰でも clone して自分の環境で使える **汎用の作り** にする（公開しても困らない内容だけを置く）。オーナーの環境の値は変数で受け取り、コードに埋め込まない。

**置くもの**: コード、テストと合成の fixture、`docs/`、`.claude/skills/`、この `CLAUDE.md`。

**置かないもの**（コミットにも Issue / PR 本文にも入れない）:

- **実際の売買の記録**（オーナー・利用者の損益・気づきの中身、建玉・約定・口座残高・損益の実額、チャートのスクリーンショット）。個人の金銭の情報なので、テストは架空の値で作った合成のデータを使う。実データの写しは `data/local/`（gitignore）に置き、件数・割合などの要約だけを Issue / PR に書く。本番のデータを調べるときも、Issue / PR / ログには件数・要約だけを書く
- 利用者の個人情報（メールアドレス・ユーザー ID と記録の対応）
- 特定の利用者の値（スプレッドシートの ID・URL、GCP のプロジェクト ID・番号、バケット名、Cloud Run の URL、GitHub のオーナー名・リポジトリ名、メールアドレス、ホームディレクトリのパス）。コード・設定は変数で受け取り、docs の例は `<PROJECT_ID>`・`<SHEET_ID>`・`<OWNER>/<REPO>` などのプレースホルダにする
- アクセストークン、OAuth クライアントのシークレット、サービスアカウント鍵、署名付き URL
- `.claude/settings.local.json`、作業用ファイル（`.claude/handoff/`、`.claude/worktrees/`、一時ディレクトリ）

リポジトリ名は `gh repo view --json nameWithOwner -q .nameWithOwner` で取る（書き込まない）。

コミット前に `git status --porcelain` で上記が含まれていないことを確認し、`git add -A` / `git add .` は使わず個別に `git add` する。

## 数値の約束

- 金額は円。外貨建ての損益は「為替」列のレートで円に直した値を正とする
- 本文・テストの価格・損益の例は **架空の値**（実際の記録を写さない）

## 言葉と文書の書き方

- 返答・報告・文書は日本語で、丁寧な言葉遣い（です・ます）で書く
- 相場の言葉（建てる・玉・枚・LC・TP・リバ・ロング / ショートなど）はそのまま使い、言い換えない。直すのはプロジェクトの中でできた造語と、文として不自然な日本語だけ
- `README.md` と利用者向けの文書は初めて読む人向けに書く。開発中のやり取りでできた内輪の言葉を看板にしない
