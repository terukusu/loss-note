#!/usr/bin/env bash
# Firebase のエミュレーター（Firestore・Auth・Storage）を手元で起動する。
# - プロジェクト ID は demo- で始まる架空のもの（エミュレーター専用。GCP のプロジェクトもログインも要らない）
# - 正常に止める（Ctrl+C）と data/local/emulator/ に書き出し、次の起動で読み込む。
#   強制終了（kill -9・端末ごと閉じるなど）では書き出さないので、最後に正常に止めた時点に戻る
# - data/local/ は gitignore 済み（コミットしない）で、画面の開発サーバーからも配らない（vite.config.ts の fs.deny）
set -euo pipefail

cd "$(dirname "$0")/.."
dir="data/local/emulator"
args=(emulators:start --project demo-loss-note --only auth,firestore,storage --export-on-exit "$dir")
# 書き出しがあるときだけ読み込む（存在しないディレクトリを --import に渡すと起動に失敗する）
if [ -f "$dir/firebase-export-metadata.json" ]; then
  args+=(--import "$dir")
fi
# exec で置き換えて、Ctrl+C（SIGINT）が firebase に直接届くようにする
exec npx --no-install firebase "${args[@]}"
