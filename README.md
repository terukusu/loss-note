# loss-note

トレードの **損失ノート** です。売買を記録し、エントリーの時点で決めたこと（根拠・LC・TP・数量）と実際の決済を比べて、「同じ負け方を繰り返さない」ための振り返りを助けます。

いまは開発の土台（画面と API の骨組み、確認コマンド、手元で動かす手順）だけがあります。設計は [`docs/design.md`](docs/design.md) にあります。

## 前提の道具

- [mise](https://mise.jdx.dev/)（道具の版をそろえるために使います。リポジトリの `mise.toml` に Node 24.22.3・Java 21（Temurin 21.0.13）・uv 0.13.6 の版が書いてあります）
- git・curl

```sh
git clone https://github.com/<OWNER>/<REPO>.git
cd <REPO>
mise trust && mise install
mise exec -- npm ci
(cd api && mise exec -- uv sync --locked)
```

以下のコマンドは、mise を有効にしたシェル（`mise activate`）か、`mise exec -- <コマンド>` で実行してください。Python 3.13 は uv が `api/.python-version` を見て用意します。

## 手元で動かす

端末を 3 つ開き、それぞれで次を起動します。

| 端末 | コマンド | 起動するもの |
|---|---|---|
| 1 | `npm run emulators` | Firebase のエミュレーター（Firestore 8080・Auth 9099・Storage 9199、UI 4000） |
| 2 | `npm run dev:api` | API（8000） |
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

## 止める・データの置き場

- エミュレーターは **Ctrl+C で止めてください**。止めるときにデータを `data/local/emulator/` に書き出し、次の `npm run emulators` で読み込みます
- 強制終了（`kill -9`・端末ごと閉じるなど）では書き出さないので、**最後に Ctrl+C で止めた時点のデータに戻ります**。強制終了のあとに Firestore のエミュレーター（java）が残ってポートがふさがっていたら、その java のプロセスを止めてから起動し直してください
- `data/local/` は git に無視されていてコミットされません。画面の開発サーバーからも配りません
- データを消して最初からにするときは、エミュレーターを止めてから `data/local/emulator/` を消します

### データが残ることを確かめる（合成のデータ）

エミュレーターを起動した状態で、合成のデータを入れます（値はすべて架空です。`Authorization: Bearer owner` はエミュレーターでルールを通さずに読み書きするための書き方です）。

```sh
# Firestore に取引を 1 件
curl -s -X POST -H 'Authorization: Bearer owner' -H 'Content-Type: application/json' \
  'http://127.0.0.1:8080/v1/projects/demo-loss-note/databases/(default)/documents/trades?documentId=synthetic-1' \
  -d '{"fields":{"symbol":{"stringValue":"TEST"},"side":{"stringValue":"L"},"entry":{"doubleValue":100},"lc":{"doubleValue":95}}}'
# Auth に利用者を 1 人
curl -s -X POST -H 'Content-Type: application/json' \
  'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key' \
  -d '{"email":"test@example.com","password":"synthetic-pass"}'
# Storage に画像を 1 枚（中身は何でもかまいません。ファイルを作らずに本文で送ります）
curl -s -X POST -H 'Authorization: Bearer owner' -H 'Content-Type: image/png' --data-binary 'synthetic' \
  'http://127.0.0.1:9199/upload/storage/v1/b/demo-loss-note.appspot.com/o?uploadType=media&name=synthetic.png'
```

Ctrl+C で止めて `npm run emulators` で起動し直し、読み出します。

```sh
curl -s -H 'Authorization: Bearer owner' \
  'http://127.0.0.1:8080/v1/projects/demo-loss-note/databases/(default)/documents/trades/synthetic-1'
curl -s -X POST -H 'Authorization: Bearer owner' -H 'Content-Type: application/json' -d '{}' \
  'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-loss-note/accounts:query'
curl -s -H 'Authorization: Bearer owner' \
  'http://127.0.0.1:9199/download/storage/v1/b/demo-loss-note.appspot.com/o/synthetic.png?alt=media'
```

## 確認コマンド

型検査・lint・テスト・ビルド・ビルド結果の CSP の検査（画面）と、lint・テスト（API と、決済明細の読み取りを測る道具 [`tools/statement-eval/`](tools/statement-eval/README.md)）をまとめて流します。AI は呼びません（資格情報は要りません）。CI（`.github/workflows/ci.yml`）も同じ検査を走らせます。

```sh
mise exec -- bash -c 'npm ci && npm run check:pinned && npm run typecheck && npm run lint && npm test && npm run build && .github/scripts/csp-check.test.sh && .github/scripts/csp-check.sh dist/index.html && (cd api && uv sync --locked && uv run --locked ruff check && uv run --locked pytest -q) && (cd tools/statement-eval && uv sync --locked && uv run --locked ruff check && uv run --locked pytest -q)'
```

## ディレクトリ

ディレクトリの役割・計算を置く場所・データの読み書きの経路は [`CLAUDE.md`](CLAUDE.md) の「作り」に書いてあります。
