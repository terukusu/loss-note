# このプロジェクトで使う API（Issue #41 の例 A）。CI の SA は API を有効にする権限を持たないので、
# 後の Issue（#42 の Cloud Run・Firestore、#43 のログイン）が使う API までここ（所有者の apply）で有効にする。
# Terraform から外しても API は止めない（disable_on_destroy = false・ABANDON）。
# serviceusage など前提の 5 つは Terraform より先に gcloud でも有効にする（quota project として使うため。infra/README.md「初回の apply」）
locals {
  services = toset([
    # 土台
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "cloudbilling.googleapis.com",
    "billingbudgets.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "storage.googleapis.com",
    # イメージ・実行（#42）
    "artifactregistry.googleapis.com",
    "run.googleapis.com",
    "firestore.googleapis.com",
    # Firestore のルールの公開（#42。firestore.tf）
    "firebaserules.googleapis.com",
    # ログイン（#43）
    "firebase.googleapis.com",
    "identitytoolkit.googleapis.com",
    "securetoken.googleapis.com",
  ])
}

resource "google_project_service" "apis" {
  for_each = local.services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
  deletion_policy    = "ABANDON"
}
