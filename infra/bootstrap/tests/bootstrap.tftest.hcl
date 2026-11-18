# infra/bootstrap の静的テスト（terraform test）。モックのプロバイダなので資格情報なしで回り、実リソースは作らない。
# command = apply（既定）はモックの computed 値（プール名など）を確定させて assert するため（plan だと unknown になる）。
# 値はすべて架空（プロジェクト example-project、リポジトリ example-owner/example-repo、数値 ID 123 / 456、
# 請求先 000000-000000-000000、プロジェクト番号 123456789）。
# 例 G1（変数なしの plan が止まる）は tests/required-vars/ と .github/scripts/tf-required-variables.sh。

mock_provider "google" {}
mock_provider "google-beta" {}

# imports.tf の取り込みはモックでは行えないので、取り込み先を上書きする
override_resource {
  target = google_storage_bucket.tfstate["bootstrap"]
}

# SA の name / member はプロバイダの形式の検証に掛かるので、モックの乱数ではなく SA ごとに架空の値を与える
# （SA ごとに違う値にして、付与先の取り違えを assert で検出できるようにする）
override_resource {
  target = google_service_account.tf_plan
  values = {
    name   = "projects/example-project/serviceAccounts/sa-tf-plan@example-project.iam.gserviceaccount.com"
    email  = "sa-tf-plan@example-project.iam.gserviceaccount.com"
    member = "serviceAccount:sa-tf-plan@example-project.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_service_account.tf_apply
  values = {
    name   = "projects/example-project/serviceAccounts/sa-tf-apply@example-project.iam.gserviceaccount.com"
    email  = "sa-tf-apply@example-project.iam.gserviceaccount.com"
    member = "serviceAccount:sa-tf-apply@example-project.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_service_account.runtime
  values = {
    name   = "projects/example-project/serviceAccounts/sa-loss-note@example-project.iam.gserviceaccount.com"
    email  = "sa-loss-note@example-project.iam.gserviceaccount.com"
    member = "serviceAccount:sa-loss-note@example-project.iam.gserviceaccount.com"
  }
}

override_resource {
  target = google_iam_workload_identity_pool.github
  values = {
    name = "projects/000/locations/global/workloadIdentityPools/github"
  }
}

override_data {
  target = data.google_project.this
  values = {
    number = "123456789"
  }
}

variables {
  project_id           = "example-project"
  billing_account      = "000000-000000-000000"
  github_repository    = "example-owner/example-repo"
  github_repository_id = "123"
  github_owner_id      = "456"
}

run "defaults" {
  # 例 A: 有効にする API は 16 個（#41 の 14 個 + #42 の firebaserules + #43 の secretmanager）。Terraform から外しても止めない
  assert {
    condition = toset([for s in google_project_service.apis : s.service]) == toset([
      "cloudresourcemanager.googleapis.com", "serviceusage.googleapis.com", "cloudbilling.googleapis.com",
      "billingbudgets.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com",
      "storage.googleapis.com", "artifactregistry.googleapis.com", "run.googleapis.com", "firestore.googleapis.com",
      "firebase.googleapis.com", "identitytoolkit.googleapis.com", "securetoken.googleapis.com",
      "firebaserules.googleapis.com", "secretmanager.googleapis.com",
    ])
    error_message = "有効にする API は例 A の 14 個と firebaserules・secretmanager の 16 個"
  }
  assert {
    condition     = alltrue([for s in google_project_service.apis : s.disable_on_destroy == false && s.deletion_policy == "ABANDON" && s.project == "example-project"])
    error_message = "API は Terraform から外しても止めない（disable_on_destroy = false・ABANDON）"
  }

  # AC-3 / 例 W: プロバイダの条件はリポジトリ ID とオーナー ID の両方の完全一致（|| などで弱めたら落ちる。名前を含まない = W6）
  assert {
    condition     = google_iam_workload_identity_pool_provider.github_actions.attribute_condition == "assertion.repository_id == '123' && assertion.repository_owner_id == '456' && assertion.event_name != 'pull_request_target'"
    error_message = "attribute_condition はリポジトリ ID とオーナー ID の両方を && で固定する"
  }
  assert {
    condition     = !strcontains(google_iam_workload_identity_pool_provider.github_actions.attribute_condition, "example")
    error_message = "attribute_condition にリポジトリ・オーナーの名前を使わない（名前を変えても同じに扱う）"
  }
  # pull_request_target は受けない。event を絞るのはこの 1 つだけ（PR・push などの plan 用 SA の借用を壊さない）
  assert {
    condition     = length(regexall("event_name", google_iam_workload_identity_pool_provider.github_actions.attribute_condition)) == 1 && strcontains(google_iam_workload_identity_pool_provider.github_actions.attribute_condition, " && assertion.event_name != 'pull_request_target'")
    error_message = "event_name の条件は != 'pull_request_target' の 1 つだけ（pull_request・push などを落とさない）"
  }
  assert {
    condition     = length(regexall("'pull_request'|'push'|==\\s*'pull_request_target'", google_iam_workload_identity_pool_provider.github_actions.attribute_condition)) == 0
    error_message = "pull_request・push を名指しで絞らない・pull_request_target を許さない"
  }

  # google.subject は数字だけのクレームで作る（127 バイトの上限を長いブランチ名・Environment 名で超えない）
  assert {
    condition     = google_iam_workload_identity_pool_provider.github_actions.attribute_mapping["google.subject"] == "assertion.repository_id + ':' + assertion.run_id + ':' + assertion.run_attempt"
    error_message = "google.subject は <REPO_ID>:<run_id>:<run_attempt>"
  }
  assert {
    condition     = toset([for m in regexall("assertion\\.([a-z_]+)", google_iam_workload_identity_pool_provider.github_actions.attribute_mapping["google.subject"]) : m[0]]) == toset(["repository_id", "run_id", "run_attempt"])
    error_message = "google.subject に名前・ref・Environment など長さの決まらないクレーム（sub・ref など）を使わない"
  }
  assert {
    condition     = google_iam_workload_identity_pool_provider.github_actions.oidc[0].issuer_uri == "https://token.actions.githubusercontent.com"
    error_message = "OIDC の issuer"
  }
  assert {
    condition     = google_iam_workload_identity_pool.github.workload_identity_pool_id == "github" && google_iam_workload_identity_pool_provider.github_actions.workload_identity_pool_provider_id == "github-actions"
    error_message = "プールの ID は github、プロバイダの ID は github-actions"
  }

  # apply SA を借用できるのは、このリポジトリ・オーナーの数値 ID と Environment prod から作る属性の値 1 つだけ（名前を含まない）
  assert {
    condition     = google_iam_workload_identity_pool_provider.github_actions.attribute_mapping["attribute.repo_env"] == "assertion.repository_id + ':' + assertion.repository_owner_id + ':' + (has(assertion.environment) ? assertion.environment : '')"
    error_message = "attribute.repo_env は <REPO_ID>:<OWNER_ID>:<Environment>（Environment の無い job は空）の数値 ID だけで作る"
  }
  assert {
    condition     = google_service_account_iam_member.tf_apply_wif.member == "principalSet://iam.googleapis.com/projects/000/locations/global/workloadIdentityPools/github/attribute.repo_env/123:456:prod"
    error_message = "apply SA の workloadIdentityUser は attribute.repo_env = <REPO_ID>:<OWNER_ID>:prod の principalSet 1 件だけ"
  }
  assert {
    condition     = google_service_account_iam_member.tf_apply_wif.service_account_id == google_service_account.tf_apply.name && google_service_account_iam_member.tf_apply_wif.role == "roles/iam.workloadIdentityUser"
    error_message = "apply SA の WIF の付与先と role"
  }
  # plan SA はこのリポジトリの数値 ID の principalSet
  assert {
    condition     = google_service_account_iam_member.tf_plan_wif.member == "principalSet://iam.googleapis.com/projects/000/locations/global/workloadIdentityPools/github/attribute.repository_id/123"
    error_message = "plan SA はこのリポジトリの数値 ID の principalSet で借用を許す"
  }
  assert {
    condition     = google_service_account_iam_member.tf_plan_wif.service_account_id == google_service_account.tf_plan.name && google_service_account_iam_member.tf_plan_wif.role == "roles/iam.workloadIdentityUser"
    error_message = "plan SA の WIF の付与先と role"
  }

  # AC-4 / 例 P: CI の SA のプロジェクト単位の付与は {run.admin → apply SA, run.viewer → plan SA} だけ（#42 の KEEP-5。
  # 実行用 SA の付与は firestore.tf の runtime_datastore だけ。下の「#42 の AC-5・例 F4」）
  assert {
    condition = toset([for m in google_project_iam_member.ci : "${m.role} ${m.member}"]) == toset([
      "roles/run.admin serviceAccount:sa-tf-apply@example-project.iam.gserviceaccount.com",
      "roles/run.viewer serviceAccount:sa-tf-plan@example-project.iam.gserviceaccount.com",
    ])
    error_message = "プロジェクト単位の付与は apply SA の run.admin と plan SA の run.viewer の 2 件だけ"
  }
  assert {
    condition     = alltrue([for m in google_project_iam_member.ci : m.project == "example-project" && length(m.condition) == 0])
    error_message = "プロジェクト単位の付与はこのプロジェクトに条件なしで付ける"
  }
  assert {
    condition = length(setintersection(toset([for m in google_project_iam_member.ci : m.role]), toset([
      "roles/owner", "roles/editor", "roles/viewer", "roles/resourcemanager.projectIamAdmin", "roles/iam.securityAdmin",
      "roles/iam.serviceAccountAdmin", "roles/iam.serviceAccountKeyAdmin", "roles/iam.serviceAccountTokenCreator",
      "roles/serviceusage.serviceUsageAdmin", "roles/storage.admin", "roles/firebase.admin",
    ]))) == 0
    error_message = "P4 のロール（owner・editor・viewer・IAM の管理など）を付けない"
  }
  # SA 単位: apply SA → 実行用 SA の serviceAccountUser だけ
  assert {
    condition     = google_service_account_iam_member.tf_apply_act_as_runtime.service_account_id == google_service_account.runtime.name && google_service_account_iam_member.tf_apply_act_as_runtime.role == "roles/iam.serviceAccountUser" && google_service_account_iam_member.tf_apply_act_as_runtime.member == google_service_account.tf_apply.member
    error_message = "apply SA の serviceAccountUser は実行用 SA 単位"
  }

  # SA の名前と削除の防止
  assert {
    condition     = google_service_account.tf_plan.account_id == "sa-tf-plan" && google_service_account.tf_apply.account_id == "sa-tf-apply" && google_service_account.runtime.account_id == "sa-loss-note"
    error_message = "SA の account_id"
  }
  assert {
    condition     = alltrue([for sa in [google_service_account.tf_plan, google_service_account.tf_apply, google_service_account.runtime] : sa.deletion_policy == "PREVENT"])
    error_message = "SA は PREVENT"
  }

  # AC-5 / R3: state のバケット 2 つ
  assert {
    condition     = google_storage_bucket.tfstate["prod"].name == "example-project-tfstate" && google_storage_bucket.tfstate["bootstrap"].name == "example-project-tfstate-bootstrap"
    error_message = "state のバケット名"
  }
  assert {
    condition = alltrue([for b in google_storage_bucket.tfstate :
      b.public_access_prevention == "enforced" && b.uniform_bucket_level_access == true && b.versioning[0].enabled == true &&
      b.force_destroy == false && b.deletion_policy == "PREVENT" && b.location == "ASIA-NORTHEAST1"
    ])
    error_message = "state のバケットは公開アクセス防止・UBLA・バージョニング・削除の防止（force_destroy = false・PREVENT）・東京"
  }
  assert {
    condition     = google_storage_bucket_iam_member.prod_state_plan.bucket == "example-project-tfstate" && google_storage_bucket_iam_member.prod_state_plan.role == "roles/storage.objectViewer" && google_storage_bucket_iam_member.prod_state_plan.member == google_service_account.tf_plan.member
    error_message = "plan SA は prod の state の読み取りだけ"
  }
  assert {
    condition     = google_storage_bucket_iam_member.prod_state_apply.bucket == "example-project-tfstate" && google_storage_bucket_iam_member.prod_state_apply.role == "roles/storage.objectUser" && google_storage_bucket_iam_member.prod_state_apply.member == google_service_account.tf_apply.member
    error_message = "apply SA は prod の state の読み書き（bootstrap 用バケットには付けない）"
  }

  # AC-6 / R6: Artifact Registry
  assert {
    condition     = google_artifact_registry_repository.app.location == "asia-northeast1" && google_artifact_registry_repository.app.format == "DOCKER" && google_artifact_registry_repository.app.repository_id == "loss-note"
    error_message = "Artifact Registry は東京・DOCKER・loss-note"
  }
  assert {
    condition     = google_artifact_registry_repository.app.docker_config[0].immutable_tags == true && google_artifact_registry_repository.app.deletion_policy == "PREVENT"
    error_message = "タグは書き換え不可・PREVENT"
  }
  assert {
    condition     = google_artifact_registry_repository.app.cleanup_policy_dry_run == false && length(google_artifact_registry_repository.app.cleanup_policies) == 2
    error_message = "掃除の規則は 2 つで、試し（dry run）にしない"
  }
  assert {
    condition     = one([for p in google_artifact_registry_repository.app.cleanup_policies : p.most_recent_versions[0].keep_count if p.action == "KEEP"]) == 5
    error_message = "KEEP は直近 5 版"
  }
  assert {
    condition     = one([for p in google_artifact_registry_repository.app.cleanup_policies : p.condition[0].older_than if p.action == "DELETE"]) == "2592000s"
    error_message = "DELETE は 30 日より古い版"
  }
  assert {
    condition     = google_artifact_registry_repository_iam_member.tf_apply_writer.role == "roles/artifactregistry.writer" && google_artifact_registry_repository_iam_member.tf_apply_writer.member == google_service_account.tf_apply.member && google_artifact_registry_repository_iam_member.tf_apply_writer.repository == google_artifact_registry_repository.app.name
    error_message = "apply SA はリポジトリ単位の writer"
  }
  assert {
    condition     = google_artifact_registry_repository_iam_member.tf_plan_reader.role == "roles/artifactregistry.reader" && google_artifact_registry_repository_iam_member.tf_plan_reader.member == google_service_account.tf_plan.member && google_artifact_registry_repository_iam_member.tf_plan_reader.repository == google_artifact_registry_repository.app.name
    error_message = "plan SA はリポジトリ単位の reader"
  }

  # AC-7 / 例 B: 予算の対象はこのプロジェクト 1 件・月 3,000 円・50 / 90 / 100%・既定の受信者のまま
  assert {
    condition     = google_billing_budget.monthly.budget_filter[0].projects == toset(["projects/123456789"])
    error_message = "予算の対象はこのプロジェクト（番号）の 1 件だけ"
  }
  assert {
    condition     = google_billing_budget.monthly.billing_account == "000000-000000-000000" && google_billing_budget.monthly.budget_filter[0].calendar_period == "MONTH"
    error_message = "予算は変数の請求先に置く月の予算"
  }
  assert {
    condition     = google_billing_budget.monthly.amount[0].specified_amount[0].currency_code == "JPY" && google_billing_budget.monthly.amount[0].specified_amount[0].units == "3000"
    error_message = "予算の金額は 3000 円"
  }
  assert {
    condition     = [for t in google_billing_budget.monthly.threshold_rules : t.threshold_percent] == [0.5, 0.9, 1.0]
    error_message = "しきい値は 50% / 90% / 100%"
  }
  assert {
    condition     = alltrue([for t in google_billing_budget.monthly.threshold_rules : t.spend_basis == "CURRENT_SPEND"])
    error_message = "しきい値は当月の実績に対して"
  }
  assert {
    condition     = length(google_billing_budget.monthly.all_updates_rule) == 0
    error_message = "通知先を書き換えない（請求先の管理者への既定の通知のまま。メールアドレスを書かない）"
  }

  # R7: Firebase と Authentication の初期化
  assert {
    condition     = google_firebase_project.this.project == "example-project" && google_firebase_web_app.app.project == "example-project" && google_identity_platform_config.auth.project == "example-project"
    error_message = "Firebase・Web アプリ・Authentication はこのプロジェクト"
  }
  assert {
    condition     = google_firebase_web_app.app.display_name == "loss-note" && google_firebase_web_app.app.deletion_policy == "PREVENT"
    error_message = "Web アプリは loss-note・PREVENT"
  }
  assert {
    condition     = length(google_identity_platform_config.auth.sign_in) == 0 && length(google_identity_platform_config.auth.authorized_domains) == 0
    error_message = "ログインの方法・許可するドメインはここで書かない（#43）"
  }
  assert {
    condition     = toset(keys(output.firebase_web_config)) == toset(["api_key", "auth_domain", "project_id"]) && output.firebase_web_config.project_id == "example-project"
    error_message = "Web の設定の出力は api_key・auth_domain・project_id"
  }
  assert {
    condition     = output.tf_state_bucket == "example-project-tfstate" && output.artifact_registry_repository == "asia-northeast1-docker.pkg.dev/example-project/loss-note"
    error_message = "出力（state のバケット・イメージのリポジトリ）"
  }

  # #42 の AC-5・R5・例 F1: Firestore はネイティブ・東京・既定のデータベース・削除の防止。Terraform から外しても消さない
  assert {
    condition     = google_firestore_database.default.name == "(default)" && google_firestore_database.default.type == "FIRESTORE_NATIVE" && google_firestore_database.default.location_id == "asia-northeast1" && google_firestore_database.default.project == "example-project"
    error_message = "Firestore は (default)・FIRESTORE_NATIVE・asia-northeast1・このプロジェクト"
  }
  assert {
    condition     = google_firestore_database.default.delete_protection_state == "DELETE_PROTECTION_ENABLED" && google_firestore_database.default.deletion_policy == "ABANDON"
    error_message = "Firestore は削除の防止が有効・ABANDON"
  }
  # 例 F3: 日次のバックアップ・保持 7 日（604800 秒。日次の上限）
  assert {
    condition     = google_firestore_backup_schedule.daily.database == google_firestore_database.default.name && length(google_firestore_backup_schedule.daily.daily_recurrence) == 1 && length(google_firestore_backup_schedule.daily.weekly_recurrence) == 0
    error_message = "バックアップの予定は既定のデータベースの日次"
  }
  assert {
    condition     = google_firestore_backup_schedule.daily.retention == "604800s" && google_firestore_backup_schedule.daily.project == "example-project"
    error_message = "バックアップの保持は 604800s（7 日）"
  }
  # 例 F2: クライアントからの直接の読み書きはリポジトリの firestore.rules（すべて拒否）を cloud.firestore に公開する
  assert {
    condition     = google_firebaserules_ruleset.firestore.source[0].files[0].name == "firestore.rules" && google_firebaserules_ruleset.firestore.source[0].files[0].content == file("${path.module}/../../firestore.rules")
    error_message = "ルールはリポジトリの firestore.rules"
  }
  assert {
    condition     = strcontains(google_firebaserules_ruleset.firestore.source[0].files[0].content, "allow read, write: if false;") && !strcontains(google_firebaserules_ruleset.firestore.source[0].files[0].content, "if true")
    error_message = "ルールはすべて拒否"
  }
  assert {
    condition     = google_firebaserules_release.firestore.name == "cloud.firestore" && google_firebaserules_release.firestore.ruleset_name == "projects/example-project/rulesets/${google_firebaserules_ruleset.firestore.name}"
    error_message = "ルールの公開先は cloud.firestore で、この ruleset を指す"
  }
  # #87 の AC-7: 取引の一覧のページ分けの複合索引（決済の時刻 降順・作った時刻 降順・ID 昇順。取引のコレクション）
  assert {
    condition     = google_firestore_index.trades_by_exit.collection == "trades" && google_firestore_index.trades_by_exit.query_scope == "COLLECTION" && google_firestore_index.trades_by_exit.database == google_firestore_database.default.name && google_firestore_index.trades_by_exit.project == "example-project"
    error_message = "索引は既定のデータベースの trades コレクション（COLLECTION）"
  }
  assert {
    condition     = [for f in google_firestore_index.trades_by_exit.fields : "${f.field_path}:${f.order}"] == ["record.exit.time:DESCENDING", "createdAt:DESCENDING", "__name__:ASCENDING"]
    error_message = "索引の欄と向きは record.exit.time 降・createdAt 降・__name__ 昇（API の trade_sort_key と同じ並び）"
  }
  # 例 F4: 実行用 SA のプロジェクト単位のロールは roles/datastore.user の 1 件だけ
  assert {
    condition     = google_project_iam_member.runtime_datastore.role == "roles/datastore.user" && google_project_iam_member.runtime_datastore.member == "serviceAccount:sa-loss-note@example-project.iam.gserviceaccount.com" && google_project_iam_member.runtime_datastore.project == "example-project" && length(google_project_iam_member.runtime_datastore.condition) == 0
    error_message = "実行用 SA に roles/datastore.user（プロジェクト単位・条件なし）"
  }
  assert {
    condition     = length([for m in google_project_iam_member.ci : m if m.member == google_service_account.runtime.member]) == 0
    error_message = "CI の付与の集合に実行用 SA を混ぜない"
  }

  # #43: 使える利用者の許可リストの入れ物（値は Terraform に書かない。複製は東京だけ・Terraform から消せない）
  assert {
    condition     = google_secret_manager_secret.allowed_emails.secret_id == "loss-note-allowed-emails" && google_secret_manager_secret.allowed_emails.project == "example-project"
    error_message = "許可リストの入れ物は loss-note-allowed-emails（このプロジェクト）"
  }
  assert {
    condition     = google_secret_manager_secret.allowed_emails.deletion_protection == true
    error_message = "許可リストの入れ物は Terraform から消せない（deletion_protection）"
  }
  assert {
    condition     = length(google_secret_manager_secret.allowed_emails.replication[0].auto) == 0 && [for r in google_secret_manager_secret.allowed_emails.replication[0].user_managed[0].replicas : r.location] == ["asia-northeast1"]
    error_message = "許可リストの複製は東京（asia-northeast1）だけ"
  }
  # 読み取りの付与は実行用 SA の 1 件だけ（入れ物の単位・secretAccessor。CI の SA に付けない）
  assert {
    condition     = google_secret_manager_secret_iam_member.runtime_allowed_emails.member == "serviceAccount:sa-loss-note@example-project.iam.gserviceaccount.com" && google_secret_manager_secret_iam_member.runtime_allowed_emails.role == "roles/secretmanager.secretAccessor" && google_secret_manager_secret_iam_member.runtime_allowed_emails.secret_id == google_secret_manager_secret.allowed_emails.secret_id
    error_message = "許可リストの読み取りは実行用 SA に secretAccessor（入れ物の単位）"
  }

  # #51: AI の上限を受けない利用者（バイパス）のリストの入れ物（許可リストと同じ形。別の入れ物）
  assert {
    condition     = google_secret_manager_secret.ai_bypass_emails.secret_id == "loss-note-ai-bypass-emails" && google_secret_manager_secret.ai_bypass_emails.project == "example-project" && google_secret_manager_secret.ai_bypass_emails.secret_id != google_secret_manager_secret.allowed_emails.secret_id
    error_message = "バイパスのリストの入れ物は loss-note-ai-bypass-emails（このプロジェクト。許可リストと別）"
  }
  assert {
    condition     = google_secret_manager_secret.ai_bypass_emails.deletion_protection == true
    error_message = "バイパスのリストの入れ物は Terraform から消せない（deletion_protection）"
  }
  assert {
    condition     = length(google_secret_manager_secret.ai_bypass_emails.replication[0].auto) == 0 && [for r in google_secret_manager_secret.ai_bypass_emails.replication[0].user_managed[0].replicas : r.location] == ["asia-northeast1"]
    error_message = "バイパスのリストの複製は東京（asia-northeast1）だけ"
  }
  assert {
    condition     = google_secret_manager_secret_iam_member.runtime_ai_bypass_emails.member == "serviceAccount:sa-loss-note@example-project.iam.gserviceaccount.com" && google_secret_manager_secret_iam_member.runtime_ai_bypass_emails.role == "roles/secretmanager.secretAccessor" && google_secret_manager_secret_iam_member.runtime_ai_bypass_emails.secret_id == google_secret_manager_secret.ai_bypass_emails.secret_id
    error_message = "バイパスのリストの読み取りは実行用 SA に secretAccessor（入れ物の単位）"
  }
}

# 例 W6: リポジトリ・オーナーの名前を変えても（数値 ID は同じ）、借用の主体と条件は defaults と同じ
run "renamed_repository" {
  variables {
    github_repository = "renamed-owner/renamed-repo"
  }
  assert {
    condition     = google_service_account_iam_member.tf_apply_wif.member == "principalSet://iam.googleapis.com/projects/000/locations/global/workloadIdentityPools/github/attribute.repo_env/123:456:prod"
    error_message = "名前を変えても apply SA の借用の主体は変わらない（W6）"
  }
  assert {
    condition     = google_service_account_iam_member.tf_plan_wif.member == "principalSet://iam.googleapis.com/projects/000/locations/global/workloadIdentityPools/github/attribute.repository_id/123"
    error_message = "名前を変えても plan SA の借用の主体は変わらない（W6）"
  }
  assert {
    condition     = google_iam_workload_identity_pool_provider.github_actions.attribute_condition == "assertion.repository_id == '123' && assertion.repository_owner_id == '456' && assertion.event_name != 'pull_request_target'"
    error_message = "名前を変えても条件は変わらない（W6）"
  }
}

# 例 W3・W4 の裏返し: 別のリポジトリ（数値 ID 789）・別のオーナー（999）向けに作ると、条件と主体がその ID に変わる
# = ID 123 / 456 のトークンでは借用できない（主体・条件は ID だけで決まる）
run "other_ids" {
  variables {
    github_repository_id = "789"
    github_owner_id      = "999"
  }
  assert {
    condition     = google_iam_workload_identity_pool_provider.github_actions.attribute_condition == "assertion.repository_id == '789' && assertion.repository_owner_id == '999' && assertion.event_name != 'pull_request_target'"
    error_message = "条件は渡した数値 ID だけを受ける"
  }
  assert {
    condition     = endswith(google_service_account_iam_member.tf_apply_wif.member, "/attribute.repo_env/789:999:prod") && !strcontains(google_service_account_iam_member.tf_apply_wif.member, "123") && !strcontains(google_service_account_iam_member.tf_apply_wif.member, "456")
    error_message = "apply SA の主体は渡した数値 ID だけで作る（ID が違えば借用できない）"
  }
  assert {
    condition     = endswith(google_service_account_iam_member.tf_plan_wif.member, "/attribute.repository_id/789")
    error_message = "plan SA の主体は渡したリポジトリの数値 ID"
  }
}

run "budget_amount" {
  variables {
    budget_amount_jpy = 5000
  }
  assert {
    condition     = google_billing_budget.monthly.amount[0].specified_amount[0].units == "5000"
    error_message = "予算の金額は変数で変えられる"
  }
}

# AC-8 / 例 G2 と、識別子の形の誤り・空文字
run "reject_bad_repository" {
  command = plan
  variables {
    github_repository = "example-repo"
  }
  expect_failures = [var.github_repository]
}

run "reject_empty_repository" {
  command = plan
  variables {
    github_repository = ""
  }
  expect_failures = [var.github_repository]
}

run "reject_non_numeric_repository_id" {
  command = plan
  variables {
    github_repository_id = "example-owner/example-repo"
  }
  expect_failures = [var.github_repository_id]
}

run "reject_empty_repository_id" {
  command = plan
  variables {
    github_repository_id = ""
  }
  expect_failures = [var.github_repository_id]
}

run "reject_non_numeric_owner_id" {
  command = plan
  variables {
    github_owner_id = "example-owner"
  }
  expect_failures = [var.github_owner_id]
}

run "reject_empty_owner_id" {
  command = plan
  variables {
    github_owner_id = ""
  }
  expect_failures = [var.github_owner_id]
}

run "reject_billing_account_with_prefix" {
  command = plan
  variables {
    billing_account = "billingAccounts/000000-000000-000000"
  }
  expect_failures = [var.billing_account]
}

run "reject_lowercase_billing_account" {
  command = plan
  variables {
    billing_account = "abcdef-000000-000000"
  }
  expect_failures = [var.billing_account]
}

run "reject_empty_billing_account" {
  command = plan
  variables {
    billing_account = ""
  }
  expect_failures = [var.billing_account]
}

run "reject_uppercase_project_id" {
  command = plan
  variables {
    project_id = "Example-Project"
  }
  expect_failures = [var.project_id]
}

run "reject_empty_project_id" {
  command = plan
  variables {
    project_id = ""
  }
  expect_failures = [var.project_id]
}

run "reject_zero_budget" {
  command = plan
  variables {
    budget_amount_jpy = 0
  }
  expect_failures = [var.budget_amount_jpy]
}

run "reject_fractional_budget" {
  command = plan
  variables {
    budget_amount_jpy = 2999.5
  }
  expect_failures = [var.budget_amount_jpy]
}
