# infra（Terraform）

loss-note の本番の土台です。自分の GCP プロジェクトと GitHub のリポジトリで、同じ土台を作れるように書いてあります（値はすべてプレースホルダ・シェルの変数です。実際の値をこのリポジトリにコミットしないでください）。

| ルート | apply する人 | 中身 |
|---|---|---|
| `bootstrap/` | 所有者（手元から） | API の有効化・Terraform の state のバケット 2 つ・Workload Identity 連携・CI のサービスアカウント（plan 用・apply 用）・Cloud Run の実行用サービスアカウントとそのデータのロール（`roles/datastore.user`）・Artifact Registry・Firebase（Web アプリ 1 つ）と Authentication の初期化（Identity Platform）・Firestore（ネイティブ・東京・既定のデータベース・削除の防止・日次のバックアップ・クライアントからの読み書きをすべて拒否するルール・取引の一覧のページ分けの複合索引（#87））・月の予算 |
| `prod/` | CI（`.github/workflows/deploy.yml`。Environment `prod` の承認の後） | Cloud Run のサービス `loss-note`（画面と API を 1 つのイメージで配る）と、未認証の呼び出しの許可（`allUsers` に `roles/run.invoker`） |

プロジェクトの作成・請求先の紐付けは Terraform の外（gcloud）で行います。理由と、戻せないもの（Identity Platform・Firebase の追加）は [`docs/adr-0008-production-foundation.md`](../docs/adr-0008-production-foundation.md) にあります。本番の配信・デプロイ・切り戻しの決定は [`docs/adr-0009-production-delivery.md`](../docs/adr-0009-production-delivery.md) にあります。

全体の順: bootstrap の初回の apply → GitHub の設定（変数・secret・Environment）→ main へのマージで deploy（承認）→ 確かめ。

前提: リポジトリの `mise.toml` の道具（terraform 1.17.1）、gcloud（プロジェクトを作れて、請求先の予算を作れる所有者のアカウントでログイン済み）、gh（リポジトリの管理者でログイン済み）、jq。

## 検証（CI と同じ。資格情報なし）

```sh
terraform fmt -check -recursive infra
terraform -chdir=infra/bootstrap init -backend=false -input=false
terraform -chdir=infra/bootstrap validate
terraform -chdir=infra/bootstrap test                  # モックのプロバイダ。実リソースは作らない
.github/scripts/tf-required-variables.sh                    # 変数なしの plan が、必須の変数の未指定で止まること
.github/scripts/tf-iam-grants.test.sh                  # 下の検査の自己テスト
.github/scripts/tf-iam-grants.sh                       # IAM の付与の宣言が期待の集合だけ（権威的な _binding・_policy、*.tf.json・module は 0 件）
terraform -chdir=infra/prod init -backend=false -input=false
terraform -chdir=infra/prod validate
terraform -chdir=infra/prod test                       # モックのプロバイダ
.github/scripts/tf-required-variables.sh infra/prod project_id image firebase_auth_domain
# 本番のイメージ（docker が要る）
.github/scripts/image.sh loss-note check-dockerignore  # イメージの入力と .dockerignore の許可リストが同じ
docker build -t loss-note:ci . && .github/scripts/image-check.sh loss-note:ci   # 中身・非 root・CSP・起動して振り分けとヘッダ
```

## 変数

識別子には既定値がありません（渡し忘れた plan が別のプロジェクトに向かわないように）。下の手順では apply のたびに環境変数 `TF_VAR_<名前>` で渡します。`infra/bootstrap/local.auto.tfvars`（gitignore 済み。例は `local.auto.tfvars.example`）にも書けますが、識別子は書かないでください（`*.auto.tfvars` は環境変数より優先されます）。

| 変数 | 必須 | 内容 | 形 |
|---|---|---|---|
| `project_id` | はい | loss-note 専用の GCP プロジェクト ID | 英小文字で始まる 6〜30 文字（英小文字・数字・`-`） |
| `billing_account` | はい | 予算を置く請求先アカウントの ID | `XXXXXX-XXXXXX-XXXXXX`（`billingAccounts/` は付けない） |
| `github_repository` | はい | WIF で借用を許すリポジトリ（照合は数値 ID で行い、名前はプールの説明にだけ使う） | `<OWNER>/<REPO>` |
| `github_repository_id` | はい | リポジトリの数値 ID（`gh api repos/<OWNER>/<REPO> --jq .id`） | 数字だけ |
| `github_owner_id` | はい | リポジトリの所有者の数値 ID（`gh api repos/<OWNER>/<REPO> --jq .owner.id`） | 数字だけ |
| `region` | いいえ（`asia-northeast1`） | Artifact Registry・state のバケット・後の Cloud Run の場所 | |
| `budget_amount_jpy` | いいえ（`3000`） | このプロジェクトの月の予算（円。請求先の通貨が JPY であること） | 正の整数 |

共通のシェルの変数（以下の節はすべてこれを前提にします。値は表示しません）:

```sh
P=<PROJECT_ID>                                   # 新しく作るプロジェクトの ID（世界で一意。再利用できない）
BA=<BILLING_ACCOUNT_ID>                          # gcloud billing accounts list で確かめる
REPO=<OWNER>/<REPO>                              # gh repo view --json nameWithOwner -q .nameWithOwner
R=repos/$REPO
L=asia-northeast1
TF="mise exec -- terraform"
LOG=data/local/infra; mkdir -p "$LOG"              # plan・apply のログ（gitignore 済み。値を含むので共有しない）

export TF_VAR_project_id=$P TF_VAR_billing_account=$BA TF_VAR_github_repository=$REPO
export TF_VAR_github_repository_id=$(gh api $R --jq .id) TF_VAR_github_owner_id=$(gh api $R --jq .owner.id)
# ADC が無いときだけトークンを渡す（1 時間で切れるので、長い作業では export し直す）
gcloud auth application-default print-access-token > /dev/null 2>&1 || export GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token)
```

## 初回の apply

1. プロジェクトを作り、請求先を紐付けます（組織の無いアカウントでも作れます。請求先に紐付けられるプロジェクトの数には上限があります）。

   ```sh
   gcloud projects create "$P" --name=loss-note
   gcloud billing projects link "$P" --billing-account="$BA"
   ```

2. Terraform より先に、前提の API を有効にします。provider は所有者の資格情報で予算・Firebase の API を呼ぶために、このプロジェクトを quota project として使います（`user_project_override`）。

   ```sh
   gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com \
     cloudbilling.googleapis.com billingbudgets.googleapis.com storage.googleapis.com --project="$P"
   ```

3. bootstrap の state のバケットを作ります（state の置き場なので Terraform より先に要ります。apply で `imports.tf` が取り込み、設定を固定します）。

   ```sh
   gcloud storage buckets create "gs://$P-tfstate-bootstrap" --project="$P" --location=$L \
     --default-storage-class=STANDARD --uniform-bucket-level-access --public-access-prevention
   gcloud storage buckets update "gs://$P-tfstate-bootstrap" --versioning
   ```

4. init → plan → 要約を確かめる → apply。

   ```sh
   $TF -chdir=infra/bootstrap init -input=false -no-color -backend-config="bucket=$P-tfstate-bootstrap" > "$LOG/init.log" 2>&1; echo $?
   # plan・apply の出力（エラーの文を含む）にはプロジェクト ID・番号が出るので、ログに書いて件数・状態だけを見る
   $TF -chdir=infra/bootstrap plan -input=false -no-color -out=bootstrap.tfplan > "$LOG/plan.log" 2>&1; echo $?   # 0 でなければ grep -c '^Error' "$LOG/plan.log"
   # 要約（アドレスと操作だけ）。初回は create 40・import 1（bootstrap のバケット。設定の in-place update を伴う）
   $TF -chdir=infra/bootstrap show -json bootstrap.tfplan | jq -r '.resource_changes[]
     | select(.change.actions != ["no-op"] or .change.importing)
     | "\(.address): \(.change.actions | join(","))\(if .change.importing then " (import)" else "" end)"'
   # 変更の対象がすべてこのプロジェクト（true）
   $TF -chdir=infra/bootstrap show -json bootstrap.tfplan | jq --arg p "$P" '[.resource_changes[] | .change.after.project? // empty] | unique == [$p]'
   $TF -chdir=infra/bootstrap apply -input=false -no-color bootstrap.tfplan > "$LOG/apply.log" 2>&1; echo $?
   grep -oE 'Resources: [0-9a-z ,]+ destroyed' "$LOG/apply.log"   # 件数の行だけ（初回の目安: 1 imported, 40 added, 1 changed, 0 destroyed）
   rm -f infra/bootstrap/bootstrap.tfplan
   ```

   ほかの update・delete・replace が出たら apply しないでください。ログ（`$LOG`。`data/local/` は gitignore 済み）は手元にだけ置き、共有しないでください。API を有効にした直後は伝搬が間に合わず失敗することがあります。その場合はもう一度 plan → apply します（冪等です）。

## apply 後の確認

値は表示せず、件数・真偽・状態コードだけを見ます。

```sh
$TF -chdir=infra/bootstrap plan -input=false -detailed-exitcode > /dev/null; echo $?          # 差分なし: 0
gcloud billing projects describe "$P" --format='value(billingEnabled)'                       # True

# API: 15
printf '%s.googleapis.com\n' cloudresourcemanager serviceusage cloudbilling billingbudgets iam iamcredentials sts \
  storage artifactregistry run firestore firebaserules firebase identitytoolkit securetoken \
  | grep -cxF -f - <(gcloud services list --enabled --project="$P" --format='value(config.name)')

# プロジェクト単位のロール: sa-tf-apply = roles/run.admin、sa-tf-plan = roles/run.viewer、sa-loss-note = roles/datastore.user
for sa in sa-tf-apply sa-tf-plan sa-loss-note; do printf '%s: ' $sa
  gcloud projects get-iam-policy "$P" --flatten=bindings \
    --filter="bindings.members:serviceAccount:$sa@$P.iam.gserviceaccount.com" --format='value(bindings.role)' | sort | paste -sd, -
done
# CI の SA に付けないロール: 0
gcloud projects get-iam-policy "$P" --flatten=bindings --filter='bindings.members:sa-tf-' --format='value(bindings.role)' \
  | grep -cxE 'roles/(owner|editor|viewer|resourcemanager.projectIamAdmin|iam.securityAdmin|iam.serviceAccountAdmin|iam.serviceAccountKeyAdmin|iam.serviceAccountTokenCreator|serviceusage.serviceUsageAdmin|storage.admin|firebase.admin)'
# ユーザー管理の鍵: 0 0 0
for sa in sa-tf-apply sa-tf-plan sa-loss-note; do
  gcloud iam service-accounts keys list --iam-account="$sa@$P.iam.gserviceaccount.com" --managed-by=user --format='value(name)' | wc -l
done

# Firebase の Web の設定の 3 つが空でない（true）・Web アプリが 1 つ（1）・Authentication の設定が読める（200）
$TF -chdir=infra/bootstrap output -json firebase_web_config | jq '[.api_key, .auth_domain, .project_id] | map(type == "string" and length > 0) | all'
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: $P" \
  "https://firebase.googleapis.com/v1beta1/projects/$P/webApps" | jq '.apps | length'
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: $P" \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/$P/config"

# Firestore: FIRESTORE_NATIVE asia-northeast1 DELETE_PROTECTION_ENABLED（1 行）・日次のバックアップの予定が 1 件（保持 604800s）
gcloud firestore databases describe --database='(default)' --project="$P" --format='value(type,locationId,deleteProtectionState)'
gcloud firestore backups schedules list --database='(default)' --project="$P" --format='value(retention)'

# 予算: 対象がこのプロジェクトだけの予算が 1 件（1）
PN=$(gcloud projects describe "$P" --format='value(projectNumber)')
gcloud billing budgets list --billing-account="$BA" --format=json \
  | jq --arg pn "projects/$PN" '[.[] | select(.displayName == "loss-note-monthly" and .budgetFilter.projects == [$pn])] | length'
```

## GitHub の設定

CI（`deploy.yml`・`rollback.yml`）が使う値と Environment `prod` を設定します。値は表示せず、Terraform の出力からパイプで渡します。**値はすべて repository secrets に置きます**（リポジトリは公開で Actions のログは誰でも読めます。variables の値はログの見出しに平文で出ますが、secrets は GitHub が自動で伏せます。repository variables は使いません。例外は値を伏せる必要の無い真偽の切り替え `STATEMENT_READ_KEY` だけで、「明細の読み取りの資格情報」で後から足します）。リポジトリの管理者の権限が要ります。変数の意味は下の「prod の変数」にあります。

| 種類 | 名前 | 中身 |
|---|---|---|
| secret | `GCP_PROJECT_ID` | プロジェクト ID |
| secret | `GCP_SA_TF_PLAN` | plan 用 SA のメール（出力 `sa_tf_plan_email`） |
| secret | `GCP_SA_TF_APPLY` | apply 用 SA のメール（出力 `sa_tf_apply_email`） |
| secret | `TF_STATE_BUCKET` | prod の state のバケット（出力 `tf_state_bucket`） |
| secret | `FIREBASE_API_KEY` | Firebase の Web の apiKey（出力 `firebase_web_config.api_key`） |
| secret | `FIREBASE_AUTH_DOMAIN` | Firebase の Web の authDomain（出力 `firebase_web_config.auth_domain`） |
| secret | `GCP_WIF_PROVIDER` | WIF のプロバイダの完全名（出力 `wif_provider_name`） |
| Environment | `prod` | デプロイできるブランチは `main` だけ・承認者は所有者 1 名 |

```sh
$TF -chdir=infra/bootstrap output -raw wif_provider_name | gh secret set GCP_WIF_PROVIDER -R "$REPO"
$TF -chdir=infra/bootstrap output -raw sa_tf_plan_email  | gh secret set GCP_SA_TF_PLAN -R "$REPO"
$TF -chdir=infra/bootstrap output -raw sa_tf_apply_email | gh secret set GCP_SA_TF_APPLY -R "$REPO"
$TF -chdir=infra/bootstrap output -raw tf_state_bucket   | gh secret set TF_STATE_BUCKET -R "$REPO"
printf '%s' "$P" | gh secret set GCP_PROJECT_ID -R "$REPO"
$TF -chdir=infra/bootstrap output -json firebase_web_config | jq -r .api_key     | gh secret set FIREBASE_API_KEY -R "$REPO"
$TF -chdir=infra/bootstrap output -json firebase_web_config | jq -r .auth_domain | gh secret set FIREBASE_AUTH_DOMAIN -R "$REPO"
# Environment prod: main だけ、承認者は所有者（自分で承認できる）
jq -n --argjson id "$(gh api user --jq .id)" '{wait_timer: 0, prevent_self_review: false,
  reviewers: [{type: "User", id: $id}],
  deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}}' \
  | gh api -X PUT $R/environments/prod --input - > /dev/null
gh api -X POST $R/environments/prod/deployment-branch-policies -f name=main -f type=branch > /dev/null
```

確認（値は表示しない。すべて `true`）:

```sh
gh api $R/actions/secrets --jq '[.secrets[].name] | contains(["GCP_WIF_PROVIDER", "GCP_PROJECT_ID", "GCP_SA_TF_APPLY", "GCP_SA_TF_PLAN", "TF_STATE_BUCKET", "FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN"])'
gh api $R/actions/variables --jq '[.variables[].name] - ["STATEMENT_READ_CREDENTIAL", "STATEMENT_READ_KEY"] == []'   # variables は使わない（値がログに出る。例外は切り替えの STATEMENT_READ_CREDENTIAL・STATEMENT_READ_KEY だけ）。以前の手順で variables に置いた値は、secrets に入れ直してから gh variable delete で消す
gh api $R/environments/prod --jq '.deployment_branch_policy == {"protected_branches": false, "custom_branch_policies": true} and ([.protection_rules[] | select(.type == "required_reviewers") | .reviewers[]] | length) == 1'
gh api $R/environments/prod/deployment-branch-policies --jq '[.branch_policies[] | {name, type}] == [{"name": "main", "type": "branch"}]'
```

## prod の変数

`infra/prod` と画面のビルドが使う値です。どれも GitHub の repository secrets から `deploy.yml` が渡します（リポジトリ・Terraform に値を書きません。識別子に既定値はありません）。

| 渡す先 | 名前 | 中身 | 出どころ |
|---|---|---|---|
| Terraform `project_id` | `GCP_PROJECT_ID`（secret） | プロジェクト ID。Firebase のプロジェクト ID を兼ねる（画面のビルドの `VITE_FIREBASE_PROJECT_ID`） | `$P` |
| Terraform `image` | （deploy.yml が求める） | `<REGION>-docker.pkg.dev/<PROJECT_ID>/loss-note/loss-note@sha256:<64 桁の 16 進>`。digest でだけ受ける | `.github/scripts/image.sh loss-note resolve` |
| Terraform `region` | （既定 `asia-northeast1`） | Cloud Run の場所 | |
| Terraform `max_instances` | （既定 `2`） | 最大インスタンス（1〜10。費用の上限） | |
| Terraform `statement_read_credential` | `STATEMENT_READ_CREDENTIAL`（**variable**。秘密ではない切り替えの例外。未設定は空） | 明細の読み取りの資格情報の方式（`api_key` / `oauth_token` / `federation`。#55） | 下の「明細の読み取りの資格情報」で方式の値を入れた後に設定 |
| Terraform `statement_read_key` | `STATEMENT_READ_KEY`（**variable**。#44 の後方互換。`true` のときだけ true） | `STATEMENT_READ_CREDENTIAL` が未設定のとき、`true` なら `api_key` と同じ | 新しく設定しない（`STATEMENT_READ_CREDENTIAL` を使う） |
| Terraform `statement_read_federation_rule_id`・`statement_read_organization_id`（`federation` では必須）・`statement_read_service_account_id`・`statement_read_workspace_id`（任意） | `STATEMENT_READ_FEDERATION_RULE_ID`・`STATEMENT_READ_ORGANIZATION_ID`・`STATEMENT_READ_SERVICE_ACCOUNT_ID`・`STATEMENT_READ_WORKSPACE_ID`（secret） | `federation` の識別子（Terraform の変数は sensitive。plan に出さない） | Anthropic Console の Workload identity の画面 |
| state | `TF_STATE_BUCKET`（secret） | prod の state のバケット | 出力 `tf_state_bucket` |
| 借用 | `GCP_SA_TF_PLAN`・`GCP_SA_TF_APPLY`・`GCP_WIF_PROVIDER`（secret） | plan / apply の SA と WIF のプロバイダ | 出力 `sa_tf_plan_email`・`sa_tf_apply_email`・`wif_provider_name` |
| 画面のビルド | `FIREBASE_API_KEY`（secret） | Firebase の Web の apiKey（公開の JS に入る値。秘密ではない） | 出力 `firebase_web_config.api_key` |
| 画面のビルド・Terraform `firebase_auth_domain` | `FIREBASE_AUTH_DOMAIN`（secret） | Firebase の Web の authDomain。Cloud Run の環境変数 `FIREBASE_AUTH_DOMAIN`（API の CSP のヘッダの `frame-src`。#43）にも入る。ホスト名の形だけを受ける | 出力 `firebase_web_config.auth_domain` |
| Cloud Run の `LOSS_NOTE_ALLOWED_EMAILS` | （Secret Manager の `loss-note-allowed-emails` の `latest`） | 使える利用者の許可リスト（カンマ区切りのメール。#43）。値は GitHub にも Terraform にも置かない | 下の「ログインと使える利用者」 |
| Terraform `ai_limit_bypass` | `AI_LIMIT_BYPASS`（**variable**。秘密ではない切り替えの例外。`true` のときだけ true） | AI の上限を受けない利用者（バイパス）のリストの参照（Secret Manager の `loss-note-ai-bypass-emails` の `latest`）を Cloud Run の `LOSS_NOTE_AI_BYPASS_EMAILS` に付ける（#51） | 下の「AI の上限とバイパス」で版を入れた後に設定 |
| Terraform `ai_user_daily_count`・`ai_user_daily_usd`・`ai_daily_usd` | `AI_USER_DAILY_COUNT`・`AI_USER_DAILY_USD`・`AI_DAILY_USD`（**variable**。未設定は空 = API の既定） | AI の上限の値（利用者ごとの回数・利用者ごとの費用 USD・全体の費用 USD。#51）。Cloud Run の `LOSS_NOTE_AI_*` に入る | 変えるときだけ設定 |

- GCP の 4 つ（`GCP_PROJECT_ID`・`TF_STATE_BUCKET`・`GCP_SA_TF_PLAN`・`GCP_SA_TF_APPLY`）のどれかが無いと、deploy は notice を出して何もせずに成功で終わります（clone しただけのリポジトリで main への push を失敗にしない）
- GCP の 4 つがあるのに `FIREBASE_API_KEY`・`FIREBASE_AUTH_DOMAIN` が無いと、deploy はビルドの前に足りない secret の名前を出して失敗します
- Cloud Run に入る環境変数は `GOOGLE_CLOUD_PROJECT`・`FIREBASE_AUTH_DOMAIN`・`LOSS_NOTE_ALLOWED_EMAILS`（Secret Manager の参照）と、明細の読み取りの方式を選んだときだけその方式の変数（下の「明細の読み取りの資格情報」の表）、AI の上限の切り替え・値を設定したときだけその変数（下の「AI の上限とバイパス」）です（API は署名を検証するモード = ADR-0004 の `verify` で起動します。エミュレーターの接続先は持ちません）。画面の置き場（`STATIC_DIR`）と `PORT` はイメージの側にあります
- prod の state は plan 用 SA が読めるので、秘密を入れません（資格情報は Secret Manager の参照だけにし、値を変数・リソースに書きません）

## ログインと使える利用者

本番はオーナーだけが使います（docs/design.md 10.1・ADR-0003「縦切り 2 で決めたこと」）。ログインは Firebase Authentication の Google ログイン（ポップアップ）で、API は署名を検証した ID トークンのうち、確かめ済みのメールが許可リストにある利用者だけを通します（ほかは 403。`/api/health` を除く）。許可リストが未設定・空なら誰も使えません（閉じる側）。

- 許可リストの値は Secret Manager の `loss-note-allowed-emails` に置きます（入れ物と実行用 SA の読み取りの付与は `infra/bootstrap/secrets.tf`）。値は Terraform・GitHub・ログに置きません。カンマ区切りで、前後の空白と空の要素は無視し、大文字小文字（ASCII）は同一視します
- 値を入れる・変える（表示しない。コマンドの文字列に書かず（シェルの履歴に残さない）、`read -rs` で受けて標準入力から渡す）:

  ```sh
  read -rs ALLOWED   # <メール>[,<メール>...] を打って Enter（画面に出ない）
  printf '%s' "$ALLOWED" | gcloud secrets versions add loss-note-allowed-emails --project="$P" --data-file=- > /dev/null; echo $?   # 0
  unset ALLOWED
  gcloud secrets versions access latest --secret=loss-note-allowed-emails --project="$P" | tr ',' '\n' | grep -c @   # 要素の数だけ
  ```

  Cloud Run は `latest` をインスタンスの起動時に読むので、新しいインスタンス（最小 0 なので使わない間に入れ替わる）か、次のデプロイから効きます
- Google のログインの有効化は Firebase のコンソールで行います（Authentication → Sign-in method → Google。OAuth のクライアントはコンソールが作るので Terraform では管理しません）。**許可リストの入った API をデプロイした後に**有効にします（先に有効にすると、許可リストの無い API に誰でもログインできる時間ができます）
- Cloud Run のホスト（`*.run.app`）を Authentication の許可するドメインに足します（Identity Toolkit の管理の API `projects/<PROJECT_ID>/config` の `authorizedDomains`。Terraform では `authorized_domains` を書かないので差分になりません）
- 確かめ: 有効なログインの方法が Google だけ・許可するドメインにホストがあること（件数と真偽だけを見る）、許可リストに無いアカウントで `/api/trades` が 403・画面に「このアカウントでは使えません」が出ること
- 戻すとき: **先に Google のログインを無効にしてから**、許可リストの無いリビジョンへ切り戻します（許可リストの無い API に誰でもログインできる状態を作らない）

## デプロイの流れと確認

```text
main へのマージ（push）→ ci.yml の check が成功 → deploy.yml の plan（plan 用 SA）
  → 差分なし: 何もしない（承認待ちを作らない）
  → 差分あり: apply job が Environment prod の承認を待つ → 承認
     → イメージが Artifact Registry に無ければ: ビルド（GCP の認証より前）→ image-check.sh → push
     → digest で terraform apply（承認の後に plan し直す）→ 新しいリビジョンが 100%
```

- CI の check が落ちたコミット・PR のブランチ・fork からは動きません。Actions の画面から手で動かす（`workflow_dispatch`）ときも main だけで、main の HEAD の ci が push で成功していなければ止まります。Environment `prod` は main だけ・所有者の承認つきです
- apply は 1 度に 1 つです（deploy と rollback で同じ concurrency `terraform-prod`）。承認待ちの間に次のマージがあれば、前の run が終わってから後の run が動き、最後に 100% を受けるのは後のコミットのイメージです
- イメージのタグは入力（`.github/scripts/image.sh` の入力パス）の git のハッシュと Firebase の Web の設定の値から決まります。画面・API・依存を変えないマージ（文書だけ）は同じタグ = 既存の digest になり、差分なしで終わります。Firebase の secrets を直したときは新しいタグになるので、`gh workflow run deploy.yml -R "$REPO" --ref main` で動かします
- plan の要約（アドレスと操作の件数だけ）、承認の後に plan し直して実際に当てた差分の要約、apply したイメージの digest の先頭 12 文字は、run の Summary に出ます。ログに出る値の範囲: プロジェクト固有の値はすべて secrets なので、見出しの env の一覧・コマンドの出力では GitHub が伏せます（`***`）。デプロイの後に、run のログを値で検索して 0 件であることを確かめます（下の確かめ）。失敗のログは末尾だけを、9 桁以上の数字（プロジェクト番号）とメールを伏せて出します

デプロイの後の確かめ（値・URL は表示せず、状態コード・件数だけを見ます）:

```sh
U=$(gcloud run services describe loss-note --region=$L --project="$P" --format='value(status.url)')   # 表示しない
for p in / /trades/abc123 /api/health; do curl -s -o /dev/null -w '%{http_code}\n' "$U$p"; done       # 200 200 200
curl -s -o /dev/null -w '%{http_code}\n' "$U/api/trades"                                             # 401（トークンなし）
curl -s -o /dev/null -w '%{http_code}\n' "$U/api/nope"                                               # 404
# CSP の指示（10）: 土台の 7 つ（manifest-src は #77）と、Google ログインの許可を足した script-src・connect-src・frame-src（#43。authDomain は伏せる）
AD=$(mise exec -- terraform -chdir=infra/bootstrap output -json firebase_web_config | jq -r .auth_domain)   # 表示しない
curl -sI "$U/" | tr -d '\r' | grep -i '^content-security-policy:' | sed 's/^[^:]*: *//' | sed "s/$AD/<AUTH_DOMAIN>/g" | tr ';' '\n' | sed 's/^ *//' \
  | grep -cxE "default-src 'none'|script-src 'self' https://apis.google.com|style-src 'self'|img-src 'self'|connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com|manifest-src 'self'|base-uri 'none'|form-action 'none'|frame-ancestors 'none'|frame-src https://<AUTH_DOMAIN>"
curl -sI "$U/" | tr -d '\r' | grep -ciE '^(x-content-type-options: nosniff|referrer-policy: no-referrer)$'
# 100% を受けるリビジョンのイメージの digest の先頭 12 文字（run の Summary と同じ）
gcloud run services describe loss-note --region=$L --project="$P" --format='value(spec.template.spec.containers[0].image)' | sed -E 's/.*@sha256:(.{12}).*/\1/'
# 公開の Actions のログに値が出ていない（deploy の最新の run。値ごとに 0）
RUN=$(gh run list -R "$REPO" --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')
SA_PLAN=$($TF -chdir=infra/bootstrap output -raw sa_tf_plan_email); SA_APPLY=$($TF -chdir=infra/bootstrap output -raw sa_tf_apply_email)
BUCKET=$($TF -chdir=infra/bootstrap output -raw tf_state_bucket); WEB=$($TF -chdir=infra/bootstrap output -json firebase_web_config)
for v in "$P" "$SA_PLAN" "$SA_APPLY" "$BUCKET" "$(jq -r .api_key <<<"$WEB")" "$(jq -r .auth_domain <<<"$WEB")" "${U#https://}"; do
  gh run view "$RUN" -R "$REPO" --log 2>/dev/null | grep -cF -- "$v"
done
```

ブラウザ（スマホ・PC）でも開き、ログインの画面に Google ログインのボタンが出ること、開発者ツールに CSP の違反が出ないことを見ます（ログインそのものが通るのは #43 の後です）。

## 切り戻し

前のリビジョン（今 100% を受けるリビジョンの直前に作られた、Ready のリビジョン）へトラフィックを 100% 戻します。Cloud Run のトラフィックだけを変え、Firestore のデータには触れません。

**#43（許可リスト）より前のリビジョンへ戻すときは、先に Google のログインを無効にします**（許可リストの無い API に誰でもログインできる時間を作らない。上の「ログインと使える利用者」）:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: $P" \
  -H 'Content-Type: application/json' -d '{"enabled":false}' \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/$P/defaultSupportedIdpConfigs/google.com?updateMask=enabled"   # 200
```

**GitHub から**（手元に gcloud が無くても行えます）: Actions の画面で `rollback` を main から実行し（`gh workflow run rollback.yml -R "$REPO" --ref main` でも同じ）、Environment `prod` の承認をします。run の Summary に「戻し: <今> → <前>」、`/` と `/api/health` の状態コード、100% のリビジョン名が出ます。戻し先が無い（リビジョンが 1 つしか無い）ときは何も変えずに失敗します。

**手元から**（所有者の gcloud。同じことを行います）:

```sh
gcloud run revisions list --service=loss-note --region=$L --project="$P" \
  --format='table(metadata.name,metadata.creationTimestamp,status.conditions[0].status)'           # 作られた順と Ready を見る
gcloud run services describe loss-note --region=$L --project="$P" --format='value(status.traffic)'     # 今 100% のリビジョン
gcloud run services update-traffic loss-note --region=$L --project="$P" --to-revisions=<REVISION>=100 > /dev/null
gcloud run services describe loss-note --region=$L --project="$P" --format='value(status.traffic)'     # <REVISION> が 100
```

切り戻しの後の注意:

- `infra/prod` は「最新のリビジョンに 100%」を宣言しているので、切り戻しの後の deploy の plan には必ず差分が出ます。**関係ないマージの deploy の承認は拒否し**、直す PR か revert の PR を先にマージしてから承認します（そのまま承認すると最新のリビジョン = 壊れたものに戻ります）。手元から最新へ戻すときは `gcloud run services update-traffic loss-note --region=$L --project="$P" --to-latest`
- Artifact Registry は直近 5 版を残し、それより古く 30 日を過ぎた版を消します（bootstrap）。直前のリビジョンのイメージは残りますが、それより古いリビジョンへ戻すと、イメージが消えていて新しいインスタンスが起動できないことがあります
- 初回のデプロイが失敗したとき（前のリビジョンが無い）は切り戻せません。原因を直す PR をマージして deploy します
- LC を動かしたかの「取消」（#165・設計書 C56）より前のリビジョンへ戻すと、「取消」で記録した取引は前の画面で「広げた」と見え、判定に B（取消）が付きません（保存の値は残ります）。前の API は `cancelled` を知らないので、その取引を直す保存は 400 で止まり、記録は壊れません。戻している間はその取引を直さないでください
- **知らない版の取引の守り（#115）より前のリビジョンへは戻しません**。取引の文書の `schemaVersion` が API の知る値より大きい取引（オプションのポジションの `schemaVersion: 2`。足 `legs` を持つ）は、守りのある版の API が直し・チャートの差し替え・外すを 409 で拒み、足を落とさないようにしています（ADR-0020 の決定 7 の (a)）。`rollback.yml` は 1 回で「今 100% を受けるリビジョンより前に作られた Ready の最新」へ戻すので、守りを足の形より 1 つ前のデプロイで単独に出してあれば、1 回の切り戻しでは守りが残ります。**`rollback.yml` を続けて流す・手元の gcloud で選ぶなど、2 つ以上前へ戻すとき** は、戻し先のリビジョンが守りを含むかをイメージの digest で確かめます。守りの PR をマージした後の deploy の run の Summary に「イメージ loss-note: `<タグ>`（digest `sha256:<先頭 12 桁>`）」が出るので、`gcloud run revisions describe <REVISION> --region=$L --project="$P" --format='value(spec.containers[0].image)'` の `@sha256:` の後ろと突き合わせます（同じ digest か、その run より後の deploy の digest なら守りを含みます。作られた時刻だけで比べると、設定だけを変えた deploy のリビジョンと紛れます）。含まない版へ戻したときは、戻している間にオプションのポジションを直さないでください（直すと、前の版の画面と API が足の無い本文で上書きし、足が消えます）
- 前の版（守りの版を含む）は `schemaVersion: 2` の文書を一覧・詳細に出しますが、**R・リスク（%）・判定は今の版と違って見えます**（前の版は足を知らないので、1R を先物 1 枚の式か損益の逆算で出し、LC の無い `riskPlan: maxLoss` の取引は C と出ます。決済の注文の種類「満期（SQ）」`expiry` は「不明」と同じに扱われます）。保存は守りの 409 で変わらないので、今の版に戻せば元どおりに見えます。戻している間の判定・集計（ホームの規律の振り返り）は参考にしないでください

待ちと取り消しの振る舞い（deploy と rollback は同じ concurrency `terraform-prod`。GitHub の concurrency に優先度はありません）:

- 承認待ちの deploy があると、rollback はその後ろで待ちます（承認待ちの deploy を承認か拒否するまで動きません）
- 同じグループで待てる（pending の）run は 1 つだけで、新しく入った run が前の pending を取り消します。待っている rollback の後に次の deploy（main へのマージ）が入ると、その rollback は取り消されます
- 障害のときは、**承認待ちの deploy を先に拒否してから** rollback を動かします。急ぐとき・GitHub の承認を待てないときは、上の「手元から」の gcloud で戻します
- CI が失敗した main の run・fork の PR の CI の完了・main 以外から動かした run は `terraform-prod` に入らない（run ごとの別のグループ）ので、待っている deploy・rollback を取り消しません（`.github/scripts/workflow-concurrency-check.sh` が式を確かめます）

## バックアップからの戻し

Firestore の日次のバックアップ（保持 7 日。bootstrap の `google_firestore_backup_schedule.daily`）から戻します。自動化はしていません。**バックアップは既存のデータベースへ直接は戻せない** ので、別の名前のデータベースへ戻して件数を確かめてから、一時バケット経由で `(default)` へ入れます。所有者の資格情報で行います。

```sh
gcloud firestore backups list --location=$L --project="$P" --format='table(name.basename(),snapshotTime)'   # 戻したい時点のものを選ぶ
B=<BACKUP_ID>; D=restore-<YYYYMMDD>                                                                           # 戻し先は新しい名前
gcloud firestore databases restore --source-backup="projects/$P/locations/$L/backups/$B" --destination-database="$D" --project="$P"
# 件数を確かめる（取引の文書の数。中身は表示しない）
curl -s -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" -H 'Content-Type: application/json' \
  "https://firestore.googleapis.com/v1/projects/$P/databases/$D/documents:runAggregationQuery" \
  -d '{"structuredAggregationQuery":{"structuredQuery":{"from":[{"collectionId":"trades","allDescendants":true}]},"aggregations":[{"alias":"n","count":{}}]}}' \
  | jq '.[0].result.aggregateFields.n.integerValue'
```

中身がよければ、一時バケットへ書き出して `(default)` へ取り込みます（取り込みは同じ ID の文書を上書きします。バックアップの後に作られた文書は残るので、残すかどうかを先に決めます）:

```sh
gcloud storage buckets create "gs://$P-firestore-restore" --project="$P" --location=$L --uniform-bucket-level-access --public-access-prevention
gcloud firestore export "gs://$P-firestore-restore/$D" --database="$D" --project="$P"
gcloud firestore import "gs://$P-firestore-restore/$D" --database='(default)' --project="$P"
# 終わったら一時のものを消す（記録の写しなので残さない）
gcloud firestore databases delete --database="$D" --project="$P"
gcloud storage rm --recursive "gs://$P-firestore-restore"
```

## 明細の読み取りの資格情報（#44・ADR-0010、#55・ADR-0011）

本番の決済明細の読み取りの資格情報は、repository variable `STATEMENT_READ_CREDENTIAL` で 3 つの方式から選びます（未設定なら Cloud Run に資格情報を載せず、読み取りは 503 `read_unavailable`・ほかの機能は動きます）。API は子の CLI に **選んだ方式の変数だけ** を渡します（ほかの方式・送り先の変数は子の環境に名前ごと無い）。

| 方式 | 値の置き場 | Cloud Run の環境変数 | 向き |
|---|---|---|---|
| `api_key` | Secret Manager の `statement-read-anthropic-api-key` | `STATEMENT_READ_CREDENTIAL`・`ANTHROPIC_API_KEY`（参照） | 従量課金のキー。本番専用のワークスペースで月の上限を置く |
| `oauth_token` | Secret Manager の `statement-read-claude-oauth-token` | `STATEMENT_READ_CREDENTIAL`・`CLAUDE_CODE_OAUTH_TOKEN`（参照） | オーナーのサブスクの資格情報。**オーナーだけが使う間に限る**（他の利用者を受け入れる前に `federation` か `api_key` へ） |
| `federation` | 秘密なし（識別子は repository secrets → sensitive な Terraform の変数） | `STATEMENT_READ_CREDENTIAL`・`ANTHROPIC_FEDERATION_RULE_ID`・`ANTHROPIC_ORGANIZATION_ID`（+ 設定したときだけ `ANTHROPIC_SERVICE_ACCOUNT_ID`・`ANTHROPIC_WORKSPACE_ID`） | 長く有効な秘密を置かない。API が要求ごとに実行用 SA の ID トークン（audience `https://api.anthropic.com`）をメタデータ サーバーから取り、要求ごとの一時ファイルで渡す |

入れ物はどちらも `infra/bootstrap/statement_read_credentials.tf`（東京だけに複製・削除の防止・読めるのは実行用 SA だけ）。値（版）は Terraform で宣言しません。#44 の `STATEMENT_READ_KEY=true` は、`STATEMENT_READ_CREDENTIAL` が未設定のときだけ `api_key` と同じに扱います。

1. **入れ物を作る**（所有者の apply。「変更」の節の手順。#44 の後に #55 の差分を足すときの要約は create 2: `google_secret_manager_secret.statement_read_oauth`・`google_secret_manager_secret_iam_member.statement_read_oauth`）
2. **方式の値を入れる**（オーナー。値をターミナル・チャット・ファイルに通さない）:
   - `api_key`: Anthropic Console で本番専用のワークスペースを作り、**月の上限を 20 USD** にしてから API キーを作る → 下の「Secret Manager に版を入れる」で `statement-read-anthropic-api-key` に入れる
   - `oauth_token`: オーナーの手元のターミナル（Claude Code の会話の外）で `claude setup-token` を流し、表示されたトークンをコピーする → 下の「Secret Manager に版を入れる」で `statement-read-claude-oauth-token` に入れる
   - `federation`: Anthropic Console の「Workload identity」（Settings → Workload identity）で「Connect workload」→「Google Cloud」を選び、発行元 `https://accounts.google.com`（discovery）・サービスアカウント・ルール（audience `https://api.anthropic.com`、主張 `sub` = 実行用 SA の一意 ID（GCP のコンソールの「IAM と管理」→「サービス アカウント」→ `sa-loss-note` の「一意の ID」）、`email` = 実行用 SA のメール、scope `workspace:inference`、本番専用のワークスペース）を作る。ルール ID・組織 ID（と使うなら SA の ID・ワークスペースの ID）を GitHub の「Settings → Secrets and variables → Actions → New repository secret」で `STATEMENT_READ_FEDERATION_RULE_ID`・`STATEMENT_READ_ORGANIZATION_ID`（・`STATEMENT_READ_SERVICE_ACCOUNT_ID`・`STATEMENT_READ_WORKSPACE_ID`）に貼る
3. **Secret Manager に版を入れる**（`api_key`・`oauth_token`）:
   1. GCP のコンソールで loss-note のプロジェクトを選び、「セキュリティ」→「Secret Manager」を開く
   2. 一覧の入れ物（上の表）を押して詳細を開き、「新しいバージョン」（+ New version）を押す
   3. 「シークレットの値」の欄にコピーした値を貼る（ファイルのアップロードは使わない。前後に空白・改行を入れない）
   4. 「以前のバージョンをすべて無効にする」は値を入れ替えるときだけ選ぶ（最初は選ばない）→「新しいバージョンを追加」を押す
   5. 貼った後はクリップボードを別の文字で上書きし、値の表示を閉じる

   確かめ（値は読まない。版の数だけ）:

   ```sh
   gcloud secrets versions list <入れ物> --project="$P" --filter=state=ENABLED --format='value(name)' | wc -l   # 1
   ```

4. **方式を選ぶ**: `gh variable set STATEMENT_READ_CREDENTIAL -R "$REPO" -b <方式>`（秘密ではない切り替えなので repository variable。下の注）→ deploy（`gh workflow run deploy -R "$REPO" --ref main`）を承認します。版の無い入れ物を参照するとインスタンスが起動しないので、`api_key`・`oauth_token` は 3 の後に選びます。`federation` で必須の識別子が無いと plan で止まります

`STATEMENT_READ_CREDENTIAL`・`STATEMENT_READ_KEY`（と下の AI の上限の切り替え・数）だけは secrets でなく variables に置きます。CI が読む値は secrets に置く決まりですが、値を伏せる必要の無い切り替えは例外です（secrets にすると Actions のログの方式の名前・`true` がすべて伏せ字になり、plan・検査のログが読めなくなるため）。

上限（設計書 8.2・下の「AI の上限とバイパス」）: 既定は利用者ごとに 1 日 30 回・1.00 USD、全利用者の合計で 1 日 2.00 USD（日本時間の 0:00 で区切る）。越えると 429 `read_limited`（画面は「今日の読み取りの上限に達しました。手で入れてください。」）。日ごとの計上は Firestore の `statement_read_spend/{YYYY-MM-DD}`（`count`・`microUsd`。1 USD = 1,000,000）と `users/{uid}/statement_read_days/{YYYY-MM-DD}`（`count`・`microUsd`。`microUsd` は #51 から）にあり、所有者の資格情報で読めます（中身は日付・回数・金額だけ）。利用者は自分の分だけを設定の画面の「AI の利用状況」で見られます（#62。今日・今月の回数と金額）。そこに出る今月の額は日の計上の合計で、Anthropic Console の月の上限（使った額）とは別の数字です。

```sh
D=$(TZ=Asia/Tokyo date +%F)
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://firestore.googleapis.com/v1/projects/$P/databases/(default)/documents/statement_read_spend/$D" \
  | jq '{count: .fields.count.integerValue, usd: ((.fields.microUsd.integerValue // "0" | tonumber) / 1000000),
         per_read_within_reserve: (((.fields.microUsd.integerValue // "0" | tonumber) / ((.fields.count.integerValue // "1" | tonumber) | if . == 0 then 1 else . end)) <= 278736)}'
```

`per_read_within_reserve` は、その日の 1 回あたりの実額が予約額（278,736 µUSD。`packages/statement-read` の `pricing.reserve_micro_usd`）以下か。false なら CLI が最大出力の上限を守っていない・続きの要求（最大出力で止まった後の回復。ADR-0010）が出たなどで、予約額が上界になっていない

止める・戻す:

| 場面 | 手順 |
|---|---|
| 読み取りが本番を壊す（起動しない・メモリ超え） | `gh variable delete STATEMENT_READ_CREDENTIAL -R "$REPO"`（あれば `STATEMENT_READ_KEY` も）→ deploy（資格情報を外す）。それでも駄目なら「切り戻し」 |
| キー・トークンが漏れた疑い | Anthropic Console でキーを無効にする（OAuth トークンは claude.ai の設定で取り消す）→ 方式の variable を消して deploy → `gcloud secrets versions disable <版> --secret=<入れ物> --project="$P"`（参照を外した後に。先に無効にするとインスタンスが起動しない）→ 新しい値で 2〜4 をやり直す |
| `federation` の交換が通らない | 読み取りは 502 `read_failed`（ログの理由が `identity_token` なら ID トークンの取得、`failed` なら交換・送り先）。Anthropic Console の Workload identity の認証の履歴で拒否の理由を見る。急ぐときは別の方式へ切り替える |
| 上限の不具合 | 修正の PR。急ぐときは方式の variable を消して deploy し、読み取りを止める（記録は手で続けられる） |
| 429 が続くのに読み取りの回数が少ない日 | 精算の失敗で予約額（約 0.28 USD）が実額に直らずに残っている。`gcloud logging read 'resource.type="cloud_run_revision" AND jsonPayload.event="statement_read_settle"' --project="$P" --freshness=1d --format='value(timestamp)' \| wc -l` で件数を見る（閉じる側の設計どおり。翌日の 0:00 に戻る） |

## AI の上限とバイパス（#51・ADR-0014）

AI（いまは明細の読み取り）の 1 日の上限は 3 つです。判定の順は 回数（利用者）→ 費用（利用者）→ 費用（全体）で、どれかを越える要求は AI を呼ばずに 429 `read_limited`（どれで止まったかはログの理由 `limited_user` / `limited_user_spend` / `limited_spend` だけ）。

| 上限 | 既定 | Cloud Run の環境変数 | repository variable |
|---|---|---|---|
| 利用者ごとの回数 | 30 回 | `LOSS_NOTE_AI_USER_DAILY_COUNT`（0〜999999 の整数） | `AI_USER_DAILY_COUNT` |
| 利用者ごとの費用 | 1.00 USD | `LOSS_NOTE_AI_USER_DAILY_USD`（整数部 6 桁・小数 6 桁まで） | `AI_USER_DAILY_USD` |
| 全利用者の合計の費用（ブレーカー） | 2.00 USD | `LOSS_NOTE_AI_DAILY_USD`（同上） | `AI_DAILY_USD` |

- 値を変える: `gh variable set AI_DAILY_USD -R "$REPO" -b 3.00` → deploy を承認（未設定・空なら既定）。形の誤りは plan で止まり、API に届いても読み取りは 503 `read_unavailable`（既定値に戻さない = 閉じる側。ログの理由 `limit_config` と変数の名前 `var`）。空白だけの値も形の誤りです。上の天井はコードで設けません（最後の歯止めは提供元の Console の月の上限）。予約額（約 0.28 USD）より小さい費用の上限では 1 回も送れません
- **バイパス**: リストの利用者（確かめ済みのメール。照らし方は許可リストと同じ）は、利用者ごとの回数と費用の上限を受けません。全体の上限は受けます（足りなければ全体の上限を上げる。最後の歯止めは提供元の Console の月の上限）。バイパスの利用者の回数・金額も計上には残ります。バイパスは使えるかどうか（許可リスト）には影響しません
- 切り戻し（`rollback.yml`）で #51 より前のリビジョンに戻した日は、前のコードが利用者の日の文書を `{count}` で置き換えるので、利用者の金額が消える・負になることがあります。新しいコードに戻った後は欠け・負を「回数 × 予約額」に見積もる（多めに数える側。その日のうちに利用者の費用の上限で 429 になりうる）ので、少なめに数えるのは置き換えの後に書かれた分だけです。全体の上限はその日も効きます
- バイパスのリストは Secret Manager の `loss-note-ai-bypass-emails`（入れ物と実行用 SA の読み取りの付与は `infra/bootstrap/secrets.tf`）。値は Terraform・GitHub・ログに置きません。入れ方は許可リストと同じ（`read -rs` で受けて標準入力から `gcloud secrets versions add loss-note-ai-bypass-emails --data-file=-`）。**版を入れた後に** `gh variable set AI_LIMIT_BYPASS -R "$REPO" -b true` → deploy（版の無い参照ではインスタンスが起動しない）。外すときは `gh variable delete AI_LIMIT_BYPASS -R "$REPO"` → deploy（版を無効にするのは参照を外した後）
- 利用者ごとの今日の計上（所有者の資格情報。回数と金額だけ）:

  ```sh
  D=$(TZ=Asia/Tokyo date +%F)
  curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    "https://firestore.googleapis.com/v1/projects/$P/databases/(default)/documents:runQuery" \
    -d '{"structuredQuery":{"from":[{"collectionId":"statement_read_days","allDescendants":true}]}}' \
    | jq --arg d "$D" '[.[] | .document? // empty | select(.name | endswith("/" + $d)) | {count: .fields.count.integerValue, usd: ((.fields.microUsd.integerValue // "0" | tonumber) / 1000000)}]'
  ```

## 変更

土台を変える（API・付与・予算の金額など）ときは、PR で `infra/bootstrap` を直し、マージの後に所有者が「共通のシェルの変数」→ `init` → plan の要約を確かめて → apply します。CI は bootstrap を apply しません。付与を足すときは `.github/scripts/tf-iam-grants.sh` の期待の集合と `tests/bootstrap.tftest.hcl` も一緒に直します。

#41 の土台を作った後に #42 の差分（Firestore）を足すときの要約は create 6 です（`firebaserules.googleapis.com` の有効化・Firestore の `(default)`・日次のバックアップの予定・ルールの ruleset と release・実行用 SA の `roles/datastore.user`）。Firestore の場所は後から変えられず、削除の防止があるので、要約を確かめてから apply します。

#87（取引の一覧のページ分け。ADR-0016）の差分は create 1 です（`google_firestore_index.trades_by_exit`。取引のコレクションの複合索引 = `record.exit.time` 降・`createdAt` 降・`__name__` 昇）。索引の作成には件数に応じて数分かかります。**API のデプロイより先に apply します**（作成が終わる前・apply の前にデプロイしても、API は全件を読んで切る形に一時的に戻るので一覧は開けます。そのときはログに `trades_page_fallback` が出ます）。作成の状態は `gcloud firestore indexes composite list --project=<PROJECT_ID>` の `STATE`（`READY`）で確かめます。

リポジトリ・オーナーの名前を変えても、CI の借用は続きます（照合も借用の主体も数値 ID と Environment だけで決めています）。次の apply でプールの説明だけが新しい名前に変わります。リポジトリを作り直した（数値 ID が変わった）ときは、新しい ID で apply し直します。

## 撤去の注意

`terraform destroy` 全体は使いません（SA・プール・バケット・Artifact Registry・Web アプリは削除の防止 = `PREVENT` で止まります）。全部をやめるときは次の順で行います。

1. **予算を先に消す**。予算は請求先のリソースなので、プロジェクトを消しても残ります: `$TF -chdir=infra/bootstrap destroy -target=google_billing_budget.monthly`
2. GitHub の設定を消す: `gh api -X DELETE $R/environments/prod`、`gh secret delete <名前> -R "$REPO"`（7 つ）・`gh variable delete STATEMENT_READ_CREDENTIAL -R "$REPO"`・`gh variable delete STATEMENT_READ_KEY -R "$REPO"`（あれば）と、`federation` の secrets（あれば）
3. 請求先を外してプロジェクトを消す: `gcloud billing projects unlink "$P"` → `gcloud projects delete "$P"`（30 日の保留の後に消えます。同じ ID は再利用できません）

Identity Platform の有効化と Firebase の追加は、プロジェクトの中では戻せません（戻すにはプロジェクトの削除だけです）。Firestore のデータベースは削除の防止があり、Terraform から外しても消えません（`ABANDON`）。Cloud Run のサービスだけを撤去するときは、`infra/prod/run.tf` を消す PR をマージして deploy を承認します（`deletion_protection = false`。データは Firestore に残ります）。
