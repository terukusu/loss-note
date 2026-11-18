# ADR-0008: 本番の土台は、プロジェクトを gcloud で作り、中身を所有者が apply する Terraform（bootstrap）に置く

- 状態: 採用
- 日付: 2026-11-18
- 関連: Issue #41（本番の土台を作る）、EPIC #45、設計書 10 章・12 章、`infra/README.md`、ADR-0004（エミュレーターのトークンは `demo-` のプロジェクトだけ）

## 背景

本番（#42 のデプロイ・#43 のログイン・#44 の読み取り・#29 の取り込み）の前に、次の 3 つを後から直しにくい形で決める必要がある。

1. 利用者の売買の記録を預かる場所を、ほかのアプリ（optionchan・option-simulator）と分ける
2. 本番を変えられる主体を、このリポジトリの main から Environment `prod` の承認を経た job だけに絞る（鍵を作らない・CI に IAM の管理を持たせない）
3. 請求先を紐付けた時点から、想定外の費用に気づける

リポジトリは公開で汎用なので、プロジェクト ID・請求先・リポジトリの数値 ID・メールをリポジトリに書かずに、誰でも自分のプロジェクトで同じ土台を作れる必要もある。

## 決定

1. **プロジェクトの作成・請求先の紐付け・bootstrap の state のバケットは gcloud で行い、プロジェクトは Terraform の管理に入れない**。state の置き場はプロジェクトより後にしか作れず、`google_project` を管理に入れると誤った destroy でプロジェクトごと消えうるため。bootstrap 用バケットは `imports.tf` で取り込み、以後は Terraform で設定を固定する
2. **土台の中身は `infra/bootstrap`（所有者が手元から apply）に置く**: API の有効化（後の Issue が使う 14 個）・state のバケット 2 つ・Workload Identity 連携・CI の SA（plan / apply）・実行用 SA（ロールなし）・Artifact Registry・Firebase・Authentication の初期化・月の予算。CI の SA は API の有効化・SA の作成・IAM の管理を持たないので、それが要るものはすべてここに置く。`infra/prod`（CI が apply）は #42
3. **Authentication の初期化は `google_identity_platform_config`（Identity Platform）で行う**。Terraform で Authentication を使える状態にできるのはこれだけで、Firebase のコンソールの操作を手順に残さずに済む。Google・メールのリンクのログインは無料の範囲（月 49,999 MAU まで）で、費用の見込みは 0 円。ログインの方法・許可するドメインは #43 が同じリソースに足す
4. **Firebase のリソース（`google_firebase_project`・`google_firebase_web_app`・データ `google_firebase_web_app_config`）のためだけに `hashicorp/google-beta` を足す**（8.10.0 でも beta にしかない）。ほかのリソースは GA の `hashicorp/google` を使う。版は両方とも正確に固定する
5. **provider に `user_project_override = true`・`billing_project = <プロジェクト>` を置く**。所有者の資格情報（ADC）で予算・Firebase の API を呼ぶには quota project の指定が要るため（無いと 403）。そのため Service Usage など前提の 5 つの API は Terraform より先に gcloud で有効にする
6. **WIF はリポジトリの数値 ID とオーナーの数値 ID の両方の完全一致だけを受け、借用の主体も数値 ID だけで指す**。プロバイダに属性 `attribute.repo_env` = `<リポジトリの数値 ID>:<オーナーの数値 ID>:<Environment>`（Environment の無い job は末尾が空）を足し、apply 用 SA は値が `<REPO_ID>:<OWNER_ID>:prod` の principalSet 1 つだけ、plan 用 SA は `attribute.repository_id` の principalSet。GitHub の sub（不変 ID 入りでも `repo:<OWNER>@<OWNER_ID>/<REPO>@<REPO_ID>:...` と名前を含む）は使わない。名前を変えても借用は変わらず（例 W6）、同じ名前で作り直した別のリポジトリは通さない。名前（`github_repository`）はプールの説明にだけ使う
7. **plan 用 SA はこのリポジトリのどの workflow からも借用でき、prod の state を読める**（PR の plan のため）。fork の `pull_request` は ID トークンを得られないので通らない。`pull_request_target` の job は fork の PR から base の文脈で動きうるので、プロバイダの `attribute_condition` で `assertion.event_name != 'pull_request_target'` を課して受けない（pull_request・push などほかの event は受ける）。あわせて #42 以降も `pull_request_target` の workflow を置かない・prod の state に秘密を入れない（Secret Manager の参照だけにする）を約束にする（条件と約束の多層の守り）
8. **`google.subject` は数字だけのクレーム `<リポジトリの数値 ID>:<run_id>:<run_attempt>` で作る**。上限の 127 バイトを、名前と ref を含む sub（長いブランチ名で超えうる）のように超えない。監査ログから workflow の実行と試行を引ける
9. **費用の見張りは請求先の予算（月 3,000 円・50 / 90 / 100%）の通知だけ**。通知先は請求先の管理者への既定のメールのまま（メールアドレスを書かない）。止める仕組み（請求先の切り離し）は置かない
10. **識別子（プロジェクト・請求先・リポジトリ・数値 ID）の変数に既定値を持たせない**。apply のたびに `TF_VAR_` で渡す。変数なしの plan が未指定の変数のエラーで止まることを `.github/scripts/tf-required-variables.sh` で CI が確かめる

## 選択肢

- **プロジェクトも Terraform で作る**: state の置き場を別のプロジェクトに置く必要があり、誤った destroy でプロジェクトごと消えうる。採らない
- **apply 用 SA を sub（`repo:<OWNER>@<OWNER_ID>/<REPO>@<REPO_ID>:environment:prod`）の principal で指す**: sub が名前を含むので、リポジトリ・オーナーの名前を変えると借用できなくなる（例 W6 に反する）。採らない
- **Authentication を Firebase のコンソールで初期化する**: 手順に画面の操作が残り、clone した人が同じ状態を作れたか確かめにくい。採らない
- **Identity Platform に移行しない（Firebase Authentication のまま）**: Terraform で初期化する手段が無い。移行は戻せない（戻しはプロジェクトの削除だけ）が、少人数の利用では費用も機能も変わらない
- **予算を超えたら請求先を切り離す（Pub/Sub と関数）**: 本番が止まり、記録できなくなる。費用の目安が小さいので、通知で気づければ足りる。採らない
- **土台を Issue ごとに分ける（Firebase・予算を別に）**: 所有者の apply と文書が分かれるだけで、間違いの確率は下がらない。採らない

## 結果

- 権限・費用・データの境界がプロジェクト単位で切れる。CI の SA は run.admin / run.viewer と、state・イメージのリソース単位の付与だけで、P4 のロール（owner・editor・viewer・IAM の管理など）を持たないことをモックのプロバイダの test で、付与の宣言がそれだけであること（権威的な `_binding`・`_policy` が 0 件）を `.github/scripts/tf-iam-grants.sh` で固定した
- **戻せないもの**: Identity Platform の有効化と Firebase の追加は、プロジェクトの中では戻せない（戻しはプロジェクトの削除だけ）
- **プロジェクトの外に残るもの**: 予算は請求先のリソースなので、プロジェクトを消しても残る。撤去では予算を先に消す（`infra/README.md`「撤去の注意」）
- #42 で、CI が読む値（プロジェクト ID・SA・state のバケット）を repository variables から repository secrets に移した（公開リポジトリの Actions のログに値を出さない。ADR-0009）
- #42 で bootstrap に Firestore（`firestore.tf`）と `firebaserules.googleapis.com`（API は 15 個）、実行用 SA の `roles/datastore.user` を足した（CI の SA の付与は変えていない。ADR-0009）
- 実際の値（プロジェクト ID・番号・請求先・数値 ID）は所有者の手元の環境変数と bootstrap の state だけにあり、リポジトリには入らない。Web の API キーも bootstrap の state（所有者だけが読める）に入る
