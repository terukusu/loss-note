#!/usr/bin/env bash
# ビルド成果物の index.html の CSP 検査（インライン script・style 要素・style 属性・イベントハンドラの属性・外部 URL を拒否。
# 大文字小文字を区別しない。docs/design.md 10.1）と、
# 鍵の形（Anthropic の [s]k-ant-<種別>-<本体>）が index.html と隣の assets/ に無いことの検査。
# 確認コマンドと ci.yml の check で dist/index.html に使う。自己テストは csp-check.test.sh
#
#   csp-check.sh <index.html>
set -euo pipefail

f="${1:?usage: $0 <index.html>}"
test -s "$f" || { echo "ファイルが無いか空: $f"; exit 1; }
# 大文字小文字を区別しない。タグが複数行にまたがっても見られるように、改行を空白にした 1 行で調べる
flat="$(tr '\n\r' '  ' < "$f")"
# <script のタグの中（> まで）に src= が無いもの（インライン）。本文や data-src の src= では外部と見なさない
if printf '%s' "$flat" | grep -oiE '<script([[:space:]][^>]*)?>' | grep -viE '[[:space:]]src[[:space:]]*='; then
  echo "インライン script がある: $f"; exit 1
fi
if printf '%s' "$flat" | grep -qiE '<style([[:space:]>/]|$)'; then echo "style 要素がある: $f"; exit 1; fi
if printf '%s' "$flat" | grep -qiE '[[:space:]]style[[:space:]]*='; then echo "style 属性がある: $f"; exit 1; fi
# イベントハンドラの属性（onerror= など。インライン script と同じく CSP で止まる）
if printf '%s' "$flat" | grep -qiE '[[:space:]]on[a-z]+[[:space:]]*='; then echo "イベントハンドラの属性がある: $f"; exit 1; fi
# 外部 URL（http(s):// と、属性の値・url() がプロトコル相対の //...）
if printf '%s' "$flat" | grep -qiE 'https?://|=[[:space:]]*["'"'"']?//|url\([[:space:]]*["'"'"']?//'; then echo "外部 URL がある: $f"; exit 1; fi
# [s] はこのファイル自身に一致させないための書き方
key='[s]k-ant-[a-z]+[0-9]*-[A-Za-z0-9_-]{20,}'
targets=("$f")
assets="$(dirname "$f")/assets"
if [ -d "$assets" ]; then targets+=("$assets"); fi
if grep -rlsIE -e "$key" -- "${targets[@]}"; then echo "鍵の形がある: ${targets[*]}"; exit 1; fi
echo "ok: $f"
