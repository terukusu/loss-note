# ADR-0009: 本番は 1 つの Cloud Run で画面と API を配り、CI の成功の後に承認つきでデプロイし、GitHub から切り戻せるようにする

- 状態: 採用
- 日付: 2026-11-18
- 関連: Issue #42（本番にデプロイする）、EPIC #45、#41（ADR-0008 の土台）、#43（ログイン）、#44（明細の読み取り）、設計書 10 章・10.1・12 章、`infra/README.md`、ADR-0002（History API の URL）、ADR-0003（本番の CSP でログインの許可を決める）、ADR-0004（起動の判定）

## 背景

縦切り 1 は手元のエミュレーターの上でしか動かず、オーナーは取引の直後にスマホから記録できない。#41 の土台（専用のプロジェクト・WIF・CI の SA・Artifact Registry・Firebase）の上に、次の 3 つを満たす本番を作る。

1. 1 つの URL で画面も API も動き、どの画面の URL を直接開いても同じ画面に着く（ADR-0002）
2. 記録を預かる場所（Firestore）が本物で閉じている。本番の API は署名を検証するモード（ADR-0004 の `verify`）で動く
3. main へのマージから承認を経てだけ本番が変わり、壊れたら前のリビジョンへすぐ戻せる

## 決定

1. **画面のビルド成果物と API を 1 つのイメージ（`Dockerfile`）にし、1 つの Cloud Run のサービス `loss-note`（東京・最小 0・最大 2・gen1・CPU 1・1Gi・同時実行 8・60 秒）で配る**。同じオリジンなので CORS も API の URL の設定も要らない。WSGI サーバーは決まったスタックの gunicorn（1 ワーカー・8 スレッド・`--timeout 60`。アクセスログは出さない）。イメージは digest でだけ指す（Terraform の変数の検査で、タグ・他のリポジトリ・他のプロジェクトのイメージを受けない）
2. **静的配信は `STATIC_DIR` があるときだけ有効にし、SPA の戻しは catch-all のルートではなく 404 の扱いの中で行う**（`api/src/loss_note_api/web.py`）。どのルールにも当たらない GET / HEAD で、パスが `/api`・`/api/…`・`/assets`・`/assets/…` でないときだけ `index.html`（`no-cache`）を返す。catch-all のルートにすると `POST /api/nope` が 405 になり、`/api` の無い入口の 404 の JSON を崩すため。`/assets/` は `send_from_directory`（safe_join）だけで返し（`immutable`）、ディレクトリの外・無いファイルは 404 の JSON。`index.html` が無い置き場では起動しない（新しいリビジョンが Ready にならず前が残る）
3. **CSP の土台はアプリがすべての応答に付ける**（静的ファイル・API・404・500）。指示 → 値の辞書 `BASE_CSP` と純関数 `build_csp` で組み立て、#43 がログインの許可を `extra` で足す。`nosniff`・`no-referrer` も付ける。`Cross-Origin-Opener-Policy` は付けない（Google ログインのポップアップを壊す。#43 が決める）。**HSTS は付けない**: `.app` のトップレベルドメインはブラウザの HSTS の preload に丸ごと入っており、`run.app` は HTTPS でしか開けないため
4. **Firestore（ネイティブ・東京・`(default)`・削除の防止・日次のバックアップ 7 日）・ルールの公開・実行用 SA の `roles/datastore.user` は `infra/bootstrap`（所有者の apply）に置く**。CI の SA に Firestore の管理・IAM の権限を足さない（#41 の例 P を保つ）。ルールはリポジトリの `firestore.rules`（すべて拒否）を `cloud.firestore` に宣言で公開し、既定の挙動に頼らない。`infra/prod`（CI の apply）は Cloud Run のサービスと `allUsers` の invoker だけ
5. **デプロイは CI の check の成功の後に動かす**（`deploy.yml` の `workflow_run`）。元の run が main への push で、このリポジトリのものであることも確かめる（fork の PR の `main` という名前のブランチを弾く）。plan に差分があるときだけ Environment `prod` の承認を待ち、承認の後に plan し直して apply する（plan ファイルは公開の artifact に置かない）。deploy と rollback は concurrency `terraform-prod`（`cancel-in-progress: false`）で 1 度に 1 つ。グループに入るのは job の if を満たす run だけ（式を if と対にし、`.github/scripts/workflow-concurrency-check.sh` で突き合わせる。CI の失敗・fork の PR の run が pending の deploy・rollback を取り消さないように）。手で動かすとき（`workflow_dispatch`）もそのコミットの ci の成功を確かめる。apply job は承認の後の plan の要約を Summary に残してから当てる。`pull_request_target` の workflow は置かない。repository secrets が無ければ notice で成功終了、Firebase の Web の設定の secrets が無ければビルドの前に名前を出して失敗する。**プロジェクト固有の値（プロジェクト ID・SA・state のバケット・Firebase の Web の設定・WIF のプロバイダ）はすべて repository secrets から読み、variables は使わない**（公開リポジトリの Actions のログは誰でも読め、variables の値は見出しの env の一覧に平文で出る。secrets は GitHub が自動で伏せる。#41 の「variables 4・secret 1」を secrets 7 に変えた）
6. **イメージのタグは入力パスの git のハッシュと、画面のビルドに渡す Firebase の Web の設定の値から作る**（`image.sh`）。文書だけのマージは同じタグ = 同じ digest で差分なしになり、承認待ちを作らない。ビルドは GCP の認証より前に行い、`image-check.sh`（中身・非 root・CSP・起動して振り分けとヘッダ）を通ったものだけを push する。Firebase の Web の設定は `--build-arg` に名前だけを渡し（値は環境変数）、ビルドの段にだけ置く
7. **切り戻しは GitHub の `rollback.yml`（`workflow_dispatch`・Environment `prod`・apply SA の `run.admin`）と手元の gcloud の両方で行える**。戻し先は「今 100% のリビジョンより前に作られた Ready のリビジョンのうち最新」で、無ければ何も変えずに失敗する。Cloud Run のトラフィックだけを変え、データに触れない。`infra/prod` は最新に 100% を宣言しているので、次の deploy で最新に戻る（切り戻しの間は関係ない deploy の承認を拒否する）
8. **イメージに明細の読み取りの AI の SDK（依存グループ `ai`・同梱の CLI）を最初から入れる**（#44 が資格情報を足すだけで動くように。イメージを 2 度作らない）。資格情報が無い間は読み取りの入口が 503 `read_unavailable` のまま。`image-check.sh` が SDK の import と同梱の CLI の `--version`（非 root・ネットワークなし）を確かめる

## 選択肢

- **画面を Firebase Hosting / Cloud Storage に置き、API だけを Cloud Run にする**: 採らない。オリジンが分かれ、CORS・API の URL の設定・2 つのデプロイが要る。設計書 10 章の「1 つのサービス」と食い違う
- **catch-all のルート（`/<path:p>`）で `index.html` を返す**: 採らない（決定 2 の理由）
- **CSP を `index.html` の meta で付ける**: 採らない。`frame-ancestors` は meta では効かず、API の応答に付けられない
- **Firestore を `infra/prod`（CI の apply）に置く**: 採らない。apply SA に `datastore.owner`・`firebaserules.admin`・`resourcemanager.projectIamAdmin` 相当が要り、CI の権限が広がる
- **main への push で直接デプロイする（CI を待たない）**: 採らない。承認者が赤いビルドを承認しても本番に出ないようにする。費用は待ち時間だけ
- **切り戻しを手元の gcloud だけにする**: 採らない。オーナーはスマホから使うので、手元が無い場面でも戻せるようにする。apply SA の `run.admin` の範囲で足り、権限は増えない

## 結果

- 本番の URL は Cloud Run の `run.app`（リポジトリ・Issue・PR に書かない）。独自ドメインは要るときに別 Issue
- ログイン（#43）は `build_csp` の `extra` で許可を足し、Cloud Run の環境変数（authDomain・許可リスト）を `infra/prod` に足す。読み取り（#44）は Secret Manager（bootstrap）と Cloud Run の資格情報の参照（`infra/prod`）を足す。prod の state に秘密を入れない
- 切り戻しの後の deploy の plan には必ず差分が出る（承認すると最新に戻る）。Artifact Registry の掃除（直近 5 版を残す）で古いリビジョンのイメージが消えると、そのリビジョンへは戻せないことがある（直前のリビジョンでは起きない）
- 画面・API・依存を変えない PR でもイメージの入力（`image.sh` の入力パス）を変えるとタグが変わるので、入力パスは `.dockerignore` の許可リストと同じに保つ（CI が突き合わせる）
- CI の check はイメージのビルドと検査の分だけ長くなる（timeout を 30 分に）
- ログに値を出さない: ワークフローが使う値はすべて secrets なので、見出し・出力では伏せ字になる。デプロイの後に run のログを値で検索して 0 件を確かめる（`infra/README.md`「デプロイの流れと確認」）。値が公開の JS に入るもの（apiKey など）でも、ログには並べない
- 承認待ちの deploy の後ろの rollback は待ち、次の deploy が入ると取り消される（GitHub の concurrency に優先度は無い）。障害時は承認待ちの deploy を先に拒否するか、手元の gcloud で戻す（`infra/README.md`「切り戻し」）
