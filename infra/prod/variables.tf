# 識別子（プロジェクト ID・イメージ）に既定値は持たない（リポジトリは誰でも clone して自分のプロジェクトで使う前提。R9）。
# CI は secrets.GCP_PROJECT_ID を TF_VAR_project_id、.github/scripts/image.sh loss-note resolve の結果を TF_VAR_image で渡す
variable "project_id" {
  description = "loss-note 専用の GCP プロジェクト ID（infra/bootstrap と同じもの）"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id は GCP のプロジェクト ID の形（英小文字で始まる 6〜30 文字の英小文字・数字・-）で指定する。"
  }
}

# Cloud Run には digest でだけデプロイする（タグ参照・他のリポジトリ・他のプロジェクトのイメージを受けない）。
# イメージが未作成のときの plan は、全 0 の digest を要約のためだけに渡す（apply は必ず実物の digest で plan し直す。deploy.yml）
variable "image" {
  description = "イメージ（<region>-docker.pkg.dev/<project_id>/loss-note/loss-note@sha256:<64hex>）"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/${var.project_id}/loss-note/loss-note@sha256:[0-9a-f]{64}$", var.image))
    error_message = "image は <region>-docker.pkg.dev/<project_id>/loss-note/loss-note@sha256:<64 桁の 16 進> の digest 参照で指定する。"
  }
}

# Firebase の authDomain（#43。CSP の frame-src に入れる。API も同じ形を検査し、合わなければ起動しない）。
# 既定値は持たない（R9）。CI は secrets.FIREBASE_AUTH_DOMAIN を TF_VAR_firebase_auth_domain で渡す
variable "firebase_auth_domain" {
  description = "Firebase の Web の設定の authDomain（ホスト名。例: <project_id>.firebaseapp.com）"
  type        = string

  validation {
    condition     = length(var.firebase_auth_domain) <= 253 && can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$", var.firebase_auth_domain))
    error_message = "firebase_auth_domain はホスト名（小文字の英数字・-・. のラベルを点でつなぐ。スキーム・ポート・ワイルドカードなし）で指定する。"
  }
}

variable "region" {
  description = "Cloud Run のリージョン（Artifact Registry・Firestore と同じ東京）"
  type        = string
  default     = "asia-northeast1"
}

# 最大インスタンス（R6。費用の上限。利用者はオーナー 1 人）
variable "max_instances" {
  description = "Cloud Run の最大インスタンス数"
  type        = number
  default     = 2

  validation {
    condition     = var.max_instances >= 1 && var.max_instances <= 10 && floor(var.max_instances) == var.max_instances
    error_message = "max_instances は 1〜10 の整数で指定する。"
  }
}
