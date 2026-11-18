# loss-note

トレードの **損失ノート** です。売買を記録し、エントリーの時点で決めたこと（根拠・LC・TP・数量）と実際の決済を比べて、「同じ負け方を繰り返さない」ための振り返りを助けます。

いまは開発の土台（画面のデザインの土台と各画面の骨組み、ログイン、記録の API（取引・銘柄・設定）、確認コマンド、手元で動かす手順）と、記録する画面（決済明細のスクショを貼るか手で入れて、LC・3 つのタップを入れると、判定・理由・R がその場で出て保存されます）があります。設計は [`docs/design.md`](docs/design.md) にあります。

## 前提の道具

- [mise](https://mise.jdx.dev/)（道具の版をそろえるために使います。リポジトリの `mise.toml` に Node 24.22.3・Java 21（Temurin 21.0.13）・uv 0.13.6・terraform 1.17.1 の版が書いてあります）
- git・curl

```sh
git clone https://github.com/<OWNER>/<REPO>.git
cd <REPO>
mise trust && mise install
mise exec -- npm ci
(cd api && mise exec -- uv sync --locked)
```

以下のコマンドは、mise を有効にしたシェル（`mise activate`）か、`mise exec -- <コマンド>` で実行してください。Python 3.13 は uv が `api/.python-version` などを見て用意します。

## 手元で動かす

端末を 3 つ開き、それぞれで次を起動します。

| 端末 | コマンド | 起動するもの |
|---|---|---|
| 1 | `npm run emulators` | Firebase のエミュレーター（Firestore 8080・Auth 9099・Storage 9199、UI 4000） |
| 2 | `npm run dev:api` | API（8000）。エミュレーター（架空のプロジェクト ID `demo-loss-note`）に繋ぎます |
| 3 | `npm run dev` | 画面の開発サーバー（5173）。`/api` は API に渡します |

エミュレーターのプロジェクト ID は架空の `demo-loss-note` です。GCP のプロジェクトやログインは要りません。初回の起動ではエミュレーターの本体（jar）を取得します。

ブラウザで <http://localhost:5173/> を開くと画面が出ます。応答は次のように確かめられます。

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/            # 画面: 200
curl -s http://localhost:5173/api/health                                   # API の生存確認: {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/            # Firestore: 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9099/            # Auth: 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9199/            # Storage: 応答があれば動いています（501 が返ります）
```

### 取引を手で記録する

ログインして [記録する] を開き、銘柄・L / S・イン・決済・数量・決済の時刻、LC（決めていなかったときは［なし］）、3 つのタップ（LC を入る前に決めていたか・LC を動かしたか・時間足を変えたか）を入れると、判定（A / B / C・危ない勝ち・計画どおりの勝ち）・理由・R がその場で出ます。足りない欄はボタンの上に名前で出ます。[記録する] で保存し、[次の取引を記録] で次へ進みます。銘柄が一覧に無ければ、名前だけで銘柄を足します（乗数 1・価格の通貨 未設定）。入力の途中の値は端末に保存しないので、画面を離れると消えます。

### 決済明細のスクショから記録する

記録する画面に決済明細のスクショを貼る（PC は画面を開いたまま Ctrl+V、スマホは [スクショを選ぶ]）と、画像を端末で描き直して（PNG か JPEG・500,000 B 以下・長辺 2,000 px 以下）読み取りに送り、銘柄・L / S・イン・決済・数量・時刻・損益・手数料の欄に「読み取り」の印つきで入れます。読み取りを待つ間も LC・一言・3 つのタップを入れられます。読み取りには API の AI の資格情報が要ります（下の「決済明細の読み取りを試す」）。資格情報が無いときは「今は読み取りを使えません。手で入れてください。」が出て、同じ欄に手で入れて記録できます。明細の画像と読み取りの結果は端末にもサーバーにも保存しません。

開いてから判定が出るまでの秒数の測り方は [`docs/record-timing-check.md`](docs/record-timing-check.md) にあります。

## 止める・データの置き場

- エミュレーターは **Ctrl+C で止めてください**。止めるときにデータを `data/local/emulator/` に書き出し、次の `npm run emulators` で読み込みます
- 強制終了（`kill -9`・端末ごと閉じるなど）では書き出さないので、**最後に Ctrl+C で止めた時点のデータに戻ります**。強制終了のあとに Firestore のエミュレーター（java）が残ってポートがふさがっていたら、その java のプロセスを止めてから起動し直してください
- `data/local/` は git に無視されていてコミットされません。画面の開発サーバーからも配りません
- データを消して最初からにするときは、エミュレーターを止めてから `data/local/emulator/` を消します

### 記録の API を試す・データが残ることを確かめる（合成のデータ）

記録の API（`/api/trades`・`/api/instruments`・`/api/settings`）は、要求の `Authorization: Bearer <ID トークン>` を確かめ、その利用者の記録だけを読み書きします。手元では Auth のエミュレーターが出す ID トークン（署名がありません）を受けます。本番は使える利用者の許可リスト（環境変数 `LOSS_NOTE_ALLOWED_EMAILS`。カンマ区切りのメール）にある、確かめ済みのメールの利用者だけが使え、ほかは 403 になります（未設定なら誰も使えません）。手元のエミュレーターでは、この変数が無ければ制限しません（変数を置けば本番と同じに効きます。[`infra/README.md`](infra/README.md)「ログインと使える利用者」）。これを受けるのは、エミュレーターの接続先があり、プロジェクト ID が `demo-` で始まるときだけです（そうでない設定で接続先があると API は起動しません。[`docs/adr-0004-records-api-auth-and-storage.md`](docs/adr-0004-records-api-auth-and-storage.md)）。

`npm run emulators` と `npm run dev:api` を起動した状態で、架空の利用者を作り、銘柄・設定・取引を 1 つずつ作ります（値はすべて架空です）。

```sh
API=http://127.0.0.1:8000/api
json() { node -pe "JSON.parse(require('fs').readFileSync(0, 'utf8')).$1"; }
# Auth のエミュレーターに架空の利用者を作り、ID トークンを取る
TOKEN=$(curl -s -X POST -H 'Content-Type: application/json' \
  'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key' \
  -d '{"email":"test@example.com","password":"synthetic-pass","returnSecureToken":true}' | json idToken)
AUTH="Authorization: Bearer $TOKEN"
# 銘柄・設定・取引
INSTRUMENT=$(curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' "$API/instruments" \
  -d '{"name":"TEST","priceCurrency":"JPY"}' | json id)
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' "$API/settings" \
  -d '{"capitalYen":1000000,"riskTolerancePct":1,"performanceUnit":"R"}'
curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' "$API/trades" -d '{
  "status":"closed","source":"manual","instrumentId":"'"$INSTRUMENT"'","side":"L","lc":99.5,
  "lcDecidedBeforeEntry":true,"lcMove":{"kind":"none"},"timeframeChange":"none",
  "entries":[{"price":100,"quantity":10000}],"exit":{"time":1700000000000,"price":99.5,"reason":"lc"}}'
# Storage に画像を 1 枚（中身は何でもかまいません。ファイルを作らずに本文で送ります）
curl -s -X POST -H 'Authorization: Bearer owner' -H 'Content-Type: image/png' --data-binary 'synthetic' \
  'http://127.0.0.1:9199/upload/storage/v1/b/demo-loss-note.appspot.com/o?uploadType=media&name=synthetic.png'
```

エミュレーターを Ctrl+C で止めて `npm run emulators` で起動し直し（API は動かしたままでかまいません）、同じ利用者でログインし直して読み出します。

```sh
TOKEN=$(curl -s -X POST -H 'Content-Type: application/json' \
  'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key' \
  -d '{"email":"test@example.com","password":"synthetic-pass","returnSecureToken":true}' | json idToken)
AUTH="Authorization: Bearer $TOKEN"
curl -s -H "$AUTH" "$API/trades"         # 止める前に作った取引
curl -s -H "$AUTH" "$API/instruments"    # 銘柄
curl -s -H "$AUTH" "$API/settings"       # 設定（資金の履歴つき）
curl -s -H 'Authorization: Bearer owner' \
  'http://127.0.0.1:9199/download/storage/v1/b/demo-loss-note.appspot.com/o/synthetic.png?alt=media'
```

トークンが無い・壊れている・期限切れなら 401、ほかの利用者の記録は 404、形に合わない本文は 400 で、何も保存しません。手元の開発サーバー（`npm run dev:api`）は要求のパス（取引・銘柄の ID を含む）をログに出しますが、記録の中身・メール・トークンは出しません。

### 決済明細の読み取りを試す（実際の AI を呼びます）

`POST /api/statement-reads` は、決済明細の画像 1 枚（PNG / JPEG・500,000 B 以下・長辺 2,000 px 以下）を本文の生のバイトで受け取り、読み取った取引を行ごとに返します（画像も結果も保存しません。[`docs/adr-0005-statement-read-api.md`](docs/adr-0005-statement-read-api.md)）。AI を呼ぶには、Claude Agent SDK（依存グループ `ai`）と資格情報が要ります。資格情報が無いときは 503 `read_unavailable` を返し、AI は呼びません。

| 環境変数 | 中身 |
|---|---|
| `STATEMENT_READ_CREDENTIAL` | `api_key`（既定）か `oauth_token`。どちらの資格情報を使うか |
| `ANTHROPIC_API_KEY` | `api_key` のときの Anthropic API のキー |
| `CLAUDE_CODE_OAUTH_TOKEN` | `oauth_token` のときのトークン（手元の実測だけに使います） |

端末 2 の `npm run dev:api` の代わりに、資格情報を環境変数に置いた端末で次を起動します（値は表示しないでください）。

```sh
cd api
uv sync --locked --group ai
GOOGLE_CLOUD_PROJECT=demo-loss-note FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
  uv run --locked --group ai flask --app loss_note_api.app:create_app run -p 8000
```

上の手順で ID トークンを取ったあと、架空の値の合成の明細を送ります。

```sh
curl -s -X POST -H "$AUTH" -H 'Content-Type: image/png' \
  --data-binary @tools/statement-eval/synthetic/s01.png "$API/statement-reads"
```

終わったら `(cd api && uv sync --locked)` で AI の SDK を外し、確認コマンドと同じ状態に戻します。

## 確認コマンド

型検査・lint・テスト・ビルド・ビルド結果の CSP の検査（画面）と、lint・テスト（決済明細の読み取りの部品 `packages/statement-read/`、API、読み取りを測る道具 [`tools/statement-eval/`](tools/statement-eval/README.md)）、本番の土台と Cloud Run の Terraform（[`infra/`](infra/README.md)。書式・検証と、モックのプロバイダのテスト）、本番のイメージのビルドと検査（docker が要ります）をまとめて流します。API のテストは、エミュレーター（Auth・Firestore）を自分で起動して流す段もあります（Java が要ります。`npm run emulators` を動かしているとポートがぶつかるので、止めてから流してください）。AI は呼びません（資格情報は要りません）。CI（`.github/workflows/ci.yml`）も同じ検査を走らせます。

```sh
mise exec -- bash -c 'npm ci && npm run check:pinned && npm run typecheck && npm run lint && npm test && npm run build && .github/scripts/csp-check.test.sh && .github/scripts/csp-check.sh dist/index.html && (cd packages/statement-read && uv sync --locked && uv run --locked ruff check && uv run --locked pytest -q) && (cd api && uv sync --locked && uv run --locked ruff check && uv run --locked pytest -q) && npm run test:api:emulator && (cd tools/statement-eval && uv sync --locked && uv run --locked ruff check && uv run --locked pytest -q) && terraform fmt -check -recursive infra && terraform -chdir=infra/bootstrap init -backend=false -input=false -no-color && terraform -chdir=infra/bootstrap validate -no-color && terraform -chdir=infra/bootstrap test -no-color && .github/scripts/tf-required-variables.sh && .github/scripts/tf-iam-grants.test.sh && .github/scripts/tf-iam-grants.sh && terraform -chdir=infra/prod init -backend=false -input=false -no-color && terraform -chdir=infra/prod validate -no-color && terraform -chdir=infra/prod test -no-color && .github/scripts/tf-required-variables.sh infra/prod project_id image firebase_auth_domain && .github/scripts/image.sh loss-note check-dockerignore && docker build -t loss-note:ci . && .github/scripts/image-check.sh loss-note:ci && .github/scripts/workflow-concurrency-check.test.sh && .github/scripts/workflow-concurrency-check.sh'
```

## ログイン（手元）

画面はログインしないと開けません。手元では Firebase Authentication のエミュレーターでログインします（`npm run emulators` を起動しておきます）。

1. <http://localhost:5173/> を開くとログイン画面になります。[Google でログイン] を押します
2. 開いた小さな画面（エミュレーターのログインの画面）で [Add new account] → [Auto-generate user information] → [Sign in with Google.com] を押します。架空のアカウントが作られ、ログインします（実在のメールは要りません）
3. 設定の画面の [ログアウト] でログアウトします

ログインの画面は Google の script（apis.google.com）を読み込むので、ネットに出られない環境ではログインできません（ログイン画面に「ログインのサービスにつながりません」と出ます）。エミュレーターが止まっているときも同じ文言が出ます。接続先は環境変数（`VITE_FIREBASE_PROJECT_ID`・`VITE_FIREBASE_API_KEY`・`VITE_FIREBASE_AUTH_EMULATOR_URL` など）で変えられます。開発サーバー（`npm run dev`）では、変数が無ければ架空の `demo-loss-note` と `http://127.0.0.1:9099` のエミュレーターを使います。本番のビルド（`npm run build`）には既定値が入らないので、変数で渡してください（エミュレーターには、変数で明示し、かつプロジェクト ID が `demo-` で始まるときだけ繋ぎます）（[`docs/adr-0003-login-emulator-popup.md`](docs/adr-0003-login-emulator-popup.md)）。

## 画面の検査

全画面を幅 360 / 390 / 768 / 1440px × ダーク / ライトで開き、横スクロールの量（px）と、幅 360px で押せるものの当たりが 44×44px 未満の件数、ボタン・選択肢などの中の文字のはみ出しの件数を数値で出します。画面の行き来（戻る・再読み込み・知らない URL）・テーマの記憶・ログインの門も実際のブラウザで確かめます。Auth のエミュレーター（`npm run emulators`）を起動してから流してください（架空のアカウントで自動でログインします）。1 つでも外れれば終了コードが 0 でなくなります。開発サーバーは検査が自分で立てて閉じます。

```sh
mise exec -- npx playwright install chromium   # 初回だけ（ブラウザは手元のキャッシュに入ります）
mise exec -- npm run ui:check
mise exec -- npm run ui:check -- --shots <出力先のディレクトリ>   # 各状態の画像を撮る（画像はコミットしないでください）
```

開発の時だけ <http://localhost:5173/dev/parts> で部品の見本（ボタン・3 つのタップ・判定のバッジ・R と円の数字・色のトークン）が開けます。本番のビルドには入りません。画面の原則は [`docs/ui-guidelines.md`](docs/ui-guidelines.md) にあります。

## 本番の土台（GCP）

自分の GCP プロジェクトに本番の土台（API・Terraform の state のバケット・GitHub Actions からの鍵なしの認証・コンテナイメージの置き場・Firebase・月の予算の通知）を作る手順は [`infra/README.md`](infra/README.md) にあります。本番へのデプロイ（main へのマージ → CI → 承認）・確認・切り戻し・Firestore のバックアップからの戻しの手順も同じ文書にあります。

## ディレクトリ

ディレクトリの役割・計算を置く場所・データの読み書きの経路は [`CLAUDE.md`](CLAUDE.md) の「作り」に書いてあります。
