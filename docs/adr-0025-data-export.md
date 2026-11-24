# ADR-0025: データの書き出しは API の 1 つの入口から読み、画面が object URL で保存する

- 状態: 採用
- 日付: 2026-11-24
- 関連: 設計書 9.2（設定の行）・10 章（ID トークンの検証・配信のヘッダ）・10.1・13.4、C39、ADR-0004（記録の API と保存）、ADR-0006（チャート画像）、ADR-0009（本番の配信と CSP）、Issue #167・#218（アカウントと全データの削除）・#163（心理のタグの選択肢）・#123（Good / More）

## 背景

設計書 10.1 は「データの書き出し（JSON / CSV）」を MVP に入れている。利用者が自分の記録を手元のファイルに持ち出せることは、他人のお金の記録を預かる側の最低限の責任（13.4）で、削除（#218）の前に書き出せる必要もある。

条件は 4 つある。

1. 読むのは本人の `users/{uid}` の下だけ（ほかの利用者のデータを読まない）。ログに中身を出さない
2. 画面から保存先は直接読めない（記録は API 経由。10 章）。API の要求には ID トークンが要る（`Authorization` の見出し）
3. 本番の CSP（`default-src 'none'`・`connect-src 'self'`・`img-src 'self'`・`form-action 'none'`）を広げない
4. 画面のソースは object URL・data URL を作らない（#15 の AC-13。CSP の img-src に `blob:`・`data:` を足さないため）

## 決定

1. **入口は `GET /api/export` 1 つ**（記録の API の門 = ID トークン + 許可リストの後）。本文は `{format: "loss-note-export", version: 1, exportedAt, settings, emotionTagSettings, accounts, instruments, trades}` で、各要素は一覧の API と同じ形・同じ並び（取引は心理のタグ・Good / More（#123 の `reflection`）を含む。`emotionTagSettings` は心理のタグの選択肢の設定（#163）で `GET /api/settings/emotion-tags` と同じ形）（`api/src/loss_note_api/export.py`）。保存先の新しいメソッドは足さず、今の `list_trades`・`list_accounts`・`list_instruments`・`get_settings` を使う。応答は `Cache-Control: no-store` と `Content-Disposition: attachment`（日本時間の日付の名前）。ログは記録の API の request の行だけ
2. **含めないもの**: チャート画像のバイト列（取引の `charts` の要約 = 形式と大きさだけ）、明細の特徴の覚え（仮名化した鍵。記録でない）、AI の計上（計量）。画像は大きく（1 枚 5 MB まで × 7 枠）、1 つの応答に入れると Cloud Run の応答の上限と記憶に当たる
3. **CSV は画面が作る**（`ui/src/lib/export-csv.ts`）。判定・R・リスク・損益の計算の正は画面の `core/`（API は判定を持たない。4.2 の「判定・R は保存しない」）。同じ応答から組み立て、列は取引の詳細の「すべての欄」と同じ言葉。文字の欄が `=` `+` `-` `@`（全角の `＝` `＋` `－` `＠` も。先頭の空白の後も）・タブ・CR で始まるときは `'` を足す（表計算の式の差し込みを防ぐ）
4. **保存は画面の薄い層 `ui/src/lib/download.ts` だけが object URL を作る**。書き出しの API を ID トークン付きの fetch で取り、文字を Blob にして `a[download]` で保存し、10 秒後に URL を取り消す。ダウンロードの遷移は CSP の img-src・connect-src の対象ではないので、CSP は変えない。object URL は img・canvas・iframe に使わない（画像のプレビューは今までどおり canvas）。画面のソースの検査（`tests/ui/source-rules.test.ts`）は、このファイルだけを外し、読み込むのが書き出しの画面だけであることを見る

## 選択肢

- **ブラウザの遷移で `GET /api/export` を開く（`<a href download>`）**: 遷移には `Authorization` の見出しを付けられない。ID トークンを URL に載せると基盤のリクエストのログと履歴に 1 時間有効なトークンが残る。採らない
- **一度だけの鍵を作って URL に載せる**（`POST` で鍵 → `GET /api/export/<鍵>`）: Cloud Run は最大 2 台なので鍵を保存先に置く必要があり、利用者を持たない場所（`export_tickets/…`）が増える（10 章の「uid の場所だけ」の例外が増える）。鍵は基盤のログに残る。採らない
- **form の POST で ID トークンを送る**: CSP の `form-action 'none'` で止まる。広げない。採らない
- **data URL**: 大きな本文で遅く、#15 の規則と同じ理由で作らない。採らない
- **Web Share API（ファイルの共有）**: スマホでは自然だが、PC の Firefox などで使えず、2 つの経路を持つことになる。要望が出たら足す
- **CSV を API で作る**: 判定・R の計算を Python に二重に持つことになる。採らない

## 結果

- 本番の CSP・インフラ・IAM は変わらない。書き出しの全件を 1 回で読むので、取引の件数が数千件になったら応答の大きさと時間を測り直す（画面の時間の上限は 60 秒）
- iOS の standalone（ホーム画面に追加）での `a[download]` の保存は手元の検査（Chromium）で見ていない。オーナーが本番で確かめ、保存できなければ Web Share API を足す
- 書き出しの鍵の意味を変える・鍵を外すときは `version` を上げ、画面の `EXPORT_VERSION` と一緒に直す（鍵を足すだけなら上げない）
