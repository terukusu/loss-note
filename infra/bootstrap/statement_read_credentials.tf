# 明細の読み取りの本番の資格情報（Issue #44・docs/design.md 8.2・ADR-0010）: Anthropic API のキーの入れ物を 1 つ。
# 所有者の apply で作る（CI の SA に Secret Manager・IAM の権限を足さない。#41 の例 P）。
# - 値（版）はここで宣言しない（Terraform の state・plan に値を入れない）。オーナーが GCP のコンソールの Secret Manager の
#   画面で新しい版として貼る（infra/README.md「明細の読み取りの資格情報」）
# - 読めるのは Cloud Run の実行用 SA（sa-loss-note）だけ。付与は入れ物の単位（プロジェクトの単位にしない）。
#   CI の SA（sa-tf-plan・sa-tf-apply）には付けない
# - 複製は東京だけ。削除の防止（PREVENT）。Secret Manager の API は services.tf の一覧（#43 が足した）で有効にする
#   （許可リストの入れ物 secrets.tf と同じ形）

resource "google_secret_manager_secret" "statement_read" {
  project         = var.project_id
  secret_id       = "statement-read-anthropic-api-key"
  deletion_policy = "PREVENT"

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "statement_read" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.statement_read.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.runtime.member
}
