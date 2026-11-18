# 版の固定。terraform の実際の版は mise.toml と .github/workflows/ci.yml の terraform_version（1.17.1）で決める。
# google-beta は Firebase のリソース（firebase.tf。8.10.0 でも beta だけ）のためだけに使う（docs/adr-0008-production-foundation.md）。
terraform {
  required_version = "~> 1.17.1"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 8.10.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "= 8.10.0"
    }
  }
}

# 所有者の資格情報（ADC）で予算・Firebase の API を呼ぶには quota project の指定が要る（無いと 403）。
# そのため Service Usage などの前提の API は Terraform より先に gcloud で有効にする（infra/README.md「初回の apply」）
provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}
