#!/usr/bin/env bash
# 追跡中のファイルに個人の値（CLAUDE.md「リポジトリに置くもの / 置かないもの」）が無いかの検査（#80）。
# ci.yml の check（依存を入れる前の段）と CLAUDE.md の確認コマンドで使う。手元でもそのまま動く（bash 3.2 以上。macOS の既定の bash でも動く）。
#
#   repo-values-check.sh [dir]
#
# - 形の検査（値を知らなくても効く）: Cloud Run の URL（*.run.app のホスト名。大小無視）、Firebase のホスト名（*.firebaseapp.com・
#   *.web.app。架空のプロジェクト demo-* を除く）、Google のドキュメント・ドライブの URL の ID（/u/0/ の形・?id= の形も）、
#   許可の表に無いメールアドレス、/home/<名前>・/Users/<名前>、プロジェクト番号の形（projects/<10 桁以上>・service-<10 桁以上>・
#   <10 桁以上>-compute@）、トークン・鍵・署名の形
# - 値の検査: 環境変数 REPO_OWNER・GCP_PROJECT_ID・GCP_PROJECT_NUMBER・TF_STATE_BUCKET・FIREBASE_AUTH_DOMAIN のうち空でないものを
#   固定文字列（大小無視・語単位）で探す。空なら飛ばしたことを 1 行出す（CI は secrets と github.repository_owner から渡す。
#   fork の PR では secrets が空なので形の検査とオーナー名だけになる）。REPO_OWNER の例外は LICENSE の著作権表示の行
#   `Copyright (c) <年>[-<年>] <REPO_OWNER>` ちょうどだけ（MIT の著作権者。ほかのファイル・行は NG のまま）
# - 中身とファイルのパスの両方を見る。パスに当たったファイルは、出力でパスを出さず「#<追跡ファイルの何番目か>」にする
# - 出力の行は次の形だけ（一致した文字列・行の中身・変数の値は出さない。自己テストが行の形を検査する）:
#     NG <検査名>: <ファイル>:<行番号> / NG <検査名>: #<番号>:<行番号> / NG <検査名>（パス）: #<番号> /
#     skip: <変数名> が空なので値の検査を飛ばす / NG: <件数> 件（…）/ ok: …
#   1 件以上で exit 1。git の作業ツリーでない・git ls-files が失敗したら exit 2（黙って通さない）
# - 対象は git ls-files（生成物の lock ファイル package-lock.json・uv.lock・.terraform.lock.hcl を除く。バイナリは grep -I で飛ばす）
# - 誤検出の許可は下の許可の表（メールのドメイン・noreply の送り元、Firebase・Cloud Run のホスト名のプレースホルダ）だけで行う。
#   行ごとの印は置かない（印で黙らせられると、本物の漏れも印 1 つで通ってしまうため）。架空の値は example.com・demo-*・<PROJECT_ID>
#   などの形で書く
set -euo pipefail

cd "${1:-.}"
if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  echo "NG: git の作業ツリーではないので検査できない"
  exit 2
fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# 普通の文で流す（失敗は set -e で exit 2 に。プロセス置換だと git の失敗が伝わらない）
git ls-files -z > "$tmp/all" || {
  echo "NG: git ls-files が失敗したので検査できない"
  exit 2
}
# mapfile -d は bash 4.4 以上なので使わない（read -d '' は bash 3.2 でも動く）
files=()
while IFS= read -r -d '' f; do
  if [[ ! "$f" =~ (^|/)(package-lock\.json|uv\.lock|\.terraform\.lock\.hcl)$ ]]; then files+=("$f"); fi
done < "$tmp/all"
if [ "${#files[@]}" -eq 0 ]; then
  echo "ok: 追跡ファイルなし"
  exit 0
fi
# パスの一覧（1 行 1 ファイル。行番号 = files の何番目か + 1）
printf '%s\n' "${files[@]}" > "$tmp/paths"

hits=0
masked=" " # パスに当たったファイルの番号（「 <番号> 」の並び）
mode=path  # path: パスの一覧を見る / content: 中身を見る

# 標準入力の位置（content: <ファイル>:<行番号> / path: <番号>）を出して数える。grep の出力の中身は cut で落とす。
# grep には必ず -H を付ける（1 ファイルだと -n の出力が <行番号>:<中身> になり、中身が出てしまう）。パスの一覧は 1 ファイルなので
# -H を付けず、先頭の行番号だけを取る。呼び出しはプロセス置換で（パイプだとサブシェルになり hits が増えない）
report() {
  local name=$1 loc file line i
  if [ "$mode" = path ]; then
    while IFS= read -r loc; do
      echo "NG ${name}（パス）: #${loc}"
      masked="${masked}${loc} "
      hits=$((hits + 1))
    done < <(cut -d: -f1 | sort -un)
  else
    while IFS= read -r loc; do
      file=${loc%:*}
      line=${loc##*:}
      if [ "$masked" != " " ]; then
        i=0
        for f in "${files[@]}"; do
          i=$((i + 1))
          if [ "$f" = "$file" ]; then break; fi
        done
        case "$masked" in *" $i "*) file="#$i" ;; esac
      fi
      echo "NG ${name}: ${file}:${line}"
      hits=$((hits + 1))
    done < <(cut -d: -f1,2 | sort -u)
  fi
}
# grep の対象（mode で切り替え）。$@ = grep の引数
search() {
  if [ "$mode" = path ]; then
    grep -nsI "$@" -- "$tmp/paths" || true
  else
    grep -HnsI "$@" -- "${files[@]}" || true
  fi
}
shape() { report "$1" < <(search -E -e "$2"); }
# 一致した文字列（grep -o。大小無視）を awk の条件 ENVIRON["REPO_VALUES_ALLOW"]（小文字で比べる）で絞り、位置だけを残す。
# awk には ENVIRON で渡す（-v だと \. が崩れる）
filtered() {
  local name=$1 pattern=$2 allow=$3
  report "$name" < <(search -oiE -e "$pattern" | REPO_VALUES_ALLOW="$allow" REPO_VALUES_MODE="$mode" awk -F: '{
    m = tolower($NF)
    if (m ~ ENVIRON["REPO_VALUES_ALLOW"]) next
    if (ENVIRON["REPO_VALUES_MODE"] == "path") print $1; else print $1 ":" $2
  }')
}

checks() {
  # Cloud Run のホスト名（*.run.app）。一致がホスト名にならない「-」始まり（<SERVICE>-<HASH>-an.a.run.app の -an.a.run.app）と、
  # 共通のドメイン a.run.app（*.a.run.app）だけを許す
  filtered run-app-host '[a-z0-9_-]+(\.[a-z0-9_-]+)*\.run\.app' '^(-|a\.run\.app$)'
  # Firebase のホスト名（認証のドメイン・Hosting）。エミュレーターの架空のプロジェクト demo-* と example だけを許す
  filtered firebase-host '[a-z0-9][a-z0-9-]*\.(firebaseapp\.com|web\.app)' '^(demo-[a-z0-9-]+|example[a-z0-9-]*)\.'
  # Google のドキュメント・スプレッドシート・フォーム・ドライブの ID（/u/0/ の形・?id= の形も。<SHEET_ID> の形は当たらない）
  shape google-doc-id '(docs|drive|sheets)\.google\.com(/[A-Za-z0-9_.-]+)*/d/(e/)?[A-Za-z0-9_-]{20,}|(docs|drive)\.google\.com/[A-Za-z0-9_./-]*\?([^ ]*&)?id=[A-Za-z0-9_-]{20,}'
  shape home-path '/(home|Users)/[A-Za-z0-9._-]+'
  shape project-number '(projects/|service-)[0-9]{10,}|[0-9]{10,}-compute@'
  # [X] などはこのファイル自身に一致させないための書き方
  # [s]k-ant-: Anthropic の API キー・OAuth トークン（接頭辞だけの説明文には当たらない。接頭辞そのものは secret-check.sh が見る）
  # A[I]za: Google の API キー（Firebase の Web の設定。ビルドの引数で渡し、リポジトリに置かない）
  # gh[p]_ など: GitHub のトークン
  shape token 'ya29\.[A-Za-z0-9_-]|GOCSP[X]-|-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key_i[d]"|X-Goog-Signatur[e]=|[s]k-ant-[a-z]+[0-9]*-[A-Za-z0-9_-]{20,}|A[I]za[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36}|github_pa[t]_[A-Za-z0-9_]{22,}'

  # メールアドレスは許可の表に無いものだけ:
  # - ドメイン: example.com・example.org・example.net とその配下、予約の TLD（.example・.test・.invalid・.localhost）、
  #   架空の SA の example-project・demo-*、Google の管理の SA（gcp-sa-*）
  # - 送り元の noreply: noreply@anthropic.com（コミットの署名）・noreply@github.com だけ。users.noreply.github.com は
  #   利用者名を含むので許さない
  filtered email '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}' \
    '^(noreply@(anthropic|github)\.com|[^@]+@(([a-z0-9-]+\.)*example\.(com|org|net)|([a-z0-9-]+\.)*(example|test|invalid|localhost)|(example-project|demo-[a-z0-9-]+)\.iam\.gserviceaccount\.com|gcp-sa-[a-z-]+\.iam\.gserviceaccount\.com))$'

  local name v
  for name in REPO_OWNER GCP_PROJECT_ID GCP_PROJECT_NUMBER TF_STATE_BUCKET FIREBASE_AUTH_DOMAIN; do
    v=${!name:-}
    if [ -z "$v" ]; then
      if [ "$mode" = content ]; then echo "skip: ${name} が空なので値の検査を飛ばす"; fi
      continue
    fi
    if [ "$name" = REPO_OWNER ] && [ "$mode" = content ]; then
      # LICENSE の著作権表示の行だけを除く（値は ENVIRON で比べる。正規表現に値を入れない）
      report "value-${name}" < <(search -Fiw -e "$v" | REPO_VALUES_V="$v" awk '{
        f = $0; i = index(f, ":"); file = substr(f, 1, i - 1); r = substr(f, i + 1); j = index(r, ":"); body = substr(r, j + 1)
        sub(/\r$/, "", body)
        if (file == "LICENSE" && match(body, /^Copyright \(c\) [0-9][0-9][0-9][0-9](-[0-9][0-9][0-9][0-9])? /) &&
            tolower(substr(body, RLENGTH + 1)) == tolower(ENVIRON["REPO_VALUES_V"])) next
        print
      }')
    else
      report "value-${name}" < <(search -Fiw -e "$v")
    fi
  done
}

# 先にパスを見て、パスに当たったファイルを覚えてから中身を見る（中身の位置でもそのパスを出さない）
mode=path
checks
mode=content
checks

if [ "$hits" -gt 0 ]; then
  echo "NG: ${hits} 件（CLAUDE.md「置かないもの」。値はプレースホルダ・変数にする）"
  exit 1
fi
echo "ok: ${#files[@]} ファイル（個人の値の形・値 0 件）"
