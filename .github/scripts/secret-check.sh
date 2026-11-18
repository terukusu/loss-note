#!/usr/bin/env bash
# 明細の読み取りの本番の資格情報（Issue #44 の AC-12・AC-15・R5）がリポジトリに入っていないことを確かめる。
# - infra/ に Secret Manager の版（google_secret_manager_secret_version）のリソースも data source も無い
#   （版を宣言すると値が Terraform の state・plan に入る。値はオーナーが gcloud で標準入力から入れる）
# - 追跡中のすべてのファイルに Anthropic の API キーの接頭辞が無い（このスクリプト自身が当たらないように、接頭辞は 2 つに
#   分けて組み立てる）
# 件数だけを出す（一致した行は出さない）。ci.yml の check と CLAUDE.md の確認コマンドで使う。
set -euo pipefail

cd "$(dirname "$0")/../.."

fail=0

versions=$({ git grep -c -E '"google_secret_manager_secret_version"' -- infra || true; } | awk -F: '{ n += $NF } END { print n + 0 }')
if [ "$versions" -ne 0 ]; then
  echo "失敗: infra/ に Secret Manager の版のリソース・data source が ${versions} 件ある（値を Terraform に入れない）" >&2
  fail=1
fi

prefix="sk-"
prefix="${prefix}ant-"
keys=$({ git grep -c -F -e "$prefix" || true; } | awk -F: '{ n += $NF } END { print n + 0 }')
if [ "$keys" -ne 0 ]; then
  echo "失敗: 追跡中のファイルに Anthropic の API キーの接頭辞が ${keys} 件ある" >&2
  fail=1
fi

[ "$fail" -eq 0 ] || exit 1
echo "ok: Secret Manager の版の宣言 0 件・API キーの接頭辞 0 件（追跡中のファイル）"
