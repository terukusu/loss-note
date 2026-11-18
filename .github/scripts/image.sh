#!/usr/bin/env bash
# 本番のイメージ（Dockerfile。Issue #42）のタグと参照を求める。ci.yml と deploy.yml で共用する。
#
#   image.sh loss-note paths    イメージの入力パスを 1 行 1 件で出す
#   image.sh loss-note check-dockerignore
#                               入力パス（Dockerfile・.dockerignore を除く）と .dockerignore の許可リスト（! の行。末尾の / を除く）が
#                               同じ集合なら 0（ci.yml・確認コマンド）。違えば差分を出して 1
#   image.sh loss-note tag      入力パスの git のハッシュと画面のビルドの変数（VITE_FIREBASE_*）からタグ src-<20hex> を出す
#                               （同じ入力・同じ変数なら同じタグ。変数の値はハッシュに混ぜるだけで出さない）
#   image.sh loss-note resolve  tag / image / exists を GITHUB_OUTPUT の形式（key=value）で出す。
#                               Artifact Registry にタグがあれば image は digest 参照・exists=true、
#                               無ければタグ参照・exists=false。権限・API などそれ以外の失敗は exit 1
#
# タグはコミット済みの内容（HEAD）から求める。作業ツリーの未コミットの変更は反映されない。
# resolve は gcloud を使う（CI では google-github-actions/auth の資格情報、手元では所有者の資格情報）。
#
# 環境変数:
#   GCP_PROJECT_ID  GCP プロジェクト ID（resolve で必須。CI は secrets.GCP_PROJECT_ID）
#   GCP_REGION      Artifact Registry のリージョン（既定 asia-northeast1）
#   VITE_FIREBASE_PROJECT_ID・VITE_FIREBASE_API_KEY・VITE_FIREBASE_AUTH_DOMAIN
#                   画面のビルドに渡す Firebase の Web の設定（tag・resolve がハッシュに混ぜる。未設定は空）
set -euo pipefail

usage() {
  echo "usage: $0 loss-note {paths|check-dockerignore|tag|resolve}" >&2
  exit 2
}

# Artifact Registry のリポジトリ（<region>-docker.pkg.dev/<project>/loss-note。infra/bootstrap）。resolve の中でだけ求める
registry_repo() {
  if [ -z "${GCP_PROJECT_ID:-}" ]; then
    echo "環境変数 GCP_PROJECT_ID（GCP プロジェクト ID）が未設定" >&2
    exit 2
  fi
  printf '%s-docker.pkg.dev/%s/loss-note\n' "${GCP_REGION:-asia-northeast1}" "$GCP_PROJECT_ID"
}

IMAGE_NAME="${1:-}"
# イメージの入力。Dockerfile・.dockerignore 自身と、.dockerignore の許可リスト（! の行。末尾の / を除く）。
# 片方だけ直すと ci.yml の「イメージの入力と .dockerignore の一致」が落ちる。並びを変えるとタグが変わる
case "$IMAGE_NAME" in
  loss-note)
    INPUT_PATHS=(
      Dockerfile
      .dockerignore
      package.json
      package-lock.json
      .npmrc
      vite.config.ts
      tsconfig.json
      ui
      core
      api/pyproject.toml
      api/uv.lock
      api/src
      packages/statement-read/pyproject.toml
      packages/statement-read/src
      .github/uv-requirements.txt
    )
    # 画面のビルドの変数（Dockerfile の ARG）。値が変われば別のイメージになる
    BUILD_VARS=(VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN)
    ;;
  *) usage ;;
esac

# gcloud のエラーは認証中のアカウント名やプロジェクト番号を含みうるので、そのまま出さない
MASK='s/[0-9]{9,}/<num>/g; s/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}/<email>/g'

cmd_paths() {
  printf '%s\n' "${INPUT_PATHS[@]}"
}

cmd_check_dockerignore() {
  local root want got
  root=$(git rev-parse --show-toplevel)
  want=$(printf '%s\n' "${INPUT_PATHS[@]}" | grep -vxE 'Dockerfile|\.dockerignore' | sort)
  got=$(sed -nE 's/^!(.*[^/])\/?$/\1/p' "$root/.dockerignore" | sort)
  if [ "$want" != "$got" ]; then
    echo "失敗: image.sh の入力パスと .dockerignore の許可リストが違う（- image.sh / + .dockerignore）" >&2
    diff <(printf '%s\n' "$want") <(printf '%s\n' "$got") >&2 || true
    exit 1
  fi
  echo "ok: イメージの入力 $(printf '%s\n' "$want" | grep -c .) 件と .dockerignore の許可リストが一致"
}

cmd_tag() {
  local root path hash name hashes=""
  root=$(git rev-parse --show-toplevel)
  for path in "${INPUT_PATHS[@]}"; do
    # 入力が HEAD に無ければ失敗させる（タグが入力を表さなくなるため）
    if ! hash=$(git -C "$root" rev-parse --verify --quiet "HEAD:${path}"); then
      echo "HEAD に ${path} が無い" >&2
      exit 1
    fi
    hashes+="${path} ${hash}"$'\n'
  done
  for name in "${BUILD_VARS[@]}"; do
    hashes+="${name}=$(printf '%s' "${!name:-}" | sha256sum | cut -c1-64)"$'\n'
  done
  printf 'src-%s\n' "$(printf '%s' "$hashes" | sha256sum | cut -c1-20)"
}

cmd_resolve() {
  local repo tag ref out rc=0
  repo=$(registry_repo)
  tag=$(cmd_tag)
  ref="${repo}/${IMAGE_NAME}:${tag}"
  out=$(CLOUDSDK_CORE_DISABLE_PROMPTS=1 gcloud artifacts docker images describe "$ref" \
    --format='value(image_summary.digest)' 2>&1) || rc=$?
  if [ "$rc" -eq 0 ] && [[ "$out" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    printf 'tag=%s\nimage=%s\nexists=true\n' "$tag" "${repo}/${IMAGE_NAME}@${out}"
  elif [ "$rc" -ne 0 ] && grep -q 'Image not found' <<<"$out"; then
    printf 'tag=%s\nimage=%s\nexists=false\n' "$tag" "$ref"
  else
    echo "イメージの確認に失敗した（exit $rc）。出力（マスク済み）:" >&2
    sed -E "$MASK" <<<"$out" | tail -n 20 >&2
    exit 1
  fi
}

case "${2:-}" in
  paths) cmd_paths ;;
  check-dockerignore) cmd_check_dockerignore ;;
  tag) cmd_tag ;;
  resolve) cmd_resolve ;;
  *) usage ;;
esac
