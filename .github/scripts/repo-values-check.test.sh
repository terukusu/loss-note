#!/usr/bin/env bash
# repo-values-check.sh の自己テスト（ci.yml の check で検査の前に回す。手元でもそのまま動く）。
# 一時ディレクトリの git リポジトリに 1 ファイル（既定 f.txt）だけ置いて検査を呼び、exit コードと出力を確かめる。
# - 陽性: exit 1、期待の行「NG <検査名>: <位置>」がちょうどある（位置は既定 <ファイル>:1。パスに当たる例は RUN_LOC で指定）
# - 陰性: exit 0
# - どちらも、出力の全行が決まった形（NG の位置の行・件数の行・skip の行・ok の行）だけで、置いた文字列・渡した値が無い。
#   行の形で見るので、検査が一致した部分（ホスト名・メール・トークンの本体）だけを出すように崩れても落ちる
# このファイル自身も検査の対象（追跡される）なので、陽性の文字列は連結で組み立てる。値はすべて架空。
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
check="$here/repo-values-check.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fails=0
n=0
LAST_OUT=""
VARS=(REPO_OWNER GCP_PROJECT_ID GCP_PROJECT_NUMBER TF_STATE_BUCKET FIREBASE_AUTH_DOMAIN)

# 出力 $2 のうち決まった形でない行を出す。$1 = 置いたファイルの名前（NG の位置はこのファイルの 1 行目か #1 だけ）
bad_lines() {
  printf '%s\n' "$2" | RV_FILE="$1" awk '
    $0 == "" { next }
    /^NG [A-Za-z0-9_-]+(（パス）)?: / {
      loc = $0
      sub(/^NG [A-Za-z0-9_-]+(（パス）)?: /, "", loc)
      if (loc == ENVIRON["RV_FILE"] ":1" || loc == "#1" || loc == "#1:1") next
      print
      next
    }
    /^NG: [0-9]+ 件（CLAUDE\.md「置かないもの」。値はプレースホルダ・変数にする）$/ { next }
    /^skip: (REPO_OWNER|GCP_PROJECT_ID|GCP_PROJECT_NUMBER|TF_STATE_BUCKET|FIREBASE_AUTH_DOMAIN) が空なので値の検査を飛ばす$/ { next }
    /^ok: [0-9]+ ファイル（個人の値の形・値 0 件）$/ { next }
    /^ok: 追跡ファイルなし$/ { next }
    { print }
  '
}

fail() {
  echo "FAIL $1"
  fails=$((fails + 1))
}

# run <期待の exit> <期待の検査名（陰性は ->）> <名前> <中身> [VAR=値 ...]: 値の環境変数は指定したもの以外を空にする。
# 置くファイルの名前は RUN_FILE（既定 f.txt）、期待の位置は RUN_LOC（既定 <ファイル>:1）
run() {
  local want=$1 kind=$2 label=$3 content=$4 file=${RUN_FILE:-f.txt}
  local loc=${RUN_LOC:-$file:1}
  shift 4
  local dir="$tmp/r$n" out rc=0 v
  local -a clear=()
  n=$((n + 1))
  for v in "${VARS[@]}"; do clear+=("$v="); done
  mkdir -p "$dir"
  git -C "$dir" init -q
  mkdir -p "$(dirname "$dir/$file")"
  printf '%s\n' "$content" > "$dir/$file"
  git -C "$dir" add -- "$file"
  out=$(env "${clear[@]}" "$@" "$check" "$dir" 2>&1) || rc=$?
  local why=""
  if [ "$rc" -ne "$want" ]; then why="exit $rc（期待 $want）"; fi
  if [ "$want" -ne 0 ] && ! printf '%s\n' "$out" | grep -qxF -e "NG ${kind}: ${loc}"; then
    why="$why 出力に「NG ${kind}: ${loc}」の行が無い"
  fi
  if [ -n "$(bad_lines "$file" "$out")" ]; then why="$why 決まった形でない行がある"; fi
  if printf '%s' "$out" | grep -qF -e "$content"; then why="$why 出力に置いた文字列がある"; fi
  for v in "$@"; do
    if [ -n "${v#*=}" ] && printf '%s' "$out" | grep -qiF -e "${v#*=}"; then why="$why 出力に変数の値がある"; fi
  done
  if [ -n "$why" ]; then
    fail "${label}:${why}"
  else
    echo "ok   ${label}"
  fi
  LAST_OUT=$out
}

# 陽性（架空の値。連結で組み立てる）
run 1 run-app-host 'Cloud Run の URL（-<ハッシュ>-<略号>.a.run.app）' "url https://loss-note-abc123xyz""-an.a.run""."app/
run 1 run-app-host 'Cloud Run の URL（<名前>-<番号>.<リージョン>.run.app）' "loss-note-123456789012"".asia-northeast1.run""."app
run 1 run-app-host 'Cloud Run の URL（大文字）' "https://LOSS-NOTE-ABC123XYZ""-AN.A.RUN"".APP/"
run 1 run-app-host 'Cloud Run の URL（HTML のタグの直後）' "<code>loss-note-abc123xyz""-an.a.run"".app</code>"
run 1 firebase-host 'Firebase の認証のドメイン' "authDomain: fake-proj""-123456.firebase""app.com"
run 1 firebase-host 'Firebase Hosting のホスト名' "https://fake-proj""-123456.web"".app/"
run 1 google-doc-id 'スプレッドシートの URL' "https://docs.google.com/spread""sheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit"
run 1 google-doc-id 'スプレッドシートの URL（/u/0/）' "https://docs.google.com/spread""sheets/u/0/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit"
run 1 google-doc-id 'ドライブのファイルの URL' "https://drive.google.com/file""/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/view"
run 1 google-doc-id 'ドライブの ?id= の URL' "https://drive.google.com/open""?id=1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"
run 1 google-doc-id 'フォームの URL' "https://docs.google.com/forms""/d/e/1FAIpQLSdAbCdEfGhIjKlMnOpQrStUvWxYz/viewform"
run 1 email 'gmail のメール' "contact some""one@gm""ail.com"
run 1 email 'GitHub の noreply（利用者名を含む）' "Author: 12345+fakeowner""@users.noreply.github.com"
run 1 email '個人のドメインの noreply' "From: noreply""@fake-owner-domain.com"
run 1 email '実在の形のプロジェクトの SA' "sa@fake-proj""-123456.iam.gserviceaccount.com"
run 1 home-path 'ホームのパス' "path /ho""me/alice/x"
run 1 home-path 'macOS のホームのパス' "/Use""rs/alice/x"
run 1 project-number 'projects/<12 桁>' "projects/""123456789012/locations"
run 1 project-number 'service-<12 桁>@' "service-""123456789012@gcp-sa-firestore.iam.gserviceaccount.com"
run 1 project-number '<12 桁>-compute@' "123456789012-compute""@developer.gserviceaccount.com"
run 1 token 'ya29. のトークン' "token ya""29.a0Abcdef"
run 1 token 'OAuth クライアントのシークレット' "GOCSP""X-abcdef"
run 1 token '秘密鍵' "-----BEGIN ""PRIVATE KEY-----"
run 1 token 'SA 鍵の private_key_id' "\"private_key""_id\": \"x\""
run 1 token '署名付き URL' "https://storage.googleapis.com/b/o?X-Goog-""Signature=abc"
run 1 token 'Anthropic の API キーの形' "ANTHROPIC_API_KEY=sk-""ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-x"
run 1 token 'Google の API キーの形' "VITE_FIREBASE_API_KEY=AI""zaSyAbCdEfGhIjKlMnOpQrStUvWxYz0123456"
run 1 token 'GitHub のトークンの形' "GH_TOKEN=gh""p_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"
run 1 value-GCP_PROJECT_ID 'プロジェクト ID の値' "project = fake-proj""-123456" GCP_PROJECT_ID=fake-proj-123456
run 1 value-GCP_PROJECT_ID 'プロジェクト ID の値（大小無視）' "FAKE-PROJ""-123456" GCP_PROJECT_ID=fake-proj-123456
run 1 value-GCP_PROJECT_NUMBER 'プロジェクト番号の値（文脈なし）' "number 98765""4321" GCP_PROJECT_NUMBER=987654321
run 1 value-TF_STATE_BUCKET 'state のバケット名の値' "bucket = \"fake-bucket""-tfstate\"" TF_STATE_BUCKET=fake-bucket-tfstate
run 1 value-FIREBASE_AUTH_DOMAIN '認証のドメインの値（独自ドメイン）' "auth.fake""-domain.test" FIREBASE_AUTH_DOMAIN=auth.fake-domain.test
run 1 value-REPO_OWNER 'オーナー名の値（<owner>/<repo>）' "see fake""owner/loss-note" REPO_OWNER=fakeowner
RUN_FILE=LICENSE run 1 value-REPO_OWNER 'LICENSE でも著作権表示の行でなければ NG' "maintained by fake""owner" REPO_OWNER=fakeowner
RUN_FILE=LICENSE run 1 value-REPO_OWNER 'LICENSE の著作権表示に続きがあれば NG' "Copyright (c) 2026 fake""owner and fake""owner/loss-note" REPO_OWNER=fakeowner
RUN_FILE=README.md run 1 value-REPO_OWNER 'LICENSE 以外の著作権表示は NG' "Copyright (c) 2026 fake""owner" REPO_OWNER=fakeowner

# 陽性（ファイルのパスにある値・形。出力はパスを出さず #<番号> にする）
RUN_FILE="docs/fake-proj""-123456.md" RUN_LOC='#1' run 1 'value-GCP_PROJECT_ID（パス）' 'ファイルの名前にプロジェクト ID' 'nothing here' GCP_PROJECT_ID=fake-proj-123456
RUN_FILE="data/fake""owner/notes.txt" RUN_LOC='#1' run 1 'value-REPO_OWNER（パス）' 'ディレクトリの名前にオーナー名' 'nothing here' REPO_OWNER=fakeowner
RUN_FILE="some""one@gm""ail.com.txt" RUN_LOC='#1' run 1 'email（パス）' 'ファイルの名前にメール' 'nothing here'
# パスにも中身にも値があるファイルは、中身の位置も #<番号>:<行番号> にする（パスを出さない）
RUN_FILE="fake-proj""-123456.txt" RUN_LOC='#1:1' run 1 value-GCP_PROJECT_ID 'パスと中身の両方にプロジェクト ID' "id fake-proj""-123456" GCP_PROJECT_ID=fake-proj-123456

# 陰性（プレースホルダ・架空の値の約束の形）
run 0 - 'example.com のメール' 'someone@example.com'
run 0 - '予約の TLD（.example・.test）のメール' 'a@example.com.evil.example b@x.test'
run 0 - 'noreply のメール（Anthropic・GitHub）' 'Co-Authored-By: Claude <noreply@anthropic.com> / noreply@github.com'
run 0 - 'demo- の SA と gcp-sa' 'sa@demo-loss-note.iam.gserviceaccount.com service-123456@gcp-sa-iap.iam.gserviceaccount.com'
run 0 - 'demo- の Firebase のドメイン' 'authDomain: demo-loss-note.firebaseapp.com'
run 0 - '<PROJECT_ID> と <OWNER>/<REPO>' 'gcloud config set project <PROJECT_ID> && gh repo view <OWNER>/<REPO>'
# shellcheck disable=SC2016 # 変数の参照はそのままの文字列として置く
run 0 - '変数の参照の SA' 'sa-run@${var.project_id}.iam.gserviceaccount.com sa@$P.iam.gserviceaccount.com'
run 0 - '<SHEET_ID>' 'https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit https://docs.google.com/spreadsheets/u/0/d/<SHEET_ID>/edit'
run 0 - '/home/<名前>/' 'ls /home/<名前>/'
run 0 - '<SERVICE>-<HASH>-an.a.run.app と *.run.app・*.a.run.app' 'https://<SERVICE>-<HASH>-an.a.run.app/ *.run.app *.a.run.app'
run 0 - 'projects/<6 桁>' 'projects/123456/locations'
# 接頭辞そのものは secret-check.sh が追跡中のファイルで 0 件を求めるので、ここでも連結で組み立てる
run 0 - 'Anthropic のキーの接頭辞だけ（説明文）' "キーは sk-""ant- で始まる（sk-""ant-api03-... / sk-""ant-oat01-...）"
run 0 - '語単位（値の続きが英数字）' 'fake-proj-1234567' GCP_PROJECT_ID=fake-proj-123456
RUN_FILE=LICENSE run 0 - 'LICENSE の著作権表示の行だけは例外' "Copyright (c) 2026 fake""owner" REPO_OWNER=fakeowner
RUN_FILE=LICENSE run 0 - 'LICENSE の著作権表示（年の範囲・大小無視）' "Copyright (c) 2026-2027 Fake""Owner" REPO_OWNER=fakeowner
run 0 - '変数が空なら形の検査だけ' 'nothing here'
if [ "$(printf '%s\n' "$LAST_OUT" | grep -c '^skip: ')" -ne "${#VARS[@]}" ]; then
  fail "変数が空のときの skip: が ${#VARS[@]} 行でない"
fi

# 生成物の lock ファイルは見ない（中身は依存の解決の結果で、手で書かない）
RUN_FILE=package-lock.json run 0 - 'package-lock.json は対象外' "\"resolved\": \"x\", \"a\": \"some""one@gm""ail.com\""

# git の作業ツリーでないディレクトリは黙って通さない（exit 2）
mkdir -p "$tmp/not-git"
rc=0
out=$(env GIT_CEILING_DIRECTORIES="$tmp" "$check" "$tmp/not-git" 2>&1) || rc=$?
if [ "$rc" -ne 2 ] || [ "$out" != "NG: git の作業ツリーではないので検査できない" ]; then
  fail "git でないディレクトリ: exit $rc（期待 2）"
else
  echo "ok   git でないディレクトリは exit 2"
fi

# このファイル自身を含む今のリポジトリ（変数は空）
rc=0
env REPO_OWNER= GCP_PROJECT_ID= GCP_PROJECT_NUMBER= TF_STATE_BUCKET= FIREBASE_AUTH_DOMAIN= "$check" "$here/../.." > /dev/null || rc=$?
if [ "$rc" -ne 0 ]; then
  fail "今のリポジトリで exit $rc"
else
  echo "ok   今のリポジトリ"
fi

if [ "$fails" -gt 0 ]; then
  echo "NG: ${fails} 件"
  exit 1
fi
echo "ok: すべて"
