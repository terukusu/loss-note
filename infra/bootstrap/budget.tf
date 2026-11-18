# 月の予算（Issue #41 の例 B）。対象はこのプロジェクトだけ。通知だけで、超えても止めない。
# 通知先は請求先の管理者への既定のメール（all_updates_rule を書かない = 既定の受信者のまま。メールアドレスを書かない）。
# 予算は請求先のリソースなので、プロジェクトを消しても残る（撤去は infra/README.md「撤去の注意」）。

data "google_project" "this" {
  project_id = var.project_id
}

resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account
  display_name    = "loss-note-monthly"

  budget_filter {
    projects        = ["projects/${data.google_project.this.number}"]
    calendar_period = "MONTH"
  }

  amount {
    specified_amount {
      currency_code = "JPY"
      units         = tostring(var.budget_amount_jpy)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 0.9
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }

  depends_on = [google_project_service.apis]
}
