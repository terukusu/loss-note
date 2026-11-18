#!/usr/bin/env bash
# Issue #41 の AC-4・AC-5・AC-6（例 P）: infra/bootstrap で宣言した IAM の付与のリソースの集合が、下の EXPECTED と一致することを確かめる。
# terraform test は名前を指したリソースしか見られないので、別名の付与（bootstrap 用バケットへの付与・実行用 SA への付与など）を
# 足しても落ちない。ここで宣言の全体（google_*_iam_member / _binding / _policy）を静的に拾い、増減を検出する。
# 権威的な型（_binding・_policy）は既存の付与を消すので 0 件（EXPECTED に入れない）。付与を足すときは EXPECTED と test を一緒に直す。
# HCL の resource 行しか読まないので、読めない形（*.tf.json・module ブロック）がディレクトリにあれば、それだけで失敗にする。
# 引数: 検査するディレクトリ（既定は infra/bootstrap。自己テスト tf-iam-grants.test.sh が一時ディレクトリを渡す）
set -euo pipefail

cd "$(dirname "$0")/../.."
dir="${1:-infra/bootstrap}"

EXPECTED="google_artifact_registry_repository_iam_member.tf_apply_writer
google_artifact_registry_repository_iam_member.tf_plan_reader
google_project_iam_member.ci
google_project_iam_member.runtime_datastore
google_secret_manager_secret_iam_member.runtime_allowed_emails
google_secret_manager_secret_iam_member.statement_read
google_service_account_iam_member.tf_apply_act_as_runtime
google_service_account_iam_member.tf_apply_wif
google_service_account_iam_member.tf_plan_wif
google_storage_bucket_iam_member.prod_state_apply
google_storage_bucket_iam_member.prod_state_plan"

shopt -s nullglob
json=("$dir"/*.tf.json "$dir"/*.tf.json.tmpl)
if [ "${#json[@]}" -gt 0 ]; then
  echo "失敗: $dir に *.tf.json がある（この検査は HCL だけを読むので、付与を見逃しうる。HCL で書く）" >&2
  exit 1
fi

tf=("$dir"/*.tf)
if [ "${#tf[@]}" -eq 0 ]; then
  echo "失敗: $dir に *.tf が無い" >&2
  exit 1
fi

if grep -qE '^[[:space:]]*module[[:space:]]+"' "${tf[@]}"; then
  echo "失敗: $dir に module ブロックがある（モジュールの中の付与はこの検査で拾えない）" >&2
  exit 1
fi

actual=$(cat "${tf[@]}" \
  | sed -nE 's/^[[:space:]]*resource[[:space:]]+"(google_[a-z0-9_]*_iam_(member|binding|policy))"[[:space:]]+"([^"]+)".*/\1.\3/p' \
  | sort)

if [ "$actual" != "$EXPECTED" ]; then
  echo "失敗: $dir の IAM の付与のリソースが期待と違う（- 期待 / + 実際）" >&2
  diff <(printf '%s\n' "$EXPECTED") <(printf '%s\n' "$actual") >&2 || true
  exit 1
fi

echo "ok: $dir の IAM の付与は期待の $(printf '%s\n' "$actual" | grep -c .) 件だけ（_binding・_policy・*.tf.json・module は 0 件）"
