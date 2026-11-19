# ADR-0018: ホーム画面に追加して開ける形は manifest とアイコンだけにし、サービスワーカーは置かない

- 状態: 採用
- 日付: 2026-11-19
- 関連: Issue #77、Issue #78（写真の「共有」から明細を渡す）、Issue #52（アイコン）、ADR-0003（Google ログインのポップアップ）、ADR-0009（本番の配信）、設計書 10 章「配信」「配信のヘッダ」・10.1

## 背景

記録は決済の直後にスマホで、事後に 1 回・30 秒以内で済ませたい（CLAUDE.md「目的」・設計書 1.1 の 0）。ブラウザを開いて URL を探す数秒と迷いが「後で書こう」につながるので、ホーム画面のアイコン 1 回で、URL のバーの無い窓でホームが開くようにしたい。後の #78（Web Share Target）も、ホーム画面に入れたアプリ（manifest）が前提になる。

サービスワーカー（SW）を入れると、オフラインで画面を開ける・インストールの条件を満たす、などの利点がある。一方で、記録・一覧・判定はどれも API（ログインと Firestore）が要り、オフラインで画面が開けても何もできない。SW が画面のファイルを持ち続けると、本番の直し（判定の直しなど）が次に開いたときに届かず、古い画面で記録する事故が起きうる。その事故は気づきにくく、計画と実行を比べる記録そのものを誤らせる。

## 決定

1. **Web App Manifest（`ui/public/manifest.webmanifest`）を置く**。name・short_name は「損失ノート」、`id`・`start_url`・`scope` は `/`、`display` は `standalone`、`lang` は `ja`、`theme_color`・`background_color` は画面の既定のテーマ（ダーク）の `--bg`（tokens.css。画面のテーマは OS の設定を見ないので、ライトに合わせて変えない）
2. **アイコンは favicon.svg から作る**（`scripts/make-icons.mjs`）。通常の形 `icon-192.png`・`icon-512.png`（purpose `any`。角丸・角は透過）と、マスクできる形 `icon-maskable-192.png`・`icon-maskable-512.png`（purpose `maskable`。角丸を外した不透明な四角。印の線は中心から幅の 40% の円 = 安全域の中。`tests/ui/pwa.test.ts` が画素で見る）。iPhone は今の `apple-touch-icon.png` を使う
3. **index.html の head** に `link rel="manifest"`・`meta name="theme-color"`（ダークの `--bg` 1 つ）・`meta name="apple-mobile-web-app-title"`（損失ノート）を置く。`apple-mobile-web-app-capable`・`apple-mobile-web-app-status-bar-style` は置かない（iOS は manifest の display を読む。option-simulator と同じ）。manifest の link に `crossorigin` は付けない（cookie で守る入口が無い）。iOS の版によっては状態バーが明るく出て暗い画面に馴染まないことがありうる。#77 の AC-7 で見て、馴染まなければ別の Issue で `apple-mobile-web-app-status-bar-style`（`black-translucent` など）を検討する
4. **サービスワーカーは置かない**。画面は登録せず、CSP に `worker-src` を足さない（`default-src 'none'` のまま SW・ワーカーが止まる）。Chrome はインストールに SW を求めない。更新は今の配信のまま届く: index.html は `no-cache`、`/assets/` は名前のハッシュで `immutable` なので、ホーム画面から開き直すとその時点の本番の版が出る
5. **配信**（ADR-0009 の追記）: `/manifest.webmanifest`（`application/manifest+json`）と 4 つのアイコンを、直下の決まった名前（`web.py` の `ROOT_FILES`）で置き場のファイルだけ返す（1 日のキャッシュ・無ければ 404 の JSON・index.html に戻さない）。CSP に `manifest-src 'self'` を足す（`default-src 'none'` では manifest を読めない）

## #78 で SW が要るときの条件

写真の「共有」から画像を受け取る Web Share Target は、画像を POST で受ける。ログインは画面の JS の ID トークンなので、その POST を API が直接受けても誰のものか分からない。受け口に SW が要るなら、次を守る最小の形にする（この ADR を改める）:

- SW は共有の POST（manifest の `share_target.action` の 1 つのパス）だけを受け、画像を記憶か端末の一時の置き場に渡して画面へ移す。それ以外の要求には `fetch` の扱いを持たない（キャッシュしない・`/api` を通す・画面のファイルを持たない）
- CSP に `worker-src 'self'` を足す。SW のファイルは直下の決まった名前で `no-cache` にする
- 古い SW を残さない更新（`skipWaiting` と、置き換わったら知らせる）を入れ、テストで固定する

## 選択肢

- **SW で画面のファイルをキャッシュする（オフラインで開ける）**: 起動は速くなりうるが、API が無いと記録できず、古い画面が残る事故の対策（更新の知らせ・版の照合）を足す必要がある。得るものより守るものが多い
- **vite のプラグイン（vite-plugin-pwa など）**: manifest と SW を自動で作れるが、依存が増え、SW を既定で入れる形になる。manifest 1 つとアイコンの生成は今の道具で足りる
- **`display: minimal-ui` / `browser`**: iOS ではブラウザで開く形に戻り、URL のバーが残る。ホーム画面から 1 回で記録の窓を開く目的に合わない

## 結果

- ホーム画面に追加すると、名前「損失ノート」とアイコンで、URL のバーの無い窓でホームが開く（本番で確かめるのは #77 の AC-7・AC-8）
- 本番の更新は、アプリを開き直せば届く（SW の版の管理が要らない）
- iPhone のホーム画面から開いた窓は Safari と保存先が分かれるので、その窓で 1 回ログインする。Google ログインのポップアップがその窓で動かなければ、別の Issue でその窓のログインの方式を替えるか、display を戻す（manifest の 1 行）
- それまでの逃げ道: ホーム画面の窓でログインできない・ポップアップが戻ってこないときは、窓を一度閉じ、Safari（Android は Chrome）のタブで開けば今までどおり使える。ポップアップがブロックされたときの文言にも、ホーム画面から開いたときはブラウザで開いてログインする案内を入れた（`ui/src/auth/errors.ts`）
- 画面のテーマをライトにしても theme-color はダークのまま（端末の状態バーの色）
