#!/usr/bin/env bash
# リファインメント済みの Issue 本文の形式を検査する（中身の良し悪しは見ない）。
# 使い方: check-refinement.sh <本文のファイル>
#   exit 0 = 形式 OK（Ready の候補）/ exit 1 = 形式の不備あり（[ng] の行を出す）
# 規約の正は .claude/skills/create-issue/SKILL.md「AC の形式規約」と implement-issue Phase 1「本文の構成」。
set -u
B=${1:?本文のファイルを指定してください}
[ -r "$B" ] || { echo "[ng] 読めない: $B"; exit 1; }
ng=0
fail() { echo "[ng] $*"; ng=1; }

section() { # 見出し $1 の節の本文（次の ## まで）
  awk -v h="## $1" 'index($0, h) == 1 {on = 1; next} on && /^## / {exit} on {print}' "$B"
}

for h in '背景（why）' 'やること（what）' 'ルールと例' '受け入れ条件（AC）' '変えないこと' '価値の確かめ方' 'スコープ外' '設計との対応' '未決・仮定'; do
  grep -q "^## $h" "$B" || fail "節が無い: $h"
done

# 背景: オーナーの言葉と、深掘りした why（仮説 / 確認済み）を分けて書く
section '背景（why）' | grep -qE '深掘りした why（(仮説|確認済み)）' || fail '背景に「深掘りした why（仮説）」または「（確認済み）」の小見出しが無い'

# AC と KEEP の行は ID と種別を持つ
ac=$(section '受け入れ条件（AC）' | grep -E '^- \[.\] ')
[ -n "$ac" ] || fail 'AC が 1 件も無い'
bad=$(printf '%s\n' "$ac" | grep -vE '^- \[.\] AC-[0-9]+ \[(auto|manual|after-deploy)\] .+pass: ')
[ -z "$bad" ] || fail "形式の違う AC: $(printf '%s' "$bad" | head -3 | tr '\n' ' ')"
keep=$(section '変えないこと')
if ! printf '%s\n' "$keep" | grep -qE '^なし'; then
  bad=$(printf '%s\n' "$keep" | grep -E '^- ' | grep -vE '^- \[.\] KEEP-[0-9]+ \[(auto|manual|after-deploy)\] .+pass: ')
  [ -z "$bad" ] || fail "形式の違う KEEP: $(printf '%s' "$bad" | head -3 | tr '\n' ' ')"
fi

# 手動・デプロイ後は手順つき
miss=$( { section '受け入れ条件（AC）'; section '変えないこと'; } | grep -E '\[(manual|after-deploy)\]' | grep -v '手順:')
[ -z "$miss" ] || fail '手順の無い manual / after-deploy の行がある'

# AC に実装の詳細（ファイルのパス・テストのファイル名）を書かない
leak=$(section '受け入れ条件（AC）' | grep -nE '\.(test|spec)\.(ts|tsx|js)|tests?/[A-Za-z0-9_/-]+\.(ts|py)|(src|api|ui)/[A-Za-z0-9_/-]+\.(ts|tsx|py)')
[ -z "$leak" ] || fail 'AC にファイルのパスがある（振る舞いで書き、テストとの対応は Phase 2 で付ける）'

# 反証できない言い方
vague=$(grep -nE '正しく|適切に|見やすく|問題なく|ちゃんと|スムーズに|使いやすく' "$B")
[ -z "$vague" ] || fail "反証できない語: $(printf '%s' "$vague" | head -3 | tr '\n' ' ')"

# 埋め残し
left=$(grep -nE '<[^>]+>|TBD|TODO|要検討' "$B" | grep -v '<!--')
[ -z "$left" ] || fail "埋め残し: $(printf '%s' "$left" | head -3 | tr '\n' ' ')"

# 設計との対応は節番号か ADR か「該当なし」
section '設計との対応' | grep -qE '§?[0-9]+\.[0-9]+|[0-9]+ 章|adr-[0-9]{4}|該当なし' || fail '設計との対応に節番号・ADR・「該当なし」が無い'

# 未決・仮定は表か「なし」
section '未決・仮定' | grep -qE '^\||^なし' || fail '未決・仮定が表でも「なし」でもない'

[ "$ng" -eq 0 ] && echo ok
exit "$ng"
