# infra/prod の静的テスト（terraform test。Issue #42 の AC-5）。モックのプロバイダなので資格情報なしで回り、実リソースは作らない。
# command = apply（既定）はモックの computed 値を確定させて assert するため（plan だと unknown になる）。
# 値はすべて架空（プロジェクト example-project、digest は a の 64 桁）。
# 変数なしの plan が止まること（AC-15）は tests/required-vars/ と .github/scripts/tf-required-variables.sh。

mock_provider "google" {}

variables {
  project_id           = "example-project"
  image                = "asia-northeast1-docker.pkg.dev/example-project/loss-note/loss-note@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  firebase_auth_domain = "auth.example.test"
}

run "defaults" {
  # R6: 東京・サービス 1 つ・名前 loss-note
  assert {
    condition     = google_cloud_run_v2_service.app.name == "loss-note" && google_cloud_run_v2_service.app.location == "asia-northeast1" && google_cloud_run_v2_service.app.project == "example-project"
    error_message = "サービスは loss-note・asia-northeast1・このプロジェクト"
  }
  # R6: 最小 0・最大 2
  assert {
    condition     = google_cloud_run_v2_service.app.template[0].scaling[0].min_instance_count == 0 && google_cloud_run_v2_service.app.template[0].scaling[0].max_instance_count == 2
    error_message = "インスタンスは 0〜2"
  }
  # R6: 実行用 SA（infra/bootstrap の sa-loss-note）
  assert {
    condition     = google_cloud_run_v2_service.app.template[0].service_account == "sa-loss-note@example-project.iam.gserviceaccount.com"
    error_message = "実行用 SA は sa-loss-note@<project_id>"
  }
  # R4: 環境変数はプロジェクト ID（値 = project_id）と、#43 のログインの 2 つ（authDomain・許可リスト）だけ。エミュレーターの接続先は 0 件
  assert {
    condition     = toset([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name]) == toset(["GOOGLE_CLOUD_PROJECT", "FIREBASE_AUTH_DOMAIN", "LOSS_NOTE_ALLOWED_EMAILS"])
    error_message = "環境変数の名前は GOOGLE_CLOUD_PROJECT・FIREBASE_AUTH_DOMAIN・LOSS_NOTE_ALLOWED_EMAILS だけ"
  }
  # #43: authDomain は変数のまま（CSP の frame-src に入る）
  assert {
    condition     = one([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.value if e.name == "FIREBASE_AUTH_DOMAIN"]) == "auth.example.test"
    error_message = "FIREBASE_AUTH_DOMAIN の値は firebase_auth_domain"
  }
  # #43: 許可リストは平文の値を持たず、Secret Manager の入れ物 loss-note-allowed-emails の latest の参照だけ
  assert {
    condition     = one([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.value if e.name == "LOSS_NOTE_ALLOWED_EMAILS"]) == null
    error_message = "LOSS_NOTE_ALLOWED_EMAILS は平文の value を持たない"
  }
  assert {
    condition     = one(flatten([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : [for v in e.value_source : [for k in v.secret_key_ref : "${k.secret}@${k.version}"]] if e.name == "LOSS_NOTE_ALLOWED_EMAILS"])) == "loss-note-allowed-emails@latest"
    error_message = "LOSS_NOTE_ALLOWED_EMAILS は Secret Manager の loss-note-allowed-emails の latest の参照"
  }
  assert {
    condition     = one([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.value if e.name == "GOOGLE_CLOUD_PROJECT"]) == "example-project"
    error_message = "GOOGLE_CLOUD_PROJECT の値は project_id"
  }
  assert {
    condition     = length([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name if endswith(e.name, "_EMULATOR_HOST")]) == 0
    error_message = "エミュレーターの接続先の環境変数（*_EMULATOR_HOST）を持たない"
  }
  # R6: イメージは digest（変数のまま）
  assert {
    condition     = google_cloud_run_v2_service.app.template[0].containers[0].image == "asia-northeast1-docker.pkg.dev/example-project/loss-note/loss-note@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    error_message = "イメージは渡した digest 参照"
  }
  # R6: 未認証の呼び出しを受ける（allUsers に run.invoker）。IAM の検査は無効にしない
  assert {
    condition     = google_cloud_run_v2_service_iam_member.public.member == "allUsers" && google_cloud_run_v2_service_iam_member.public.role == "roles/run.invoker"
    error_message = "invoker は allUsers / roles/run.invoker"
  }
  assert {
    condition     = google_cloud_run_v2_service_iam_member.public.name == "loss-note" && google_cloud_run_v2_service_iam_member.public.location == "asia-northeast1" && google_cloud_run_v2_service_iam_member.public.project == "example-project"
    error_message = "invoker はサービス loss-note に付ける"
  }
  assert {
    condition     = google_cloud_run_v2_service.app.invoker_iam_disabled == false && google_cloud_run_v2_service.app.ingress == "INGRESS_TRAFFIC_ALL"
    error_message = "IAM の検査を無効にしない・ingress は all（run.app の URL）"
  }
  # 時間（gunicorn の --timeout 60 と同じ。画面の待ち 30 秒 = 読み取りの締め切り 20 秒 + 後始末 約 5 秒 より長い）・同時実行（gunicorn の --threads 8）
  assert {
    condition     = google_cloud_run_v2_service.app.template[0].timeout == "60s" && google_cloud_run_v2_service.app.template[0].max_instance_request_concurrency == 8
    error_message = "タイムアウト 60 秒・同時実行 8"
  }
  assert {
    condition     = google_cloud_run_v2_service.app.template[0].execution_environment == "EXECUTION_ENVIRONMENT_GEN1"
    error_message = "第 1 世代"
  }
  assert {
    condition     = google_cloud_run_v2_service.app.template[0].containers[0].resources[0].limits["cpu"] == "1" && google_cloud_run_v2_service.app.template[0].containers[0].resources[0].limits["memory"] == "1Gi" && google_cloud_run_v2_service.app.template[0].containers[0].resources[0].cpu_idle == true
    error_message = "CPU 1・1Gi・リクエスト中だけ CPU"
  }
  assert {
    condition     = google_cloud_run_v2_service.app.template[0].containers[0].startup_probe[0].http_get[0].path == "/api/health"
    error_message = "起動の確かめは /api/health（記録に触れない）"
  }
  # R8: トラフィックは最新に 100%（切り戻しの後の次の deploy で最新に戻る）
  assert {
    condition     = length(google_cloud_run_v2_service.app.traffic) == 1 && google_cloud_run_v2_service.app.traffic[0].type == "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST" && google_cloud_run_v2_service.app.traffic[0].percent == 100
    error_message = "トラフィックは最新のリビジョンに 100%"
  }
}

run "max_instances" {
  variables {
    max_instances = 3
  }
  assert {
    condition     = google_cloud_run_v2_service.app.template[0].scaling[0].max_instance_count == 3
    error_message = "最大インスタンスは変数で変えられる"
  }
}

# AC-5: digest でないイメージを受けない
run "reject_tag_image" {
  command = plan
  variables {
    image = "asia-northeast1-docker.pkg.dev/example-project/loss-note/loss-note:src-0123456789abcdef0123"
  }
  expect_failures = [var.image]
}

run "reject_latest_image" {
  command = plan
  variables {
    image = "asia-northeast1-docker.pkg.dev/example-project/loss-note/loss-note:latest"
  }
  expect_failures = [var.image]
}

run "reject_short_digest" {
  command = plan
  variables {
    image = "asia-northeast1-docker.pkg.dev/example-project/loss-note/loss-note@sha256:aaaa"
  }
  expect_failures = [var.image]
}

run "reject_other_repo_image" {
  command = plan
  variables {
    image = "asia-northeast1-docker.pkg.dev/example-project/other/loss-note@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  expect_failures = [var.image]
}

run "reject_other_registry_image" {
  command = plan
  variables {
    image = "docker.io/library/loss-note@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  expect_failures = [var.image]
}

run "reject_other_project_image" {
  command = plan
  variables {
    image = "asia-northeast1-docker.pkg.dev/other-project/loss-note/loss-note@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  expect_failures = [var.image]
}

# #43: authDomain はホスト名だけ（CSP のヘッダへの差し込み・スキーム・ワイルドカードを受けない）
run "reject_auth_domain_with_scheme" {
  command = plan
  variables {
    firebase_auth_domain = "https://auth.example.test"
  }
  expect_failures = [var.firebase_auth_domain]
}

run "reject_auth_domain_wildcard" {
  command = plan
  variables {
    firebase_auth_domain = "*.example.test"
  }
  expect_failures = [var.firebase_auth_domain]
}

run "reject_auth_domain_separator" {
  command = plan
  variables {
    firebase_auth_domain = "auth.example.test; script-src *"
  }
  expect_failures = [var.firebase_auth_domain]
}

run "reject_auth_domain_uppercase" {
  command = plan
  variables {
    firebase_auth_domain = "Auth.Example.Test"
  }
  expect_failures = [var.firebase_auth_domain]
}

run "reject_empty_auth_domain" {
  command = plan
  variables {
    firebase_auth_domain = ""
  }
  expect_failures = [var.firebase_auth_domain]
}

run "reject_bad_project_id" {
  command = plan
  variables {
    project_id = "Example-Project"
  }
  expect_failures = [var.project_id]
}

run "reject_empty_project_id" {
  command = plan
  variables {
    project_id = ""
  }
  expect_failures = [var.project_id]
}

run "reject_zero_max_instances" {
  command = plan
  variables {
    max_instances = 0
  }
  expect_failures = [var.max_instances]
}

run "reject_too_many_instances" {
  command = plan
  variables {
    max_instances = 11
  }
  expect_failures = [var.max_instances]
}
