# bootstrap の state は prod 用と別のバケットに置く（CI の SA には読ませない）。
# バケットは初回だけ gcloud で作り、imports.tf で取り込む（infra/README.md「初回の apply」）。
# バケット名（<PROJECT_ID>-tfstate-bootstrap）はプロジェクトごとに違うので部分設定にし、
# terraform init -backend-config="bucket=<PROJECT_ID>-tfstate-bootstrap" で渡す。
terraform {
  backend "gcs" {
    prefix = "bootstrap"
  }
}
