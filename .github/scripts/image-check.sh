#!/usr/bin/env bash
# 本番のイメージ（Dockerfile。Issue #42 の AC-4・R6）の中身と起動の検査。GCP の資格情報は使わない（Firestore・AI に触れない。
# /api は health と、トークンなしの 401 だけを見る）。ci.yml の check と deploy.yml の apply job（push の前）で共用する。
#
#   image-check.sh <ローカルのイメージ名>   例: loss-note:ci
set -euo pipefail

img="${1:?usage: $0 <image>}"
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
cid=""
cleanup() {
  if [ -n "$cid" ]; then docker rm -f "$cid" > /dev/null 2>&1 || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

fail() { echo "NG: $*" >&2; exit 1; }

# 1. gunicorn と同じ create_app() を作れること（本番の形: STATIC_DIR はイメージの値・プロジェクト ID は架空・エミュレーターの接続先なし
#    = verify。Firestore のクライアントとトークンの検証は遅延生成なので、資格情報なしで作れる）
docker run --rm -e GOOGLE_CLOUD_PROJECT=example-project "$img" python -c '
from loss_note_api.app import create_app
from loss_note_api.runtime import decide_runtime
import os
assert decide_runtime(os.environ).mode == "verify"
assert create_app().name
assert os.environ["STATIC_DIR"] == "/app/static"' || fail "loss_note_api.app の create_app() を本番の形で作れない"
echo "ok: import（create_app・verify・STATIC_DIR=/app/static）"
# gunicorn がある（CMD の入口）
docker run --rm --entrypoint gunicorn "$img" --version > /dev/null || fail "gunicorn が無い"
echo "ok: gunicorn"
# 起動の設定（CMD）のワーカーのタイムアウトが 30 秒（画面の待ち）より長い（#44 の AC-11。読み取りの締め切り 20 秒 + 後始末 約 5 秒）
cmd=$(docker inspect --format '{{json .Config.Cmd}}' "$img")
worker_timeout=$(printf '%s\n' "$cmd" | grep -oE -- '--timeout[ =][0-9]+' | grep -oE '[0-9]+$' || true)
[ -n "$worker_timeout" ] || fail "CMD に gunicorn の --timeout が無い"
[ "$worker_timeout" -gt 30 ] || fail "gunicorn の --timeout が 30 秒以下: ${worker_timeout}"
echo "ok: gunicorn の --timeout ${worker_timeout} 秒（30 秒より長い）"

# 2. 明細の読み取りの送り口（claude-agent-sdk。依存グループ ai。#44）: import でき、同梱の CLI が非 root・ネットワークなしで
#    --version に答え、その版が SDK の同梱の版と同じこと（Anthropic には触れない）
want=$(docker run --rm "$img" python -c 'from claude_agent_sdk._cli_version import __cli_version__; print(__cli_version__)') \
  || fail "claude_agent_sdk を import できない"
got=$(docker run --rm --network none -e CLAUDE_CONFIG_DIR=/tmp/claude-version-check --entrypoint sh "$img" -c \
  'exec "$(python -c "import claude_agent_sdk, os; print(os.path.join(os.path.dirname(claude_agent_sdk.__file__), \"_bundled\", \"claude\"))")" --version')
case "$got" in
  "$want"*) ;;
  *) fail "同梱の CLI の --version が ${want} でない: ${got}" ;;
esac
echo "ok: claude_agent_sdk・同梱の CLI ${want}（非 root・ネットワークなし）"

# 3. 非 root で動くこと
uid=$(docker run --rm --entrypoint id "$img" -u)
[ "$uid" != 0 ] || fail "root（uid 0）で動く"
echo "ok: uid ${uid}"

# 4. 入れてはいけないものが無いこと。.git・node_modules・.claude・Terraform の変数 / state / plan・.env・エミュレーターの書き出しは
#    イメージ全体、テスト・fixture・手元のデータ（data）・infra はアプリの置き場（/app・loss_note_api・statement_read）で探す
found=$(docker run --rm --entrypoint sh "$img" -c '
  find / -xdev \( -name .git -o -name node_modules -o -name .claude -o -name "*.tfvars" -o -name "*.tfstate" \
    -o -name "*.tfstate.*" -o -name "*.tfplan" -o -name .env -o -name ".env.*" -o -name "firebase-export-*" \
    -o -name "*-debug.log" \) -print 2>/dev/null
  pkgs=$(python -c "import os, loss_note_api, statement_read; print(os.path.dirname(loss_note_api.__file__)); print(os.path.dirname(statement_read.__file__))")
  find /app $pkgs \( -name tests -o -name fixtures -o -name data -o -name infra -o -name local -o -name "*.test.*" \
    -o -name "conftest.py" \) -print 2>/dev/null
  true')
[ -z "$found" ] || fail "イメージに入れてはいけないものがある: $(printf '%s\n' "$found" | wc -l) 件"$'\n'"$found"
# /app は同梱の dist（static）だけ。static は index.html と assets/ だけ
top=$(docker run --rm --entrypoint ls "$img" -A /app | tr '\n' ' ')
[ "$top" = "static " ] || fail "/app に static 以外がある: ${top}"
static_ls=$(docker run --rm --entrypoint ls "$img" -A /app/static | tr '\n' ' ')
[ "$static_ls" = "assets index.html " ] || fail "/app/static に index.html・assets 以外がある: ${static_ls}"
echo "ok: 除外物 0 件・/app/static は index.html と assets/ だけ"

# 5. 同梱の index.html と assets/ が ci.yml と同じ CSP の検査（と鍵の形の検査）を通ること。開発の時だけの値・部品の見本が無いこと（KEEP-4）
cid=$(docker create "$img")
docker cp "$cid:/app/static" "$work/static" > /dev/null
docker rm "$cid" > /dev/null
cid=""
"$here/csp-check.sh" "$work/static/index.html"
if grep -rlsF -e '127.0.0.1:9099' -e 'demo-loss-note' -e 'demo-api-key' -e '部品の見本' -- "$work/static"; then
  fail "同梱の画面に開発の時だけの値・部品の見本がある"
fi
echo "ok: 開発の時だけの値・部品の見本なし"

# 6. 起動して振り分け（例 S）とヘッダ（例 H）を状態コードで見る（GCP の資格情報なし。Firestore には触れない）
cid=$(docker run -d -p 127.0.0.1::8080 -e GOOGLE_CLOUD_PROJECT=example-project "$img")
port=$(docker port "$cid" 8080/tcp | head -n 1 | sed 's/.*://')
base="http://127.0.0.1:${port}"
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "$base/api/health" 2> /dev/null; then break; fi
  sleep 1
done

check() {  # パス 期待の状態 名前（ヘッダは $work/<名前>.h、本文は $work/<名前>.body）
  local code
  code=$(curl -sS -o "$work/$3.body" -D "$work/$3.h" -w '%{http_code}' "$base$1") || fail "$1 に接続できない"
  [ "$code" = "$2" ] || { docker logs "$cid" 2>&1 | tail -n 20 >&2; fail "$1 が ${code}（期待 $2）"; }
  local csp
  csp=$(grep -i '^content-security-policy:' "$work/$3.h" | sed 's/^[^:]*:[[:space:]]*//' | tr -d '\r' | tr ';' '\n' | sed 's/^ *//; s/ *$//')
  local n
  n=$(printf '%s\n' "$csp" | grep -cxE "default-src 'none'|script-src 'self'|style-src 'self'|img-src 'self'|connect-src 'self'|base-uri 'none'|form-action 'none'|frame-ancestors 'none'" || true)
  [ "$n" = 8 ] || fail "$1 の CSP に R3 の 8 つの指示が揃っていない（${n} 個）"
  grep -qixE 'x-content-type-options: nosniff' <(tr -d '\r' < "$work/$3.h") || fail "$1 に nosniff が無い"
  grep -qixE 'referrer-policy: no-referrer' <(tr -d '\r' < "$work/$3.h") || fail "$1 に no-referrer が無い"
  echo "ok: $1 ${code}（CSP・nosniff・no-referrer）"
}
header() {  # 名前 ヘッダ名 → 値
  grep -i "^$2:" "$work/$1.h" | head -n 1 | sed 's/^[^:]*:[[:space:]]*//' | tr -d '\r'
}

check /api/health 200 health
grep -q '"status":"ok"' "$work/health.body" || fail "/api/health の本文が {\"status\":\"ok\"} でない"
check / 200 index
cmp -s "$work/index.body" "$work/static/index.html" || fail "/ が同梱の index.html と違う"
[ "$(header index cache-control)" = "no-cache" ] || fail "/ の Cache-Control が no-cache でない"
check /trades/abc123 200 trade
cmp -s "$work/trade.body" "$work/static/index.html" || fail "/trades/abc123 が同梱の index.html でない"
asset=$(grep -oE '/assets/[A-Za-z0-9._-]+\.js' "$work/static/index.html" | head -n 1)
[ -n "$asset" ] || fail "index.html に /assets/*.js が無い"
check "$asset" 200 asset
case "$(header asset cache-control)" in
  *immutable*) ;;
  *) fail "${asset} の Cache-Control に immutable が無い" ;;
esac
case "$(header asset content-type)" in
  text/javascript* | application/javascript*) ;;
  *) fail "${asset} の Content-Type が JS でない" ;;
esac
check /assets/missing-0000.js 404 missing
cmp -s "$work/missing.body" "$work/static/index.html" && fail "/assets/missing-0000.js が index.html を返す"
check /api/nope 404 nope
grep -q '"error":"not_found"' "$work/nope.body" || fail "/api/nope が API の 404 の JSON でない"
check /api/trades 401 trades
echo "loss-note のイメージの検査: OK"
