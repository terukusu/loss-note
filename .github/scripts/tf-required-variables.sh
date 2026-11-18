#!/usr/bin/env bash
# 変数なしの plan が、必須の変数の未指定で止まることを確かめる（#41 の例 G1・AC-8、#42 の AC-15）。
# terraform test -test-directory=tests/required-vars（モックのプロバイダ。資格情報なし）が失敗し、
# 未指定と出た変数の名前の集合が期待と一致すれば 0。テストが通ってしまう（既定値が足された）・集合が違うなら 1。
#
#   tf-required-variables.sh                          infra/bootstrap を #41 の 5 つの変数で確かめる
#   tf-required-variables.sh <dir> <変数名>...         <dir> を、未指定と出るべき変数の名前の集合で確かめる
#                                                 例: tf-required-variables.sh infra/prod project_id image
# 前提: <dir> で terraform init 済み（CLAUDE.md の確認コマンド・CI の順）。
set -euo pipefail

cd "$(dirname "$0")/../.."

if [ "$#" -eq 0 ]; then
  set -- infra/bootstrap billing_account github_owner_id github_repository github_repository_id project_id
fi
if [ "$#" -lt 2 ]; then
  echo "usage: $0 [<dir> <変数名>...]" >&2
  exit 2
fi
dir="$1"
shift
EXPECTED=$(printf '%s\n' "$@" | sort -u)

set +e
out=$(terraform -chdir="$dir" test -test-directory=tests/required-vars -no-color 2>&1)
code=$?
set -e

if [ "$code" -eq 0 ]; then
  echo "失敗: $dir の変数なしの plan が通った（必須の変数に既定値がある）" >&2
  printf '%s\n' "$out" >&2
  exit 1
fi

# 文言は端末の幅で折り返されるので、改行を空白にしてから名前を拾う
actual=$(printf '%s\n' "$out" | tr '\n' ' ' | grep -oE 'has a required variable[[:space:]]+"[^"]+"' | sed 's/.*"\([^"]*\)"$/\1/' | sort -u)

if [ "$actual" != "$EXPECTED" ]; then
  echo "失敗: $dir の未指定の必須の変数の集合が期待と違う（- 期待 / + 実際）" >&2
  diff <(printf '%s\n' "$EXPECTED") <(printf '%s\n' "$actual") >&2 || true
  printf '%s\n' "$out" >&2
  exit 1
fi

echo "ok: $dir の変数なしの plan は必須の変数 $(printf '%s\n' "$actual" | grep -c .) 個の未指定で止まる"
