# ADR-0026: 数字の部品だけに、Inter を数字・符号・英大文字に切り出した書体を同梱する

- 状態: 採用
- 日付: 2026-11-25
- 関連: 設計書 C61（見た目の土台の 3 本の (3)）・C62（数字の 4 段と単位の文法）・C63（この決定）・10 章（配信のヘッダ）・10.1（CSP）、ui-guidelines P3・P11・4.3・9.9、ADR-0009（本番の配信と CSP）、Issue #237・#229・#236

## 背景

主役の数字（R・%・金額。設計書 C59・C62）の字形と字幅が端末の書体まかせで、iPhone・Android・PC で同じ数が違う顔になる。#236 で数字の大きさを 4 段に決めても、端末の書体ごとに見え方が変わる。後の「行 → 詳細」の共有要素の動きも、同じ数が同じ形であることを前提にする。

条件:

1. 日本語の Web フォントは入れない（重さと表示の遅れ）。本文・日本語は端末の書体のまま
2. 外部（CDN）を読まない。本番の CSP は `default-src 'none'` で、書体を読む指示が無かった
3. 直接の依存は公開から 14 日以上たった版だけ（CLAUDE.md「開発」）。npm の依存を増やさない
4. 読み込めないとき・読み込みの間も、今と同じ形で読める

## 決定

1. **書体**: Inter 4.1（SIL Open Font License 1.1・Reserved Font Name の指定なし）の可変の書体を、太さ 400〜700・opsz 14〜32 に絞り、数字 0〜9・`+` `−`（U+2212）`-` `±` `.` `,` `%` `:` `/` `·` 空白・英大文字 A〜Z・`×` `…` `–` `—` `→` の 52 文字だけに切り出した woff2 1 つ（12,608 バイト）。置き場は `ui/src/assets/fonts/inter-num.woff2`、隣に OFL の全文 `LICENSE-OFL.txt`（リリースの `LICENSE.txt` をそのまま）。書体の中にも名前の表の 0（著作権）・13・14（ライセンスの表示と URL）を残す
2. **当てる所**: 数字の部品の 3 つ（`.num`・単位の塊 `.num-unit`・数値の入力欄 `.numfield__input`）だけ。トークン `--font-num: "Inter Num", var(--font)`。入っていない文字（円・日本語）はブラウザが文字ごとに続きの端末の書体で出す。`@font-face` は `ui/src/styles/base.css` の 1 か所で、`font-display: swap`・`unicode-range` を 52 文字に合わせる
3. **配信**: Vite が `/assets/inter-num-<hash>.woff2` に出す（4 KB を超えるので data URL にしない）。API は `/assets/` を `immutable`・`font/woff2` で配る（イメージの Python 3.13 の mimetypes は `.woff2` を知らないので、`web.py` の `ASSET_TYPES` で決める）。本番の CSP に `font-src 'self'` を足す（data: と外部は許さない。ほかの指示は変えない）
4. **検査**: `tests/ui/num-font.test.ts`（woff2 を開いて文字の集合・軸・tnum・名前の表と、隣の全文）、`tests/ui/cssTokens.test.ts`（書体の並び・使う規則が 3 つだけ・url() は @font-face の 1 か所）、`csp-check.sh`（assets の CSS に data: と外部の url() が無い）、`image-check.sh`（CSP の font-src・書体のファイルが 200・`font/woff2`・`immutable`）、API のテスト（CSP の集合と配信）、画面の検査（測る前に `document.fonts.ready` を待つ・R13 で書体が読み込み済み）
5. **太さのトークン**: 650 / 750 は変えない（設計書 C63）

## 出どころと切り出しの手順

- リリース: `https://github.com/rsms/inter/releases/tag/v4.1`（公開 2024-11-16T00:27:07Z。2026-11-25 の時点で 14 日以上前）
- `Inter-4.1.zip` の SHA-256: `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`
- 元の `InterVariable.ttf` の SHA-256: `4989b125924991b90d05b2d16e0e388c48f7d5bb8b30539bbf9c755278d0ccaf`
- `LICENSE.txt`（= `LICENSE-OFL.txt`）の SHA-256: `262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a`
- 道具: fonttools 4.55.0 と brotli 1.1.0（uv の一時の環境。リポジトリの依存・lock に入れない）

```
FT="uvx --isolated --from fonttools==4.55.0 --with brotli==1.1.0"
$FT fonttools varLib.instancer InterVariable.ttf wght=400:700 opsz=14:32 -o lim.ttf
$FT pyftsubset lim.ttf \
  --unicodes="U+0020,U+0025,U+002B-002F,U+0030-003A,U+0041-005A,U+00B1,U+00B7,U+00D7,U+2013,U+2014,U+2026,U+2192,U+2212" \
  --layout-features=kern,tnum,calt --name-IDs=0,1,2,3,4,5,6,13,14 --no-hinting --flavor=woff2 \
  --output-file=inter-num.woff2
```

- 出力の SHA-256（同梱のファイル）: `2ea6d665a3da6265a598f2f08c31ea29dccc470e67dfb79a645efb97c899ec99`。作り直すと書体の中の時刻が変わるのでハッシュは同じにならない（文字・軸・機能は `num-font.test.ts` で確かめる）

## 選択肢

- **端末の書体のまま**（今まで）: 重さ 0 だが、数字の顔が端末で変わる。採らない
- **日本語を含む Web フォント**: 数百 KB〜数 MB で表示が遅れる。採らない
- **npm の書体のパッケージ（`@fontsource` など）**: 依存が増え、切り出しの範囲を決められない（大きい）。採らない
- **静的な 1 太さ（約 5.8 KB）**: 650・500・400 の 3 つの太さを使うので足りない。採らない
- **opsz を落とす（約 9.3 KB）**: 28〜56px の大きな数字に表示用の字形（opsz 32。字間と字の細部が大きな文字向き）を使えなくなる。軸を残しても 20 KB 以下に収まるので残す
- **先読み（link の preload）**: 名前にハッシュが付くので組み立ての仕組みが要る。swap で足りなければ後の Issue

## 結果

- 数字の部品は、読み込めた端末では同じ字形・同じ字幅になる。読み込みの間と読み込めないときは今の書体（swap）
- 本番の CSP に `font-src 'self'` が増える（自分のオリジンだけ）
- 書体を作り直すときは、この手順と `num-font.test.ts` の文字の集合を一緒に直す
