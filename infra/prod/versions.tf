# 版の固定（infra/bootstrap と同じ。terraform の実際の版は mise.toml と .github/workflows/ci.yml・deploy.yml の terraform_version）。
# prod は Cloud Run のサービスと invoker の付与だけなので google だけを使う
terraform {
  required_version = "~> 1.17.1"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 8.10.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
