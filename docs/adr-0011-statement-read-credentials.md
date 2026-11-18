# ADR-0011: 明細の読み取りの資格情報は 3 つの方式から選び、子の CLI に渡す環境を方式ごとの許可リストで組み立てる

- 状態: 採用
- 日付: 2026-11-18
- 関連: Issue #55、EPIC #45、ADR-0005（読み取りの入口。決定 3 を上書き）、ADR-0010（本番の資格情報と上限。決定 5・6 を上書き）、ADR-0004（起動の判定）、設計書 7.5・8.2、`infra/README.md`「明細の読み取りの資格情報」

## 背景

#44 の本番の資格情報は Anthropic API のキーだけで、本番の起動では OAuth トークンを拒んでいた。オーナーは OAuth トークン（サブスクの資格情報）と Workload Identity Federation（以下 WIF）の両方を使いたい。

送り口（`packages/statement-read` の `agent_reader`）は同梱の Claude Code の CLI を子として起動する。SDK は親の環境（`os.environ`）に `options.env` を重ねて子を起動するので、#44 までは許可リストに無い親の変数を **空の文字列で上書き** していた。しかし Anthropic の文書（WIF reference）は、資格情報の優先順位を `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_PROFILE` → WIF の変数 → 有効なプロファイル とし、「空の文字列の変数も枠を占めうる。空にせず unset する」と書いている。OAuth トークンや WIF を選んだのにキー系の名前が子に残ると、選んでいない資格情報で送られる（費用と送り先が変わる）か、認証に失敗する。

## 決定

1. **方式は 3 つ**: `STATEMENT_READ_CREDENTIAL` = `api_key`（既定。`ANTHROPIC_API_KEY`）/ `oauth_token`（`CLAUDE_CODE_OAUTH_TOKEN`）/ `federation`（`ANTHROPIC_FEDERATION_RULE_ID`・`ANTHROPIC_ORGANIZATION_ID`、任意で `ANTHROPIC_SERVICE_ACCOUNT_ID`・`ANTHROPIC_WORKSPACE_ID`、と要求ごとの `ANTHROPIC_IDENTITY_TOKEN_FILE`）。不明な方式・必須の値が空なら 503 `read_unavailable`（AI を呼ばない・数えない）
2. **起動の種類で方式を制限しない**。本番の `oauth_token` は、オーナーだけが使う間（#43 の許可リストがオーナーだけ）に限る。**他の利用者を受け入れる前に `federation` か `api_key` へ移る**（課金の EPIC の前提）
3. **子の環境は方式ごとの許可リスト**: 資格情報・送り先の系統の名前（`ANTHROPIC_*`・`CLAUDE_*`〔`CLAUDE_CODE_OAUTH_*`・`CLAUDE_CODE_USE_*` など〕・`AWS_*`・`CLOUD_ML_REGION`・`VERTEX_REGION_*`・`CLAUDECODE`）は、選んだ方式の変数と送り口が決めた CLI の設定を除いて **子の環境に名前ごと置かない**。SDK が親の環境を引き継ぐので、各プロセスの入口で資格情報を設定へ写した直後に 1 回だけ、親（この process）の環境から系統の名前を外す（`scrub_process_env`。API は `create_app()` で保存先・検証器を作る前、道具は CLI の起動）。送り口は要求ごとに `os.environ` を書き換えず、系統の名前が親に残っていれば送らずに失敗にする（fail closed。API は予約の前に 502 `read_failed`・数えない）。系統の外で許可リストに無い親の変数は空で上書きする（`GOOGLE_*` は API 自身が使うので親から外さず、子では空。Vertex の切り替え `CLAUDE_CODE_USE_VERTEX` が無いので使われない）
4. **設定ファイルを置かない**: 子の HOME・XDG・CLI の設定の置き場は要求ごとの一時ディレクトリの中で、起動の時点でファイル 0 件（`apiKeyHelper`・プロファイル・ログインの資格情報が無い）。`setting_sources = []` は #11 のまま
5. **federation の ID トークン**: API が要求ごとに Cloud Run の実行用 SA の ID トークンをメタデータ サーバー（`instance/service-accounts/default/identity`、audience `https://api.anthropic.com`・`format=full`）から取り、要求ごとの一時ディレクトリの `cred/identity-token`（0600。HOME・設定の置き場の外）に書いて渡す。読み取りが終われば一時ディレクトリごと消える。取れなければ AI を呼ばずに 502 `read_failed`（ログの理由 `identity_token`）、1 日の上限に数えない（予約の前に取る）。依存は足さない（標準の urllib・プロキシを通さない）
6. **本番の配線**: repository variable `STATEMENT_READ_CREDENTIAL`（値を伏せる必要の無い切り替え）→ Terraform の `statement_read_credential` → Cloud Run の環境変数。`api_key` / `oauth_token` の値は Secret Manager の別々の入れ物（`statement-read-anthropic-api-key`・`statement-read-claude-oauth-token`。東京だけ・削除の防止・実行用 SA だけが読める・版は宣言しない）の参照。`federation` の識別子は repository secrets → sensitive な Terraform の変数 → Cloud Run の環境変数（秘密は置かない）。選ばなかった方式の変数は Cloud Run に載せない。#44 の `STATEMENT_READ_KEY=true` は、切り替えが未設定のときだけ `api_key` と同じに扱う（後方互換）。`federation` で必須の識別子が空なら plan で止める
7. 評価の道具（`tools/statement-eval`）の `--credential` は `api_key` / `oauth_token` のまま（手元で ID トークンを取る経路が無い）。子の環境の組み立ては同じ送り口を通る

## 選択肢

- **空の文字列で上書きし続ける**（#44 のまま）: 文書が明示的に「unset する」と言っている。古い SDK・CLI で空の値が枠を占めると、選んだ方式で送られない。採らない
- **親の環境を変えず、CLI を包む起動スクリプト（`cli_path`）で `env -i` する**: 子の環境は完全に作れるが、資格情報を引数か別の経路で渡す必要があり、SDK の版の確かめ（`-v`）も同じスクリプトを通る。仕組みが増える割に、API の process に資格情報が残る点は変わらない。採らない
- **ID トークンを環境変数 `ANTHROPIC_IDENTITY_TOKEN` で渡す**: ファイルより手軽だが、子の環境（`/proc/<pid>/environ`）に JWT が残る。ファイル（0600・要求ごとに消える）にする
- **WIF の交換を API（Python の anthropic SDK）で行い、子にアクセストークンを渡す**: 依存の追加が要り、トークンの更新も自前になる。CLI がファイルから自分で交換するので採らない
- **本番の OAuth トークンを禁止のまま**: オーナーの希望に合わない。利用者がオーナーだけの間に限り、設計書・この ADR に移る条件を書いて許す

## 結果

- 子の CLI に渡る値のある名前は、方式ごとに「共通の集合（PATH・言語・TZ・証明書・プロキシ、要求ごとの HOME・TMPDIR・XDG、CLI の固定の設定）+ 方式の変数」に固定され、テストで親にすべての変数が入った状態から確かめている（`packages/statement-read/tests/test_credentials.py`）
- API の process の環境（`os.environ` と C の environ）から系統の名前が消えるので、同じ process から起動する子には、選んだ方式の変数（要求ごとの `options.env`）のほかの資格情報は引き継がれない。ただし起動時の環境の写し（`/proc/<pid>/environ`）と gunicorn の親プロセスの環境には値が残り、同じ uid の子なら読める。子の CLI は組み込みのツールを持たず（`tools = []`・MCP のツール 1 本でフックが止める）、ファイルや他のプロセスを読む経路が無いので、この脅威は小さいと判断した
- 子に渡る環境のテストは 2 段: 普段は SDK の重ね方の写し（`spawn_env`）で、依存グループ `ai` があるときだけ本物の SDK の `SubprocessCLITransport.connect` を通して `anyio.open_process` に渡る `env=` を確かめる（`api/tests/test_real_sdk_env.py`。確認コマンド・CI では SDK を入れないのでスキップ）。**SDK を上げるときは、`subprocess_cli.connect` の重ね方（親の環境 → `options.env` の順・SDK が足す名前）を確かめ直し、`uv sync --locked --group ai` の後にこのテストを流す**
- 方式の切り替えは repository variable と deploy だけで済む（コードを変えない）。oauth_token の入れ物は bootstrap の apply が要る（create 2）
- 本番で OAuth トークンを使う期間は、利用規約・費用の扱いがサブスクに依る。他の利用者を受け入れる前に移ることを、課金の EPIC の前提として残す
