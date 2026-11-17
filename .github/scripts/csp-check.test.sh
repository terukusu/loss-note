#!/usr/bin/env bash
# csp-check.sh の自己テスト。一時ディレクトリに合成の index.html を作り、拒否すべき形で失敗し、
# きれいな HTML で成功することを確かめる（値はすべて架空）
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
check="$here/csp-check.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

clean='<!doctype html><html><head><script type="module" src="/assets/a.js"></script></head><body><div id="app"></div></body></html>'
fail=0

# 名前 HTML（assets/ に置く中身があれば 3 つ目）
expect_reject() {
  local name="$1" html="$2" asset="${3:-}"
  local d="$work/$name"
  mkdir -p "$d/assets"
  printf '%s\n' "$html" > "$d/index.html"
  if [ -n "$asset" ]; then printf '%s\n' "$asset" > "$d/assets/a.js"; fi
  if "$check" "$d/index.html" >/dev/null 2>&1; then
    echo "NG: $name を拒否しなかった"
    fail=1
  else
    echo "ok: $name を拒否した"
  fi
}

expect_reject inline-script '<!doctype html><html><body><script>alert(1)</script></body></html>'
expect_reject style-element '<!doctype html><html><head><style>body{color:red}</style></head></html>'
expect_reject style-attr '<!doctype html><html><body><div style="color:red"></div></body></html>'
expect_reject external-url '<!doctype html><html><head><script type="module" src="https://example.com/a.js"></script></head></html>'
# 取りこぼしやすい形（レビューの指摘 N1）
expect_reject inline-script-src-in-body '<!doctype html><html><body><script>var src=1;alert(1)</script></body></html>'
expect_reject inline-script-data-src '<!doctype html><html><body><script data-src="/a.js">alert(1)</script></body></html>'
expect_reject inline-script-upper '<!doctype html><html><body><SCRIPT>alert(1)</SCRIPT></body></html>'
expect_reject inline-script-multiline $'<!doctype html><html><body><script\n  type="module">alert(1)</script></body></html>'
expect_reject style-element-upper '<!doctype html><html><head><STYLE>body{color:red}</STYLE></head></html>'
expect_reject style-attr-upper '<!doctype html><html><body><div STYLE="color:red"></div></body></html>'
expect_reject protocol-relative-url '<!doctype html><html><head><script type="module" src="//evil.example/a.js"></script></head></html>'
expect_reject event-handler '<!doctype html><html><body><img src="/a.png" onerror="alert(1)"></body></html>'
expect_reject event-handler-upper '<!doctype html><html><body><body ONLOAD="alert(1)"></body></html>'
# 鍵の形は架空の本体を組み立てて作る（このファイルに鍵の形の文字列を直接書かない）
fake_key="s""k-ant-api03-$(printf 'x%.0s' $(seq 1 24))"
expect_reject key-in-assets "$clean" "const k = '$fake_key';"

d="$work/clean"
mkdir -p "$d/assets"
printf '%s\n' "$clean" > "$d/index.html"
printf '%s\n' "console.log(1);" > "$d/assets/a.js"
if "$check" "$d/index.html" >/dev/null 2>&1; then
  echo "ok: clean を受け入れた"
else
  echo "NG: clean を拒否した"
  fail=1
fi

# 引数のファイルが無いときも失敗する
if "$check" "$work/none/index.html" >/dev/null 2>&1; then
  echo "NG: 無いファイルを受け入れた"
  fail=1
else
  echo "ok: 無いファイルを拒否した"
fi

exit "$fail"
