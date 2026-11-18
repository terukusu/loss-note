# Firestore（Issue #42 の R5・例 F・docs/design.md 10 章・ADR-0009）: 記録を預かる場所。所有者の apply で作る
# （CI の SA に Firestore の管理・IAM の権限を足さないため。#41 の例 P）。
# ネイティブモード・東京・既定のデータベース 1 つ。場所は後から変えられず、削除すると同じ名前は一定期間使えないので、
# 削除の防止を有効にし、Terraform から外しても消さない（ABANDON）。PITR は使わない（日次のバックアップで足りる。費用）。
resource "google_firestore_database" "default" {
  project                 = var.project_id
  name                    = "(default)"
  location_id             = var.region
  type                    = "FIRESTORE_NATIVE"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"

  depends_on = [google_project_service.apis]
}

# 日次のバックアップ（設計書 12 章の日次の書き出し）。日次の保持は 7 日が上限なのでちょうど 7 日（604800 秒）。
# 戻しは手順だけ（infra/README.md「バックアップからの戻し」。自動化しない）
resource "google_firestore_backup_schedule" "daily" {
  project   = var.project_id
  database  = google_firestore_database.default.name
  retention = "604800s"

  daily_recurrence {}
}

# 画面（クライアント）から直接の読み書きはすべて拒否する。リポジトリの firestore.rules（エミュレーターで検査済み）を宣言で公開し、
# 既定の挙動に頼らない。読み書きは API（実行用 SA。ルールを通らない）だけが行う
resource "google_firebaserules_ruleset" "firestore" {
  project = var.project_id

  source {
    files {
      name    = "firestore.rules"
      content = file("${path.module}/../../firestore.rules")
    }
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_firestore_database.default]
}

# Firestore のルールの公開先の名前は必ず cloud.firestore
resource "google_firebaserules_release" "firestore" {
  project      = var.project_id
  name         = "cloud.firestore"
  ruleset_name = "projects/${var.project_id}/rulesets/${google_firebaserules_ruleset.firestore.name}"

  depends_on = [google_firestore_database.default, google_firebase_project.this]
}

# 実行用 SA（runtime.tf）にだけデータの読み書きのロールを付ける（プロジェクト単位。ほかのデータのロールは付けない。例 F4）
resource "google_project_iam_member" "runtime_datastore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = google_service_account.runtime.member
}
