# statement-eval: 決済明細の読み取りを測る道具

証券会社・FX / CFD 会社の **決済明細（約定明細）のスクリーンショットを AI で読み取ったとき、どの欄をどれだけ正しく読めるか・何秒かかるか・いくらかかるか** を測る手元の道具です。loss-note の「事後に 1 回・30 秒で記録する」入力（設計書 1.1）が、明細の読み取りに寄りかかっているかどうかを、数字で確かめるために作りました（Issue #14、[ADR-0001](../../docs/adr-0001-statement-read-eval.md)）。

アプリ（`ui/`・`api/`）の一部ではありません。アプリの読み取りの入口は別の Issue（#11）で作り、そのときもここの採点の規則と合成の明細を使って精度を確かめます。

## 測るもの

明細の行（1 行 = 建てて決済した 1 取引）ごとに、次の 10 欄を正解と比べ、欄ごとの一致の割合を出します。

| 欄 | 比べ方 |
|---|---|
| 銘柄の名前 | 全角 / 半角と空白をそろえてから比べる |
| L / S（建てた向き） | 明細に書かれた向きの言葉から、建てた向きに直して比べる（下の「向きの言葉」） |
| 建てた価格・決済の価格・数量・損益（円） | 値で比べる（桁区切り・通貨の記号・全角 / 半角は無視、符号は区別） |
| 建てた日時・決済の日時 | 明細の時間帯のまま、年・月・日・時・分が一致すれば一致（日本時間への換算はしない） |
| 手数料 | 建て・決済の手数料と消費税の合計 |
| 決済の注文の種類 | 逆指値 / 成行 / 指値 / 不明。写っていないのに種類を返したら「作り話」として別にも数える |

ほかに、行数の一致（画像ごと）、1 枚の所要秒数の中央値と最大、1 回あたりの費用、使ったモデルの名前を出します。

**出力には件数・割合・秒数・費用・モデルの名前だけを出し、読み取った値と正解の値は出しません。** 実物の画像はファイル名でなく番号（1・2・3）で呼びます。

### 向きの言葉

明細の形によって、書かれた売買の向きの意味が違います。

| 明細の形 | 書かれた言葉 | 意味 | 建てた向き |
|---|---|---|---|
| 形 1（1 行が建てから決済までの 1 取引。「方向」の欄） | 買約定 | 建玉そのものの向き | L |
| 〃 | 売約定 | 〃 | S |
| 形 2（先物・オプションの決済明細。「取引」の欄） | 決済売 | 決済の注文の向き（売って決済 = 買いの建玉） | L |
| 〃 | 決済買 | 〃（買って決済 = 売りの建玉） | S |

AI には書かれた言葉のまま（`side_written` = buy / sell と、`side_of` = position（建玉の向き）/ close（決済の向き））を返させ、建てた向きへの直しは採点のコード（`score.opened_side`）が行います。

## 準備

[ルートの README](../../README.md) の「前提の道具」（mise・uv）がそろっていれば、追加の準備は要りません。

```sh
cd tools/statement-eval
mise exec -- uv sync --locked            # 採点・合成の明細・テストだけ（AI の SDK は入らない）
mise exec -- uv run --locked pytest -q   # テスト（AI は呼ばない）
```

## 合成の明細

`synthetic/` に、架空の値で作った明細の画像（`s01.png`〜`s14.png`）と正解（`answers.json`）、形と場面の一覧（`manifest.json`）があります。2 つの形（欄の並び・日時の書き方・時間帯・向きの言葉・手数料の欄の分け方）だけを真似ており、会社名・ロゴ・配色は入れていません。

含めている場面: 形 1 の L と S / 形 2 の先物（決済売）とオプション（決済買。銘柄名に限月・プット / コール・行使価格）/ 日が 12 以下の日時（日 / 月 / 年と年 / 月 / 日の両方）/ 1 枚に 2〜3 行 / 損益 0 円と損失 / 決済の注文の種類の欄がある形（逆指値と成行）/ 小数のある価格と桁区切りのある大きな数。

作り直すとき（値の表は `src/statement_eval/synthetic.py`）:

```sh
mise exec -- uv run --locked python -m statement_eval generate            # 画像・正解・一覧を書き直す
mise exec -- uv run --locked python -m statement_eval generate --check    # 正解と一覧がコミット済みと同じか
```

画像を描くには日本語のフォントが要ります。IPA ゴシック・Noto Sans CJK の代表的な置き場所を探し、見つからなければ `--font <フォントのパス>` で渡してください。正解は値の表から機械的に出るので、作り直しても同じになります（画像のバイトはフォントの版で変わることがあります）。

## 評価を回す（実際の AI を呼ぶ）

AI を呼ぶときだけ、Claude Agent SDK（依存グループ `ai`）を入れます。資格情報は環境変数で渡し、どちらを使うかを `--credential` で選びます（値は表示しません）。

| `--credential` | 環境変数 |
|---|---|
| `api_key` | `ANTHROPIC_API_KEY` |
| `oauth_token` | `CLAUDE_CODE_OAUTH_TOKEN`（サブスクの枠。費用は「従量課金なら」の換算額として出ます） |

```sh
mise exec -- uv sync --locked --group ai
mise exec -- uv run --locked python -m statement_eval eval --set synthetic --credential api_key
# モデルを変えて比べる（既定は claude-opus-5-5・effort low）
mise exec -- uv run --locked python -m statement_eval eval --set synthetic --credential api_key --model claude-sonnet-5-5
mise exec -- uv run --locked python -m statement_eval eval --set synthetic --credential api_key --model claude-haiku-5-5
# 終わったら AI の SDK を外す（確認コマンドと同じ状態に戻す）
mise exec -- uv sync --locked
```

主な引数: `--effort`（low / medium / high / xhigh / max。既定 low）、`--repeat`（同じ画像を読む回数。既定は合成 1・実物 3）、`--usd-jpy <レート>`（渡したときだけ費用を円でも出す）、`--json-out <パス>`（同じ要約の JSON。`data/local/` の下か一時ディレクトリだけ）。

資格情報が無いときは、AI を呼ばずに `資格情報がありません` と出して終わります（exit 2）。

### 実物の明細で測る

実物の明細と正解は **`data/local/statement-eval/real/`（gitignore）にだけ** 置きます。リポジトリ・Issue・PR には入れません。

1. 明細のスクリーンショットから、氏名・口座番号・注文番号の欄を塗りつぶすか切り取った写しを作り、`data/local/statement-eval/real/` に置く（PNG / JPEG。長辺 2,000 px・500 KB を超える画像は、送る前にメモリ上で縮めます）
2. 同じ場所に、人が画像を見て正解 `answers.json` を書く（AI に正解を作らせると、同じ誤りを正解にしてしまうため）
3. 回す: `mise exec -- uv run --locked python -m statement_eval eval --set real --dir ../../data/local/statement-eval/real --credential api_key`

実物のときは、AI に渡すための一時ファイル（同梱の CLI が画像を書く場所）も `data/local/statement-eval/tmp/` の下に作り、終わったら消します。

### 正解の書き方（`answers.json`）

合成の明細の `synthetic/answers.json` と同じ形です。値はすべて架空の例です。

```json
{
  "schema_version": 1,
  "images": [
    {
      "file": "real-1.png",
      "rows": [
        {
          "symbol": "日経225mini 26/03",
          "side": "L",
          "entry_price": "38250",
          "entry_time": "2026-03-04T09:12",
          "exit_price": "38610",
          "exit_time": "2026-03-04T10:15",
          "qty": "1",
          "fees": ["38", "3", "38", "3"],
          "pnl_jpy": "35918",
          "exit_order_type": "unknown"
        }
      ]
    }
  ]
}
```

- `side` は **建てた向き**（L / S）。「向きの言葉」の表のとおり、形 1 の「売約定」は S、形 2 の「決済売」は L です
- 数は文字列で、桁区切りなしで書きます（`"38250"`・`"151.234"`・`"-12340"`）
- 日時は明細の時間帯のまま `YYYY-MM-DDTHH:MM` に並べ替えます。日 / 月 / 年の明細の「04/03/2026 10:15」は `"2026-03-04T10:15"`、年 / 月 / 日の明細の「2026/03/04 10:15」も `"2026-03-04T10:15"` です
- `fees` は手数料・消費税の欄ごとの配列。欄が無い明細は `null`
- 明細に写っていない欄は `null`。決済の注文の種類が写っていなければ `"unknown"`
- 形が外れていると、位置（例 `images[0].rows[0].qty`）と理由だけを出して止まります

## 出力の読み方と限界

- 欄ごとの「一致 / 分母」の分母は正解の行の数（× 回数）です。写っていない欄も分母に入ります
- 秒数は、画像を送ってから形の決まった結果を受け取るまでの壁時計です。同梱の CLI の起動（約 1 秒）を含むので、API を直接呼ぶ作りよりやや長めに出ます。読み取りに失敗した回は秒数の集計から外し、失敗の件数を別に出します
- 費用は、提供元が返す使用量 × 公開価格（`score.PRICES_PER_MTOK`。2026-11-03 時点）です。価格表に無いモデルは「不明」と出ます
- 合成の明細は形への対応を測るもので、実物の画質や撮り方での精度は測りません
- 実物は枚数が少ないので、1 件の誤りで割合が大きく動きます（要約に実数を出します）
- 秒数はその日の提供元の混み具合に左右されます

## 作り

| ファイル | 役割 |
|---|---|
| `src/statement_eval/score.py` | 採点の純関数（正規化・欄の比較・行の対応づけ・作り話・割合・中央値と最大・費用） |
| `src/statement_eval/schema.py` | 読み取りの結果の形（ツールの JSON Schema）と検査、正解のファイルの検査 |
| `src/statement_eval/prompt.py` | 読み取りの指示 |
| `src/statement_eval/synthetic.py` | 架空の値の表 → 明細の配置と正解 |
| `src/statement_eval/render.py` | 配置を PNG に描く |
| `src/statement_eval/images.py` | 送る前の画像の確認と縮小（メモリ上だけ） |
| `src/statement_eval/reader.py` | Claude Agent SDK で 1 枚を読む |
| `src/statement_eval/report.py` | 要約（件数・割合・秒数・費用・モデル名だけ）→ Markdown / JSON |
| `src/statement_eval/cli.py` | `generate` / `eval` の入口 |

依存: Pillow 13.0（描画・画像の確認）、claude-agent-sdk 0.2.176（依存グループ `ai`。MIT。同梱の Claude Code CLI 2.1.316 は Anthropic の利用規約に従います）。
