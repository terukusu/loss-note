#!/usr/bin/env bash
# tf-iam-grants.sh の自己テスト。infra/bootstrap の *.tf を一時ディレクトリに写し、付与を足す・読めない形を置くと失敗し、
# 写しのままなら成功することを確かめる（足す宣言はすべて架空）
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
check="$here/tf-iam-grants.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail=0

# 名前・足すファイル名・中身
setup() {
  local d="$work/$1"
  mkdir -p "$d"
  cp "$root"/infra/bootstrap/*.tf "$d/"
  if [ -n "$2" ]; then printf '%s\n' "$3" > "$d/$2"; fi
  printf '%s' "$d"
}

expect_reject() {
  local d; d=$(setup "$1" "$2" "$3")
  if "$check" "$d" >/dev/null 2>&1; then
    echo "NG: $1 を拒否しなかった"
    fail=1
  else
    echo "ok: $1 を拒否した"
  fi
}

expect_reject bootstrap-bucket-grant extra.tf 'resource "google_storage_bucket_iam_member" "bootstrap_state" {}'
expect_reject runtime-project-grant extra.tf 'resource "google_project_iam_member" "runtime_role" {}'
expect_reject authoritative-binding extra.tf '  resource   "google_project_iam_binding"   "x" {}'
expect_reject authoritative-policy extra.tf 'resource "google_service_account_iam_policy" "y" {}'
expect_reject tf-json extra.tf.json '{"resource": {"google_project_iam_member": {"j": {}}}}'
expect_reject module-block extra.tf 'module "grants" { source = "./grants" }'

d=$(setup clean "" "")
if "$check" "$d" >/dev/null 2>&1; then
  echo "ok: clean を受け入れた"
else
  echo "NG: clean を拒否した"
  fail=1
fi

d=$(setup removed "" "")
rm "$d/runtime.tf"
if "$check" "$d" >/dev/null 2>&1; then
  echo "NG: 付与を消したのに受け入れた"
  fail=1
else
  echo "ok: 付与の欠けを拒否した"
fi

exit "$fail"
