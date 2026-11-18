# infra（Terraform）

loss-note の本番の土台です。自分の GCP プロジェクトと GitHub のリポジトリで、同じ土台を作れるように書いてあります（値はすべてプレースホルダ・シェルの変数です。実際の値をこのリポジトリにコミットしないでください）。

| ルート | apply する人 | 中身 |
|---|---|---|
| `bootstrap/` | 所有者（手元から） | API の有効化・Terraform の state のバケット 2 つ・Workload Identity 連携・CI のサービスアカウント（plan 用・apply 用）・Cloud Run の実行用サービスアカウント・Artifact Registry・Firebase（Web アプリ 1 つ）と Authentication の初期化（Identity Platform）・月の予算 |
| `prod/` | CI（Environment `prod` の承認の後） | Cloud Run など（#42 で足します） |

プロジェクトの作成・請求先の紐付けは Terraform の外（gcloud）で行います。理由と、戻せないもの（Identity Platform・Firebase の追加）は [`docs/adr-0008-production-foundation.md`](../docs/adr-0008-production-foundation.md) にあります。

前提: リポジトリの `mise.toml` の道具（terraform 1.17.1）、gcloud（プロジェクトを作れて、請求先の予算を作れる所有者のアカウントでログイン済み）、gh（リポジトリの管理者でログイン済み）、jq。

## 検証（CI と同じ。資格情報なし）

```sh
terraform fmt -check -recursive infra
terraform -chdir=infra/bootstrap init -backend=false -input=false
terraform -chdir=infra/bootstrap validate
terraform -chdir=infra/bootstrap test                  # モックのプロバイダ。実リソースは作らない
.github/scripts/tf-required-vars.sh                    # 変数なしの plan が、必須の変数の未指定で止まること
.github/scripts/tf-iam-grants.test.sh                  # 下の検査の自己テスト
.github/scripts/tf-iam-grants.sh                       # IAM の付与の宣言が期待の集合だけ（権威的な _binding・_policy、*.tf.json・module は 0 件）
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
   # 要約（アドレスと操作だけ）。初回は create 34・import 1（bootstrap のバケット。設定の in-place update を伴う）
   $TF -chdir=infra/bootstrap show -json bootstrap.tfplan | jq -r '.resource_changes[]
     | select(.change.actions != ["no-op"] or .change.importing)
     | "\(.address): \(.change.actions | join(","))\(if .change.importing then " (import)" else "" end)"'
   # 変更の対象がすべてこのプロジェクト（true）
   $TF -chdir=infra/bootstrap show -json bootstrap.tfplan | jq --arg p "$P" '[.resource_changes[] | .change.after.project? // empty] | unique == [$p]'
   $TF -chdir=infra/bootstrap apply -input=false -no-color bootstrap.tfplan > "$LOG/apply.log" 2>&1; echo $?
   grep -oE 'Resources: [0-9a-z ,]+ destroyed' "$LOG/apply.log"   # 件数の行だけ（初回の目安: 1 imported, 34 added, 1 changed, 0 destroyed）
   rm -f infra/bootstrap/bootstrap.tfplan
   ```

   ほかの update・delete・replace が出たら apply しないでください。ログ（`$LOG`。`data/local/` は gitignore 済み）は手元にだけ置き、共有しないでください。API を有効にした直後は伝搬が間に合わず失敗することがあります。その場合はもう一度 plan → apply します（冪等です）。

## apply 後の確認

値は表示せず、件数・真偽・状態コードだけを見ます。

```sh
$TF -chdir=infra/bootstrap plan -input=false -detailed-exitcode > /dev/null; echo $?          # 差分なし: 0
gcloud billing projects describe "$P" --format='value(billingEnabled)'                       # True

# API: 14
printf '%s.googleapis.com\n' cloudresourcemanager serviceusage cloudbilling billingbudgets iam iamcredentials sts \
  storage artifactregistry run firestore firebase identitytoolkit securetoken \
  | grep -cxF -f - <(gcloud services list --enabled --project="$P" --format='value(config.name)')

# プロジェクト単位のロール: sa-tf-apply = roles/run.admin、sa-tf-plan = roles/run.viewer、sa-loss-note = （空）
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

# 予算: 対象がこのプロジェクトだけの予算が 1 件（1）
PN=$(gcloud projects describe "$P" --format='value(projectNumber)')
gcloud billing budgets list --billing-account="$BA" --format=json \
  | jq --arg pn "projects/$PN" '[.[] | select(.displayName == "loss-note-monthly" and .budgetFilter.projects == [$pn])] | length'
```

## GitHub の設定

CI（#42 の plan / apply）が使う値と Environment `prod` を設定します。値は表示せず、Terraform の出力からパイプで渡します（WIF のプロバイダの完全名はプロジェクト番号を含むので secret にします）。リポジトリの管理者の権限が要ります。

| 種類 | 名前 | 中身 |
|---|---|---|
| repository variable | `GCP_PROJECT_ID` | プロジェクト ID |
| repository variable | `GCP_SA_TF_PLAN` | plan 用 SA のメール（出力 `sa_tf_plan_email`） |
| repository variable | `GCP_SA_TF_APPLY` | apply 用 SA のメール（出力 `sa_tf_apply_email`） |
| repository variable | `TF_STATE_BUCKET` | prod の state のバケット（出力 `tf_state_bucket`） |
| secret | `GCP_WIF_PROVIDER` | WIF のプロバイダの完全名（出力 `wif_provider_name`） |
| Environment | `prod` | デプロイできるブランチは `main` だけ・承認者は所有者 1 名 |

```sh
$TF -chdir=infra/bootstrap output -raw wif_provider_name | gh secret set GCP_WIF_PROVIDER -R "$REPO"
$TF -chdir=infra/bootstrap output -raw sa_tf_plan_email  | gh variable set GCP_SA_TF_PLAN -R "$REPO"
$TF -chdir=infra/bootstrap output -raw sa_tf_apply_email | gh variable set GCP_SA_TF_APPLY -R "$REPO"
$TF -chdir=infra/bootstrap output -raw tf_state_bucket   | gh variable set TF_STATE_BUCKET -R "$REPO"
printf '%s' "$P" | gh variable set GCP_PROJECT_ID -R "$REPO"
# Environment prod: main だけ、承認者は所有者（自分で承認できる）
jq -n --argjson id "$(gh api user --jq .id)" '{wait_timer: 0, prevent_self_review: false,
  reviewers: [{type: "User", id: $id}],
  deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}}' \
  | gh api -X PUT $R/environments/prod --input - > /dev/null
gh api -X POST $R/environments/prod/deployment-branch-policies -f name=main -f type=branch > /dev/null
```

確認（値は表示しない。すべて `true`）:

```sh
gh api $R/actions/variables --jq '[.variables[].name] | contains(["GCP_PROJECT_ID", "GCP_SA_TF_APPLY", "GCP_SA_TF_PLAN", "TF_STATE_BUCKET"])'
gh api $R/actions/secrets --jq '[.secrets[].name] | index("GCP_WIF_PROVIDER") != null'
gh api $R/environments/prod --jq '.deployment_branch_policy == {"protected_branches": false, "custom_branch_policies": true} and ([.protection_rules[] | select(.type == "required_reviewers") | .reviewers[]] | length) == 1'
gh api $R/environments/prod/deployment-branch-policies --jq '[.branch_policies[] | {name, type}] == [{"name": "main", "type": "branch"}]'
```

## 変更

土台を変える（API・付与・予算の金額など）ときは、PR で `infra/bootstrap` を直し、マージの後に所有者が「共通のシェルの変数」→ `init` → plan の要約を確かめて → apply します。CI は bootstrap を apply しません。付与を足すときは `.github/scripts/tf-iam-grants.sh` の期待の集合と `tests/bootstrap.tftest.hcl` も一緒に直します。

リポジトリ・オーナーの名前を変えても、CI の借用は続きます（照合も借用の主体も数値 ID と Environment だけで決めています）。次の apply でプールの説明だけが新しい名前に変わります。リポジトリを作り直した（数値 ID が変わった）ときは、新しい ID で apply し直します。

## 撤去の注意

`terraform destroy` 全体は使いません（SA・プール・バケット・Artifact Registry・Web アプリは削除の防止 = `PREVENT` で止まります）。全部をやめるときは次の順で行います。

1. **予算を先に消す**。予算は請求先のリソースなので、プロジェクトを消しても残ります: `$TF -chdir=infra/bootstrap destroy -target=google_billing_budget.monthly`
2. GitHub の設定を消す: `gh api -X DELETE $R/environments/prod`、`gh variable delete <名前> -R "$REPO"`（4 つ）、`gh secret delete GCP_WIF_PROVIDER -R "$REPO"`
3. 請求先を外してプロジェクトを消す: `gcloud billing projects unlink "$P"` → `gcloud projects delete "$P"`（30 日の保留の後に消えます。同じ ID は再利用できません）

Identity Platform の有効化と Firebase の追加は、プロジェクトの中では戻せません（戻すにはプロジェクトの削除だけです）。
