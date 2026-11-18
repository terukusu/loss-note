# 識別子（プロジェクト・請求先・リポジトリ・数値 ID）に既定値は持たない（リポジトリは誰でも clone して自分のプロジェクトで使う前提。
# 既定値があると、渡し忘れた plan が別のプロジェクトに向かう）。値は apply のたびに TF_VAR_ で渡す（infra/README.md「変数」）。
variable "project_id" {
  description = "loss-note 専用の GCP プロジェクト ID"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id は GCP のプロジェクト ID の形（英小文字で始まる 6〜30 文字の英小文字・数字・-）で指定する。"
  }
}

variable "billing_account" {
  description = "予算を置く請求先アカウントの ID（XXXXXX-XXXXXX-XXXXXX）"
  type        = string

  validation {
    condition     = can(regex("^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$", var.billing_account))
    error_message = "billing_account は XXXXXX-XXXXXX-XXXXXX（英大文字と数字。billingAccounts/ は付けない）で指定する。"
  }
}

variable "region" {
  description = "既定のリージョン（Artifact Registry・state のバケット・後の Cloud Run）"
  type        = string
  default     = "asia-northeast1"
}

variable "github_repository" {
  description = "WIF で借用を許す GitHub リポジトリ（owner/name）。照合は数値 ID で行い、名前はプールの説明にだけ使う"
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$", var.github_repository))
    error_message = "github_repository は <owner>/<name> の形で指定する。"
  }
}

# GitHub の数値 ID はコード・tfvars に置かない。apply のたびに gh api から TF_VAR_ で渡す（infra/README.md「変数」）
variable "github_repository_id" {
  description = "GitHub リポジトリの数値 ID（gh api repos/<OWNER>/<REPO> --jq .id）"
  type        = string

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "github_repository_id は数字だけで指定する。"
  }
}

variable "github_owner_id" {
  description = "GitHub リポジトリの所有者の数値 ID（gh api repos/<OWNER>/<REPO> --jq .owner.id）"
  type        = string

  validation {
    condition     = can(regex("^[0-9]+$", var.github_owner_id))
    error_message = "github_owner_id は数字だけで指定する。"
  }
}

# 月の予算（円）。通知だけで、超えても止めない（docs/design.md 10 章・12 章）
variable "budget_amount_jpy" {
  description = "このプロジェクトの月の予算（円。請求先の通貨が JPY であること）"
  type        = number
  default     = 3000

  validation {
    condition     = var.budget_amount_jpy > 0 && floor(var.budget_amount_jpy) == var.budget_amount_jpy
    error_message = "budget_amount_jpy は正の整数（円）で指定する。"
  }
}
