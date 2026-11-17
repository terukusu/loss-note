# ADR-0002: 画面の行き来（SPA のルーター）

- 状態: 採用
- 日付: 2026-11-17
- 関連: Issue #3（画面のデザインの土台。例の表 V1〜V6・L1〜L3）、設計書 9.2・10・C35、`docs/ui-guidelines.md` P6

## 背景

画面は SPA（設計書 K2）で、ログイン・ホーム・記録する・取引の一覧・取引の詳細・設定の 6 画面を持つ。どの画面にも URL があり、ブラウザの戻る・再読み込み・URL を直接開くで同じ画面に着き、知らない URL はホームへ置き換える（Issue #3 の R4）。ログインの門（Issue #3 の PR-2）は、ログイン後に開こうとした画面へ戻すため、戻り先の URL（`?next=`）を受け取る。

## 決定

1. **History API の URL**（`/`・`/record`・`/trades`・`/trades/<id>`・`/trades/<id>/edit`（直す。#9）・`/settings`・`/login`。開発の時だけ `/dev/parts`）。取引の ID は `[A-Za-z0-9_-]{1,64}` で、外れは知らない URL
2. **依存を足さず、自前の小さな仕組み**にする。純関数（`ui/src/lib/routes.ts`: `parseRoute`・`hrefOf`・`resolveNavigation`・`safeNext`・`shouldInterceptClick`）と、履歴を差し替えられる薄い層（`ui/src/lib/router.tsx`: `createNavigator(env)`・`Link`）に分ける。テストは偽の履歴を差して window を使わない
3. **知らない URL は履歴を置き換えて**ホームへ（`replaceState`）。戻るで知らない URL に戻らない。画面の中のリンクから知らない URL へ押しても、積まずに置き換える
4. **ログイン後の戻り先（`next`）は自分の画面だけ**（`safeNext`）。`/` で始まり、`//`・`\` を含まず、`parseRoute` を通り、ログイン画面そのものでないもの。ほかはホーム（オープンリダイレクトを作らない）
5. **リンクは `<a href>`**。左クリック（修飾キー・中クリックなし）だけを横取りして push し、新しいタブで開く等はブラウザに任せる

## 選択肢

- **preact-iso（MIT・2.12.2）**: Preact の公式のルーター。知らない URL の置き換え・`next` の検証・偽の履歴でのテストは自前で書くことになり、量は自前と大差ない。依存を 1 つ減らすほうを選んだ
- **ハッシュの URL（`#/trades`）**: 静的配信のサーバーに戻しが要らない。URL が利用者に読みにくく、共有の形として不自然。ログインの戻り先もハッシュの中に入れることになる

## 結果

- **本番の静的配信（Flask / Cloud Run）は、`/api` 以外の知らないパスに `index.html` を返す戻しが要る**（設計書 10 章）。静的配信を作る Issue（#4 か縦切り 2）に渡す。手元の Vite の開発サーバーは既定（`appType: 'spa'`）でそうなっているので、#3 では変更しない
- 経路を足すときは `routes.ts` の `parseRoute`・`hrefOf`・`titleOf` と `tests/ui/routes.test.ts`、`scripts/ui-check.mjs` の画面の一覧を一緒に直す
