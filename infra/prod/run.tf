# Cloud Run（Issue #42・docs/design.md 10 章・ADR-0009）: 画面の静的ファイルと API を 1 つのサービスで配る（同じオリジン）。
# 誰でも開ける（ログイン前の画面は公開）。記録の API の守りは ID トークンの検証（ADR-0004 の verify）と使える利用者の許可リスト（#43）。
# 実行用 SA（sa-loss-note）・Firestore・そのデータのロール（roles/datastore.user）は infra/bootstrap（所有者の apply）。
# ここ（CI の apply SA の roles/run.admin の範囲）はサービスと invoker の付与だけ。出力は持たない（URL をログに出さない）。
locals {
  # plan SA は SA を読めないので data source にしない（名前は infra/bootstrap の google_service_account.runtime と同じ）
  runtime_sa = "sa-loss-note@${var.project_id}.iam.gserviceaccount.com"
  # 名前は infra/bootstrap の google_secret_manager_secret.allowed_emails と同じ（#43。読み取りの付与も bootstrap）
  allowed_emails_secret = "loss-note-allowed-emails"
}

# ingress は all（run.app の URL で配る。ロードバランサは使わない）。IAM の検査は無効にしない（invoker は下の付与）。
# 第 1 世代（起動が速い）・CPU 1・1Gi（明細の読み取りの同梱の CLI の子プロセスの分。#44）・リクエスト中だけ CPU。
# 同時実行 8 は gunicorn の --threads 8、タイムアウト 60 秒は gunicorn の --timeout 60 と同じ（読み取りの締め切り 30 秒より長い）。
# deletion_protection = false: データは Firestore にありサービスは持たないので、撤去を 1 つの PR で行えるようにする。
# トラフィックは最新のリビジョンに 100%（切り戻しの後の次の deploy で最新に戻る。R8・infra/README.md「切り戻し」）
resource "google_cloud_run_v2_service" "app" {
  project              = var.project_id
  name                 = "loss-note"
  location             = var.region
  description          = "loss-note（画面と API）"
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = false
  deletion_protection  = false

  template {
    service_account                  = local.runtime_sa
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN1"
    max_instance_request_concurrency = 8
    timeout                          = "60s"

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    containers {
      image = var.image

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      # プロジェクト ID だけ（ADR-0004 の verify。エミュレーターの接続先の環境変数は持たない）。
      # STATIC_DIR・PORT はイメージ側。AI の資格情報（Secret Manager の参照）は #44 が足す
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }

      # ログイン（#43・ADR-0003「縦切り 2 で決めたこと」）: CSP に Google ログインのポップアップの authDomain を足す
      # （画面のビルドの VITE_FIREBASE_AUTH_DOMAIN と同じ値。CI は secrets.FIREBASE_AUTH_DOMAIN を TF_VAR_firebase_auth_domain で渡す）
      env {
        name  = "FIREBASE_AUTH_DOMAIN"
        value = var.firebase_auth_domain
      }

      # 使える利用者の許可リスト（#43）。値は Secret Manager（infra/bootstrap/secrets.tf の入れ物の latest）だけに置き、
      # Terraform の plan・state には参照だけが入る。値を変えたら新しいインスタンスから効く
      env {
        name = "LOSS_NOTE_ALLOWED_EMAILS"
        value_source {
          secret_key_ref {
            secret  = local.allowed_emails_secret
            version = "latest"
          }
        }
      }

      # /api/health は記録（Firestore）に触れない
      startup_probe {
        http_get {
          path = "/api/health"
        }
        initial_delay_seconds = 0
        period_seconds        = 3
        timeout_seconds       = 2
        failure_threshold     = 10
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

# 未認証の呼び出しを受ける（ログイン前の画面は公開。記録の API はトークン必須）。追加型（_iam_member）だけを使う
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
