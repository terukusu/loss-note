# Firebase（ログイン。#43 がログインの方法・許可するドメイン・許可リストを足す）。
# google_firebase_project・google_firebase_web_app・data google_firebase_web_app_config は google-beta にしかない。
# Authentication の初期化は google_identity_platform_config（Identity Platform）で行う。作成は 1 回だけでプロジェクトの中では戻せない
# （戻しはプロジェクトの削除だけ）。Google・メールのリンクのログインは無料の範囲（docs/adr-0008-production-foundation.md）。

resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.project_id

  depends_on = [google_project_service.apis]
}

# PREVENT: Terraform からの削除を拒む（Web の設定 = apiKey などは #42 のビルドが使う）
resource "google_firebase_web_app" "app" {
  provider        = google-beta
  project         = var.project_id
  display_name    = "loss-note"
  deletion_policy = "PREVENT"

  depends_on = [google_firebase_project.this]
}

data "google_firebase_web_app_config" "app" {
  provider   = google-beta
  project    = var.project_id
  web_app_id = google_firebase_web_app.app.app_id
}

# sign_in・authorized_domains は書かない（#43）。deletion_policy は 8.10.0 のこのリソースに無い（Terraform から外しても設定は残る）
resource "google_identity_platform_config" "auth" {
  project = var.project_id

  depends_on = [google_firebase_project.this]
}
