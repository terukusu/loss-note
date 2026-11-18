# CI の SA（infra/prod を GitHub Actions で plan / apply する）と、その借用・付与。
# 付与は追加型（*_iam_member）だけを使う（権威的な型は既存の binding を消す）。鍵は作らない（WIF で借用する）。
# basic の roles/viewer・owner・editor、IAM の管理（projectIamAdmin・securityAdmin・serviceAccountAdmin など）は付けない。
# viewer を使わないのは、UBLA のバケットの既定の IAM で projectViewer が読み取りを持ち、bootstrap の state まで読めるため。

resource "google_service_account" "tf_plan" {
  project         = var.project_id
  account_id      = "sa-tf-plan"
  display_name    = "Terraform plan (GitHub Actions)"
  description     = "loss-note の PR と main の terraform plan 用（読み取りだけ）"
  deletion_policy = "PREVENT"

  depends_on = [google_project_service.apis]
}

resource "google_service_account" "tf_apply" {
  project         = var.project_id
  account_id      = "sa-tf-apply"
  display_name    = "Terraform apply (GitHub Actions)"
  description     = "loss-note の Environment prod の承認後の terraform apply 用"
  deletion_policy = "PREVENT"

  depends_on = [google_project_service.apis]
}

locals {
  pool_name = google_iam_workload_identity_pool.github.name
  # Environment prod の job の attribute.repo_env の値（wif.tf）。数値 ID だけで作るので、名前を変えても同じ（例 W6）
  apply_repo_env = "${var.github_repository_id}:${var.github_owner_id}:prod"

  # プロジェクト単位の付与はここに並べたものだけ（テストで集合を比べる）。Cloud Run の作成にはプロジェクト単位の run.admin が要る。
  # plan は Cloud Run の読み取りだけ（data.google_project の projects.get は run.viewer に含まれる）。実行用 SA（runtime.tf）にはここでは付けない（データのロールは firestore.tf。#42）
  project_roles = {
    tf_apply_run_admin = {
      role   = "roles/run.admin"
      member = google_service_account.tf_apply.member
    }
    tf_plan_run_viewer = {
      role   = "roles/run.viewer"
      member = google_service_account.tf_plan.member
    }
  }
}

# plan SA: このリポジトリのどの workflow からも借用できる（PR の plan 用）
resource "google_service_account_iam_member" "tf_plan_wif" {
  service_account_id = google_service_account.tf_plan.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${local.pool_name}/attribute.repository_id/${var.github_repository_id}"
}

# apply SA: このリポジトリの Environment prod の job だけが借用できる（Environment は main だけ・承認が要る。infra/README.md「GitHub の設定」）。
# sub（repo:<OWNER>@<OWNER_ID>/<REPO>@<REPO_ID>:environment:prod）は名前を含み、名前を変えると借用できなくなるので使わない
resource "google_service_account_iam_member" "tf_apply_wif" {
  service_account_id = google_service_account.tf_apply.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${local.pool_name}/attribute.repo_env/${local.apply_repo_env}"
}

resource "google_project_iam_member" "ci" {
  for_each = local.project_roles

  project = var.project_id
  role    = each.value.role
  member  = each.value.member
}

# prod の state: plan は読み取り（plan は -lock=false で回す）、apply は state とロックの読み書き。
# bootstrap 用バケットには CI の SA の付与を付けない
resource "google_storage_bucket_iam_member" "prod_state_plan" {
  bucket = google_storage_bucket.tfstate["prod"].name
  role   = "roles/storage.objectViewer"
  member = google_service_account.tf_plan.member
}

resource "google_storage_bucket_iam_member" "prod_state_apply" {
  bucket = google_storage_bucket.tfstate["prod"].name
  role   = "roles/storage.objectUser"
  member = google_service_account.tf_apply.member
}
