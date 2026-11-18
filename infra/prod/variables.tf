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

# 明細の読み取りのキーの参照を付けるか（#44・ADR-0010）。#55 からは statement_read_credential が空のときだけ見る後方互換の
# 切り替えで、true は statement_read_credential = "api_key" と同じ（CI は repository variable STATEMENT_READ_KEY が "true" の
# ときだけ true を渡す。deploy.yml）。版の無い参照ではインスタンスが起動しないので、既定は false
variable "statement_read_key" {
  description = "（後方互換）statement_read_credential が空のとき、true なら api_key を選ぶ"
  type        = bool
  default     = false
}

# 明細の読み取りの資格情報の方式（#55・ADR-0011）。"" = 載せない（読み取りは 503 read_unavailable・ほかの機能は動く）/
# api_key / oauth_token（Secret Manager の版を入れた後に選ぶ）/ federation（Anthropic Console でルールを作り、識別子を
# GitHub の secrets に入れた後に選ぶ）。CI は repository variable STATEMENT_READ_CREDENTIAL を渡す（値を伏せる必要の無い切り替え）
variable "statement_read_credential" {
  description = "明細の読み取りの資格情報の方式（\"\" / api_key / oauth_token / federation）"
  type        = string
  default     = ""

  validation {
    condition     = contains(["", "api_key", "oauth_token", "federation"], var.statement_read_credential)
    error_message = "statement_read_credential は \"\"・api_key・oauth_token・federation のどれか。"
  }
}

# federation の識別子（#55）。ID の形は Anthropic の WIF reference（platform.claude.com/docs/en/manage-claude/wif-reference の
# 「Environment variables」: ルール fdrl_...・組織は UUID・サービスアカウント svac_...・ワークスペース wrkspc_...）に合わせる。
# 秘密ではないが利用者ごとの値なので、リポジトリに置かず GitHub の secrets から受け、plan に出さない
# （sensitive）。CI は secrets.STATEMENT_READ_FEDERATION_RULE_ID などを TF_VAR_* で渡す（未設定なら空）
variable "statement_read_federation_rule_id" {
  description = "federation のルールの ID（fdrl_ で始まる）"
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = can(regex("^(fdrl_[A-Za-z0-9_-]{1,128})?$", var.statement_read_federation_rule_id))
    error_message = "statement_read_federation_rule_id は fdrl_ で始まる ID か空。"
  }
  # federation を選んだら必須（空のまま deploy すると読み取りが 503 になるので plan で止める）
  validation {
    condition     = !(var.statement_read_credential == "federation" && var.statement_read_federation_rule_id == "")
    error_message = "statement_read_credential = federation のときは statement_read_federation_rule_id が必須。"
  }
}

variable "statement_read_organization_id" {
  description = "federation の Anthropic の組織の ID（UUID）"
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = can(regex("^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})?$", var.statement_read_organization_id))
    error_message = "statement_read_organization_id は UUID の形か空。"
  }
  validation {
    condition     = !(var.statement_read_credential == "federation" && var.statement_read_organization_id == "")
    error_message = "statement_read_credential = federation のときは statement_read_organization_id が必須。"
  }
}

variable "statement_read_service_account_id" {
  description = "federation の Anthropic のサービスアカウントの ID（svac_ で始まる。任意）"
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = can(regex("^(svac_[A-Za-z0-9_-]{1,128})?$", var.statement_read_service_account_id))
    error_message = "statement_read_service_account_id は svac_ で始まる ID か空。"
  }
}

variable "statement_read_workspace_id" {
  description = "federation のワークスペースの ID（wrkspc_ で始まる。ルールが複数のワークスペースに効くときだけ必須）"
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = can(regex("^(wrkspc_[A-Za-z0-9_-]{1,128})?$", var.statement_read_workspace_id))
    error_message = "statement_read_workspace_id は wrkspc_ で始まる ID か空。"
  }
}
