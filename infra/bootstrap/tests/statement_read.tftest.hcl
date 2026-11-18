# 明細の読み取りの本番の資格情報の入れ物（Issue #44 の AC-12・R5）の静的テスト。モックのプロバイダなので資格情報なしで回り、
# 実リソースは作らない。値はすべて架空（bootstrap.tftest.hcl と同じ）。上書き（override）は bootstrap.tftest.hcl と同じもの。
# 版（google_secret_manager_secret_version）とその data source が 0 件なことは .github/scripts/secret-check.sh。

mock_provider "google" {}
mock_provider "google-beta" {}

override_resource {
  target = google_storage_bucket.tfstate["bootstrap"]
}

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

run "statement_read_secret" {
  # Secret Manager の API は services.tf の一覧で有効にする（#43 が足した。外しても止めない）
  assert {
    condition     = contains([for s in google_project_service.apis : s.service], "secretmanager.googleapis.com")
    error_message = "secretmanager.googleapis.com は services.tf の一覧で有効にする"
  }
  # 入れ物 1 つ・名前・東京だけに複製・削除の防止
  assert {
    condition     = google_secret_manager_secret.statement_read.secret_id == "statement-read-anthropic-api-key" && google_secret_manager_secret.statement_read.project == "example-project"
    error_message = "入れ物は statement-read-anthropic-api-key・このプロジェクト"
  }
  assert {
    condition     = length(google_secret_manager_secret.statement_read.replication[0].auto) == 0 && length(google_secret_manager_secret.statement_read.replication[0].user_managed) == 1 && toset([for r in google_secret_manager_secret.statement_read.replication[0].user_managed[0].replicas : r.location]) == toset(["asia-northeast1"])
    error_message = "複製は東京（asia-northeast1）だけ（自動の複製にしない）"
  }
  assert {
    condition     = google_secret_manager_secret.statement_read.deletion_policy == "PREVENT"
    error_message = "入れ物は削除の防止（PREVENT）"
  }
  # 付与は入れ物の単位で 1 件: 実行用 SA の読み取りだけ
  assert {
    condition     = google_secret_manager_secret_iam_member.statement_read.role == "roles/secretmanager.secretAccessor" && google_secret_manager_secret_iam_member.statement_read.member == "serviceAccount:sa-loss-note@example-project.iam.gserviceaccount.com" && google_secret_manager_secret_iam_member.statement_read.secret_id == "statement-read-anthropic-api-key" && google_secret_manager_secret_iam_member.statement_read.project == "example-project"
    error_message = "付与は入れ物の単位で、実行用 SA（sa-loss-note）の secretAccessor だけ"
  }
  # CI の SA（plan・apply）に付けない
  assert {
    condition     = !contains([google_service_account.tf_plan.member, google_service_account.tf_apply.member], google_secret_manager_secret_iam_member.statement_read.member)
    error_message = "CI の SA に入れ物の読み取りを付けない"
  }
  # プロジェクトの単位の付与に Secret Manager のロールが無い（CI の SA にも実行用 SA にも）
  assert {
    condition     = length([for m in google_project_iam_member.ci : m.role if startswith(m.role, "roles/secretmanager.")]) == 0 && !startswith(google_project_iam_member.runtime_datastore.role, "roles/secretmanager.")
    error_message = "プロジェクトの単位で Secret Manager のロールを付けない"
  }
  # 許可リストの入れ物（#43）とは別の入れ物・別の付与（読み取りの資格情報と許可リストを混ぜない）
  assert {
    condition     = google_secret_manager_secret.statement_read.secret_id != google_secret_manager_secret.allowed_emails.secret_id && google_secret_manager_secret_iam_member.statement_read.secret_id != google_secret_manager_secret_iam_member.runtime_allowed_emails.secret_id
    error_message = "API キーの入れ物は許可リストの入れ物と別"
  }
}

# OAuth トークンの入れ物（Issue #55 の AC-9）: キーの入れ物と同じ形で別に 1 つ
run "statement_read_oauth_secret" {
  assert {
    condition     = google_secret_manager_secret.statement_read_oauth.secret_id == "statement-read-claude-oauth-token" && google_secret_manager_secret.statement_read_oauth.project == "example-project"
    error_message = "入れ物は statement-read-claude-oauth-token・このプロジェクト"
  }
  assert {
    condition     = length(google_secret_manager_secret.statement_read_oauth.replication[0].auto) == 0 && length(google_secret_manager_secret.statement_read_oauth.replication[0].user_managed) == 1 && toset([for r in google_secret_manager_secret.statement_read_oauth.replication[0].user_managed[0].replicas : r.location]) == toset(["asia-northeast1"])
    error_message = "複製は東京（asia-northeast1）だけ"
  }
  assert {
    condition     = google_secret_manager_secret.statement_read_oauth.deletion_policy == "PREVENT"
    error_message = "入れ物は削除の防止（PREVENT）"
  }
  assert {
    condition     = google_secret_manager_secret_iam_member.statement_read_oauth.role == "roles/secretmanager.secretAccessor" && google_secret_manager_secret_iam_member.statement_read_oauth.member == "serviceAccount:sa-loss-note@example-project.iam.gserviceaccount.com" && google_secret_manager_secret_iam_member.statement_read_oauth.secret_id == "statement-read-claude-oauth-token" && google_secret_manager_secret_iam_member.statement_read_oauth.project == "example-project"
    error_message = "付与は入れ物の単位で、実行用 SA（sa-loss-note）の secretAccessor だけ"
  }
  assert {
    condition     = !contains([google_service_account.tf_plan.member, google_service_account.tf_apply.member], google_secret_manager_secret_iam_member.statement_read_oauth.member)
    error_message = "CI の SA に入れ物の読み取りを付けない"
  }
  # キー・許可リストの入れ物と別（方式を切り替えても、もう片方の値に触れない）
  assert {
    condition     = length(toset([google_secret_manager_secret.statement_read_oauth.secret_id, google_secret_manager_secret.statement_read.secret_id, google_secret_manager_secret.allowed_emails.secret_id])) == 3
    error_message = "OAuth トークンの入れ物はキー・許可リストの入れ物と別"
  }
}
