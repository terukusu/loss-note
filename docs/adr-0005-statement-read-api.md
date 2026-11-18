# ADR-0005: 決済明細の読み取りの入口（送り口・資格情報・共有の部品・画像を残さない）

- 状態: 採用（決定 3 の資格情報の方式と本番の OAuth トークンの扱いは ADR-0011 で上書き）
- 日付: 2026-11-18
- 関連: Issue #11（決済明細のスクショを読み取る）、#14（評価の道具。ADR-0001）、#15（画面につなぐ）、#23（銘柄の名前から原資産・種類を当てる）、EPIC #10（終了条件 6(a)・7・8）、設計書 7.5・8.2・10 章・10.1・13.3・C13・C14・C21・C26・C27、ADR-0004（記録の API の認証）、option-simulator の ADR-0009（画像の上限・保存しない・結果は形の決まった値だけ）

## 背景

事後の 30 秒の記録（設計書 7.5）は、決済明細の画像から実行の事実（向き・価格・時刻・数量・手数料・損益）を読み取れることに寄りかかっている。#14 で評価の道具を作り、Claude Agent SDK を通して合成の明細を読み、判定と R に効く 4 欄が全件一致することを確かめた。アプリの入口はこの結果と比べられる形で作る必要がある。

一方で、明細の画像には氏名・口座番号・残高が写りやすい。画像が残る・中身が戻ってくる不安があると利用者は貼るのをためらい、記録が続かない（この開発の動機）。読み取りの誤り（とくに向きの取り違え）は判定を壊す。

## 決定

1. **送り口は Claude Agent SDK**（#14 の道具と同じ経路。ツール `report_statement` 1 本を SDK MCP で渡し、PreToolUse のフックで入力だけを受け取る。組み込みのツールなし・設定ファイルを読まない・turn 1・再試行 0）。終了条件 8 の閾値は #14 がこの経路（CLI の起動を含む）で測った値なので、同じ送り口で比べられる。モデルは claude-sonnet-5-5・effort low（`statement_read.app_settings`。環境変数では変えない。変えるなら終了条件 8 の測り直しとセット）
2. **読み取りの部品は共有のパッケージ `packages/statement-read/`**（import 名 `statement_read`。uv の独立したプロジェクト）に 1 つだけ置き、`api/` と `tools/statement-eval/` が uv の path 依存で使う。指示・決まった文・ツールの名前と入力の形・結果の検査・送り口・数と向きの純関数・画像の上限・直しの純関数・アプリの設定。道具のモジュールは名前を写すだけ（道具のテストを変えずに通す）。写しが無いことは `packages/statement-read/tests/test_no_copies.py`、同じオブジェクトであることは道具の `tests/test_shared_contract.py` で検査する
3. **資格情報は環境変数**。`STATEMENT_READ_CREDENTIAL`（`api_key`〔既定〕/ `oauth_token`）で `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` のどちらを使うかを選ぶ。`oauth_token` は手元の実測だけに使い、他の利用者に提供するサービスにはオーナーのサブスクの資格情報を使わない（設計書 8.2）。子（CLI）の環境は許可リスト方式で、選んだ資格情報だけを渡す（API のプロセスにある Firebase・GCP の変数も子に渡らない）。資格情報が空・切り替えの値が不明・SDK を import できない → 503 `read_unavailable`（AI を呼ばない）。SDK は API の依存グループ `ai`（`claude-agent-sdk==0.2.176`）で、確認コマンドと CI では入れない
4. **入口は `POST /api/statement-reads`、本文は画像の生のバイト**（`Content-Type: image/png` | `image/jpeg`）。multipart・base64 は使わない（Werkzeug の multipart は大きな本文をディスクに一時保存しうる。生のバイトは `get_data(cache=False)` でメモリだけ）。認証は記録の API と同じ blueprint（本文を読む前に 401）。この入口だけ本文の上限を 500,000 B に上げる（Flask 3.1 の要求ごとの `max_content_length`。ほかの入口は 64 KiB のまま）
5. **画像の上限は PNG / JPEG・500,000 B 以下・長辺 2,000 px 以下**（option-simulator の ADR-0009 と同じ）。寸法は PNG の IHDR・JPEG の SOF を読む純関数（`statement_read.image`。Pillow を API に入れない）。上限の外は AI を呼ばずに 400 `image_rejected` + `reason`（`bytes` / `format` / `dimensions`）。API は縮めない（縮めるのは送る側。#15）
6. **締め切りは 20 秒**。anyio の cancel scope（`fail_after`）で取り消す。SDK の後始末（子の stdin を閉じ → 待って SIGTERM → SIGKILL）は SDK の shield の中で走る。asyncio の素の `task.cancel()` / `wait_for` は後始末を飛ばして子が残るので使わない（option-simulator の `agent_sdk.py` と同じ）。後始末に最大約 5 秒かかる
7. **画像も結果も残さない**。記録の保存先・Storage に触れない。CLI の `CLAUDE_CODE_TMPDIR`・`CLAUDE_CONFIG_DIR`・cwd に加えて `HOME`・`TMPDIR`・`XDG_CONFIG_HOME`・`XDG_CACHE_HOME`・`XDG_DATA_HOME`・`XDG_STATE_HOME` も要求ごとの一時ディレクトリの中にし（子が一時ディレクトリの外に書かない）、成功・失敗・締め切り超えのどれでも `finally` で一緒に消す。Content-Length の無い分割の本文は上限 + 1 B まで読み、超えたら 400 `bytes`（切り詰めて送らない）
8. **結果は形の決まった値だけ**。`check_result` で知らない鍵・型・列挙・日時の書式・21 行以上を弾き、`normalize` で暦にない日時も弾く（全体を捨てて 502 `read_invalid_result`）。銘柄の名前の長さ・文字の違反と範囲の外の数（数量・価格が 0 以下、絶対値 1e12 超）はその欄だけ空。向き（L / S）・日本時間・手数料の合計は純関数で直す（C27）。損益・価格・数量は書かれた値のまま
9. **失敗は決まった符号だけ**: 401 `unauthorized` / 400 `image_rejected` / 503 `read_unavailable` / 502 `read_invalid_result`（形の違反・ツールを呼ばない）/ 502 `read_failed`（送り先のエラー・例外）/ 504 `read_timeout`。応答とログに画像の中身・結果の値・資格情報・送り先の文言を出さない。ログは `{"event":"statement_read","reason","rows","ms"}`（足した鍵は件数の `rows` だけ）

## 選択肢

- **Anthropic の Messages API を直接呼ぶ**: 子のプロセスが無く速いが、#14 の測定と経路が変わり、終了条件 8 の閾値をそのまま当てられない。採らない（main の決定 2026-11-18）
- **API が道具に依存する**: Pillow がアプリに入り、「測る道具」をアプリが import する逆向きの依存になる。採らない
- **道具が API に依存する**: 道具の lock に Flask・firebase-admin・grpc が入り、読み取りの部品がアプリの HTTP の層と同じ包みになる。採らない
- **片方を正にして写し、検査で一致を比べる**: 二重に持つことそのもの。採らない
- **multipart で受ける**: 画面からは送りやすいが、500 KiB を超える部分がディスクに一時保存されうる（終了条件 6(a) に反する経路）。採らない

## 結果

- API の lock に Agent SDK とその推移的な依存（mcp・pydantic など。版は道具の lock と同じ）が依存グループ `ai` として入る。本番のイメージでは `--group ai` で入れる必要がある（縦切り 2 のデプロイの Issue で）。SDK の wheel は約 134 MB で、要求ごとに CLI の子（Node）を起動する → Cloud Run のメモリ・同時実行の見積もりは縦切り 2
- 確認コマンドと CI に共有のパッケージの sync・lint・テストの 1 段が加わる
- 精度と秒数（終了条件 8）は道具の `eval --set synthetic --preset app` で、API と同じ部品と設定で手元で測る（HTTP・認証の層は通さない。精度と秒数に効くのは部品と設定だけ）
- 締め切りの取り消しで子が確実に止まるか、本物の CLI が一時ディレクトリの外（ホームディレクトリの下など）に書かないかは、偽の SDK のテストでは見られない。子の HOME・TMPDIR・XDG の置き場所を要求ごとの一時ディレクトリに向けたので、本物の CLI でも書き込み先はその中に閉じる想定。手元の実測（`pgrep` の件数・ホームディレクトリの下のファイルの増減）で確かめる
- 子の HOME を一時ディレクトリにしたので、CLI がホームの下の設定・キャッシュ（認証の情報を含む）を読まない。資格情報は環境変数の 1 つだけが効く
- 結果も例外も無いまま stream が終わった（CLI の異常終了など）ときは `no_result` に分類し、送り先の失敗（502 `read_failed`）として返す
- API のプロセスが SIGKILL で落ちたときは一時ディレクトリが残りうる（ADR-0009 と同じ限界。Cloud Run の一時ディレクトリはメモリで、インスタンスと一緒に消える）
- 利用者ごとの回数・費用の上限、本番の資格情報の置き場所は縦切り 2。画面（送る前の注意・読み取りの印・縮小）は #15
  - 縦切り 2 で埋めた（#44・ADR-0010）: 本番の資格情報は Secret Manager の入れ物 1 つ（実行用 SA だけが読める。本番の起動では OAuth トークンを使わない）、上限は利用者ごとに 1 日 30 回・全体で 1 日 2.00 USD（日本時間の 0:00 で区切る。429 `read_limited`）。本番のイメージの `--group ai` は #42（ADR-0009 の決定 8）
