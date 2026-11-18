# AI の上限（Issue #51 の AC-10・ADR-0014）の Cloud Run の配線の静的テスト。モックのプロバイダなので資格情報なしで回る。
# 値はすべて架空（prod.tftest.hcl と同じ）。

mock_provider "google" {}

variables {
  project_id           = "example-project"
  firebase_auth_domain = "auth.example.test"
  image                = "asia-northeast1-docker.pkg.dev/example-project/loss-note/loss-note@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

# 既定: 環境変数の集合は今と同じ（バイパスの参照も上限の値も載せない = API のコードの既定・バイパス 0 人）
run "defaults" {
  assert {
    condition     = toset([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name]) == toset(["GOOGLE_CLOUD_PROJECT", "FIREBASE_AUTH_DOMAIN", "LOSS_NOTE_ALLOWED_EMAILS"])
    error_message = "既定では AI の上限の環境変数を載せない"
  }
}

# 切り替えが true: バイパスのリストは Secret Manager の loss-note-ai-bypass-emails の latest の参照だけ（平文の値を持たない）
run "bypass_enabled" {
  variables {
    ai_limit_bypass = true
  }
  assert {
    condition     = toset([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name]) == toset(["GOOGLE_CLOUD_PROJECT", "FIREBASE_AUTH_DOMAIN", "LOSS_NOTE_ALLOWED_EMAILS", "LOSS_NOTE_AI_BYPASS_EMAILS"])
    error_message = "バイパスの切り替えで足すのは LOSS_NOTE_AI_BYPASS_EMAILS だけ"
  }
  assert {
    condition     = one(flatten([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : [for v in e.value_source : [for k in v.secret_key_ref : "${k.secret}@${k.version}"]] if e.name == "LOSS_NOTE_AI_BYPASS_EMAILS"])) == "loss-note-ai-bypass-emails@latest"
    error_message = "LOSS_NOTE_AI_BYPASS_EMAILS は Secret Manager の loss-note-ai-bypass-emails の latest の参照"
  }
  assert {
    condition     = one([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.value if e.name == "LOSS_NOTE_AI_BYPASS_EMAILS"]) == null
    error_message = "LOSS_NOTE_AI_BYPASS_EMAILS は平文の value を持たない"
  }
}

# 上限の値: 指定したものだけ平文で載せる
run "limit_values" {
  variables {
    ai_user_daily_usd = "0.50"
    ai_daily_usd      = "5"
  }
  assert {
    condition     = toset([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name]) == toset(["GOOGLE_CLOUD_PROJECT", "FIREBASE_AUTH_DOMAIN", "LOSS_NOTE_ALLOWED_EMAILS", "LOSS_NOTE_AI_USER_DAILY_USD", "LOSS_NOTE_AI_DAILY_USD"])
    error_message = "指定した上限の値だけを載せる（回数は空なので載せない）"
  }
  assert {
    condition     = one([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.value if e.name == "LOSS_NOTE_AI_USER_DAILY_USD"]) == "0.50" && one([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.value if e.name == "LOSS_NOTE_AI_DAILY_USD"]) == "5"
    error_message = "上限の値はそのまま平文で載せる"
  }
}

run "count_value" {
  variables {
    ai_user_daily_count = "45"
  }
  assert {
    condition     = one([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.value if e.name == "LOSS_NOTE_AI_USER_DAILY_COUNT"]) == "45"
    error_message = "回数の上限を載せる"
  }
}

# 形の誤りは plan で止める（API も 503 にするが、deploy の前に気づけるように）
run "bad_user_usd_rejected" {
  command = plan
  variables {
    ai_user_daily_usd = "-1"
  }
  expect_failures = [var.ai_user_daily_usd]
}

run "bad_daily_usd_rejected" {
  command = plan
  variables {
    ai_daily_usd = "1e9"
  }
  expect_failures = [var.ai_daily_usd]
}

run "bad_count_rejected" {
  command = plan
  variables {
    ai_user_daily_count = "3.5"
  }
  expect_failures = [var.ai_user_daily_count]
}
