#!/usr/bin/env bash
# 例 G1（Issue #41 の AC-8）: infra/bootstrap を変数なしで plan すると、必須の変数の未指定で止まることを確かめる。
# terraform test -test-directory=tests/required-vars（モックのプロバイダ。資格情報なし）が失敗し、
# 未指定と出た変数の名前の集合が下の EXPECTED と一致すれば 0。テストが通ってしまう（既定値が足された）・集合が違うなら 1。
# 前提: infra/bootstrap で terraform init 済み（CLAUDE.md の確認コマンド・CI の順）。
set -euo pipefail

cd "$(dirname "$0")/../.."

EXPECTED="billing_account
github_owner_id
github_repository
github_repository_id
project_id"

set +e
out=$(terraform -chdir=infra/bootstrap test -test-directory=tests/required-vars -no-color 2>&1)
code=$?
set -e

if [ "$code" -eq 0 ]; then
  echo "失敗: 変数なしの plan が通った（必須の変数に既定値がある）" >&2
  printf '%s\n' "$out" >&2
  exit 1
fi

# 文言は端末の幅で折り返されるので、改行を空白にしてから名前を拾う
actual=$(printf '%s\n' "$out" | tr '\n' ' ' | grep -oE 'has a required variable[[:space:]]+"[^"]+"' | sed 's/.*"\([^"]*\)"$/\1/' | sort -u)

if [ "$actual" != "$EXPECTED" ]; then
  echo "失敗: 未指定の必須の変数の集合が期待と違う（- 期待 / + 実際）" >&2
  diff <(printf '%s\n' "$EXPECTED") <(printf '%s\n' "$actual") >&2 || true
  printf '%s\n' "$out" >&2
  exit 1
fi

echo "ok: 変数なしの plan は必須の変数 $(printf '%s\n' "$actual" | grep -c .) 個の未指定で止まる"
