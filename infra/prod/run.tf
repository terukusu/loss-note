# Cloud Run（Issue #42・docs/design.md 10 章・ADR-0009）: 画面の静的ファイルと API を 1 つのサービスで配る（同じオリジン）。
# 誰でも開ける（ログイン前の画面は公開）。記録の API の守りは ID トークンの検証（ADR-0004 の verify）と使える利用者の許可リスト（#43）。
# 実行用 SA（sa-loss-note）・Firestore・そのデータのロール（roles/datastore.user）は infra/bootstrap（所有者の apply）。
# ここ（CI の apply SA の roles/run.admin の範囲）はサービスと invoker の付与だけ。出力は持たない（URL をログに出さない）。
locals {
  # plan SA は SA を読めないので data source にしない（名前は infra/bootstrap の google_service_account.runtime と同じ）
  runtime_sa = "sa-loss-note@${var.project_id}.iam.gserviceaccount.com"
  # 名前は infra/bootstrap の google_secret_manager_secret.allowed_emails と同じ（#43。読み取りの付与も bootstrap）
  allowed_emails_secret = "loss-note-allowed-emails"
  # 明細の読み取りの資格情報の方式（#55・ADR-0011）。切り替え statement_read_credential が空なら、#44 の statement_read_key = true を
  # api_key と同じに扱う（後方互換）。どちらも無ければ ""（資格情報の環境変数を載せない。読み取りは 503・ほかの機能は動く）
  statement_read_credential = var.statement_read_credential != "" ? var.statement_read_credential : (var.statement_read_key ? "api_key" : "")
  # 値を Secret Manager に置く方式 → 環境変数の名前と入れ物（infra/bootstrap/statement_read_credentials.tf と同じ名前）
  statement_read_secrets = {
    api_key     = { name = "ANTHROPIC_API_KEY", secret = "statement-read-anthropic-api-key" }
    oauth_token = { name = "CLAUDE_CODE_OAUTH_TOKEN", secret = "statement-read-claude-oauth-token" }
  }
  # 値を環境変数に直に置くもの（方式の切り替えと、federation の識別子。識別子は秘密ではないが伏せた変数で受け、plan に出さない）。
  # 名前の集合だけを nonsensitive にする（for_each は伏せた値を受けない。名前は値の有無しか表さない）
  statement_read_values = {
    STATEMENT_READ_CREDENTIAL    = local.statement_read_credential
    ANTHROPIC_FEDERATION_RULE_ID = var.statement_read_federation_rule_id
    ANTHROPIC_ORGANIZATION_ID    = var.statement_read_organization_id
    ANTHROPIC_SERVICE_ACCOUNT_ID = var.statement_read_service_account_id
    ANTHROPIC_WORKSPACE_ID       = var.statement_read_workspace_id
  }
  statement_read_plain_names = nonsensitive(toset(concat(
    local.statement_read_credential != "" ? ["STATEMENT_READ_CREDENTIAL"] : [],
    local.statement_read_credential == "federation" ? [
      for n in ["ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID", "ANTHROPIC_SERVICE_ACCOUNT_ID", "ANTHROPIC_WORKSPACE_ID"] :
      n if local.statement_read_values[n] != ""
    ] : [],
  )))
}

# ingress は all（run.app の URL で配る。ロードバランサは使わない）。IAM の検査は無効にしない（invoker は下の付与）。
# 第 1 世代（起動が速い）・CPU 1・1Gi（明細の読み取りの同梱の CLI の子プロセスの分。#44）・リクエスト中だけ CPU。
# 同時実行 8 は gunicorn の --threads 8、タイムアウト 60 秒は gunicorn の --timeout 60 と同じ（画面の待ち 30 秒 = 読み取りの締め切り 20 秒 + 後始末 約 5 秒 より長い）。
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

      # 明細の読み取りの資格情報（#44・ADR-0010、#55・ADR-0011）: 方式の切り替えで載せる環境変数の集合が決まる。
      # - api_key / oauth_token: 値は Secret Manager の参照（値は Terraform に入らない）。参照はインスタンスの起動時に解決され、
      #   版が無い・無効だとインスタンスが起動しないので、オーナーが版を入れた後に方式を選ぶ
      # - federation: 識別子（ルール ID・組織 ID、任意で SA の ID・ワークスペースの ID）だけ。秘密は持たない
      #   （ID トークンは API が要求ごとにメタデータ サーバーから取る）
      # 選ばなかった方式の変数は載せない（API は子の CLI に選んだ方式の変数だけを渡す）
      dynamic "env" {
        for_each = contains(keys(local.statement_read_secrets), local.statement_read_credential) ? [local.statement_read_secrets[local.statement_read_credential]] : []
        content {
          name = env.value.name
          value_source {
            secret_key_ref {
              secret  = env.value.secret
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = local.statement_read_plain_names
        content {
          name  = env.value
          value = local.statement_read_values[env.value]
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
