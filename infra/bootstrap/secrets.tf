# 使える利用者の許可リスト（Issue #43・docs/design.md 10.1・ADR-0003「縦切り 2 で決めたこと」）の置き場。
# 入れ物と読み取りの付与だけを宣言し、値（版）は Terraform に書かない（plan・state・Actions のログに値を入れない）。
# 値は所有者が gcloud secrets versions add にパイプで入れる（infra/README.md「ログインと使える利用者」）。
# Cloud Run（infra/prod/run.tf）が環境変数 LOSS_NOTE_ALLOWED_EMAILS に latest の参照で入れる。
# 複製は東京だけ（データの置き場を Firestore と揃える）。Terraform から消せない（deletion_protection）。
resource "google_secret_manager_secret" "allowed_emails" {
  project             = var.project_id
  secret_id           = "loss-note-allowed-emails"
  deletion_protection = true

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.apis]
}

# 実行用 SA（runtime.tf）にだけ、この入れ物の読み取りを付ける（入れ物の単位。CI の SA には付けない）
resource "google_secret_manager_secret_iam_member" "runtime_allowed_emails" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.allowed_emails.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.runtime.member
}
