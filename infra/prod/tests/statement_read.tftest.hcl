# 明細の読み取りの本番の配線（Issue #44 の AC-11・R5・R6・例 K4）の静的テスト。モックのプロバイダなので資格情報なしで回る。
# 値はすべて架空（prod.tftest.hcl と同じ）。

mock_provider "google" {}

variables {
  project_id           = "example-project"
  firebase_auth_domain = "auth.example.test"
  image                = "asia-northeast1-docker.pkg.dev/example-project/loss-note/loss-note@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

# キーの前（既定）: 資格情報の環境変数は 0 件（版の無い参照でインスタンスが起動しない問題を避ける。K4・AC-13）
run "no_key" {
  assert {
    condition     = length([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name if contains(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "STATEMENT_READ_CREDENTIAL", "ANTHROPIC_AUTH_TOKEN"], e.name)]) == 0
    error_message = "キーの前は読み取りの資格情報の環境変数を持たない"
  }
}

# キーの後: ANTHROPIC_API_KEY を入れ物の参照（latest）で 1 つだけ。OAuth トークン・切り替えの変数は載せない
run "with_key" {
  variables {
    statement_read_key = true
  }
  assert {
    condition     = length([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e if e.name == "ANTHROPIC_API_KEY"]) == 1
    error_message = "ANTHROPIC_API_KEY は 1 つ"
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
    condition     = length([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name if contains(["CLAUDE_CODE_OAUTH_TOKEN", "STATEMENT_READ_CREDENTIAL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"], e.name)]) == 0
    error_message = "OAuth トークン・切り替え・送信先の変数を載せない（本番は API キーだけ）"
  }
  # ほかの環境変数（#42・#43）はそのまま
  assert {
    condition     = toset([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name]) == toset(["GOOGLE_CLOUD_PROJECT", "FIREBASE_AUTH_DOMAIN", "LOSS_NOTE_ALLOWED_EMAILS", "ANTHROPIC_API_KEY"])
    error_message = "環境変数は GOOGLE_CLOUD_PROJECT・FIREBASE_AUTH_DOMAIN・LOSS_NOTE_ALLOWED_EMAILS と ANTHROPIC_API_KEY だけ"
  }
}

# AC-11: 要求のタイムアウトが 30 秒（画面の待ち）より長い。読み取りの締め切り 20 秒 + 後始末 約 5 秒の内側に収まる
run "timeouts" {
  assert {
    condition     = tonumber(trimsuffix(google_cloud_run_v2_service.app.template[0].timeout, "s")) > 30
    error_message = "Cloud Run の要求のタイムアウトは 30 秒より長い"
  }
}
