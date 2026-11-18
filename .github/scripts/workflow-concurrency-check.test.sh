#!/usr/bin/env bash
# workflow-concurrency-check.sh の自己テスト。.github/workflows を一時ディレクトリに写し、壊した写しは失敗・そのままの写しは成功することを確かめる
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
check="$here/workflow-concurrency-check.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail=0

# 名前・対象のファイル・sed の式
setup() {
  local d="$work/$1"
  mkdir -p "$d"
  cp "$root"/.github/workflows/*.yml "$d/"
  if [ -n "$2" ]; then sed -i -E "$3" "$d/$2"; fi
  printf '%s' "$d"
}

expect_reject() {
  local d; d=$(setup "$1" "$2" "$3")
  if "$check" "$d" > /dev/null 2>&1; then
    echo "NG: $1 を拒否しなかった"
    fail=1
  else
    echo "ok: $1 を拒否した"
  fi
}

expect_reject fixed-group deploy.yml 's/^  group: .*/  group: terraform-prod/'
expect_reject rollback-fixed-group rollback.yml 's/^  group: .*/  group: terraform-prod/'
expect_reject if-drift deploy.yml "s/github.event.workflow_run.event == 'push' \&\&$/github.event.workflow_run.event != 'pull_request' \&\&/"
expect_reject group-drift deploy.yml "s/github.event.workflow_run.head_branch == 'main' \&\& github.event.workflow_run.head_repository/github.event.workflow_run.head_repository/"
expect_reject rollback-if-drift rollback.yml "s/^    if: github.ref == 'refs\/heads\/main'/    if: true/"
expect_reject cancel-true deploy.yml 's/^  cancel-in-progress: false/  cancel-in-progress: true/'
expect_reject pull-request-target ci.yml 's/^  pull_request:$/  pull_request_target:/'

d=$(setup clean "" "")
if "$check" "$d" > /dev/null 2>&1; then
  echo "ok: clean を受け入れた"
else
  echo "NG: clean を拒否した"
  "$check" "$d" || true
  fail=1
fi

exit "$fail"
