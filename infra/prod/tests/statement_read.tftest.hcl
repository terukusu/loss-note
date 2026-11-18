# 明細の読み取りの本番の配線（Issue #44 の AC-11・R5・R6・例 K4、Issue #55 の AC-8）の静的テスト。モックのプロバイダなので資格情報なしで回る。
# 値はすべて架空（prod.tftest.hcl と同じ）。

mock_provider "google" {}

variables {
  project_id           = "example-project"
  firebase_auth_domain = "auth.example.test"
  image                = "asia-northeast1-docker.pkg.dev/example-project/loss-note/loss-note@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

# 方式ごとの Cloud Run の資格情報の環境変数（Issue #55 の AC-8・例 E7〜E10。#44 の K4・AC-13 を含む）。
# 選ばなかった方式の変数は載せない（API は子の CLI に選んだ方式の変数だけを渡す）

# 例 E7（KEEP-2）: 切り替えが無い（既定）: 資格情報の環境変数は 0 件（版の無い参照でインスタンスが起動しない問題を避ける）
run "no_key" {
  assert {
    condition     = length([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name if contains(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "STATEMENT_READ_CREDENTIAL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE", "ANTHROPIC_BASE_URL", "ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID", "ANTHROPIC_SERVICE_ACCOUNT_ID", "ANTHROPIC_WORKSPACE_ID", "ANTHROPIC_IDENTITY_TOKEN", "ANTHROPIC_IDENTITY_TOKEN_FILE"], e.name)]) == 0
    error_message = "切り替えの前は読み取りの資格情報の環境変数を持たない"
  }
  assert {
    condition     = toset([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name]) == toset(["GOOGLE_CLOUD_PROJECT", "FIREBASE_AUTH_DOMAIN", "LOSS_NOTE_ALLOWED_EMAILS"])
    error_message = "環境変数は #42・#43 の 3 つだけ"
  }
}

# 例 E10: #44 の statement_read_key = true だけ（切り替えは空）は api_key と同じ（後方互換）
run "with_key" {
  variables {
    statement_read_key = true
  }
  assert {
    condition     = toset([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name]) == toset(["GOOGLE_CLOUD_PROJECT", "FIREBASE_AUTH_DOMAIN", "LOSS_NOTE_ALLOWED_EMAILS", "STATEMENT_READ_CREDENTIAL", "ANTHROPIC_API_KEY"])
    error_message = "環境変数は #42・#43 の 3 つと STATEMENT_READ_CREDENTIAL・ANTHROPIC_API_KEY だけ"
  }
  assert {
    condition = one([
      for e in google_cloud_run_v2_service.app.template[0].containers[0].env :
      e.value_source[0].secret_key_ref[0].secret == "statement-read-anthropic-api-key" && e.value_source[0].secret_key_ref[0].version == "latest" && (e.value == null || e.value == "")
      if e.name == "ANTHROPIC_API_KEY"
    ])
    error_message = "ANTHROPIC_API_KEY は入れ物 statement-read-anthropic-api-key の latest の参照（値を直に書かない）"
  }
  assert {
    condition     = one([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.value if e.name == "STATEMENT_READ_CREDENTIAL"]) == "api_key"
    error_message = "STATEMENT_READ_CREDENTIAL は api_key"
  }
}

# api_key を切り替えで選ぶ（E10 と同じ集合）
run "api_key" {
  variables {
    statement_read_credential = "api_key"
  }
  assert {
    condition     = toset([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name]) == toset(["GOOGLE_CLOUD_PROJECT", "FIREBASE_AUTH_DOMAIN", "LOSS_NOTE_ALLOWED_EMAILS", "STATEMENT_READ_CREDENTIAL", "ANTHROPIC_API_KEY"])
    error_message = "api_key は STATEMENT_READ_CREDENTIAL・ANTHROPIC_API_KEY だけ"
  }
  assert {
    condition = one([
      for e in google_cloud_run_v2_service.app.template[0].containers[0].env :
      e.value_source[0].secret_key_ref[0].secret == "statement-read-anthropic-api-key" && e.value_source[0].secret_key_ref[0].version == "latest" && (e.value == null || e.value == "")
      if e.name == "ANTHROPIC_API_KEY"
    ])
    error_message = "ANTHROPIC_API_KEY は入れ物 statement-read-anthropic-api-key の latest の参照（値を直に書かない）"
  }
}

# 例 E8: oauth_token は OAuth トークンの入れ物の参照だけ（キーは載せない）。statement_read_key = true が残っていても切り替えが勝つ
run "oauth_token" {
  variables {
    statement_read_credential = "oauth_token"
    statement_read_key        = true
  }
  assert {
    condition     = toset([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name]) == toset(["GOOGLE_CLOUD_PROJECT", "FIREBASE_AUTH_DOMAIN", "LOSS_NOTE_ALLOWED_EMAILS", "STATEMENT_READ_CREDENTIAL", "CLAUDE_CODE_OAUTH_TOKEN"])
    error_message = "oauth_token は STATEMENT_READ_CREDENTIAL・CLAUDE_CODE_OAUTH_TOKEN だけ（ANTHROPIC_API_KEY を載せない）"
  }
  assert {
    condition = one([
      for e in google_cloud_run_v2_service.app.template[0].containers[0].env :
      e.value_source[0].secret_key_ref[0].secret == "statement-read-claude-oauth-token" && e.value_source[0].secret_key_ref[0].version == "latest" && (e.value == null || e.value == "")
      if e.name == "CLAUDE_CODE_OAUTH_TOKEN"
    ])
    error_message = "CLAUDE_CODE_OAUTH_TOKEN は入れ物 statement-read-claude-oauth-token の latest の参照（値を直に書かない）"
  }
  assert {
    condition     = one([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.value if e.name == "STATEMENT_READ_CREDENTIAL"]) == "oauth_token"
    error_message = "STATEMENT_READ_CREDENTIAL は oauth_token"
  }
}

# 例 E9: federation は識別子だけ（任意の 2 つは設定したときだけ）。Secret Manager の参照は無い
run "federation" {
  variables {
    statement_read_credential         = "federation"
    statement_read_federation_rule_id = "fdrl_example"
    statement_read_organization_id    = "00000000-0000-0000-0000-000000000001"
  }
  assert {
    condition     = toset([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name]) == toset(["GOOGLE_CLOUD_PROJECT", "FIREBASE_AUTH_DOMAIN", "LOSS_NOTE_ALLOWED_EMAILS", "STATEMENT_READ_CREDENTIAL", "ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID"])
    error_message = "federation は STATEMENT_READ_CREDENTIAL・ルール ID・組織 ID だけ"
  }
  assert {
    condition     = one([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.value if e.name == "STATEMENT_READ_CREDENTIAL"]) == "federation"
    error_message = "STATEMENT_READ_CREDENTIAL は federation"
  }
  assert {
    condition     = length([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name if length(e.value_source) > 0 && e.name != "LOSS_NOTE_ALLOWED_EMAILS"]) == 0
    error_message = "federation は Secret Manager の参照を持たない（秘密を置かない）"
  }
  assert {
    condition     = nonsensitive(one([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.value if e.name == "ANTHROPIC_FEDERATION_RULE_ID"]) == "fdrl_example")
    error_message = "ルール ID は変数の値"
  }
}

run "federation_optional_ids" {
  variables {
    statement_read_credential         = "federation"
    statement_read_federation_rule_id = "fdrl_example"
    statement_read_organization_id    = "00000000-0000-0000-0000-000000000001"
    statement_read_service_account_id = "svac_example"
    statement_read_workspace_id       = "wrkspc_example"
  }
  assert {
    condition     = toset([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name]) == toset(["GOOGLE_CLOUD_PROJECT", "FIREBASE_AUTH_DOMAIN", "LOSS_NOTE_ALLOWED_EMAILS", "STATEMENT_READ_CREDENTIAL", "ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID", "ANTHROPIC_SERVICE_ACCOUNT_ID", "ANTHROPIC_WORKSPACE_ID"])
    error_message = "任意の SA の ID・ワークスペースの ID は設定したときだけ載せる"
  }
}

# 識別子があっても federation でなければ載せない
run "federation_ids_ignored_for_other_methods" {
  variables {
    statement_read_credential         = "oauth_token"
    statement_read_federation_rule_id = "fdrl_example"
    statement_read_organization_id    = "00000000-0000-0000-0000-000000000001"
  }
  assert {
    condition     = toset([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name]) == toset(["GOOGLE_CLOUD_PROJECT", "FIREBASE_AUTH_DOMAIN", "LOSS_NOTE_ALLOWED_EMAILS", "STATEMENT_READ_CREDENTIAL", "CLAUDE_CODE_OAUTH_TOKEN"])
    error_message = "federation の識別子は federation のときだけ載せる"
  }
}

# federation で必須の識別子が無ければ plan で止める
run "federation_requires_rule_id" {
  command = plan
  variables {
    statement_read_credential      = "federation"
    statement_read_organization_id = "00000000-0000-0000-0000-000000000001"
  }
  expect_failures = [var.statement_read_federation_rule_id]
}

run "federation_requires_organization_id" {
  command = plan
  variables {
    statement_read_credential         = "federation"
    statement_read_federation_rule_id = "fdrl_example"
  }
  expect_failures = [var.statement_read_organization_id]
}

run "unknown_method_rejected" {
  command = plan
  variables {
    statement_read_credential = "password"
  }
  expect_failures = [var.statement_read_credential]
}

# AC-11: 要求のタイムアウトが 30 秒（画面の待ち）より長い。読み取りの締め切り 20 秒 + 後始末 約 5 秒の内側に収まる
run "timeouts" {
  assert {
    condition     = tonumber(trimsuffix(google_cloud_run_v2_service.app.template[0].timeout, "s")) > 30
    error_message = "Cloud Run の要求のタイムアウトは 30 秒より長い"
  }
}
