# prod の state は bootstrap が作ったバケット <PROJECT_ID>-tfstate に置く（plan SA は読み取り、apply SA は読み書き）。
# バケット名はプロジェクトごとに違うので部分設定にし、terraform init -backend-config="bucket=<PROJECT_ID>-tfstate" で渡す
# （CI は secrets.TF_STATE_BUCKET。infra/README.md「prod（Cloud Run）」）。
# state に秘密を入れない（plan SA が読める。#44 の資格情報は Secret Manager の参照だけにし、値を変数・リソースに書かない）
terraform {
  backend "gcs" {
    prefix = "prod"
  }
}
