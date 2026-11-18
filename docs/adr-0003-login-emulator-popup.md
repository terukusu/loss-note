# ADR-0003: ログイン（Auth のエミュレーターと Google ログインのポップアップ）

- 状態: 採用（2026-11-18 に「縦切り 2 で決めたこと（本番）」を追記。Issue #43）
- 日付: 2026-11-17
- 関連: Issue #3（画面のデザインの土台。例の表 L1〜L7・R5）、Issue #43（本番のログイン）、設計書 C39・C40、設計書 10 章・10.1、ADR-0002（画面の行き来）、`docs/ui-guidelines.md` P11

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

手元（開発サーバー）には CSP のヘッダが無いので、これは許容する。ビルドの `index.html` には影響しない（SDK は `dist/assets/` の JS に入り、外部 URL・インラインの script / style を `index.html` に足さない。確認コマンドの CSP の検査が通る）。**本番の CSP のヘッダ（縦切り 2）では次のどれかを決める**（→ (a) に決めた。下の「縦切り 2 で決めたこと（本番）」）:

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
- **エミュレーターの ID トークンには署名が無い**（エミュレーターが発行するトークンは誰でも作れる）。**本番の API はエミュレーターのトークンを受けてはいけない**。API は、エミュレーターの接続先が明示された手元のときだけそれを受け、それ以外は署名を検証する（#4 に申し送る → #4 で対応。ADR-0004）
- 「記録は本人だけが見られます」という約束の文言は、#4 で利用者の分離（API での ID トークンの検証と uid で絞った読み書き）をテストで固定したので、ログインの画面に出す（ADR-0004）

## 縦切り 2 で決めたこと（本番。2026-11-18・Issue #43）

### 決定

1. **ログインの方式は (a) ポップアップ + 本番の CSP のヘッダ**。コードは縦切り 1 のまま（`signInWithPopup`。決定 1・4）で、本番の応答の CSP（`api/src/loss_note_api/web.py` の `login_csp_extra`。すべての応答）に次の 4 つだけを足す
   - `script-src` に `https://apis.google.com`（gapi）
   - `frame-src` に `https://<authDomain>`（`/__/auth/iframe`。ほかの frame は `default-src 'none'` のまま）
   - `connect-src` に `https://identitytoolkit.googleapis.com` と `https://securetoken.googleapis.com`
   - `'unsafe-inline'`・`'unsafe-eval'`・ワイルドカードは入れない。style・img・font は足さない（自分のオリジンだけ。font は土台の `default-src 'none'` で許さない）。`frame-ancestors 'none'` のまま
2. **authDomain は変数から受ける**: Cloud Run の環境変数 `FIREBASE_AUTH_DOMAIN`（画面のビルドの `VITE_FIREBASE_AUTH_DOMAIN` と同じ値。CI は repository secret `FIREBASE_AUTH_DOMAIN` を `TF_VAR_firebase_auth_domain` で渡す）。署名を検証する起動（`verify`）で変数があるときだけ足し、ホスト名の形（小文字の英数字・`-` のラベルを点でつなぐ。スキーム・ポート・ワイルドカード・空白・`;`・`,` なし）でなければ起動しない（ヘッダへの差し込みを塞ぎ、設定の誤りをデプロイで止める。Terraform の変数も同じ形を検査する）。エミュレーターの起動では足さない（手元の画面は Vite が配る）
3. **使える利用者は許可リストで絞る**（設計書 C39）: API が ID トークンの検証（401・503 の判定）の後に、確かめ済みのメール（`email_verified` が真偽値の真）を `LOSS_NOTE_ALLOWED_EMAILS`（カンマ区切り）と照合し、外れたら 403 `{"error":"forbidden"}`（本文・保存先・AI に触れる前。ログは決まった理由の語だけ）。照合は前後の空白を除いた完全一致・ASCII の大文字小文字だけを同一視。本番で未設定・空ならすべて 403。値は Secret Manager（`loss-note-allowed-emails`。入れ物と実行用 SA の読み取りは `infra/bootstrap/secrets.tf`、参照は `infra/prod/run.tf`）。uid ではなくメールで照合するのは、uid が初回のログインまで分からず、前もって入れられないため
4. **画面の 403**: `/api/*` の 403 で旗（`ui/src/auth/forbidden.ts`）を立て、門（`gate.ts`）が `forbidden` を返し、アプリの殻がどの画面の代わりにも「このアカウントでは使えません」・理由の 1 行（「使えるのは登録されたアカウントだけです。」）と [別のアカウントでログイン]（押すとログアウトしてログインの画面へ）を描く（`ui/src/pages/Forbidden.tsx`。メール・内部の言葉は出さない）。ホームは `/api` を読まないので、ログインしたら殻が旗を下ろしてから 1 度だけ `GET /api/settings` を読んで確かめる。旗には世代があり、ログイン・ログアウトで世代を進め、前の世代で送った要求の遅れて届いた 403 では立てない（次のアカウントに「使えません」を出さない。`onAuthKind`）。門は見た目で、守りは API の許可リスト（決定 6）
5. **Google のログインの有効化はコンソールで行う**（OAuth のクライアントは API で作れないので Terraform で管理しない）。**許可リストの入った API をデプロイした後に**有効にし、戻すときは先に無効にする（許可リストの無い API に誰でもログインできる時間を作らない。`infra/README.md`「ログインと使える利用者」）

### 理由

- `signInWithRedirect` は、Chrome M115 以降・Firefox 109 以降・Safari 16.1 以降のストレージの分離で、authDomain がアプリと違うドメインだと壊れる（Firebase の公開の手引き「Best practices for using signInWithRedirect」）。対応には `/__/auth/*` を Cloud Run で中継するか Firebase Hosting を手前に置く作りが要り、縦切り 2 の最優先（本番で回す）に対して作りが増える。手引きの対応の 1 つがポップアップへの切り替えで、ポップアップは影響を受けない
- (c) メールのリンクは他の利用者を受け入れる後の EPIC（オーナー 1 人は Google で足りる）

### 確かめていないこと（本番で見る）

- gapi が iframe に付ける位置・大きさの style は、SDK が値の組で gapi に渡している（属性の文字列ではない）ので CSSOM で付き、CSP に掛からない見込み。本番の PC の Chrome で違反が出たら（Issue #43 の AC-10）、`style-src-attr` を足すか redirect に変えるかを、そのときこの ADR に書いて決める
- iPhone の Safari のポップアップと保存の制限（AC-11）。通らなければ redirect + 中継を別 Issue で行う
