# Cloud Run（#42）が動くときの実行用 SA。データのロール（roles/datastore.user）は firestore.tf（#42）。
# CI の SA に SA を作る権限を持たせないため、SA そのものは所有者の apply で作る。
resource "google_service_account" "runtime" {
  project         = var.project_id
  account_id      = "sa-loss-note"
  display_name    = "loss-note (Cloud Run)"
  description     = "loss-note の Cloud Run の実行用"
  deletion_policy = "PREVENT"

  depends_on = [google_project_service.apis]
}

# apply SA が Cloud Run に実行用 SA を設定できるように（SA 単位。プロジェクト単位にしない）
resource "google_service_account_iam_member" "tf_apply_act_as_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.tf_apply.member
}
