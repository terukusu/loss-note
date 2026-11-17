# ADR-0003: ログイン（Auth のエミュレーターと Google ログインのポップアップ）

- 状態: 採用
- 日付: 2026-11-17
- 関連: Issue #3（画面のデザインの土台。例の表 L1〜L7・R5）、設計書 10 章・10.1、ADR-0002（画面の行き来）、`docs/ui-guidelines.md` P11

## 背景

記録は利用者ごとの個人の金銭の情報なので、ログインしていないと記録の画面に入れず、画面から API への要求には利用者の ID トークンを付ける（Issue #3 の R5。トークンの検証は #4）。本番のログインは Firebase Authentication の Google ログイン（設計書 10 章）で、縦切り 1 は手元で回す（エミュレーター）。画面の CSP は、インラインの script / style・style 属性・外部 URL を持たない（設計書 10.1）。

## 決定

1. **縦切り 1 は Auth のエミュレーターの Google ログイン**（`signInWithPopup` + `GoogleAuthProvider`）。本番と同じ経路で、縦切り 2 で作り直さずに済む。エミュレーターのログインの画面で、架空のアカウントを自動生成して選ぶ（実在のメールを使わない）
2. **接続先は環境変数**（`ui/src/auth/config.ts` の `readAuthConfig`）: `VITE_FIREBASE_PROJECT_ID`、`VITE_FIREBASE_API_KEY`、`VITE_FIREBASE_AUTH_DOMAIN`（無ければ `<projectId>.firebaseapp.com`）、`VITE_FIREBASE_AUTH_EMULATOR_URL`（空ならエミュレーターに繋がない）
   - **既定値（架空の `demo-loss-note`・`demo-api-key`・エミュレーターの `http://127.0.0.1:9099`）は開発のビルドのときだけ**（`ui/src/auth/devDefaults.ts` を `main.tsx` が `import.meta.env.DEV` のときだけ渡す）。本番のビルドには既定値が入らず、**変数で明示しない限りエミュレーターに繋がない**（変数が無ければ初期化に失敗し、決定 8 の案内を出す）。本番のビルドの JS にこれらの値が無いことを `tests/ui/prod-build.test.ts` で確かめる
   - **プロジェクト ID が `demo-` で始まらないときはエミュレーターに繋がない**（実プロジェクトの ID のままエミュレーターへ向けない守り。エミュレーターの URL の変数があっても無視する）
3. **画面は `firebase/app` と `firebase/auth` だけを読み込む**（Firestore・Storage は読まない。検査は `tests/ui/source-rules.test.ts`）
4. **ポップアップの仕組みはボタンを押したときにだけ読み込む**。`getAuth` は使わず `initializeAuth` に永続化（IndexedDB → localStorage）だけを渡し、`browserPopupRedirectResolver` は `signInWithPopup` の呼び出しに渡す。ログイン済みの再読み込みやログイン画面を開いただけでは、外（apis.google.com）へ取りに行かない
5. **SDK の既定の警告の帯は止める**（`connectAuthEmulator(..., { disableWarnings: true })`。帯は style 属性で固定した要素を body に足し、CSP と画面の検査を乱す）。代わりにアプリの帯に「エミュレーター」の印を出す
6. **門は純関数**（`ui/src/auth/gate.ts`）。**門は画面の振る舞い（中身を描かない・ログイン画面へ導く）であって守りではない**。画面のコードは公開で、門はブラウザの開発ツールで外せる。記録を守る本体は API での ID トークンの検証と uid での絞り込み（#4）。状態が分かるまでは何も出さない（再読み込みでログイン画面がちらつかない）、ログインしていなければ `/login?next=<開こうとした画面>` へ置き換える、ログイン後は `next`（自分の画面だけ。ADR-0002 の `safeNext`）へ置き換える
7. **`/api` の窓口**（`ui/src/lib/api.ts` の `apiFetch`、画面からは `ui/src/auth/session.ts` の `api`）: URL として解決（正規化）した結果が同一オリジンの `/api/` の下になるパスだけを受け（符号化した `..`・制御文字・符号化した区切りを通さない）、正規化したパスで送り、ログイン中は `Authorization: Bearer <ID トークン>` を付ける。ログインしていなければ要求を送らずに `NotSignedIn` を投げる
8. **ログインできないときの画面の振る舞い**: 失敗は決まった文言だけを出し、コード・例外の本文を出さない（`ui/src/auth/errors.ts`）。白い画面にしない
   - エミュレーターが止まっている: SDK はポップアップを開いたまま失敗を返さずに待ち続ける（手元で 40 秒以上待っても返らないことを確かめた）。そこで `signInWithPopup` はクリックの直後に始め（待ってから開くとブラウザにポップアップを止められる）、並行してエミュレーターに届くか（`fetch` の `no-cors`・5 秒）を確かめ、届かなければ「ログインのサービスにつながりません」で打ち切る（`ui/src/auth/race.ts`。3 つの分岐を vitest で固定）。開いたポップアップ（接続できない旨の画面）は利用者が閉じる
   - 起動時に Firebase の初期化が例外を投げた（接続先の設定の誤りなど）: ログインしていない状態として描き、ログイン画面に「ログインの準備ができませんでした。接続先の設定を確かめてください」を出す（例外の本文は出さない）
   - `auth/internal-error` は設定の誤りでも返るので、「つながりません」と言い切らず「ログインできませんでした」にする
   - ログアウトの失敗: 設定の画面に「ログアウトできませんでした。もう一度押してください」を出す（押している間は押せない）
   - ネットに出られない（apis.google.com に届かない）: SDK が gapi の読み込みの失敗をすぐ返す（`auth/network-request-failed`）ので、ポップアップを開かずに同じ文言を出す
   - ポップアップを自分で閉じた: 文言を出さない。ポップアップが止められた: 「もう一度押してください」

## 手元で許容し、縦切り 2 で決めること（CSP）

Google ログインのポップアップは、エミュレーターでも次を行う（`@firebase/auth` 1.13.9 の `_openIframe` → `_loadGapi` を読んで確かめた）。

- **外部の script** `https://apis.google.com/js/api.js` を `<script>` 要素で読み込む
- **iframe**（エミュレーターでは `<エミュレーター>/emulator/auth/iframe`、本番では `https://<authDomain>/__/auth/iframe`）を body に足し、gapi がその iframe に位置・大きさの style を付ける
- **ポップアップのウィンドウ**（`<authDomain>` の `/__/auth/handler`）を開く

手元（開発サーバー）には CSP のヘッダが無いので、これは許容する。ビルドの `index.html` には影響しない（SDK は `dist/assets/` の JS に入り、外部 URL・インラインの script / style を `index.html` に足さない。確認コマンドの CSP の検査が通る）。**本番の CSP のヘッダ（縦切り 2）では次のどれかを決める**:

- (a) `script-src` に `https://apis.google.com`、`frame-src` に `https://<authDomain>`、`connect-src` に Identity Toolkit・Secure Token の API を足し、gapi が付ける iframe の style（CSSOM で付くなら CSP に掛からない。属性で付くなら `style-src-attr`）を確かめる
- (b) `signInWithRedirect` + 同じドメインの authDomain（Firebase Hosting の `/__/auth/*` を Cloud Run の手前に置く、または同じ道を API が中継する）にして、外部の script・iframe を減らす
- (c) メールのリンク（設計書 10 章）を主にする

## 選択肢

- **`signInWithRedirect`**: 外部の iframe とポップアップのウィンドウが要らない代わりに、本番では authDomain をアプリと同じドメインに揃える仕組みが要る（サードパーティの cookie の制限）。縦切り 1 の手元には過剰
- **エミュレーターのメール・パスワード**（`signInWithEmailAndPassword`）: 外部の script が要らないが、本番の方法（Google）と経路が違い、縦切り 2 で作り直しになる
- **`getAuth`**: 簡単だが、ポップアップの仕組みを持つので、Safari・スマホでは起動時に gapi を取りに行く（`_shouldInitProactively`）

## 結果

- 手元でログインするにはネット（apis.google.com）が要る。ネットに出られない環境ではログインできず、ログイン画面に「ログインのサービスにつながりません」と出る（README に書いた）
- 画面の検査（`npm run ui:check`）は Auth のエミュレーターが動いていることを前提にし、ログインした状態（IndexedDB）を作って全画面を測る。L1〜L7 も流す。エミュレーターのログインの画面の要素の ID（`#add-account-button`・`#autogen-button`・`#sign-in`）に寄りかかるので、firebase-tools を上げたら見直す
- **エミュレーターの ID トークンには署名が無い**（エミュレーターが発行するトークンは誰でも作れる）。**本番の API はエミュレーターのトークンを受けてはいけない**。API は、エミュレーターの接続先が明示された手元のときだけそれを受け、それ以外は署名を検証する（#4 に申し送る）
- 「記録は本人だけが見られます」という約束の文言は、利用者の分離（#4 の API での検証）が入るまで画面に出さない
