# GitHub Actions から鍵なしで GCP を使うための Workload Identity 連携（docs/design.md 10 章・ADR-0008）。
# このリポジトリ（数値 ID で照合。名前を変えても別物にならず、同じ名前で作り直した別のリポジトリは通さない）以外のトークンは受けない。
# 借用の主体（iam.tf）も数値 ID と Environment だけから作る属性で指すので、リポジトリ・オーナーの名前を変えても借用は変わらない（例 W6）。
resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  # 名前は説明にだけ使う（照合には使わない。名前を変えたら次の apply で説明だけが変わる）
  description     = "${var.github_repository} の GitHub Actions 用"
  deletion_policy = "PREVENT"

  depends_on = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github_actions" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions OIDC"

  attribute_mapping = {
    # google.subject は 127 バイトまで。sub（repo:<OWNER>@<OWNER_ID>/<REPO>@<REPO_ID>:ref:refs/heads/<ブランチ>）は名前と ref を含み、
    # 長いブランチ名では超えてトークンの交換が失敗しうる。数字だけの値にする: <リポジトリの数値 ID>:<run_id>:<run_attempt>
    # （どれも数字なので、長さはブランチ名・Environment 名に依らず 40 バイトほど。監査ログから workflow の実行と試行を引ける）
    "google.subject"                = "assertion.repository_id + ':' + assertion.run_id + ':' + assertion.run_attempt"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    # <リポジトリの数値 ID>:<オーナーの数値 ID>:<Environment の名前>（Environment の無い job は末尾が空）。名前を含まない。
    # apply 用 SA は値が <REPO_ID>:<OWNER_ID>:prod の principalSet だけが借用できる（iam.tf）
    "attribute.repo_env" = "assertion.repository_id + ':' + assertion.repository_owner_id + ':' + (has(assertion.environment) ? assertion.environment : '')"
  }

  # リポジトリの数値 ID とオーナーの数値 ID の両方が一致するときだけ受ける（名前は条件に使わない）。
  # pull_request_target の job は fork の PR から base の文脈で動きうるので受けない（多層の守り。ADR-0008 決定 7）。
  # PR（pull_request）・push・workflow_dispatch などほかの event は受ける（plan 用 SA の借用を壊さない）
  attribute_condition = "assertion.repository_id == '${var.github_repository_id}' && assertion.repository_owner_id == '${var.github_owner_id}' && assertion.event_name != 'pull_request_target'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}
