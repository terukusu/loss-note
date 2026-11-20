// 画面の検査（`npm run ui:check`。Issue #3 の what 6・AC-6・8・9・10。docs/ui-guidelines.md P6・P7・P8）。
// Chromium（Playwright）で全画面を幅 360 / 390 / 768 / 1440px × ダーク / ライトで開き、横スクロールの量（px）と、
// 幅 360px の押せるものの当たりが 44×44px 未満の件数、折り返さない部品（ボタン・セグメント・バッジなど）の中の
// はみ出しの件数を数値で出す。行き来（例の表 V1〜V6）とテーマ（T2〜T4）も実ブラウザで流す。
// 戻るでスクロールの位置が戻ること（S1）、ログインの門（例の表 L1〜L7）と、使えないアカウントの画面（Issue #43 の例 L3・L4 = F1・F2。偽の /api がすべて 403）も見る。1 つでも外れれば終了コード 1。CI には入れない（手元で流し、出力の要約を PR に貼る）。
// アプリの殻（#127。ui-guidelines 9.2・9.6・9.7・9.12）: 全状態で文字のリンクの見た目の操作（9.12 の数え方。.glink を除く）と、縦の形で
// ［記録する］ が 2 か所以上の状態を数え（どちらも 0 件が期待）、V6 は下のタブ 4 つ + ［＋ 記録］ と全画面のシートで下のタブを隠すこと、
// V7 は 9.7 の表（タブごとの積み重ね・押し直し・戻る・印の無い起動の組み直し・層の段の再読み込み・広い形のタブの切り替え）、
// SA1 は安全域の差し替え（上 47・下 34。トークン --safe-* を差し替える）で押せるものが安全域の内側にあることを見る。
// 記録する画面（Issue #13）は、入力の途中・判定が出た状態（B・危ない勝ち・LC なしの C）・保存の後も同じ幅とテーマで測り、
// 手順 R1〜R5（開いたときの既定・E1 の判定・二度押し・端末に書かない・保存の失敗）を流す。
// 決済明細の読み取り（Issue #15）は、読み取り中・読み取りの後・複数行（タイムゾーンの確認）・読み取りの失敗の状態を同じ幅とテーマで
// 測り、手順 R6〜R10（貼り付けとファイル選択で 1 件ずつ・文字の貼り付けで 0 件 / 実物の canvas で描き直した本文の形式・寸法・
// バイト数 / 端末に残さない / 失敗の文言 / E1 を貼って打つ 2・選ぶ 3 で判定と保存）を流す。読み取りの API も偽物（架空の行）で、
// 実際の AI は呼ばない。画像はページの中の canvas で作るか、合成の明細 tools/statement-eval/synthetic/ を使う。
// 根拠の足のチャート（Issue #12）は、2 枠にチャートがある状態（時間足の欄つき）を同じ幅とテーマで測り、手順 C1〜C3
// （枠を選んで貼る → チャート・枠の外に貼る → 明細 / 貼る → 保存 → 離れるの後に端末の保存先に画像が無い / 2 枚と明細で
// 打つ 2・選ぶ 3 → 1 要求の multipart で保存）を流す。チャートの画像もページの中の canvas で作る（架空）。
// 取引の一覧・詳細・直す（Issue #9）は、取引のある一覧・ホーム・詳細（チャート 2 枚）・直すを同じ幅とテーマで測り
// （トーストの出た一覧も）、手順 T-L4・T-H1・T-D1・T-D2・T-D3・T-E1・T-E2・T-X1・T-X2（例の表の L4・H1・D1・D2・E1・E2・X1・X2 と #34 の物差し）を流す。
// 例の取引とチャートの画像（このスクリプトが作る小さな PNG）はすべて架空。
// 一覧のページ分け（Issue #87）は、合成の取引 120 件で手順 TL-P1（末尾へ送ると続きが自動で出て「全 120 件」・要求 3 回・
// 幅 360 で横スクロール 0）・TL-P2（80 行目の詳細から戻ると行の数と位置が保たれる）・TL-P3（続きの読みの失敗と
// [再読み込み]）・TL-P4（キーで押したときのフォーカスと末尾の段の高さ）・TL-P5（5 つの状態を 360 / 1440 × ダーク /
// ライトで測って撮る）を流す。
// 設定の画面（Issue #5）は、開いた直後（資金・履歴 3 件・銘柄 3 件）・銘柄を直している・誤りと警告・資金が未設定の状態を
// 同じ幅とテーマで測り、手順 SET1〜SET3（資金を保存して記録する画面でリスク 0.5% / 銘柄を直す・誤りは送らない・
// フォーカス / 名前だけで足す・許容リスクの警告と範囲 / 誤り・失敗の後のフォーカス）を流す。セグメントのチェックの記号が
// 文字の前にあって項目の中に収まるかも、部品のはみ出しと一緒に数える。
// 口座（Issue #47 PR-1）: 記録する画面の口座 2 つ（Segment）・3 つ（長い名前の「…」）・4 つ（select）・その場で足す欄・足す欄の誤り、
// 設定の口座の一覧（2 つ・資金が未設定の行）・直す欄・足す欄・誤り、一覧と詳細（口座 2 つ）を同じ幅とテーマで測り、
// 手順 ACC1（口座 2 つで 1 タップで替わる・判定の枠の 1 行がその場で変わる）・ACC2（その場で足す: Enter で足す・Esc で閉じて
// フォーカスを戻す・足した口座が選ばれる・入れていた欄が残る）・SET5（設定で口座を追加 → 名前の順・知らせ・新しい行の [直す] へ）を流す。
// 数量と提案の数量（Issue #67）: 手順 SZ1（幅 360 の記録する画面・詳細・編集の画面で、判定の枠の数量の行が区切りの中で折れず・
// --ink-3・数の段の直後・横スクロール 0。2〜3 桁の比・小数 / 7 桁の提案の数量・1R が出ない・エントリー 2 つも。詳細の「すべての欄」に 2 行）を流す。
// R12 は口座 1 つの形の全長 2,550px に加えて、口座 2 つ・3 つの形に 2,646px（欄 1 つ分 96px まで）の上限を見る。
// 通貨と為替（Issue #47 PR-2・U34）: 記録する画面の為替の欄（USD 建て）・為替 7 桁・明細から逆算した為替・為替の誤り・USD の口座、
// 設定の USD の口座の行と通貨を直せない口座の直す欄、詳細（外貨建て）を同じ幅とテーマで測る。円の口座・円建ての形は今のまま。
// 記録する画面の密度と階層（Issue #33）: 全状態で枠の入れ子（線か、最も近い面と違う面の色を持つ箱の祖先）が 3 段以上の要素を
// 数え、幅 360 の記録する画面の全状態で貼り付きの帯の高さ（64px まで）と状態の文の行数（1 行まで）・切れ（scrollWidth）、直す画面の帯の高さ
// （変える前の 161.1px まで）を測る。手順 R11（最後のタップの直後に判定のバッジと R が見える）・R12（開いた直後の 1 画面・
// 注意 3 行以下・全長 2,550px 以下）・R13（大きな R は 36px・本文の書体、ラベルの上端が揃う）を流す。R11 は判定が見える範囲の
// 外にある状態で最後のタップを座標で押し、アプリが寄せることを確かめる。幅 720 未満の画面は指で触る端末（hasTouch）として開く。
// 言葉の説明の「i」（Issue #57。#129 で吹き出しから説明のシートへ）: 記録する画面で説明を 1 つ開いた状態（時間足・判定）を同じ幅と
// テーマで測り、シートが窓の中に収まることを見る。手順 IT1（押して開く・✕・Esc でフォーカスが「i」・外を押す・同時に 1 つ）・
// IT2（押しても入力の状態が変わらず保存の要求 0）・IT3（戻るでシートだけを閉じ、画面は移らない・閉じた後の履歴の数）を流す。
// 下のシート（#129。ui-guidelines 9.3・9.10）: 手順 SH1（360×780・390×844 × ダーク / ライトと文字の拡大 200%: 下から出る・窓の中・
// 最大 86%・中がスクロールで最後まで届く・✕ の当たり 44・Tab でシートの外へ出ない・閉じたら「i」へ・安全域を差し替えて押せるものが
// 内側）・SH2（シートを開いている間はトーストの取り消しの時間が止まる）・SH3（<html data-form> を付けた横・広いの見せ方）を流す。
// 文字の拡大 200%（Issue #79・WCAG 1.4.4）: 文字の大きさのトークン（tokens.css の --fs-*）を全部 2 倍にし、ルートの文字の
// 大きさも 200% にした状態で、全画面と記録する画面・設定の画面・ホームの振り返りの主な状態を 360×780 と 1440×900 × ダークで
// 測る。文字は px のトークンなので、ルートの文字の大きさだけを 2 倍にしても変わらない。トークンを 2 倍にするのは、文字だけの
// 拡大（Android の Chrome の文字の拡大。px の文字も大きくなり、窓の幅は変わらない）に当たる。あわせて 1440×900 のページの拡大
// 200%（窓 720×450・DPR 2・等倍の文字）も同じ状態で測る。横スクロール 0px・部品のはみ出し 0 件に加えて、拡大の漏れ（文字が
// 20px 未満 = トークンを通らない大きさ）と行の重なり（行の高さが文字より小さい・文字どうしの重なり・切れ）を数える。当たり・
// 帯の高さ・全長・入れ子は拡大では見ない（文字に合わせて大きくなるのが正しい）。残している崩れは ZOOM_KNOWN（外れの文言で絞る）。
// 等倍の状態では、ボタン・バッジが 2 行に折れていないかも部品のはみ出しに数える（#79 で親より広いときだけ折り返す作りにした）。
// ホーム画面に追加（Issue #77）: 手順 PWA1（/ に manifest-src 'self' の CSP を付けて開き、CDP の Page.getAppManifest のエラー 0 件・
// manifest の CSP の違反 0 件・manifest のアイコンが 200）を流す。
// ログイン済みの文脈の /api は、このスクリプトの中の偽の記録の API（記憶の中だけ・架空の値）に置き換える
// （Flask と Firestore のエミュレーターを立てなくてよい。本物の API の経路は Issue #13 の手での確かめで見る）。
//
// 前提: `npm ci` の後に一度 `npx playwright install chromium`（ブラウザは手元のキャッシュに入る。リポジトリには入らない）。
// Auth のエミュレーター（127.0.0.1:9099。`npm run emulators`）が動いていること（無ければ終了コード 2）。
// 架空の利用者はエミュレーターのログインの画面で自動生成する（実在のメールを使わない）。ログインの画面は
// Google の gapi の script（apis.google.com）を読むので、ネットに出られない環境ではログインできない。
// Vite の開発サーバーはこのスクリプトが空きポートに立てて、終わりに閉じる（手で `npm run dev` を立てなくてよい）。
//
//   npm run ui:check                       既定の検査
//   npm run ui:check -- --inject-wide 400  幅 400px に固定した要素を全画面に足して流す（検査が崩れを見逃さないことの確かめ。AC-9）
//   npm run ui:check -- --inject-clip      部品が切れる・はみ出す見本（親で切れるバッジ・親より広いボタン・縦に切れるボタン）と
//                                          カード → 枠 → ボタンの入れ子の見本を全画面に足して流す（部品のはみ出しの検査・入れ子の
//                                          検査が見逃さないことの確かめ。1 画面 はみ出し 3 件・入れ子 1 件）。幅 360 の記録する画面には
//                                          帯の見本（長い文・改行・背の高い要素）も足す（帯の外れ 1 状態 3 件）
//   npm run ui:check -- --zoom             文字の拡大 200% の状態だけを流す（既定の実行にも入る。Issue #79）。
//                                          --inject-clip と一緒なら、拡大の見本（px の文字・行の高さの決め打ち）も足す
//                                          （文字の拡大の状態ごとに拡大の漏れ 1 件・行の重なり 1 件）
//   npm run ui:check -- --shots <dir>      各状態を <dir> に撮る（目で見る補助。画像はコミットしない）
//
// 終了コード: 0 = すべて ok / 1 = 外れあり / 2 = 引数の誤り・起動できない
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const USAGE = `使い方: npm run ui:check [-- --inject-wide <px>] [-- --inject-clip] [-- --zoom] [-- --shots <dir>]`;

/** 引数を読む。誤りは終了コード 2 */
function parseArgs(argv) {
  const opts = { injectWide: 0, injectClip: false, zoom: false, shots: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--inject-clip') {
      opts.injectClip = true;
    } else if (a === '--zoom') {
      opts.zoom = true;
    } else if (a === '--inject-wide') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v <= 0)
        usageError('--inject-wide には正の整数（px）を渡してください');
      opts.injectWide = v;
    } else if (a === '--shots') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) usageError('--shots には出力先のディレクトリを渡してください');
      opts.shots = resolve(v);
    } else if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else {
      usageError(`知らない引数: ${a}`);
    }
  }
  return opts;
}

function usageError(msg) {
  console.error(msg);
  console.error(USAGE);
  process.exit(2);
}

const opts = parseArgs(process.argv.slice(2));

/**
 * 検査する画面（ログイン・ホーム・記録する・一覧・詳細・直す・設定 + 部品の見本）。詳細は無い取引の ID（V4 の画面）と
 * チャート 2 枚の取引（Issue #9）。wait = 中身が出るまで待つ要素（ホーム・一覧は取引の行、詳細はチャートの canvas）
 */
const PAGES = [
  { path: '/login', h1: 'ログイン' },
  { path: '/', h1: 'ホーム', wait: '.traderow' },
  { path: '/record', h1: '記録する' },
  { path: '/trades', h1: '取引', wait: '.traderow' },
  // 振り返りのタブ（#127。U1 の時点ではホームの規律の振り返りの部品をそのまま出す）
  { path: '/review', h1: '振り返り', wait: '.review' },
  { path: '/trades/no-such-trade', h1: '取引の詳細' },
  { path: '/trades/x-d1', h1: 'US30 · L', wait: 'canvas.chartview__canvas >> nth=1' },
  { path: '/trades/x-e1/edit', h1: '取引を編集', wait: '#edit-submit' },
  // Issue #34: 物差しの場面（危ない勝ちで LC を広げていた・TP を入れた・ショート）
  { path: '/trades/x-r1', h1: 'US30 · L', wait: '.ruler__plot' },
  { path: '/trades/x-r2', h1: 'US30 · L', wait: '.ruler__plot' },
  { path: '/trades/x-r3', h1: 'US30 · S', wait: '.ruler__plot' },
  { path: '/settings', h1: '設定' },
  { path: '/dev/parts', h1: '部品の見本' },
];
const SIZES = [
  [360, 780],
  [390, 844],
  [768, 1024],
  [1440, 900],
];
const THEMES = ['dark', 'light'];
const TAP = 44;
/** 記録する画面の貼り付きの帯の高さの上限（幅 360。Issue #33 AC-1） */
const BAR_MAX = 64;
/** 記録する画面の全長の上限（360×780 の開いた直後。Issue #33 AC-4） */
const TOTAL_MAX = 2550;
/** 口座が 2 つ以上の形の全長の上限（口座の欄 1 つ分 = 96px まで増える。Issue #47 の画面の決定 2.7） */
const TOTAL_MAX_ACCOUNTS = 2646;
/** 直す画面の貼り付きの帯の高さの上限（幅 360。Issue #33 KEEP-7: 変える前に測った値 161.1px） */
const EDIT_BAR_MAX = 161.1;
const THEME_KEY = 'loss-note.theme';
/** 文字の拡大（Issue #79）の倍率・幅・テーマ・拡大の漏れとみなす文字の大きさ（いちばん小さいトークン 12px の 2 倍から 1 割ほど下） */
const ZOOM = 2;
/**
 * 拡大の窓。text = 文字の拡大（トークン 2 倍・窓の幅はそのまま）。text が false の 720×450（DPR 2）は 1440×900 の窓を
 * ブラウザのページの拡大で 200% にしたもの（窓がちょうど PC の並びの境 720px になる。文字は等倍のトークン）
 */
const ZOOM_SIZES = [
  { w: 360, h: 780, text: true },
  { w: 1440, h: 900, text: true },
  { w: 720, h: 450, text: false, dpr: 2 },
];
const ZOOM_THEMES = ['dark'];
const ZOOM_MIN_FONT = 20;
/** 文字の拡大で測る記録する画面・設定の画面の状態（RECORD_STATES・SETTINGS_STATES の slug） */
const ZOOM_RECORD = [
  'record-1-open',
  'record-3-judged-b',
  'record-5-no-lc-c',
  'record-8-read',
  'record-9-rows',
  'record-10-read-failed',
  'record-12-charts',
  'record-15-accounts-2',
  'record-21-fx',
  'record-11-info-tap',
];
const ZOOM_SETTINGS = ['settings-1-open', 'settings-5-accounts', 'settings-3-errors'];
/**
 * 文字の拡大で残している崩れ（`幅:slug` → { match: 既知の外れの文言の正規表現, why: 理由 }）。match に当たる外れだけを
 * 既知として数え（失敗にしない）、当たらない外れは失敗にする。match に当たる外れが無くなったら「消す」で失敗にする。
 * 理由は handoff と docs/ui-guidelines.md 5 章
 */
// 説明の吹き出しが窓より高くなる件（360:record-11-info-tap。#110）は、説明のシート（最大 86dvh・中のスクロール）で解いた（#129）
const ZOOM_KNOWN = {};
/** 下のタブ 4 つと真ん中の ［＋ 記録］（V6。ui-guidelines 9.2・#127） */
const NAV_HREFS = ['/', '/trades', '/record', '/review', '/settings'];
/** 全画面のシートの画面（下のタブを隠す。9.2・A2） */
const SHEET_PATHS = (path) => path === '/record' || path.endsWith('/edit');
const AUTH_EMULATOR = 'http://127.0.0.1:9099';

/** エミュレーターのログインの画面（ポップアップ）で、架空のアカウントを自動生成してログインする */
async function loginViaPopup(page) {
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: 'Google でログイン' }).click(),
  ]);
  await popup.locator('#add-account-button').click({ timeout: 20000 });
  await popup.locator('#autogen-button').click();
  await popup.locator('#sign-in').click();
  await popup.waitForEvent('close', { timeout: 20000 }).catch(() => {});
}

/** テーマを端末の記憶に入れ、--inject-wide なら幅の広い要素を足す */
async function setupContext(context, theme, zoom = false) {
  await context.addInitScript(
    ([key, t]) => {
      try {
        localStorage.setItem(key, t);
      } catch {}
    },
    [THEME_KEY, theme],
  );
  if (zoom) {
    await context.addInitScript((css) => {
      const add = () => {
        const st = document.createElement('style');
        st.setAttribute('data-ui-check-zoom', '');
        st.textContent = css;
        document.head.appendChild(st);
      };
      if (document.head) add();
      else document.addEventListener('DOMContentLoaded', add);
    }, zoomCss());
  }
  if (zoom && opts.injectClip) {
    // 拡大の見本（--zoom --inject-clip）: px の決め打ちの文字（拡大の漏れ 1 件）と、行の高さの決め打ち（行の重なり 1 件）。
    // 窓の上の外に置き、ページの文字とは重ならない
    await context.addInitScript(() => {
      const add = () => {
        const box = document.createElement('div');
        box.setAttribute('data-ui-check-zoom-sample', '');
        box.style.cssText = 'position:absolute;left:0;top:-400px;width:200px';
        const a = document.createElement('p');
        a.style.cssText = 'font-size:12px !important;margin:0';
        a.textContent = '拡大の漏れの見本';
        const b = document.createElement('p');
        b.style.cssText = 'line-height:10px;margin:100px 0 0';
        b.textContent = '行の重なりの見本';
        box.append(a, b);
        document.body.appendChild(box);
      };
      if (document.body) add();
      else document.addEventListener('DOMContentLoaded', add);
    });
  }
  if (opts.injectClip) {
    await context.addInitScript(() => {
      const add = () => {
        const box = document.createElement('div');
        box.setAttribute('data-ui-check-clip', '');
        box.style.cssText = 'position:absolute;left:0;top:0;width:200px';
        // (1) overflow: hidden の狭い親で切れるバッジ
        const a = document.createElement('div');
        a.style.cssText = 'width:60px;overflow:hidden';
        const badge = document.createElement('span');
        badge.className = 'badge badge--plan';
        badge.textContent = '計画どおりの勝ちの見本';
        a.append(badge);
        // (2) 親より広がるボタン（隣に重なる）
        const b = document.createElement('div');
        b.style.cssText = 'width:60px';
        const btn = document.createElement('button');
        btn.className = 'btn btn--primary';
        btn.textContent = 'とても長いボタンの文字';
        b.append(btn);
        // (3) 文字が縦に切れるボタン
        const tall = document.createElement('button');
        tall.className = 'btn btn--secondary';
        tall.style.cssText =
          'height:20px;min-height:0;overflow:hidden;white-space:normal;width:44px';
        tall.textContent = '縦に長い文字の見本';
        // (4) カード → 枠 → ボタンの 3 段の入れ子（入れ子の検査の見本。Issue #33 AC-5。1 画面 1 件）
        const card = document.createElement('div');
        card.className = 'card';
        card.style.cssText = 'padding:8px';
        const frame = document.createElement('div');
        frame.style.cssText = 'padding:8px;border:1px solid currentColor';
        const inner = document.createElement('button');
        inner.className = 'btn btn--secondary';
        inner.textContent = '入れ子';
        frame.append(inner);
        card.append(frame);
        box.append(a, b, tall, card);
        document.body.appendChild(box);
      };
      if (document.body) add();
      else document.addEventListener('DOMContentLoaded', add);
    });
  }
  if (opts.injectWide) {
    await context.addInitScript((px) => {
      const add = () => {
        const el = document.createElement('div');
        el.setAttribute('data-ui-check-wide', '');
        el.style.cssText = `position:absolute;left:0;top:0;width:${px}px;height:1px`;
        document.body.appendChild(el);
      };
      if (document.body) add();
      else document.addEventListener('DOMContentLoaded', add);
    }, opts.injectWide);
  }
}

// ── 偽の記録の API（記憶の中だけ。値はすべて架空。形は api/src/loss_note_api/routes.py に合わせる） ──
const FAKE_US30 = {
  id: 'inst-us30',
  name: 'US30',
  underlyingKind: 'index',
  productForm: 'spotCfd',
  priceCurrency: null,
  multiplier: 1,
  quantityStep: 1,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

/** 前に記録した架空の取引（開いたときの既定 R1 の確かめ: 銘柄 US30・数量 2） */
function fakeTrade(id, instrumentId, quantity, createdAt) {
  return {
    id,
    schemaVersion: 1,
    createdAt,
    updatedAt: createdAt,
    snapshot: {
      instrument: {
        multiplier: 1,
        quantityStep: 1,
        priceCurrency: null,
        underlyingKind: 'index',
        productForm: 'spotCfd',
      },
      capitalYen: null,
      riskTolerancePct: 1,
    },
    record: {
      status: 'closed',
      source: 'manual',
      instrumentId,
      side: 'L',
      lc: 99.5,
      lcBasis: 'chart',
      stopOrderPlaced: 'unanswered',
      lcDecidedBeforeEntry: true,
      lcMove: { kind: 'none' },
      timeframeChange: 'none',
      entries: [{ price: 100, quantity }],
      exit: {
        time: createdAt,
        price: 99.5,
        orderType: 'unknown',
        reason: 'other',
        gapSlip: 'unanswered',
      },
      fees: [],
    },
  };
}

// ── 取引の一覧・詳細・直すの例（Issue #9 の例の表 L1〜L3・D1・D2・E1・E2・H1。値はすべて架空）──
// 作った時刻はすべて t-last（1700000100000）より前（記録する画面の既定 R1 を変えない）。
// 損益 = (決済 − イン) × 数量。資金 1,000,000 円（L2 は資金なし）
const DAY_MS = 86400000;
const T_1110 = Date.UTC(2026, 10, 10, 0, 0);
const SNAP = {
  instrument: {
    multiplier: 1,
    quantityStep: 1,
    priceCurrency: null,
    underlyingKind: 'index',
    productForm: 'spotCfd',
  },
  capitalYen: 1000000,
  riskTolerancePct: 1,
};
function exampleTrade(id, createdAt, over = {}, top = {}) {
  const record = {
    status: 'closed',
    source: 'manual',
    instrumentId: FAKE_US30.id,
    side: 'L',
    lc: 99.5,
    lcBasis: 'chart',
    stopOrderPlaced: 'unanswered',
    lcDecidedBeforeEntry: true,
    lcMove: { kind: 'none' },
    timeframeChange: 'none',
    entries: [{ price: 100, quantity: 10000 }],
    exit: {
      time: T_1110,
      price: 99.5,
      orderType: 'unknown',
      reason: 'other',
      gapSlip: 'unanswered',
    },
    fees: [],
    statementPnlYen: -5000,
    ...over,
  };
  for (const k of Object.keys(record)) if (record[k] === undefined) delete record[k];
  return { id, schemaVersion: 1, createdAt, updatedAt: createdAt, snapshot: SNAP, record, ...top };
}
const TX_L1 = exampleTrade('x-l1', 1700000000001);
const TX_L2 = exampleTrade(
  'x-l2',
  1700000000002,
  {
    side: 'S',
    lc: 150.5,
    entries: [{ price: 150, quantity: 10000 }],
    exit: {
      time: T_1110 + 2 * DAY_MS,
      price: 149,
      orderType: 'unknown',
      reason: 'tp',
      gapSlip: 'unanswered',
    },
    statementPnlYen: 10000,
  },
  { snapshot: { ...SNAP, capitalYen: null } },
);
const TX_L3 = exampleTrade('x-l3', 1700000000003, {
  lc: undefined,
  lcDecidedBeforeEntry: false,
  entries: [{ price: 100, quantity: 3000 }],
  exit: {
    time: T_1110 + DAY_MS,
    price: 101,
    orderType: 'unknown',
    reason: 'other',
    gapSlip: 'unanswered',
  },
  statementPnlYen: 3000,
});
const D1_RECORD = {
  lcMove: { kind: 'widened', after: 99.2 },
  exit: {
    time: T_1110 - DAY_MS,
    price: 99.2,
    orderType: 'unknown',
    reason: 'other',
    gapSlip: 'unanswered',
  },
  statementPnlYen: -8000,
  entryChartTimeframe: '4h',
};
const TX_D1 = exampleTrade(
  'x-d1',
  1700000000004,
  { ...D1_RECORD, exitChartTimeframe: '1d' },
  {
    charts: {
      entry: { contentType: 'image/png', size: 1 },
      exit: { contentType: 'image/png', size: 1 },
    },
  },
);
const TX_D2 = exampleTrade(
  'x-d2',
  1700000000005,
  { ...D1_RECORD, exit: { ...D1_RECORD.exit, time: T_1110 - 2 * DAY_MS } },
  { charts: { entry: { contentType: 'image/png', size: 1 } } },
);
const TX_E1 = exampleTrade('x-e1', 1700000000006, {
  lcMove: { kind: 'widened', after: 99.2 },
  exit: {
    time: T_1110 - 3 * DAY_MS,
    price: 99.5,
    orderType: 'unknown',
    reason: 'other',
    gapSlip: 'unanswered',
  },
});
const TX_E2 = exampleTrade('x-e2', 1700000000007, {
  exit: {
    time: T_1110 - 4 * DAY_MS,
    price: 99.5,
    orderType: 'unknown',
    reason: 'other',
    gapSlip: 'unanswered',
  },
  entryChartTimeframe: '4h',
  exitChartTimeframe: '1d',
});
/** Issue #34 の撮影の場面（物差し）: 危ない勝ちで LC を広げていた（L）・TP を入れた（L）・ショートで LC を広げた。架空の値。
 * 決済の時刻は一覧・ホームの並びの後ろ（既存の手順の件数・並びを変えない） */
const rulerExit = (days, price, reason = 'other') => ({
  time: T_1110 - days * DAY_MS,
  price,
  orderType: 'unknown',
  reason,
  gapSlip: 'unanswered',
});
const TX_R1 = exampleTrade('x-r1', 1700000000011, {
  lcMove: { kind: 'widened', after: 99.2 },
  exit: rulerExit(20, 100.75),
  statementPnlYen: 7500,
});
const TX_R2 = exampleTrade('x-r2', 1700000000012, {
  tp: 101,
  exit: rulerExit(21, 101, 'tp'),
  statementPnlYen: 10000,
});
const TX_R3 = exampleTrade('x-r3', 1700000000013, {
  side: 'S',
  lc: 150.5,
  // エントリーの時刻は決済の 2 日 4 時間前（詳細の見出しの下の行に保有時間。#58）
  entries: [{ price: 150, quantity: 10000, time: T_1110 - 22 * DAY_MS - 2 * DAY_MS - 4 * 3600000 }],
  lcMove: { kind: 'widened', after: 150.8 },
  exit: rulerExit(22, 150.8),
  statementPnlYen: -8000,
});
const EXAMPLE_TRADES = [TX_L1, TX_L2, TX_L3, TX_D1, TX_D2, TX_E1, TX_E2, TX_R1, TX_R2, TX_R3];
/**
 * Issue #88 の例の表 S1 の 7 件（架空の値）。決済は端末の今日から 6 日前〜今日の 10:00（7 日・3 か月に入り、1 日は今日の 1 件）。
 * 1 A −1.0R・2 計画どおりの勝ち +2.0R・3 B LC を広げた −1.6R・4 危ない勝ち +0.5R・5 C LC なし・6 A −0.8R・7 計画どおりの勝ち +1.2R
 */
function reviewExit(daysAgo) {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() - daysAgo, 10, 0).getTime();
}
function reviewTrade(i, id, price, over = {}, source = 'manual') {
  return exampleTrade(id, 1700000001000 + i, {
    source,
    exit: {
      time: reviewExit(6 - i),
      price,
      orderType: 'unknown',
      reason: 'other',
      gapSlip: 'unanswered',
    },
    statementPnlYen: Math.round((price - 100) * 10000),
    ...over,
  });
}
const REVIEW_S1 = [
  reviewTrade(0, 'rv-1', 99.5),
  reviewTrade(1, 'rv-2', 101),
  reviewTrade(2, 'rv-3', 99.2, { lcMove: { kind: 'widened', after: 99.2 } }),
  reviewTrade(3, 'rv-4', 100.25, { timeframeChange: 'longer' }),
  reviewTrade(4, 'rv-5', 99, { lc: undefined, lcDecidedBeforeEntry: false }),
  reviewTrade(5, 'rv-6', 99.6),
  reviewTrade(6, 'rv-7', 100.6),
];
/** S4 の取り込んだ取引 2 件（A −1.0R・B −1.3R） */
const REVIEW_IMPORTS = [
  reviewTrade(1, 'rv-i1', 99.5, {}, 'import'),
  reviewTrade(2, 'rv-i2', 99.35, { lcMove: { kind: 'widened', after: 99.3 } }, 'import'),
];
/** S2: 判定の出た取引 3 件（A 1・B 2） */
const REVIEW_S2 = REVIEW_S1.slice(0, 3);
/** 差が無い期間（S1 から 3 番の B を除く） */
const REVIEW_NOGAP = REVIEW_S1.filter((t) => t.id !== 'rv-3');
/** 差も曲線の外の取引も無い期間（「崩れなし ±0.0R」） */
const REVIEW_CLEAN = REVIEW_S1.filter((t) => t.id !== 'rv-3' && t.id !== 'rv-5');
/** 今日から 120 日前に決済した取引だけ（1 日・7 日・1 か月・3 か月はどれも 0 件） */
const REVIEW_OLD = REVIEW_S1.map((t) => ({
  ...t,
  record: { ...t.record, exit: { ...t.record.exit, time: reviewExit(120) } },
}));
/** 大きな負け（LC を広げて −8.0R の B）が 1 件ある期間 */
const REVIEW_BIG = [
  ...REVIEW_S1,
  reviewTrade(6, 'rv-big', 96, { lcMove: { kind: 'widened', after: 95.5 } }),
];
/** 取引の多い期間（合成 120 件。決済は今日から 0〜84 日前。10 件に 1 件が LC を広げた −1.5R の B） */
const REVIEW_MANY = Array.from({ length: 120 }, (_, i) => {
  const daysAgo = Math.floor((119 - i) * 0.7);
  const price = i % 10 === 0 ? 99.25 : i % 3 === 0 ? 99.5 : 100.4;
  return exampleTrade(`rv-m${i}`, 1700000100000 + i, {
    exit: {
      time: reviewExit(daysAgo) + (i % 5) * 60000,
      price,
      orderType: 'unknown',
      reason: 'other',
      gapSlip: 'unanswered',
    },
    statementPnlYen: Math.round((price - 100) * 10000),
    ...(i % 10 === 0 ? { lcMove: { kind: 'widened', after: 99.2 } } : {}),
  });
});
/** #47 PR-2: JPY の口座 × USD 建て・為替 150 の取引（詳細の外貨建ての測りで一時だけ足す。架空の値） */
/** Issue #89: エントリー時・決済時 + 追加のチャート 5 枚（一言の有り無し・時間足の有り無しを混ぜる。値は架空） */
const CHART_META = { contentType: 'image/png', size: 1 };
const TX_C7 = exampleTrade(
  'x-c7',
  1700000000040,
  {
    ...D1_RECORD,
    exitChartTimeframe: '1d',
    extraCharts: [
      { slot: 'x2', timeframe: '1w', note: '上位足の環境（週足の高値の下）' },
      { slot: 'x1', timeframe: '15m', note: '下位足のタイミング' },
      { slot: 'x3' },
      { slot: 'x5', note: '指標の予定の画面' },
      { slot: 'x4', timeframe: '1h' },
    ],
  },
  {
    charts: Object.fromEntries(
      ['entry', 'exit', 'x1', 'x2', 'x3', 'x4', 'x5'].map((slot) => [slot, CHART_META]),
    ),
  },
);

const TX_FX = exampleTrade(
  'x-fx',
  1700000000021,
  {
    instrumentId: 'inst-usd',
    entries: [{ price: 100, quantity: 100 }],
    exit: { ...rulerExit(30, 99.5, 'lc'), fxRate: 150 },
    statementPnlYen: undefined,
  },
  {
    snapshot: {
      ...SNAP,
      instrument: { ...SNAP.instrument, priceCurrency: 'USD' },
      accountCurrency: 'JPY',
    },
  },
);
/** #47 PR-2: USD の口座・USD 建ての取引（明細の損益 −51.50 USD・手数料 1.50 USD。詳細の測りで一時だけ足す。架空の値） */
const TX_FXU = exampleTrade(
  'x-fxu',
  1700000000022,
  {
    instrumentId: 'inst-usd',
    accountId: 'acc-usd',
    entries: [{ price: 100, quantity: 100 }],
    exit: rulerExit(31, 99.5, 'lc'),
    statementPnlYen: -51.5,
    fees: [{ amountYen: 1.5 }],
  },
  {
    snapshot: {
      ...SNAP,
      instrument: { ...SNAP.instrument, priceCurrency: 'USD' },
      capitalYen: 10000,
      accountCurrency: 'USD',
    },
  },
);
/** H1: 決済の時刻の違う 7 件（新しい方から 2 件目が危ない勝ち = L3 の形） */
const TX_H1 = Array.from({ length: 7 }, (_, i) => {
  const base = i === 1 ? TX_L3 : TX_L1;
  return exampleTrade(`x-h${i}`, 1700000000010 + i, {
    ...base.record,
    exit: { ...base.record.exit, time: T_1110 - i * DAY_MS },
  });
});

/** 架空のチャートの画像（無圧縮の画素を deflate した小さな PNG。縞の色で枠を見分ける） */
function makePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const k = (x >> 3) % 2 === 0 ? 1 : 0.6;
      raw[row + 1 + x * 3] = Math.round(rgb[0] * k);
      raw[row + 2 + x * 3] = Math.round(rgb[1] * k);
      raw[row + 3 + x * 3] = Math.round(rgb[2] * k);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // ビットの深さ
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const CHART_PNG = {
  entry: makePng(480, 300, [40, 160, 120]),
  exit: makePng(480, 300, [200, 120, 40]),
  // 追加のチャート（Issue #89）
  x1: makePng(480, 300, [70, 110, 200]),
  x2: makePng(480, 300, [150, 80, 180]),
  x3: makePng(480, 300, [60, 150, 170]),
  x4: makePng(480, 300, [180, 160, 60]),
  x5: makePng(480, 300, [120, 120, 120]),
};
/** API の trade_sort_key と同じ並び（決済の時刻の新しい順 → 作った時刻の新しい順 → ID） */
const tradeSort = (a, b) =>
  b.record.exit.time - a.record.exit.time ||
  b.createdAt - a.createdAt ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** API の order=created と同じ並び（作った時刻の新しい順 → ID の降順。Issue #87） */
const createdSort = (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

// ── 偽の読み取りの応答の行（Issue #15 の例の表。値は架空。形は normalize_row と同じ 12 の鍵） ──
const pad2 = (n) => String(n).padStart(2, '0');
function jstTime(y, mo, d, h, mi) {
  const written = `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}`;
  return {
    written,
    timeZone: 'JST',
    jst: written,
    epochMs: Date.UTC(y, mo - 1, d, h, mi) - 9 * 3600000,
  };
}
const READ_E1 = {
  symbol: '架空指数A',
  side: 'L',
  entryPrice: 100,
  exitPrice: 99,
  quantity: 2,
  pnl: -2000,
  pnlCurrency: 'JPY',
  entryTime: jstTime(2026, 11, 10, 9, 5),
  exitTime: jstTime(2026, 11, 10, 10, 30),
  timeZoneNeedsCheck: false,
  fees: [100, 50],
  feesTotal: 150,
  exitOrderType: 'unknown',
};
/** 3 行。行 1 は決済の時刻の時間帯が明細に無い（E9 + E10） */
const READ_E10 = [
  {
    ...READ_E1,
    entryTime: null,
    exitTime: { written: '2026-11-10T10:30', timeZone: 'unknown', jst: null, epochMs: null },
    timeZoneNeedsCheck: true,
  },
  { ...READ_E1, symbol: '架空指数C', side: 'S', entryPrice: 200, exitPrice: 201.5, quantity: 1 },
  { ...READ_E1, symbol: '架空指数D', entryPrice: 50, exitPrice: 51, quantity: 3, pnl: 3000 },
];
const SYNTHETIC_STATEMENT = 'tools/statement-eval/synthetic/s05.png';

/**
 * 文脈の /api/** を偽の記録の API に置き換える。opts.capitalYen（資金）、opts.failTrades（POST /api/trades の状態）、
 * opts.delayMs（POST /api/trades を待たせる）。返す api.posts で保存の要求を数える。
 * 設定（Issue #5）: api.settings は書き換えてよい（PUT /api/settings で変わる。資金が変わったときだけ履歴に足す）。
 * PUT /api/instruments/<id> は本文に無い欄を既定に戻し、名前が自分以外と同じなら 409。設定・銘柄の書き込みは api.writes に残す
 * POST /api/statement-reads は api.read（{ status, rows, holdMs }。後から書き換えてよい）で答え、要求の
 * Content-Type と本文のバイト列を api.reads に残す（このスクリプトの記憶の中だけ）。api.read.profile（#66。明細の特徴の
 * 鍵と提案の口座。省けば null）を応答に足す。PUT /api/statement-profiles/<鍵> は 204 で api.profiles に残す
 * 口座（Issue #47）: api.accounts（opts.accounts。書き換えてよい）。既定の口座 default（「口座 1」）が無ければ、口座を読む・使う
 * 入口で api.settings から作る（本物の移し替えと同じ）。取引の snapshot の資金・許容リスクは取引の口座から写し、PUT で口座を
 * 付け替えたときだけ付け替え先の今の値で写し直す。opts.failAccounts は PUT /api/accounts/<id> の状態
 * POST /api/chart-reads（Issue #27）は api.chartTimeframes の先頭から順に時間足を返す（無ければ null = 読めなかった）。
 * api.chartRead（{ status, kind, holdMs }。後から書き換えてよい）で状態・種類・待ちを変える。要求の数を api.chartReads に残す
 * 口座の通貨（Issue #47 PR-2）: 口座はいつも currency を返す（無い = JPY）。POST / PUT の currency は任意（PUT の省略は今のまま）。
 * 取引のある口座の通貨を変える PUT は 409 currencyLocked。取引の snapshot に口座の通貨（accountCurrency）を写す
 */
async function installFakeApi(context, opts = {}) {
  const api = {
    instruments: [FAKE_US30],
    trades: opts.trades
      ? [...opts.trades]
      : [fakeTrade('t-last', FAKE_US30.id, 2, 1700000100000), ...EXAMPLE_TRADES],
    /** 取引の PUT・DELETE・チャートの GET（Issue #9） */
    puts: [],
    /** 取引の一覧の GET のクエリ（Issue #87。件数・カーソル・並び） */
    tradeGets: [],
    /** 取引の一覧のページの応答を待たせる（ミリ秒。Issue #87 の読み込み中の確かめ） */
    tradesPageDelayMs: 0,
    /** 決済の時刻の範囲の読み（Issue #88）の状態（200 以外 = 振り返りだけ失敗させる） */
    rangeStatus: 200,
    /** 決済の時刻の範囲の応答を待たせる（ミリ秒。読み込み中の状態を撮る） */
    rangeHoldMs: 0,
    deletes: [],
    chartGets: [],
    /** 取引の PUT のチャートの変更（Issue #89） */
    chartPuts: [],
    posts: [],
    chartPosts: [],
    read: { status: 200, rows: [READ_E1], holdMs: 0 },
    reads: [],
    profiles: [],
    chartTimeframes: [],
    chartRead: { status: 200, kind: 'chart', holdMs: 0 },
    chartReads: 0,
    settings: {
      capitalYen: opts.capitalYen ?? null,
      riskTolerancePct: 1,
      performanceUnit: 'R',
      capitalHistory: [],
    },
    writes: [],
    accounts: [...(opts.accounts ?? [])],
    /** GET /api/ai-usage の応答（Issue #62。{ status, body, holdMs }。後から書き換えてよい） */
    aiUsage: { status: 200, body: FAKE_AI_USAGE },
  };
  let seq = 0;
  let clock = 1800000000000;
  const settings = () => api.settings;
  /** 名前の同一視（API の name_key と同じ） */
  const nameKey = (n) => n.normalize('NFKC').toUpperCase().toLowerCase().trim();
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  /** 既定の口座が無ければ設定から作る（移し替え） */
  const ensureDefault = () => {
    if (api.accounts.some((a) => a.id === 'default')) return;
    const s = api.settings;
    api.accounts.push({
      id: 'default',
      name: '口座 1',
      capitalYen: s.capitalYen,
      riskTolerancePct: s.riskTolerancePct,
      capitalHistory: [...s.capitalHistory],
      createdAt: clock,
      updatedAt: clock,
    });
  };
  const sortedAccounts = () =>
    [...api.accounts].sort(
      (a, b) => cmp(nameKey(a.name), nameKey(b.name)) || cmp(a.name, b.name) || cmp(a.id, b.id),
    );
  const okCap = (cap) => cap === null || (typeof cap === 'number' && cap > 0);
  const okRisk = (risk) => typeof risk === 'number' && risk >= 0.5 && risk <= 3;
  const okCurrency = (c) => typeof c === 'string' && /^[A-Z]{3}$/.test(c);
  const currencyOf = (a) => a.currency || 'JPY';
  const withCurrency = (a) => ({ ...a, currency: currencyOf(a) });
  const json = (route, status, body) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await context.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const key = `${req.method()} ${path}`;
    if (key === 'POST /api/statement-reads') {
      api.reads.push({
        contentType: req.headers()['content-type'] ?? '',
        body: req.postDataBuffer() ?? Buffer.alloc(0),
      });
      const r = api.read;
      if (r.holdMs) {
        await new Promise((ok) => {
          const t = setTimeout(ok, r.holdMs);
          t.unref?.();
        });
      }
      try {
        return await json(
          route,
          r.status,
          r.status === 200
            ? { kind: 'statement', rows: r.rows, profile: r.profile ?? null }
            : { error: 'read_unavailable', detail: 'SECRET-本文' },
        );
      } catch {
        return undefined; // 待たせている間に画面を離れた
      }
    }
    const profileM = /^\/api\/statement-profiles\/([0-9a-f]{32})$/.exec(path);
    if (req.method() === 'PUT' && profileM) {
      api.profiles.push({ key: profileM[1], body: JSON.parse(req.postData() ?? '{}') });
      return route.fulfill({ status: 204 });
    }
    if (key === 'POST /api/chart-reads') {
      api.chartReads++;
      const r = api.chartRead;
      if (r.holdMs) {
        await new Promise((ok) => {
          const t = setTimeout(ok, r.holdMs);
          t.unref?.();
        });
      }
      try {
        if (r.status !== 200) return await json(route, r.status, { error: 'read_unavailable' });
        const timeframe = r.kind === 'chart' ? (api.chartTimeframes.shift() ?? null) : null;
        return await json(route, 200, { kind: r.kind, timeframe });
      } catch {
        return undefined; // 待たせている間に画面を離れた
      }
    }
    // 取引の作成の multipart（#12）: 部分 record（JSON の文字）+ entryChart / exitChart（画像）
    const ctype = req.headers()['content-type'] ?? '';
    let body;
    let chartParts = null;
    let chartRemoves = [];
    if (ctype.startsWith('multipart/form-data')) {
      const fd = await new Response(req.postDataBuffer(), {
        headers: { 'Content-Type': ctype },
      }).formData();
      body = JSON.parse(String(fd.get('record')));
      chartParts = {};
      chartRemoves = fd.getAll('removeChart').map(String);
      for (const slot of ['entry', 'exit', 'x1', 'x2', 'x3', 'x4', 'x5']) {
        const f = fd.get(`${slot}Chart`);
        if (f && typeof f !== 'string') {
          chartParts[slot] = { type: f.type, bytes: Buffer.from(await f.arrayBuffer()) };
        }
      }
      api.chartPosts.push({ parts: [...fd.keys()], charts: chartParts });
    } else {
      body = req.postData() ? JSON.parse(req.postData()) : undefined;
    }
    if (key === 'GET /api/trades') {
      // ページ分け（Issue #87。本物の trade_pages.py と同じ並びと切り出し。カーソルは並びの鍵の JSON）
      const q = new URL(req.url()).searchParams;
      api.tradeGets.push(q.toString());
      // 決済の時刻の範囲（Issue #88。本物の trade_range.py と同じ境目: 開始を含み終了を含まない。367 日まで）
      if (q.has('exitFrom') || q.has('exitTo')) {
        const from = Number(q.get('exitFrom'));
        const to = Number(q.get('exitTo'));
        if (!(from >= 0 && to > from && to - from <= 367 * 86400000) || q.has('limit')) {
          return json(route, 400, { error: 'invalid' });
        }
        if (api.rangeHoldMs) {
          await new Promise((ok) => {
            const t = setTimeout(ok, api.rangeHoldMs);
            t.unref?.();
          });
        }
        if (api.rangeStatus !== 200) {
          try {
            return await json(route, api.rangeStatus, { error: 'unavailable' });
          } catch {
            return undefined; // 待たせている間に画面を離れた
          }
        }
        const items = api.trades
          .filter((t) => t.record.exit.time >= from && t.record.exit.time < to)
          .sort(tradeSort);
        try {
          return await json(route, 200, {
            items: items.slice(0, 2000),
            truncated: items.length > 2000,
          });
        } catch {
          return undefined; // 待たせている間に画面を離れた
        }
      }
      if (!q.has('limit')) return json(route, 200, { items: [...api.trades].sort(tradeSort) });
      const limit = Number(q.get('limit'));
      const order = q.get('order') ?? 'exit';
      if (!(limit >= 1 && limit <= 100) || (order !== 'exit' && order !== 'created')) {
        return json(route, 400, { error: 'invalid' });
      }
      const cmp = order === 'exit' ? tradeSort : createdSort;
      const sorted = [...api.trades].sort(cmp);
      let start = 0;
      if (q.has('cursor')) {
        const k = JSON.parse(Buffer.from(q.get('cursor'), 'base64url').toString('utf8'));
        const at = { id: k.id, createdAt: k.c, record: { exit: { time: k.t } } };
        start = sorted.findIndex((t) => cmp(t, at) > 0);
        if (start < 0) start = sorted.length;
      }
      if (api.tradesPageDelayMs) await new Promise((ok) => setTimeout(ok, api.tradesPageDelayMs));
      const items = sorted.slice(start, start + limit);
      const last = items.at(-1);
      const next =
        start + limit < sorted.length && last
          ? Buffer.from(
              JSON.stringify({ t: last.record.exit.time, c: last.createdAt, id: last.id }),
            ).toString('base64url')
          : null;
      return json(route, 200, { items, next });
    }
    // 取引 1 件・チャート（Issue #9。形は routes.py の get_trade / update_trade / delete_trade / get_chart）
    const chartM = /^\/api\/trades\/([^/]+)\/charts\/([^/]+)$/.exec(path);
    if (chartM && req.method() === 'GET') {
      const id = decodeURIComponent(chartM[1]);
      api.chartGets.push(`${id}-${chartM[2]}`);
      const t = api.trades.find((x) => x.id === id);
      const png = CHART_PNG[chartM[2]];
      if (!t?.charts?.[chartM[2]] || !png) return json(route, 404, { error: 'not_found' });
      return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    }
    const tradeM = /^\/api\/trades\/([^/]+)$/.exec(path);
    if (tradeM) {
      const id = decodeURIComponent(tradeM[1]);
      const idx = api.trades.findIndex((x) => x.id === id);
      if (idx < 0) return json(route, 404, { error: 'not_found' });
      const prev = api.trades[idx];
      if (req.method() === 'GET') return json(route, 200, prev);
      if (req.method() === 'DELETE') {
        api.deletes.push(id);
        api.trades.splice(idx, 1);
        return route.fulfill({ status: 204, body: '' });
      }
      if (req.method() === 'PUT') {
        // ?snapshot=current（#31）: 銘柄・口座が同じでも今の値で写し直す（routes.py の update_trade と同じ）
        const query = new URL(req.url()).search;
        const resnap = query === '?snapshot=current';
        api.puts.push({ id, body, query });
        const inst = api.instruments.find((i) => i.id === body.instrumentId);
        if (!inst) return json(route, 400, { error: 'invalid' });
        // チャートの変更（Issue #89。multipart の PUT: 差し替え・足す画像 + 外す枠）。直した後の枠で時間足を見る
        const nextCharts = {};
        for (const slot of ['entry', 'exit', 'x1', 'x2', 'x3', 'x4', 'x5']) {
          if (chartParts?.[slot])
            nextCharts[slot] = { contentType: chartParts[slot].type, size: 1 };
          else if (prev.charts?.[slot] && !chartRemoves.includes(slot))
            nextCharts[slot] = prev.charts[slot];
        }
        api.chartPuts.push({ id, parts: Object.keys(chartParts ?? {}), removes: chartRemoves });
        for (const slot of ['entry', 'exit']) {
          if (body[`${slot}ChartTimeframe`] !== undefined && !nextCharts[slot]) {
            return json(route, 400, { error: 'invalid', issues: [{ kind: 'noChart' }] });
          }
        }
        // 口座を付け替えたときだけ、付け替え先の今の資金・許容リスクで写し直す（本文に口座が無ければ前の口座のまま）
        const prevAcc = prev.record.accountId || 'default';
        const target = body.accountId ?? prevAcc;
        let moved = null;
        if (resnap || target !== prevAcc) {
          ensureDefault();
          moved = api.accounts.find((a) => a.id === target);
          if (!moved) return json(route, 400, { error: 'invalid' });
        }
        clock += 1;
        const changed = resnap || inst.id !== prev.record.instrumentId;
        const snap = changed
          ? {
              ...prev.snapshot,
              instrument: {
                multiplier: inst.multiplier,
                quantityStep: inst.quantityStep,
                priceCurrency: inst.priceCurrency,
                underlyingKind: inst.underlyingKind,
                productForm: inst.productForm,
              },
            }
          : prev.snapshot;
        const { charts: _prevCharts, ...prevRest } = prev;
        const next = {
          ...prevRest,
          ...(Object.keys(nextCharts).length > 0 ? { charts: nextCharts } : {}),
          updatedAt: clock,
          snapshot: moved
            ? {
                ...snap,
                capitalYen: moved.capitalYen,
                riskTolerancePct: moved.riskTolerancePct,
                accountCurrency: currencyOf(moved),
              }
            : snap,
          record:
            body.accountId === undefined && prev.record.accountId !== undefined
              ? { ...body, accountId: prev.record.accountId }
              : body,
        };
        api.trades[idx] = next;
        return json(route, 200, next);
      }
    }
    if (key === 'GET /api/accounts') {
      ensureDefault();
      return json(route, 200, { items: sortedAccounts().map(withCurrency) });
    }
    if (key === 'POST /api/accounts') {
      api.writes.push({ key, body });
      ensureDefault();
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const cap = body.capitalYen ?? null;
      const risk = body.riskTolerancePct ?? 1;
      const currency = body.currency ?? 'JPY';
      if (name === '' || !okCap(cap) || !okRisk(risk) || !okCurrency(currency))
        return json(route, 400, { error: 'invalid' });
      if (api.accounts.some((a) => nameKey(a.name) === nameKey(name))) {
        return json(route, 409, { error: 'conflict', reason: 'duplicateName' });
      }
      clock += 1;
      const acc = {
        id: `acc-${++seq}`,
        name,
        currency,
        capitalYen: cap,
        riskTolerancePct: risk,
        capitalHistory: cap === null ? [] : [{ valueYen: cap, at: clock, currency }],
        createdAt: clock,
        updatedAt: clock,
      };
      api.accounts.push(acc);
      return json(route, 201, acc);
    }
    const accountM = /^\/api\/accounts\/([^/]+)$/.exec(path);
    if (accountM) {
      ensureDefault();
      const id = decodeURIComponent(accountM[1]);
      const idx = api.accounts.findIndex((a) => a.id === id);
      if (idx < 0) return json(route, 404, { error: 'not_found' });
      const prev = api.accounts[idx];
      if (req.method() === 'GET') return json(route, 200, withCurrency(prev));
      if (req.method() === 'PUT') {
        api.writes.push({ key, body });
        if (opts.failAccounts) return json(route, opts.failAccounts, { error: 'unavailable' });
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const prevCurrency = currencyOf(prev);
        const currency = body.currency ?? prevCurrency;
        if (
          name === '' ||
          !okCap(body.capitalYen) ||
          !okRisk(body.riskTolerancePct) ||
          !okCurrency(currency)
        ) {
          return json(route, 400, { error: 'invalid' });
        }
        if (
          currency !== prevCurrency &&
          api.trades.some((t) => (t.record.accountId || 'default') === id)
        ) {
          return json(route, 409, { error: 'conflict', reason: 'currencyLocked' });
        }
        if (api.accounts.some((a) => a.id !== id && nameKey(a.name) === nameKey(name))) {
          return json(route, 409, { error: 'conflict', reason: 'duplicateName' });
        }
        clock += 1;
        const next = {
          id,
          name,
          currency,
          capitalYen: body.capitalYen,
          riskTolerancePct: body.riskTolerancePct,
          capitalHistory:
            body.capitalYen === prev.capitalYen && currency === prevCurrency
              ? prev.capitalHistory
              : [...prev.capitalHistory, { valueYen: body.capitalYen, at: clock, currency }],
          createdAt: prev.createdAt,
          updatedAt: clock,
        };
        api.accounts[idx] = next;
        return json(route, 200, next);
      }
    }
    if (key === 'GET /api/instruments') return json(route, 200, { items: api.instruments });
    if (key === 'GET /api/settings') return json(route, 200, settings());
    if (key === 'POST /api/instruments') {
      api.writes.push({ key, body });
      if (api.instruments.some((i) => nameKey(i.name) === nameKey(body.name))) {
        return json(route, 409, { error: 'conflict', reason: 'duplicateName' });
      }
      clock += 1;
      const inst = {
        id: `inst-${++seq}`,
        name: body.name.trim(),
        underlyingKind: 'other',
        productForm: 'spotCfd',
        priceCurrency: null,
        multiplier: 1,
        quantityStep: 1,
        createdAt: clock,
        updatedAt: clock,
      };
      api.instruments.push(inst);
      return json(route, 201, inst);
    }
    if (key === 'PUT /api/settings') {
      api.writes.push({ key, body });
      if (opts.failSettings) return json(route, opts.failSettings, { error: 'unavailable' });
      const cap = body.capitalYen;
      const risk = body.riskTolerancePct;
      if (
        !(cap === null || (typeof cap === 'number' && cap > 0)) ||
        !(typeof risk === 'number' && risk >= 0.5 && risk <= 3) ||
        !['R', 'yen'].includes(body.performanceUnit)
      ) {
        return json(route, 400, { error: 'invalid' });
      }
      clock += 1;
      const cur = api.settings;
      api.settings = {
        capitalYen: cap,
        riskTolerancePct: risk,
        performanceUnit: body.performanceUnit,
        capitalHistory:
          cap === cur.capitalYen
            ? cur.capitalHistory
            : [...cur.capitalHistory, { valueYen: cap, at: clock }],
      };
      return json(route, 200, api.settings);
    }
    if (req.method() === 'PUT' && path.startsWith('/api/instruments/')) {
      api.writes.push({ key, body });
      const id = decodeURIComponent(path.slice('/api/instruments/'.length));
      const idx = api.instruments.findIndex((i) => i.id === id);
      if (idx < 0) return json(route, 404, { error: 'not_found' });
      if (api.instruments.some((i) => i.id !== id && nameKey(i.name) === nameKey(body.name))) {
        return json(route, 409, { error: 'conflict', reason: 'duplicateName' });
      }
      clock += 1;
      const prev = api.instruments[idx];
      const next = {
        id,
        name: body.name.trim(),
        ...(body.underlying === undefined ? {} : { underlying: body.underlying }),
        underlyingKind: body.underlyingKind ?? 'other',
        productForm: body.productForm ?? 'spotCfd',
        priceCurrency: body.priceCurrency ?? null,
        multiplier: body.multiplier ?? 1,
        quantityStep: body.quantityStep ?? 1,
        createdAt: prev.createdAt,
        updatedAt: clock,
      };
      api.instruments[idx] = next;
      return json(route, 200, next);
    }
    if (key === 'POST /api/trades') {
      api.posts.push(body);
      if (opts.delayMs) await new Promise((ok) => setTimeout(ok, opts.delayMs));
      if (opts.failTrades) return json(route, opts.failTrades, { error: 'unavailable' });
      const inst = api.instruments.find((i) => i.id === body.instrumentId);
      if (!inst) return json(route, 400, { error: 'invalid' });
      // 資金・許容リスクは取引の口座（無ければ既定の口座）から写す（#47）
      ensureDefault();
      const s = api.accounts.find((a) => a.id === (body.accountId || 'default'));
      if (!s) return json(route, 400, { error: 'invalid' });
      clock += 1;
      const stored = {
        id: `trade-${++seq}`,
        schemaVersion: 1,
        createdAt: clock,
        updatedAt: clock,
        snapshot: {
          instrument: {
            multiplier: inst.multiplier,
            quantityStep: inst.quantityStep,
            priceCurrency: inst.priceCurrency,
            underlyingKind: inst.underlyingKind,
            productForm: inst.productForm,
          },
          capitalYen: s.capitalYen,
          riskTolerancePct: s.riskTolerancePct,
          accountCurrency: currencyOf(s),
        },
        record: body,
        ...(chartParts && Object.keys(chartParts).length > 0
          ? {
              charts: Object.fromEntries(
                Object.entries(chartParts).map(([k, v]) => [
                  k,
                  { contentType: v.type, size: v.bytes.length },
                ]),
              ),
            }
          : {}),
      };
      api.trades.push(stored);
      return json(route, 201, stored);
    }
    if (key === 'GET /api/ai-usage') {
      const u = api.aiUsage;
      if (u.holdMs) {
        await new Promise((ok) => {
          const t = setTimeout(ok, u.holdMs);
          t.unref?.();
        });
      }
      try {
        return await json(route, u.status, u.body);
      } catch {
        return undefined; // 待たせている間に画面を離れた
      }
    }
    if (key === 'GET /api/health') return json(route, 200, { status: 'ok' });
    return json(route, 404, { error: 'not_found' });
  });
  return api;
}

/** 記録する画面を開き、入力の欄が出るまで待つ */
/** 開いたページで出たダイアログの種類（beforeunload を受けた数を DR1 が見る。#75） */
const dialogsSeen = [];

async function openRecord(page, base) {
  await page.goto(`${base}/record`);
  await waitReady(page, '記録する');
  await page.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
}

const seg = (page, group, text) =>
  page.locator(`[role="radiogroup"][aria-label="${group}"] label.seg__item`, { hasText: text });

/** 記録する画面の例（Issue #13 の例の表。値は架空）。taps = false なら 3 つのタップの前で止める */
async function fillRecord(page, ex, taps = true, lastTap = true) {
  await page.locator('#record-instrument').fill('US30');
  await seg(page, 'L / S', ex.side === 'S' ? 'S ショート' : 'L ロング').click();
  await page.locator('#record-entry').fill(ex.entry);
  await page.locator('#record-exit').fill(ex.exit);
  await page.locator('#record-quantity').fill('10000');
  if (ex.lc === 'none') await page.locator('button.lcnone').click();
  else await page.locator('#record-lc').fill(ex.lc);
  if (!taps) return;
  if (ex.lc !== 'none') {
    await seg(
      page,
      'LC を入る前に決めていたか',
      ex.decided ? '決めていた' : '決めていない',
    ).click();
    await seg(page, 'LC を動かしたか', ex.move).click();
    if (ex.after) await page.locator('#record-lc-after').fill(ex.after);
  }
  if (lastTap) await seg(page, '時間足を変えたか', 'そのまま').click();
}

const EX_E1 = {
  side: 'L',
  entry: '100.00',
  exit: '99.20',
  lc: '99.50',
  decided: true,
  move: '広げた',
  after: '99.20',
};
const EX_E3 = {
  side: 'L',
  entry: '100.00',
  exit: '100.75',
  lc: '99.50',
  decided: false,
  move: 'そのまま',
};
const EX_E16 = { side: 'L', entry: '100.00', exit: '99.20', lc: 'none' };
/** 計画どおりの勝ち（決めていた・そのまま・そのまま。+2.0R）。値は架空 */
const EX_SAFE = {
  side: 'L',
  entry: '100.00',
  exit: '101.00',
  lc: '99.50',
  decided: true,
  move: 'そのまま',
};
/** Issue #33 例 8: S ショートで LC を広げた（広げた後の LC の欄が出る）。値は架空 */
const EX_S8 = {
  side: 'S',
  entry: '150.00',
  exit: '151.00',
  lc: '150.50',
  decided: true,
  move: '広げた',
  after: '151.00',
};

/**
 * 判定の枠のバッジと R が、上の帯の下端 〜 min(下部の行き先の上端, 貼り付きの帯の上端) と画面の左右の中にあるか
 * （Issue #33 AC-3）。withR = false なら R を見ない（LC なしの C）。外れの文の配列を返す
 */
async function verdictInView(page, withR) {
  return page.evaluate((withR) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const top = Math.max(
      0,
      ...[...document.querySelectorAll('.apphead, .appbar')]
        .filter((e) => ['sticky', 'fixed'].includes(getComputedStyle(e).position))
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.height > 0)
        .map((r) => r.bottom),
    );
    const nav = document.querySelector('.appnav');
    // 下のタブ（全画面のシートの間は隠れる = 高さ 0）
    const navTop =
      nav && getComputedStyle(nav).position === 'fixed' && nav.getBoundingClientRect().height > 0
        ? nav.getBoundingClientRect().top
        : vh;
    const bar = document.querySelector('.record__submit')?.getBoundingClientRect();
    const bottom = Math.min(navTop, bar ? bar.top : vh, vh);
    const out = [];
    const parts = [['バッジ', '.verdict .badge']];
    if (withR) parts.push(['R', '.verdict .num--xl']);
    for (const [name, sel] of parts) {
      const el = document.querySelector(sel);
      if (!el) {
        out.push(`${name} が無い`);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.top < top - 0.5 || r.bottom > bottom + 0.5 || r.left < -0.5 || r.right > vw + 0.5)
        out.push(
          `${name} ${Math.round(r.top)}〜${Math.round(r.bottom)}px が見える範囲 ${Math.round(top)}〜${Math.round(bottom)}px の外`,
        );
    }
    const taps = document.querySelector('section[aria-labelledby="record-taps-title"]');
    if (!taps?.nextElementSibling?.classList.contains('verdict'))
      out.push('判定の枠が 3 つのタップの枠のすぐ後に無い');
    return out;
  }, withR);
}

/** --inject-clip の帯の見本: 状態の文を長くして改行を入れ、帯に背の高い要素を足す（高さ・行数・切れが 1 件ずつ外れる） */
async function injectBarSample(page) {
  await page.evaluate(() => {
    const bar = document.querySelector('.record__submit');
    const status = bar?.querySelector('.record__status');
    if (!bar || !status) return;
    status.textContent = '帯の見本: とても長い状態の文が帯の幅に入らずに切れる';
    status.append(document.createElement('br'), '2 行目');
    const tall = document.createElement('div');
    tall.setAttribute('data-ui-check-clip', '');
    tall.style.cssText = 'flex:1 1 100%;height:40px';
    bar.append(tall);
  });
}

/** スクロールが止まるまで待つ（なめらかなスクロールの途中で測らない。最大 3 秒） */
async function scrollSettled(page) {
  let last = -1;
  for (let i = 0; i < 30; i++) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === last) return;
    last = y;
    await page.waitForTimeout(100);
  }
}

/**
 * ページの中の canvas で架空の明細らしい画像を作る（白地・罫線・数字の行。noise = true なら一部に細かい模様を足して
 * PNG を大きくする）。to = 'paste' なら画面の document に画像の貼り付けを送り、'bytes' ならバイト列を返す
 */
async function makeImage(page, spec, to) {
  return page.evaluate(
    async ({ s, to }) => {
      const c = document.createElement('canvas');
      c.width = s.w;
      c.height = s.h;
      const g = c.getContext('2d');
      g.fillStyle = 'white';
      g.fillRect(0, 0, s.w, s.h);
      g.fillStyle = 'black';
      g.font = `${Math.round(s.h / 24)}px sans-serif`;
      let seed = 15;
      const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      for (let i = 1; i < 20; i++) {
        const y = Math.round((s.h / 20) * i);
        g.fillRect(0, y, s.w, 1);
        g.fillText(`架空指数A  L  100.0  99.0  2  -2,000  ${i}`, 10, y - 4);
      }
      if (s.noise) {
        const band = g.getImageData(0, 0, s.w, Math.round(s.h / 6));
        for (let i = 0; i < band.data.length; i += 4) {
          const v = Math.round(rnd() * 255);
          band.data[i] = v;
          band.data[i + 1] = 255 - v;
          band.data[i + 2] = (v * 7) & 255;
        }
        g.putImageData(band, 0, 0);
      }
      const blob = await new Promise((ok) => c.toBlob(ok, s.type, s.quality));
      if (to === 'paste') {
        const dt = new DataTransfer();
        dt.items.add(new File([blob], 'statement', { type: s.type }));
        document.body.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
        );
        return blob.size;
      }
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { s: spec, to },
  );
}

const STATEMENT_SPEC = { w: 1200, h: 600, type: 'image/png' };

/** チャートの画像に付ける架空のファイル名（端末の保存先・URL に出ていないかを探す印） */
const CHART_MARKER = 'CHARTMARK-9d3f';

/**
 * ページの中の canvas で架空のローソク足のチャートを作る。to = 'paste' なら target（CSS selector。無ければ今フォーカスの
 * ある要素）に画像の貼り付けを送り、'bytes' ならバイト列を返す。ブラウザはフォーカスのある要素に paste を送る（枠を選んで貼る）
 */
async function makeChart(page, to, target = null) {
  return page.evaluate(
    async ({ to, target, marker }) => {
      const w = 1280;
      const h = 720;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#10141c';
      g.fillRect(0, 0, w, h);
      let seed = 7;
      const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      let price = h / 2;
      for (let i = 0; i < 60; i++) {
        const o = price;
        price += (rnd() - 0.5) * 40;
        const hi = Math.min(o, price) - rnd() * 20;
        const lo = Math.max(o, price) + rnd() * 20;
        const x = 20 + i * 20;
        g.fillStyle = price < o ? '#2ec5a0' : '#ff8fa0';
        g.fillRect(x + 6, hi, 2, lo - hi);
        g.fillRect(x, Math.min(o, price), 14, Math.max(2, Math.abs(price - o)));
      }
      g.fillStyle = '#a8b0bf';
      g.fillRect(0, h * 0.62, w, 1);
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
      if (to === 'paste') {
        const dt = new DataTransfer();
        dt.items.add(new File([blob], `${marker}.png`, { type: 'image/png' }));
        const el = target ? document.querySelector(target) : document.activeElement;
        (el ?? document.body).dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
        );
        return blob.size;
      }
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { to, target, marker: CHART_MARKER },
  );
}

/** 枠を選んで（クリックでフォーカスして）チャートを貼り、プレビューが出るまで待つ */
async function pasteChart(page, slot) {
  const frame = page.locator(`#record-chart-${slot}`);
  await frame.locator('.chart__name').click();
  await makeChart(page, 'paste');
  await frame.locator('canvas.chart__preview').waitFor({ timeout: 10000 });
}

/** 本文の形式と寸法（PNG の IHDR・JPEG の SOF。読めなければ null。image.py の image_info と同じ規則） */
function imageInfoOf(b) {
  if (b.length >= 24 && b[0] === 0x89 && b.subarray(12, 16).toString('latin1') === 'IHDR') {
    return { type: 'image/png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) return null;
      while (i < b.length && b[i] === 0xff) i++;
      const m = b[i++];
      if (m === 0x01 || m === 0xd8 || (m >= 0xd0 && m <= 0xd7)) continue;
      if (m === 0xd9 || m === 0xda || i + 2 > b.length) return null;
      const len = b.readUInt16BE(i);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { type: 'image/jpeg', w: b.readUInt16BE(i + 5), h: b.readUInt16BE(i + 3) };
      }
      i += len;
    }
  }
  return null;
}

/** 記録する画面の状態（幅 × テーマで測る）。fn は開いた画面をその状態にする（api は偽の API。読み取りの応答を決める） */
/** 口座の例（Issue #47。名前・値はすべて架空） */
const acct = (id, name, capitalYen, riskTolerancePct = 1, currency = 'JPY') => ({
  id,
  name,
  currency,
  capitalYen,
  riskTolerancePct,
  capitalHistory: capitalYen === null ? [] : [{ valueYen: capitalYen, at: 1799000000000 }],
  createdAt: 1799000000000,
  updatedAt: 1799000000000,
});
const ACC_ONE = acct('default', '口座 1', 1000000);
const ACC_B = acct('acc-b', '口座 B', 200000);
const ACC_C = acct('acc-c', '口座 C', null);
const ACC_D = acct('acc-d', '口座 D', 500000);
const ACC_LONG = acct('acc-long', '架空の長い名前の口座 B（長期の積み立てと短期の売買）', 200000);
/** USD の口座（#47 PR-2。架空の値） */
const ACC_USD = acct('acc-usd', '口座 D', 10000, 1, 'USD');
const ACCOUNTS_2 = [ACC_ONE, ACC_B];
const ACCOUNTS_3_LONG = [ACC_ONE, ACC_LONG, ACC_C];
const ACCOUNTS_4 = [ACC_ONE, ACC_B, ACC_C, ACC_D];
/** 偽の API の口座を入れ替える（空 = 既定の口座を設定から作り直す） */
/** 明細の特徴（#66）: 提案の口座の ID は API の ID の形（英数だけ） */
/** 状態の中の確かめ（外れたら投げる = その状態は「開けない」） */
const mustEq = (got, want, what) => {
  if (got !== want)
    throw new Error(`${what}: ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`);
};
const ACCOUNTS_ALNUM = [ACC_ONE, { ...ACC_B, id: 'accB' }];
const PROFILE_NEW = { key: 'd'.repeat(32), accountId: null };
const PROFILE_B = { key: 'c'.repeat(32), accountId: 'accB' };
const READ_USD = { ...READ_E1, pnl: -62, feesTotal: 2, fees: [2], pnlCurrency: 'USD' };
const setAccounts = (api, list) => api.accounts.splice(0, api.accounts.length, ...list);
/** EUR 建ての架空の銘柄（#47 PR-2） */
const FAKE_EUR_IDX = { ...FAKE_US30, id: 'inst-eur', name: '架空指数E', priceCurrency: 'EUR' };
/** USD 建ての架空の銘柄（#47 PR-2）を一覧に足す（何度呼んでも 1 つ） */
const FAKE_USD_IDX = { ...FAKE_US30, id: 'inst-usd', name: '架空指数U', priceCurrency: 'USD' };
const withUsdInstrument = (api) => {
  if (!api.instruments.some((i) => i.id === FAKE_USD_IDX.id)) api.instruments.push(FAKE_USD_IDX);
};
/** USD 建ての銘柄で場面 P（L・100.00 / 99.50 / 99.50 or 99.40・数量 100）を入れる */
async function fillFx(page, exit = '99.50') {
  await page.locator('#record-instrument').fill(FAKE_USD_IDX.name);
  await seg(page, 'L / S', 'L ロング').click();
  await page.locator('#record-entry').fill('100.00');
  await page.locator('#record-exit').fill(exit);
  await page.locator('#record-quantity').fill('100');
  await page.locator('#record-lc').fill('99.50');
  await seg(page, 'LC を入る前に決めていたか', '決めていた').click();
  await seg(page, 'LC を動かしたか', 'そのまま').click();
  await seg(page, '時間足を変えたか', 'そのまま').click();
}

const RECORD_STATES = [
  { slug: 'record-1-open', name: '開いた直後', fn: async () => {} },
  { slug: 'record-2-typing', name: '入力の途中', fn: (p) => fillRecord(p, EX_E1, false) },
  {
    slug: 'record-3-judged-b',
    name: '判定 B',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('.verdict .badge', { hasText: 'B 悪い損失' }).waitFor();
    },
  },
  {
    slug: 'record-4-risky-win',
    name: '危ない勝ち',
    fn: async (p) => {
      await fillRecord(p, EX_E3);
      await p.locator('.verdict .badge', { hasText: '危ない勝ち' }).waitFor();
    },
  },
  {
    slug: 'record-5-no-lc-c',
    name: 'LC なしの C',
    fn: async (p) => {
      await fillRecord(p, EX_E16);
      await p.locator('.verdict .badge', { hasText: 'C 極悪な損失' }).waitFor();
    },
  },
  {
    slug: 'record-6-saved',
    name: '保存の後',
    noBar: true,
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor();
    },
  },
  {
    slug: 'record-7-reading',
    name: '明細の読み取り中',
    anchor: '.statement',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 20000 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.getByRole('status').filter({ hasText: '明細を読み取っています' }).waitFor();
      await p.locator('canvas.statement__preview').waitFor();
    },
  },
  {
    slug: 'record-8-read',
    name: '読み取りの後',
    // 撮るのは印のついた「取引」の欄（枠のプレビューは record-9 で撮る）
    anchor: 'section[aria-labelledby="record-trade-title"]',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.field__mark').first().waitFor();
    },
  },
  {
    slug: 'record-9-rows',
    name: '複数行・時間帯',
    anchor: '.statement',
    fn: async (p, api) => {
      api.read = { status: 200, rows: READ_E10, holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.statement__row', { hasText: '1 / 3 行目' }).waitFor();
      // タイムゾーンの選択肢（選ぶ前。#58）: 選択肢ごとに欄に入る日本時間
      await p.getByRole('radio', { name: /GMT（\+9 時間） ?2026\/11\/10 19:30/ }).waitFor();
    },
  },
  {
    slug: 'record-9-tz-other',
    name: 'ほかのタイムゾーン',
    anchor: '.statement__tz',
    fn: async (p, api) => {
      api.read = { status: 200, rows: READ_E10, holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.getByRole('radio', { name: /ほかのタイムゾーン/ }).check();
      const sel = p.getByRole('combobox', { name: 'ほかのタイムゾーン' });
      await sel.waitFor();
      await sel.selectOption('us-east');
      await expectPollAsync(
        async () => (await p.locator('#record-exit-time').inputValue()) === '2026-11-11T00:30',
        '米国東部で直した決済の時刻',
      );
    },
  },
  {
    slug: 'record-9-tz-remembered',
    name: '覚えたタイムゾーン',
    anchor: '.statement__tz',
    fn: async (p, api) => {
      await p.evaluate(() => localStorage.setItem('loss-note.statementTimeZone', 'gmt'));
      api.read = { status: 200, rows: READ_E10, holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.getByText('前に選んだ GMT（+9 時間）で日本時間に直しました。').waitFor();
      await expectPollAsync(
        async () => (await p.locator('#record-exit-time').inputValue()) === '2026-11-10T19:30',
        '覚えた GMT で直した決済の時刻',
      );
    },
  },
  {
    slug: 'record-11-tall',
    name: '縦長のスクショ',
    anchor: '.statement',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      // スマホの縦長のスクショ（1080 × 2340）。描き直すと 923 × 2000
      await makeImage(p, { w: 1080, h: 2340, type: 'image/png' }, 'paste');
      await p.locator('.field__mark').first().waitFor();
      // プレビューが枠に収まり、縦横比を保つ（縦に潰れない。レビュー指摘 8）
      const box = await p.evaluate(() => {
        const c = document.querySelector('canvas.statement__preview');
        const r = c.getBoundingClientRect();
        const parent = c.parentElement.getBoundingClientRect();
        return { w: r.width, h: r.height, aw: c.width, ah: c.height, pw: parent.width };
      });
      if (box.w > box.pw + 0.5) throw new Error(`プレビューが枠より広い ${box.w}px`);
      if (box.h > 320.5) throw new Error(`プレビューが高すぎる ${box.h}px`);
      if (Math.abs(box.w / box.h - box.aw / box.ah) > 0.02)
        throw new Error(`プレビューの縦横比 ${box.w}×${box.h}（画像 ${box.aw}×${box.ah}）`);
    },
  },
  {
    slug: 'record-12-charts',
    name: 'チャートあり',
    anchor: '.charts',
    fn: async (p, api) => {
      // 読み取りで埋めた直後（印「チャートから」つき。#27）
      api.chartTimeframes = ['4h', '1d'];
      await fillRecord(p, EX_E1);
      await pasteChart(p, 'entry');
      await pasteChart(p, 'exit');
      await p.locator('#record-chart-exit-tf-mark').waitFor();
      await p
        .locator('.reasons__item', { hasText: '時間足を変えた（4 時間足 → 日足・チャートから）' })
        .waitFor();
      // 枠を選んだ状態（輪と「貼り付けると差し替えられます」）を撮る
      await p.locator('#record-chart-exit .chart__name').click();
    },
  },
  {
    slug: 'record-15-chart-reading',
    name: 'チャートの読み取り中',
    anchor: '.charts',
    fn: async (p, api) => {
      api.chartRead = { status: 200, kind: 'chart', holdMs: 20000 };
      await fillRecord(p, EX_E1);
      await pasteChart(p, 'entry');
      await p.getByRole('status').filter({ hasText: '時間足を読み取っています' }).waitFor();
      // 読み取り中も [記録する] は押せる（帯は「待たずに記録できます」）
      if (await p.locator('#record-submit').isDisabled())
        throw new Error('読み取り中に [記録する] が押せない');
      await p.locator('.record__status', { hasText: '待たずに記録できます' }).waitFor();
    },
  },
  {
    slug: 'record-16-chart-not-chart',
    name: 'チャートと読めない',
    anchor: '.charts',
    fn: async (p, api) => {
      api.chartRead = { status: 200, kind: 'not_chart', holdMs: 0 };
      await pasteChart(p, 'entry');
      await p.getByText('チャートとして読み取れませんでした').waitFor();
    },
  },
  {
    slug: 'record-17-chart-failed',
    name: 'チャートの読み取りの失敗',
    anchor: '.charts',
    fn: async (p, api) => {
      api.chartRead = { status: 503, kind: 'chart', holdMs: 0 };
      await pasteChart(p, 'entry');
      await p.getByText('今は時間足の読み取りを使えません').waitFor();
    },
  },
  {
    slug: 'record-18-chart-suggest',
    name: '選んだ値と読めた値が違う',
    anchor: '.charts',
    fn: async (p, api) => {
      api.chartTimeframes = ['1d'];
      api.chartRead = { status: 200, kind: 'chart', holdMs: 1500 };
      await pasteChart(p, 'exit');
      await p.locator('#record-chart-exit-tf').selectOption('4h');
      await p.locator('#record-chart-exit .chart__suggest').waitFor({ timeout: 10000 });
      await p.getByRole('button', { name: '日足にする' }).waitFor();
    },
  },
  {
    slug: 'record-19-chart-conflict',
    name: 'タップとチャートの食い違い',
    fn: async (p, api) => {
      api.chartTimeframes = ['4h', '1d'];
      await fillRecord(p, EX_E1);
      await pasteChart(p, 'entry');
      await pasteChart(p, 'exit');
      await p.locator('.reasons__sub', { hasText: 'あなたの答え: そのまま' }).waitFor();
    },
  },
  // Issue #89: 追加のチャート（見出しの行の [＋ 追加] → 枠を足して貼る）
  {
    slug: 'record-30-extra-1',
    name: '追加のチャート 1 枚',
    anchor: '.charts',
    fn: async (p, api) => {
      api.chartTimeframes = ['1d'];
      await p.locator('#record-chart-add').click();
      await pasteChart(p, 'x1');
      await p.locator('#record-chart-x1-note').fill('上位足の環境');
      await p.locator('.charts__subtitle', { hasText: '判定には使いません' }).waitFor();
    },
  },
  {
    slug: 'record-31-extra-full',
    name: '追加のチャート 5 枚',
    anchor: '.charts__subtitle',
    fn: async (p) => {
      for (let i = 0; i < 5; i++) await p.locator('#record-chart-add').click();
      for (const slot of ['x1', 'x2', 'x3', 'x4', 'x5']) await pasteChart(p, slot);
      if (!(await p.locator('#record-chart-add').isDisabled()))
        throw new Error('5 枚で [＋ 追加] が押せる');
      await p.getByText('追加のチャートは 5 枚までです。').waitFor();
    },
  },
  {
    slug: 'record-32-extra-note-err',
    name: '一言が字数を超えた',
    anchor: '.charts__subtitle',
    fn: async (p) => {
      await p.locator('#record-chart-add').click();
      await pasteChart(p, 'x1');
      await p.locator('#record-chart-x1-note').fill('あ'.repeat(41));
      // 欄の誤り（保存しないことは controller のテストで見る）
      await p
        .locator('#record-chart-x1-note-error', { hasText: '一言は 40 字までです。' })
        .waitFor();
    },
  },
  {
    slug: 'record-33-extra-fifth',
    name: '追加のチャートの 5 枚目',
    anchor: '#record-chart-x4',
    fn: async (p) => {
      for (let i = 0; i < 5; i++) await p.locator('#record-chart-add').click();
      await pasteChart(p, 'x5');
      if (!(await p.locator('#record-chart-add').isDisabled()))
        throw new Error('5 枚で [＋ 追加] が押せる');
    },
  },
  {
    slug: 'record-13-error',
    name: '誤り 1 欄',
    fn: async (p) => {
      // 帯の長い文の例 3（「誤り 1 欄・あと N 欄」）
      await p.locator('#record-exit').fill('x');
      await p.locator('.record__status', { hasText: '誤り 1 欄' }).waitFor();
    },
  },
  {
    slug: 'record-14-safe-win',
    name: '計画どおりの勝ち',
    fn: async (p) => {
      // 帯の判定の要約でいちばん長い「計画どおりの勝ち · +2.0R」
      await fillRecord(p, EX_SAFE);
      await p.locator('.record__status', { hasText: '計画どおりの勝ち · +2.0R' }).waitFor();
    },
  },
  {
    slug: 'record-15-accounts-2',
    name: '口座 2 つ',
    prep: (api) => setAccounts(api, ACCOUNTS_2),
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await seg(p, '口座', '口座 B').click();
      await p
        .locator('.verdict__account', { hasText: '口座 B の資金 200,000円 に対して' })
        .waitFor();
    },
  },
  {
    // 口座 2 つの「取引」の枠（Segment の位置。Phase 4b で撮れていなかった）
    slug: 'record-15b-accounts-2-top',
    name: '口座 2 つ（取引の枠）',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: (api) => setAccounts(api, ACCOUNTS_2),
    fn: async (p) => {
      await seg(p, '口座', '口座 B').click();
      await p
        .locator('.seg--truncate .seg__input:checked[value="acc-b"]')
        .waitFor({ state: 'attached' });
    },
  },
  {
    // 口座 2 つで選択を替えた 2 枚目（✓ の幅を先に取り、境目が動かないこと。再レビュー N2）
    slug: 'record-15c-accounts-2-top-default',
    name: '口座 2 つ（取引の枠・口座 1）',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: (api) => setAccounts(api, ACCOUNTS_2),
    fn: async (p) => {
      await seg(p, '口座', '口座 B').click();
      await seg(p, '口座', '口座 1').click();
      await p
        .locator('.seg--truncate .seg__input:checked[value="default"]')
        .waitFor({ state: 'attached' });
    },
  },
  {
    // 「ほかの欄（任意）」を開いた形（決済の理由の .select の見た目。再レビュー）
    slug: 'record-20-more-open',
    name: 'ほかの欄を開いた',
    anchor: 'details.more',
    fn: async (p) => {
      await p.locator('details.more > summary').click();
      await p.locator('#record-exit-reason').waitFor();
      await p.locator('#record-exit-reason').scrollIntoViewIfNeeded();
    },
  },
  {
    slug: 'record-16-accounts-3-long',
    name: '口座 3 つ・長い名前',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: (api) => setAccounts(api, ACCOUNTS_3_LONG),
    fn: async (p) => {
      await p.locator('.seg--truncate .seg__text', { hasText: '架空の長い名前' }).waitFor();
      await p.locator('.seg--truncate .seg__item', { hasText: '架空の長い名前' }).click();
    },
  },
  {
    slug: 'record-17-accounts-4',
    name: '口座 4 つ（select）',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: (api) => setAccounts(api, ACCOUNTS_4),
    fn: async (p) => {
      await p.locator('select#record-account').selectOption('acc-c');
      await fillRecord(p, EX_E1);
      await p.locator('.verdict__account', { hasText: '口座 C（資金は未設定）' }).waitFor();
    },
  },
  {
    slug: 'record-18-add-open',
    name: '口座を追加する欄',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    fn: async (p) => {
      await p.locator('#record-account-add').click();
      await p.locator('#record-account-new-name').fill('口座 C');
      await p.locator('#record-account-new-capital').fill('300,000');
    },
  },
  {
    slug: 'record-19-add-error',
    name: '口座を追加する欄の誤り',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    fn: async (p) => {
      await p.locator('#record-account-add').click();
      await p.locator('#record-account-new-name').fill('口座 1');
      await p.locator('#record-account-new-capital').fill('0');
      await p.locator('.accountadd').getByRole('button', { name: '追加', exact: true }).click();
      await p
        .locator('#record-account-new-name-error', { hasText: '同じ名前の口座があります' })
        .waitFor();
    },
  },
  // 通貨と為替（Issue #47 PR-2・U23〜U26・U34）
  {
    slug: 'record-21-fx',
    name: '為替の欄（USD 建て）',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: withUsdInstrument,
    fn: async (p) => {
      await fillFx(p);
      await p.locator('#record-fx').fill('150');
      await p.locator('#record-fx-line', { hasText: '1 USD = 150円' }).waitFor();
      await p.locator('#record-instrument-hint', { hasText: 'USD 建て' }).waitFor();
    },
  },
  {
    slug: 'record-22-fx-7digits',
    name: '為替 7 桁',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: withUsdInstrument,
    fn: async (p) => {
      await fillFx(p);
      await p.locator('#record-fx').fill('1234567');
      await p.locator('#record-fx-line', { hasText: '1 USD = 1,234,567円' }).waitFor();
    },
  },
  {
    slug: 'record-23-fx-derived',
    name: '明細から逆算した為替',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: withUsdInstrument,
    fn: async (p) => {
      await fillFx(p, '99.40');
      await p.locator('details.more > summary').click();
      await p.locator('#record-pnl').fill('-9100');
      await p.locator('#record-fee').fill('100');
      await p.locator('#record-fx-line', { hasText: '明細から 1 USD = 150.00円' }).waitFor();
    },
  },
  {
    slug: 'record-24-fx-error',
    name: '為替の誤り',
    // 撮るのは為替の欄そのもの（.field--error と文言）
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: withUsdInstrument,
    fn: async (p) => {
      await fillFx(p);
      await p.locator('#record-fx').fill('0');
      await p.locator('.record__status', { hasText: '誤り 1 欄' }).waitFor();
    },
  },
  {
    // #56: ショートで「広げた」を選び、広げた後の LC を向きの逆（入る前の LC より下）に入れた誤り。架空の値
    slug: 'record-28-widen-s-error',
    name: '広げた後の LC の誤り（S）',
    anchor: 'section[aria-labelledby="record-taps-title"]',
    fn: async (p) => {
      await p.locator('#record-instrument').fill('US30');
      await seg(p, 'L / S', 'S ショート').click();
      await p.locator('#record-entry').fill('150.00');
      await p.locator('#record-exit').fill('150.20');
      await p.locator('#record-quantity').fill('10000');
      await p.locator('#record-lc').fill('150.50');
      await seg(p, 'LC を入る前に決めていたか', '決めていた').click();
      await seg(p, 'LC を動かしたか', '広げた').click();
      await p.locator('#record-lc-after').fill('150.20');
      await seg(p, '時間足を変えたか', 'そのまま').click();
      await p
        .locator('#record-lc-after-error', {
          hasText: '広げた後の LC は、入る前の LC より上にしてください',
        })
        .waitFor();
      const label = (await p.locator('label[for="record-lc-after"]').textContent()) ?? '';
      mustEq(label, '広げた後の LC（任意）', '欄の名前');
    },
  },
  {
    // #58 コードレビュー 5: 円以外の口座で価格の通貨が未設定の銘柄（為替の欄は出ず、半幅の銘柄の下に「価格の通貨 未設定」）
    slug: 'record-29-usd-unset',
    name: 'USD の口座・価格の通貨 未設定',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: (api) => setAccounts(api, [{ ...ACC_USD, id: 'default' }]),
    fn: async (p) => {
      await p.locator('#record-instrument').fill('US30');
      await p.locator('#record-quantity').fill('10000');
      await p.locator('#record-instrument-hint', { hasText: '価格の通貨 未設定' }).waitFor();
      mustEq(await p.locator('#record-fx').count(), 0, '為替の欄の数');
    },
  },
  {
    slug: 'record-25-fx-none',
    name: '為替も損益も無い',
    // 資金のある口座で（資金が未設定だと注記は「資金を設定すると…」になる）
    prep: (api) => {
      withUsdInstrument(api);
      setAccounts(api, [ACC_ONE]);
    },
    fn: async (p) => {
      await fillFx(p);
      await p.locator('.verdict__why', { hasText: '為替か損益を入力すると表示されます' }).waitFor();
    },
  },
  {
    // 為替が空で明細の損益も無い取引の欄（「1 USD = ?円（空でも記録できます）」）
    slug: 'record-25b-fx-empty',
    name: '為替が空（取引の欄）',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: (api) => {
      withUsdInstrument(api);
      setAccounts(api, [ACC_ONE]);
    },
    fn: async (p) => {
      await fillFx(p);
      await p
        .locator('#record-fx-line', { hasText: '1 USD = ?円（空でも記録できます）' })
        .waitFor();
    },
  },
  {
    slug: 'record-26-usd-account',
    name: 'USD の口座',
    prep: (api) => {
      withUsdInstrument(api);
      setAccounts(api, [{ ...ACC_USD, id: 'default' }]);
    },
    fn: async (p) => {
      await fillFx(p);
      await p.locator('.verdict', { hasText: '50.00' }).waitFor();
    },
  },
  {
    // USD の口座の取引の枠の上（EUR 建て: 銘柄の下の「EUR 建て」・為替の単位「USD」・「1 EUR = ? USD」）
    slug: 'record-27-usd-eur',
    name: 'USD の口座・EUR 建て',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: (api) => {
      withUsdInstrument(api);
      if (!api.instruments.some((i) => i.id === FAKE_EUR_IDX.id))
        api.instruments.push(FAKE_EUR_IDX);
      setAccounts(api, [{ ...ACC_USD, id: 'default' }]);
    },
    fn: async (p) => {
      await fillFx(p);
      await p.locator('#record-instrument').fill(FAKE_EUR_IDX.name);
      await p.locator('#record-fx-line', { hasText: '1 EUR = ? USD' }).waitFor();
      await p.locator('#record-instrument-hint', { hasText: 'EUR 建て' }).waitFor();
    },
  },
  {
    // USD の口座で JPY の明細を貼った（#66 C5: 損益・手数料は空、その下に「明細の損益は JPY です（口座 D は USD）」）
    slug: 'record-28-usd-statement',
    name: 'USD の口座で明細',
    anchor: 'details.more',
    prep: (api) => setAccounts(api, [{ ...ACC_USD, id: 'default' }]),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.field__mark').first().waitFor();
      await p.locator('#record-money-note', { hasText: '明細の損益は JPY です' }).waitFor();
    },
  },
  {
    // 口座 2 つ・明細の特徴の覚えあり（#66 AC-11・R4: 提案の口座 B が選ばれ、口座の欄に印「自動で選択」）
    slug: 'record-29-account-suggested',
    name: '明細から口座',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    // 提案の口座の ID は API の ID の形（英数だけ）。画面は形の外れた ID を提案に使わない
    prep: (api) => setAccounts(api, [ACC_ONE, { ...ACC_B, id: 'accB' }]),
    fn: async (p, api) => {
      api.read = {
        status: 200,
        rows: [READ_E1],
        holdMs: 0,
        profile: { key: 'c'.repeat(32), accountId: 'accB' },
      };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('#record-account-mark', { hasText: '自動で選択' }).waitFor();
      await p
        .locator('[role="radiogroup"][aria-label="口座"] input:checked[value="accB"]')
        .waitFor({ state: 'attached' });
    },
  },
  {
    // 初めての明細（#66 デザイン 1: 覚えが無い → 口座の欄の下に「この明細の口座を選んでください…」・印なし）
    slug: 'record-31-account-first',
    name: '初めての明細',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: (api) => setAccounts(api, ACCOUNTS_ALNUM),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0, profile: PROFILE_NEW };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p
        .locator('#record-account-hint', { hasText: 'この明細の口座を選んでください' })
        .waitFor();
      await p.locator('.field__mark').first().waitFor();
      mustEq(await p.locator('#record-account-mark').count(), 0, '初めての明細の口座の印');
    },
  },
  {
    // 自動で選んだ後に選び直した（#66 R4: 印「自動で選択」が消える・「直した」にしない）
    slug: 'record-32-account-rechosen',
    name: '選び直した口座',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: (api) => setAccounts(api, ACCOUNTS_ALNUM),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0, profile: PROFILE_B };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('#record-account-mark', { hasText: '自動で選択' }).waitFor();
      await seg(p, '口座', '口座 1').click();
      await p.locator('#record-account-mark').waitFor({ state: 'detached' });
    },
  },
  {
    // 覚えた口座の通貨が明細と違う（#66 デザイン 3・4: 選ぶが印は付けず、合う通貨の口座を口座の欄の下で案内）
    slug: 'record-33-account-currency-mismatch',
    name: '覚えた口座の通貨が違う',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: (api) => {
      setAccounts(api, [...ACCOUNTS_ALNUM, { ...ACC_USD, id: 'accUsd' }]);
      withUsdInstrument(api);
    },
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_USD], holdMs: 0, profile: PROFILE_B };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('#record-account-hint', { hasText: 'USD の口座は 口座 D です' }).waitFor();
      mustEq(await p.locator('#record-account-mark').count(), 0, '通貨の違う提案の口座の印');
    },
  },
  {
    // 口座 4 つ（select）+ 自動で選んだ（#66 デザイン 8）
    slug: 'record-34-accounts-4-suggested',
    name: '口座 4 つで自動で選択',
    anchor: 'section[aria-labelledby="record-trade-title"]',
    prep: (api) =>
      setAccounts(api, [...ACCOUNTS_ALNUM, { ...ACC_C, id: 'accC' }, { ...ACC_D, id: 'accD' }]),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0, profile: PROFILE_B };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('#record-account-mark', { hasText: '自動で選択' }).waitFor();
      mustEq(await p.locator('select#record-account').inputValue(), 'accB', 'select の口座');
    },
  },
  {
    // 明細から記録した後（#66 デザイン 5: 覚えたことを保存の後の 1 行で 1 回だけ伝える）
    slug: 'record-35-learned-saved',
    name: '明細から記録した後',
    noBar: true,
    prep: (api) => setAccounts(api, ACCOUNTS_ALNUM),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0, profile: PROFILE_NEW };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.field__mark').first().waitFor();
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').click();
      await p.getByText('次からこの明細は', { exact: false }).waitFor();
      mustEq(api.profiles.length, 1, '覚えの送信');
    },
  },
  {
    // USD の口座に USD の明細（#66 C4: 損益・手数料が入る・注記なし）
    slug: 'record-36-usd-statement-usd',
    name: 'USD の口座に USD の明細',
    anchor: 'details.more',
    prep: (api) => setAccounts(api, [{ ...ACC_USD, id: 'default' }]),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_USD], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await expectPollAsync(
        async () => (await p.locator('#record-pnl').inputValue()) === '-62',
        'USD の損益',
      );
      mustEq(await p.locator('#record-money-note').count(), 0, '注記');
    },
  },
  {
    // 円の口座に USD の明細（#66 AC-11・C3: 損益・手数料は入らず、その下に「明細の損益は USD です（口座 1 は JPY）」）
    slug: 'record-30-currency-mismatch',
    name: '明細の通貨が違う',
    anchor: 'details.more',
    fn: async (p, api) => {
      api.read = {
        status: 200,
        rows: [{ ...READ_E1, pnl: -62, feesTotal: 2, fees: [2], pnlCurrency: 'USD' }],
        holdMs: 0,
      };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.field__mark').first().waitFor();
      await p.locator('#record-money-note', { hasText: '明細の損益は USD です' }).waitFor();
    },
  },
  {
    slug: 'record-10-read-failed',
    name: '読み取りの失敗',
    anchor: '.statement',
    fn: async (p, api) => {
      api.read = { status: 503, rows: [], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.getByRole('alert').filter({ hasText: '今は読み取りを使えません' }).waitFor();
    },
  },
  // 言葉の説明の「i」を 1 つ開いた状態（Issue #57 AC-10）。説明のシートが窓の左右・上下に収まることも見る（H3・#129）
  {
    // #56 デザインレビュー: 「LC を動かしたか」の説明（狭めた / 広げた の文）
    slug: 'record-11b-info-lcmove',
    name: '説明（LC を動かしたか）',
    reopen: '「LC を動かしたか」の説明',
    anchor: 'section[aria-labelledby="record-taps-title"]',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await openInfo(p, '「LC を動かしたか」の説明');
      await p.getByText('広げた（リスクが増える向き）', { exact: false }).first().waitFor();
    },
  },
  {
    slug: 'record-11-info-tap',
    name: '説明（時間足）',
    reopen: '「時間足を変えたか」の説明',
    anchor: 'section[aria-labelledby="record-taps-title"]',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await openInfo(p, '「時間足を変えたか」の説明');
    },
  },
  {
    slug: 'record-12-info-judge',
    name: '説明（判定）',
    reopen: '「判定」の説明',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('.verdict .badge', { hasText: 'B 悪い損失' }).waitFor();
      await openInfo(p, '「判定」の説明');
    },
  },
  {
    slug: 'record-13-info-r',
    name: '説明（R）',
    reopen: '「R」の説明',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('.verdict .badge', { hasText: 'B 悪い損失' }).waitFor();
      await openInfo(p, '「R」の説明');
    },
  },
  {
    slug: 'record-14-info-ruler',
    name: '説明（物差し）',
    reopen: '「LC の物差し」の説明',
    // 判定の枠を上の帯のすぐ下に寄せて撮る
    anchor: '.verdict',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('.verdict .badge', { hasText: 'B 悪い損失' }).waitFor();
      await openInfo(p, '「LC の物差し」の説明');
    },
  },
  {
    slug: 'record-15-info-statement',
    name: '説明（明細）',
    reopen: '「明細の送り方」の説明',
    anchor: '.statement',
    fn: async (p) => {
      await openInfo(p, '「明細の送り方」の説明');
    },
  },
  // 用語集のリンクを 2 段たどった状態（判定 → LC → 1R。#57 オーナーの要望）
  {
    slug: 'record-16-info-link2',
    name: '説明（2 段たどる）',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('.verdict .badge', { hasText: 'B 悪い損失' }).waitFor();
      // 撮るときの位置（判定の枠を上の帯のすぐ下）へ先に寄せてから開いてたどる（開き直すとたどった段が消えるため）
      await p.evaluate(() => {
        const v = document.querySelector('.verdict');
        if (v) window.scrollTo(0, v.getBoundingClientRect().top + window.scrollY - 76);
      });
      await openInfo(p, '「判定」の説明');
      await followLink(p, 'LC', 'LC');
      await followLink(p, '1R', '1R');
    },
  },
];

/** 層を開いたまま移って戻った後、元の項目の scrollRestoration が auto に戻っている（#57 再レビュー B2・N12） */
async function expectRestore(page, what) {
  // 記録する画面は戻ると読み込み直す（中身が描けるまで背が低い）ので、ブラウザの位置の復元そのものは S1（部品の見本）で測る。
  // ここでは元の項目に manual が残っていないこと（B2）だけを見る
  await page.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(300);
  const mode = await page.evaluate(() => history.scrollRestoration);
  if (mode !== 'auto') throw new Error(`${what}: scrollRestoration = ${mode}`);
}

/** 「i」のボタン（シートを開いている間、後ろは inert なので役割ではなく名前の属性で探す） */
const infoButton = (page, name) => page.locator(`button.info[aria-label="${name}"]`).first();
/** 開いている説明のシート（#129） */
const OPEN_SHEET = 'dialog.sheet[open]';
const sheetCount = (page) => page.locator(OPEN_SHEET).count();
/** 開いているシートの見出し（無ければ null） */
async function sheetTitle(page) {
  const t = page.locator(`${OPEN_SHEET} .sheet__title`);
  return (await t.count()) === 0 ? null : ((await t.first().textContent())?.trim() ?? '');
}

/** シートの出入りの動き（320ms）が終わるのを待つ */
async function settleSheet(page) {
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .filter((a) => a.effect?.target?.closest?.('dialog.sheet'))
          .every((a) => a.playState !== 'running'),
      null,
      { timeout: 3000 },
    )
    .catch(() => {});
}

/** 開いているシートの箱と窓の大きさ（#129。窓の中か・下からか・最大の高さを見る） */
async function sheetBox(page) {
  return page.evaluate((sel) => {
    const d = document.querySelector(sel);
    if (!d) return null;
    const r = d.getBoundingClientRect();
    const body = d.querySelector('.sheet__body');
    return {
      id: d.id,
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      vw: document.documentElement.clientWidth,
      vh: window.innerHeight,
      form: document.documentElement.getAttribute('data-form') ?? 'compact',
      scrollable: body ? body.scrollHeight - body.clientHeight : 0,
    };
  }, OPEN_SHEET);
}

/** シートが窓の中（上下左右）にある・縦の形は最大 86%（#110・9.3） */
function expectSheetInWindow(r, what) {
  if (!r) throw new Error(`${what}: シートが無い`);
  if (r.left < -0.5 || r.right > r.vw + 0.5)
    throw new Error(
      `${what}: シートが窓の左右の外（${Math.round(r.left)}〜${Math.round(r.right)} / ${r.vw}）`,
    );
  if (r.top < -0.5 || r.bottom > r.vh + 0.5)
    throw new Error(
      `${what}: シートが窓の上下の外（${Math.round(r.top)}〜${Math.round(r.bottom)} / ${r.vh}）`,
    );
  if (r.form === 'compact' && r.height > r.vh * 0.86 + 1)
    throw new Error(`${what}: シートの高さ ${Math.round(r.height)}px が窓の 86% を超える`);
}

/** 閉じる動きが終わった後、窓の中に見えているシートが無い（閉じた dialog が最上層に残らない。#129 のデザインレビュー a-1） */
async function expectNoSheetShown(page, what) {
  await settleSheet(page);
  const shown = await page.evaluate(
    () =>
      [...document.querySelectorAll('dialog.sheet')].filter((d) => {
        const r = d.getBoundingClientRect();
        const inWindow = r.bottom > 0.5 && r.top < window.innerHeight - 0.5 && r.height > 0;
        return d.checkVisibility() && inWindow;
      }).length,
  );
  if (shown > 0) throw new Error(`${what}: 窓の中にシートが ${shown} 枚見えている`);
}

/** 開いている説明のシートの中の用語集のリンクを押し、その言葉の説明（見出し）になるのを待つ（#57） */
async function followLink(page, linkText, title) {
  await page.locator(`${OPEN_SHEET} button.glink`, { hasText: linkText }).first().click();
  await expectPollAsync(async () => (await sheetTitle(page)) === title, `「${title}」の説明へ`);
  await settleSheet(page);
  expectSheetInWindow(await sheetBox(page), `${title}（たどった後）`);
}

/**
 * 「i」を押して説明のシートを開き、窓の中に収まることを確かめる（#57・#129）。開いていればそのまま確かめる（撮る前の
 * 開き直しは要らない。シートは窓に対して置く）
 */
async function openInfo(page, name, _reopen = false) {
  const b = infoButton(page, name);
  if ((await b.getAttribute('aria-expanded')) !== 'true') {
    await b.scrollIntoViewIfNeeded();
    await b.click();
  }
  const id = await b.getAttribute('aria-controls');
  if (!id) throw new Error(`${name}: aria-controls が無い（シートが開かない）`);
  await page.locator(`dialog[id="${id}"][open]`).waitFor({ state: 'visible', timeout: 5000 });
  await settleSheet(page);
  const r = await sheetBox(page);
  expectSheetInWindow(r, name);
  return r;
}

/** 今のフォーカスの読み上げの名前（aria-label） */
const focusLabel = (page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
/** 後ろの暗い面（シートの上・窓の上端の近く）を押す（#129） */
async function pressBackdrop(page) {
  const r = await sheetBox(page);
  if (!r) throw new Error('シートが無い');
  await page.mouse.click(Math.round(r.vw / 2), Math.max(4, Math.round(r.top / 2)));
}
/** シートの右上の ✕ で閉じる（#129） */
const closeSheet = (page) => page.locator(`${OPEN_SHEET} .sheet__close`).click();

// ── 設定の画面（Issue #5 の E16）。値はすべて架空 ──
const FAKE_N225 = {
  ...FAKE_US30,
  id: 'inst-n225',
  name: '日経225',
  underlying: '架空指数',
  priceCurrency: 'JPY',
};
const FAKE_XAU = {
  ...FAKE_US30,
  id: 'inst-xau',
  name: 'XAU',
  underlyingKind: 'commodity',
  priceCurrency: 'USD',
  multiplier: 100,
  quantityStep: 0.01,
};
/**
 * AI の利用状況（Issue #62。架空の値）: 今日 3 回・0.12 USD、今月（18 日まで）41 回・0.96 USD、既定の上限。
 * 状態の値は、今月 ≥ 今日・今月の回数 ≤ 1 日の上限 × 経過日数の範囲にそろえる（ありえない数を写さない）
 */
const FAKE_AI_USAGE = {
  today: { date: '2026-11-18', count: 3, microUsd: 120000 },
  month: { month: '2026-11', count: 41, microUsd: 960000 },
  limits: { count: 30, userMicroUsd: 1000000, dailyMicroUsd: 2000000 },
  bypass: false,
  blocked: { count: false, microUsd: false },
};
const usageBody = (over) => ({ ...FAKE_AI_USAGE, ...over });
/** 自動で足されたままの銘柄（初期値のまま） */
const FAKE_US30_AUTO = { ...FAKE_US30, underlyingKind: 'other' };

/** 資金 1,000,000円（履歴 3 件。移し替えで「口座 1」へ）・銘柄 3 件にする */
function seedSettings(api) {
  setAccounts(api, []);
  api.instruments.splice(0, api.instruments.length, FAKE_US30_AUTO, FAKE_N225, FAKE_XAU);
  api.settings = {
    capitalYen: 1000000,
    riskTolerancePct: 1,
    performanceUnit: 'R',
    capitalHistory: [
      { valueYen: 800000, at: 1799000000000 },
      { valueYen: 1200000, at: 1799500000000 },
      { valueYen: 1000000, at: 1799900000000 },
    ],
  };
}

/** 設定の画面を開き、口座の一覧（[＋ 口座を追加]）が出るまで待つ */
async function openSettings(page, base) {
  await page.goto(`${base}/settings`);
  await waitReady(page, '設定');
  await page.locator('#settings-account-add').waitFor({ state: 'visible', timeout: 15000 });
}

/** 設定の画面の状態（幅 × テーマで測る）。prep は開く前に偽の API を整え、fn は開いた画面をその状態にする */
const SETTINGS_STATES = [
  {
    slug: 'settings-1-open',
    name: '開いた直後',
    prep: seedSettings,
    fn: async () => {},
  },
  {
    slug: 'settings-5-accounts',
    name: '口座 2 つ（未設定の行）',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_C]);
    },
    fn: async (p) => {
      await p.locator('.instlist__item', { hasText: '資金 未設定 · 許容 1%' }).waitFor();
    },
  },
  {
    slug: 'settings-6-account-edit',
    name: '口座を直している',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_B]);
    },
    fn: async (p) => {
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await p.locator('#settings-account-name').waitFor();
      await p.locator('summary', { hasText: '資金の履歴（3 件）' }).click();
    },
  },
  {
    slug: 'settings-7-account-add',
    name: '口座の追加の欄',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, ACCOUNTS_2);
    },
    fn: async (p) => {
      await p.locator('#settings-account-add').click();
      await p.locator('#settings-account-name').fill('口座 Ｂ');
      await p.locator('#settings-account-capital').fill('300,000');
      await p.locator('#settings-account-save').click();
      await p
        .locator('#settings-account-name-error', { hasText: '同じ名前の口座があります' })
        .waitFor();
    },
  },
  {
    // #47 PR-2 U30: USD の口座の行
    slug: 'settings-8-usd-row',
    name: 'USD の口座の行',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_USD]);
    },
    fn: async (p) => {
      await p.locator('.instlist__item', { hasText: '10,000.00 USD · 許容 1%' }).waitFor();
      await p.getByRole('button', { name: '口座 D を編集' }).click();
      await p.locator('#settings-account-currency').waitFor();
    },
  },
  {
    // #47 PR-2 U31: 取引のある口座（既定の口座。例の取引は口座が付いていない）の直す欄は通貨が文字
    slug: 'settings-9-currency-locked',
    name: '通貨を変更できない口座',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_USD]);
    },
    fn: async (p) => {
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      // 通貨を変える操作のときだけ取引を確かめる（開いたときは読まない）。取引のある口座は文字に戻る
      await p.locator('input#settings-account-currency').fill('USD');
      await p
        .locator('#settings-account-currency', { hasText: '取引があるので変更できません' })
        .waitFor();
    },
  },
  {
    slug: 'settings-2-editing',
    name: '銘柄を直している',
    prep: seedSettings,
    fn: async (p) => {
      await p.getByRole('button', { name: 'US30 を編集' }).click();
      await p.locator('#settings-inst-name').waitFor();
      await p.locator('#settings-inst-kind').selectOption('index');
      await p.locator('#settings-inst-currency').fill('USD');
    },
  },
  {
    slug: 'settings-3-errors',
    name: '誤りと警告',
    prep: seedSettings,
    fn: async (p) => {
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await p.locator('#settings-account-capital').fill('1000.5');
      await p.locator('#settings-account-risk').fill('2.5');
      await p.getByRole('status').filter({ hasText: '2% を超えています' }).waitFor();
      await p.getByRole('button', { name: 'US30 を編集' }).click();
      await p.locator('#settings-inst-name').fill('日経２２５ ');
      await p.locator('#settings-inst-currency').fill('US');
      await p.locator('#settings-inst-multiplier').fill('0');
      await p.getByText('同じ名前の銘柄があります').waitFor();
    },
  },
  {
    slug: 'settings-4-unset',
    name: '資金が未設定',
    prep: (api) => {
      api.instruments.splice(0, api.instruments.length, FAKE_US30_AUTO);
    },
    fn: async (p) => {
      await p
        .locator('.instlist__item', { hasText: '資金を入力するとリスク（%）が表示されます' })
        .waitFor();
    },
  },
  {
    slug: 'settings-8-usage-reached',
    name: 'AI 金額で届いた',
    prep: (api) => {
      seedSettings(api);
      api.aiUsage = {
        status: 200,
        body: usageBody({
          today: { date: '2026-11-18', count: 24, microUsd: 721265 },
          month: { month: '2026-11', count: 96, microUsd: 3121265 },
          blocked: { count: false, microUsd: true },
        }),
      };
    },
    fn: async (p) => {
      await p.getByText('今日の読み取りは上限に届きました').waitFor();
    },
  },
  {
    slug: 'settings-11-usage-near',
    name: 'AI 上限に近いだけ',
    prep: (api) => {
      seedSettings(api);
      api.aiUsage = {
        status: 200,
        body: usageBody({
          today: { date: '2026-11-18', count: 25, microUsd: 310000 },
          month: { month: '2026-11', count: 88, microUsd: 1720000 },
        }),
      };
    },
    fn: async (p) => {
      await p.getByText('今日の読み取りは上限に近づいています').waitFor();
    },
  },
  {
    slug: 'settings-12-usage-count-reached',
    name: 'AI 回数で届いた',
    prep: (api) => {
      seedSettings(api);
      api.aiUsage = {
        status: 200,
        body: usageBody({
          today: { date: '2026-11-18', count: 30, microUsd: 420000 },
          month: { month: '2026-11', count: 120, microUsd: 2100000 },
          blocked: { count: true, microUsd: false },
        }),
      };
    },
    fn: async (p) => {
      await p.getByText('あと 0 回').waitFor();
    },
  },
  {
    slug: 'settings-13-usage-zero',
    name: 'AI 月の初日・0 回',
    prep: (api) => {
      seedSettings(api);
      api.aiUsage = {
        status: 200,
        body: usageBody({
          today: { date: '2026-12-01', count: 0, microUsd: 0 },
          month: { month: '2026-12', count: 0, microUsd: 0 },
        }),
      };
    },
    fn: async (p) => {
      await p.getByText('今日（12 月 1 日）').waitFor();
    },
  },
  {
    slug: 'settings-9-usage-bypass',
    name: 'AI 上限を受けない',
    prep: (api) => {
      seedSettings(api);
      api.aiUsage = {
        status: 200,
        body: usageBody({
          today: { date: '2026-11-18', count: 40, microUsd: 1500000 },
          month: { month: '2026-11', count: 212, microUsd: 6400000 },
          bypass: true,
          limits: { count: null, userMicroUsd: null, dailyMicroUsd: 2000000 },
        }),
      };
    },
    fn: async (p) => {
      await p.getByText('あなたの 1 日の上限: なし').waitFor();
    },
  },
  {
    slug: 'settings-14-usage-loading',
    name: 'AI 読み込み中',
    prep: (api) => {
      seedSettings(api);
      api.aiUsage = { status: 200, body: FAKE_AI_USAGE, holdMs: 20000 };
    },
    fn: async (p) => {
      await p.locator('.usage .loading', { hasText: '読み込んでいます…' }).waitFor();
    },
  },
  {
    slug: 'settings-10-usage-failed',
    name: 'AI 読めない',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_B]);
      api.aiUsage = { status: 503, body: { error: 'read_unavailable' } };
    },
    fn: async (p) => {
      await p.getByText('利用状況を読み込めませんでした').waitFor();
      // AC-7: 利用状況が読めなくても、口座の編集と [保存] は使える（別の部品で状態を共有しない）
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await p.locator('#settings-account-name').waitFor();
      if (!(await p.locator('#settings-account-save').isEnabled())) {
        throw new Error('利用状況が読めないときに口座の [保存] が押せない（AC-7）');
      }
    },
  },
];

async function emulatorUp() {
  try {
    const r = await fetch(`${AUTH_EMULATOR}/`);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * 文字の拡大 200%（Issue #79）の CSS。tokens.css の文字の大きさのトークン（--fs-*: Npx）を全部 2 倍にし、ルートの文字の
 * 大きさも 200% にする。トークンを足したら自動で入る（トークンが 1 つも読めなければ起動の誤り）
 */
function zoomCss() {
  const css = readFileSync(join(ROOT, 'ui/src/styles/tokens.css'), 'utf8');
  const all = [...css.matchAll(/(--fs-[a-z0-9-]+)\s*:/g)].length;
  const decls = [...css.matchAll(/(--fs-[a-z0-9-]+):\s*([\d.]+)px;/g)].map(
    ([, name, px]) => `${name}: ${Number(px) * ZOOM}px !important;`,
  );
  if (decls.length === 0)
    throw new Error('tokens.css に文字の大きさのトークン（--fs-*）がありません');
  // px の数で書いていないトークン（clamp・calc など）は 2 倍にできず、拡大の漏れにも出ないので、起動の誤りにする
  if (decls.length !== all)
    throw new Error(
      `tokens.css の文字の大きさのトークン ${all} 個のうち、px の数で書いたものが ${decls.length} 個です（拡大の検査は px の数だけを 2 倍にします）`,
    );
  return `:root { font-size: ${ZOOM * 100}% !important; ${decls.join(' ')} }`;
}

/** tokens.css のダークの定義の --bg（T2 の期待値） */
function darkBg() {
  const css = readFileSync(join(ROOT, 'ui/src/styles/tokens.css'), 'utf8');
  const block = /:root,\s*:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  return /--bg:\s*(#[0-9a-fA-F]{6})/.exec(block)?.[1]?.toLowerCase() ?? '';
}

function freePort() {
  return new Promise((ok, ng) => {
    const s = createNetServer();
    s.once('error', ng);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

/** 横スクロール（px）と、幅 360 のときは 44×44 未満の押せるもの */
/** slack = 部品の中の文字のはみ出しの許し（px。小数の丸めの分。文字の拡大では倍率の分だけ広げる） */
async function measure(page, withTargets, tap, slack = 1) {
  return page
    .evaluate(
      ({ withTargets, tap, slack }) => {
        const d = document.documentElement;
        const b = document.body;
        const h = Math.max(d.scrollWidth - window.innerWidth, b.scrollWidth - b.clientWidth, 0);
        const small = [];
        if (withTargets) {
          const sel =
            'a[href], button, input, select, textarea, [role="radio"], [role="button"], [tabindex]:not([tabindex="-1"])';
          for (const el of document.querySelectorAll(sel)) {
            if (el.closest('[data-ui-check-wide]')) continue;
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            if (r.width === 0 && r.height === 0) continue;
            // 文の中の用語集のリンク（.glink）は当たりの 44px の例外（WCAG 2.5.8 の inline。#57・#76）
            if (el.classList.contains('glink')) continue;
            if (r.width < tap - 0.5 || r.height < tap - 0.5) {
              const text = (el.textContent || el.getAttribute('aria-label') || '')
                .trim()
                .slice(0, 16);
              const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
              small.push(
                `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}「${text}」${Math.round(r.width)}×${Math.round(r.height)}`,
              );
            }
          }
        }
        // 部品のはみ出し（折り返さない部品の文字・部品そのものが切れる・隣に重なる）。次の 4 つを数える
        //   横 / 縦: 部品の中で文字が箱を超える（scrollWidth / scrollHeight > clientWidth / clientHeight）
        //   親の外: 部品が自分ごと広がり、親の箱の左右を超える（隣との重なり）
        //   切れ: 部品が、最も近い overflow が visible でない祖先の箱の外に出る（祖先で切られる）
        const clipped = [];
        const clipAncestor = (el) => {
          for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
            const cs = getComputedStyle(a);
            if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return a;
          }
          return null;
        };
        const outside = (r, b) =>
          r.left < b.left - 1 ||
          r.right > b.right + 1 ||
          r.top < b.top - 1 ||
          r.bottom > b.bottom + 1;
        for (const el of document.querySelectorAll(
          '.seg__item, .btn, .badge, .appnav__link, .envchip, .lcnone, .pagehead__title',
        )) {
          if (el.closest('[data-ui-check-wide]')) continue;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const name = `${el.className.split(' ')[0]}「${(el.textContent || '').trim().slice(0, 16)}」`;
          if (el.scrollWidth > el.clientWidth + slack) {
            clipped.push(`${name} 横 ${el.scrollWidth}>${el.clientWidth}`);
          }
          if (el.scrollHeight > el.clientHeight + slack) {
            clipped.push(`${name} 縦 ${el.scrollHeight}>${el.clientHeight}`);
          }
          // ボタン・バッジは親より広いときだけ折り返す作り（#79）。等倍（slack 1）で 2 行に折れていたら外れ
          if (slack <= 1 && (el.classList.contains('btn') || el.classList.contains('badge'))) {
            const tops = [];
            const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            for (let t = tw.nextNode(); t; t = tw.nextNode()) {
              if (t.textContent.trim() === '' || t.parentElement?.closest('.sr-only')) continue;
              const range = document.createRange();
              range.selectNodeContents(t);
              for (const rr of range.getClientRects()) {
                if (rr.width > 1 && !tops.some((y) => Math.abs(y - rr.top) < 4)) tops.push(rr.top);
              }
            }
            if (tops.length > 1) clipped.push(`${name} ${tops.length} 行に折れる`);
          }
          const r = el.getBoundingClientRect();
          // display: contents の親は箱を持たない（子は祖先の並びに入る）ので、箱を持つ祖先と比べる（#47 一覧の 1 行目）
          let parent = el.parentElement;
          while (parent && getComputedStyle(parent).display === 'contents')
            parent = parent.parentElement;
          if (parent) {
            const pr = parent.getBoundingClientRect();
            if (r.left < pr.left - 1 || r.right > pr.right + 1) {
              clipped.push(
                `${name} 親の外 ${Math.round(r.width)}px / 親 ${Math.round(pr.width)}px`,
              );
            }
          }
          const c = clipAncestor(el);
          // 縦にスクロールする祖先（説明のシートの中身。#129）の上下の外は、スクロールで隠れているだけ（切れではない）。左右は見る
          const scrollsY = c ? ['auto', 'scroll'].includes(getComputedStyle(c).overflowY) : false;
          const cb = c?.getBoundingClientRect();
          if (
            c &&
            cb &&
            (scrollsY ? r.left < cb.left - 1 || r.right > cb.right + 1 : outside(r, cb))
          ) {
            clipped.push(
              `${name} 切れ（${c.className.split(' ')[0] || c.tagName.toLowerCase()} の外）`,
            );
          }
        }
        // セグメントの選んだ項目のチェックの記号は文字の前で、項目の中に収まる（#5 のレビュー指摘 2・Issue #33 例 13）
        for (const mark of document.querySelectorAll('.seg__item .seg__check')) {
          const item = mark.closest('.seg__item');
          if (!item || item.closest('[data-ui-check-wide]')) continue;
          // 畳んだ欄（<details>）の中など、描かれていないものは見ない
          if (typeof mark.checkVisibility === 'function' && !mark.checkVisibility()) continue;
          const label = [...item.children].find((c) => c.tagName === 'SPAN');
          if (!label) continue;
          const range = document.createRange();
          range.selectNodeContents(label);
          const t = range.getBoundingClientRect();
          const m = mark.getBoundingClientRect();
          if (t.width === 0 || m.width === 0) continue;
          const name = `seg__check「${(label.textContent || '').trim()}」`;
          if (m.right > t.left + 0.5) clipped.push(`${name} 記号が文字の前に無い（重なる・後ろ）`);
          if (outside(m, item.getBoundingClientRect())) clipped.push(`${name} 項目の外`);
        }
        // 枠の入れ子（Issue #33 AC-5）。枠 = 四辺の線がある / 最も近い面を持つ祖先と違う面の色・背景の画像がある /
        // img・canvas・video。段 = 自分を含めた枠の祖先の数。段 3 以上の枠を数える（擬似要素・影・輪郭は数えない）
        const alpha = (c) => {
          if (!c || c === 'transparent') return 0;
          const slash = c.match(/\/\s*([\d.]+)(%?)\s*\)$/);
          if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
          const rgba = c.match(/^rgba\(([^)]*)\)$/);
          if (rgba) return Number(rgba[1].split(',')[3]);
          return 1;
        };
        const surfaceOf = (el) => {
          for (let a = el; a; a = a.parentElement) {
            const bg = getComputedStyle(a).backgroundColor;
            if (alpha(bg) > 0) return bg;
          }
          return getComputedStyle(document.body).backgroundColor;
        };
        const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
        const frameMemo = new Map();
        const isFrame = (el) => {
          if (frameMemo.has(el)) return frameMemo.get(el);
          let f = false;
          if (el !== document.body && el !== document.documentElement) {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            const drawn =
              (typeof el.checkVisibility !== 'function' ||
                el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) &&
              r.width >= 2 &&
              r.height >= 2 &&
              !el.classList.contains('sr-only') &&
              !el.closest('[data-ui-check-wide]');
            if (drawn) {
              if (['IMG', 'CANVAS', 'VIDEO'].includes(el.tagName)) f = true;
              else if (
                SIDES.every(
                  (s) =>
                    Number.parseFloat(cs[`border${s}Width`]) > 0 &&
                    !['none', 'hidden'].includes(cs[`border${s}Style`]) &&
                    alpha(cs[`border${s}Color`]) > 0,
                )
              )
                f = true;
              else if (cs.backgroundImage !== 'none') f = true;
              else if (alpha(cs.backgroundColor) > 0) {
                f = el.parentElement ? cs.backgroundColor !== surfaceOf(el.parentElement) : true;
              }
            }
          }
          frameMemo.set(el, f);
          return f;
        };
        const nest = [];
        const nameOf = (el) => {
          const c = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
          return c || el.tagName.toLowerCase();
        };
        for (const el of document.body.querySelectorAll('*')) {
          if (!isFrame(el)) continue;
          const chain = [];
          for (let a = el; a && a !== document.body; a = a.parentElement) {
            if (isFrame(a)) chain.unshift(nameOf(a));
          }
          if (chain.length >= 3)
            nest.push(`${nameOf(el)}（祖先: ${chain.slice(0, -1).join(' > ')}）`);
        }
        // 貼り付きの帯（記録する画面・直す画面）の高さと、状態の文の行数（Issue #33 AC-1・KEEP-7）
        let bar = null;
        const barEl = document.querySelector('.record__submit');
        if (barEl) {
          const statusEl = barEl.querySelector('.record__status, .record__missing');
          let lines = 0;
          if (statusEl && statusEl.textContent.trim() !== '') {
            const range = document.createRange();
            range.selectNodeContents(statusEl);
            const tops = new Set();
            for (const rr of range.getClientRects()) if (rr.width > 0) tops.add(Math.round(rr.top));
            lines = tops.size;
          }
          bar = {
            h: Math.round(barEl.getBoundingClientRect().height * 10) / 10,
            lines,
            // 状態の文が切れている（「…」で省かれる。コードレビュー指摘 1）
            cut: !!statusEl && statusEl.scrollWidth > statusEl.clientWidth + 0.5,
            text: statusEl?.textContent?.trim() ?? '',
            error: !!barEl.querySelector('.notice--error'),
          };
        }
        // 文字のリンクの見た目の操作（ui-guidelines 9.12 の数え方。#127）: 押せる要素（a・button・role=button・role=link）の
        // うち、面の色が親と同じで、枠の線も無く、アイコン（svg・img・canvas・擬似要素の中身）も無い、文字だけのもの。
        // 文の中の用語集のリンク（.glink）は除く。描かれていないもの・読み上げだけのもの（.sr-only）は見ない
        const linkish = [];
        for (const el of document.querySelectorAll('a, button, [role="button"], [role="link"]')) {
          if (el.closest('[data-ui-check-wide]') || el.classList.contains('glink')) continue;
          if (el.closest('.sr-only')) continue;
          if (
            typeof el.checkVisibility === 'function' &&
            !el.checkVisibility({ visibilityProperty: true })
          )
            continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (el.querySelector('svg, img, canvas')) continue;
          // 擬似要素の中身（› の記号）か、擬似要素の面・枠（小さいボタンの見た目の面 = .btn--sm。#127）
          const pseudo = ['::before', '::after'].some((p) => {
            const ps = getComputedStyle(el, p);
            const c = ps.content;
            if (!c || c === 'none' || c === 'normal') return false;
            if (c !== '""') return true;
            return (
              alpha(ps.backgroundColor) > 0 ||
              SIDES.some(
                (s) =>
                  Number.parseFloat(ps[`border${s}Width`]) > 0 && alpha(ps[`border${s}Color`]) > 0,
              )
            );
          });
          if (pseudo) continue;
          const cs = getComputedStyle(el);
          const lined = SIDES.some(
            (s) =>
              Number.parseFloat(cs[`border${s}Width`]) > 0 &&
              !['none', 'hidden'].includes(cs[`border${s}Style`]) &&
              alpha(cs[`border${s}Color`]) > 0,
          );
          if (lined || cs.boxShadow !== 'none' || cs.backgroundImage !== 'none') continue;
          if (alpha(cs.backgroundColor) > 0) {
            const parentSurface = el.parentElement ? surfaceOf(el.parentElement) : '';
            if (cs.backgroundColor !== parentSurface) continue;
          }
          const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
          linkish.push(
            `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}「${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 16)}」`,
          );
        }
        // [記録する] の数（ui-guidelines 9.2・A2。#127）: 見えている押せる要素で、名前が「記録する」「記録」のもの
        let recordEntries = 0;
        for (const el of document.querySelectorAll('a, button')) {
          if (
            typeof el.checkVisibility === 'function' &&
            !el.checkVisibility({ visibilityProperty: true })
          )
            continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const name = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, '');
          if (/^(＋)?記録(する)?$/.test(name)) recordEntries++;
        }
        return { h, small, clipped, nest, bar, scrollH: d.scrollHeight, linkish, recordEntries };
      },
      { withTargets, tap, slack },
    )
    .then((m) => {
      const at = new URL(page.url()).pathname;
      const vw = page.viewportSize()?.width ?? 0;
      for (const d of m.linkish) LINKISH.add(`${at} ${d}`);
      // ［記録する］ は 1 か所まで（縦の形 = 幅 720 未満。広い形の上の帯の ［＋ 記録］ と画面の主のボタンは U9・U10）
      if (vw < 720 && m.recordEntries > 1 && !at.startsWith('/dev/'))
        RECORD_DUP.add(`${vw}px ${at}: ${m.recordEntries} か所`);
      return m;
    });
}

/** 文字のリンクの見た目の操作（9.12。全状態で集める。0 件でなければ外れ。#127） */
const LINKISH = new Set();
/** ［記録する］ が 2 か所以上の状態（縦の形。#127） */
const RECORD_DUP = new Set();

/**
 * 文字の拡大（Issue #79）の測り。拡大の漏れ = 描かれた文字を持つ要素の文字の大きさが minFont 未満（トークンを通らない
 * px の大きさ）。行の重なり = 行の高さ（px）が文字の大きさより小さい（折り返すと行が重なる）か、別の要素の文字と文字の
 * 箱が重なる（列の幅が足りず隣の列に入る）。文字の箱は切る祖先（overflow が visible でない）の箱で切ってから比べ、
 * 位置を固定した帯（fixed・sticky）の中と外は比べない（スクロールで重なるのは正しい）。開いた説明のシートの文字は
 * 比べ合いにだけ入れない（拡大の漏れ・行の高さ・切れは見る）。
 * 文字が切る祖先の左右の外に出る（「…」で省く作りを除く）のも、文字の切れとして重なりに数える
 */
async function measureZoom(page, minFont) {
  return page.evaluate((minFont) => {
    const unscaled = [];
    const overlap = [];
    const texts = [];
    const seen = new Set();
    const layerOf = (el) => {
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        const pos = getComputedStyle(a).position;
        if (pos === 'fixed' || pos === 'sticky') return a;
      }
      return null;
    };
    // hard = 切るだけの祖先（hidden・clip）に限る。スクロールの容器（auto・scroll）は中を送れば読めるので、切れには数えない
    const scrolls = (cs) =>
      [cs.overflowX, cs.overflowY].some((v) => v === 'auto' || v === 'scroll');
    const clipBox = (el, hard = false) => {
      let box = { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 };
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        if (hard && scrolls(cs)) continue;
        const r = a.getBoundingClientRect();
        box = {
          left: Math.max(box.left, r.left),
          top: Math.max(box.top, r.top),
          right: Math.min(box.right, r.right),
          bottom: Math.min(box.bottom, r.bottom),
        };
      }
      // 自分が切る箱（「…」で省く名前など）なら自分の箱でも切る
      const own = getComputedStyle(el);
      if (own.overflowX !== 'visible' || own.overflowY !== 'visible') {
        const r = el.getBoundingClientRect();
        box = {
          left: Math.max(box.left, r.left),
          top: Math.max(box.top, r.top),
          right: Math.min(box.right, r.right),
          bottom: Math.min(box.bottom, r.bottom),
        };
      }
      return box;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || n.textContent.trim() === '') continue;
      if (el.closest('[data-ui-check-wide], [data-ui-check-clip], .sr-only, script, style'))
        continue;
      // 開いた説明のシートは上に重ねて出すもの。拡大の漏れ・行の高さ・切れは見るが、文字どうしの比べ合いには入れない
      const inPop = !!el.closest('dialog.sheet');
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) continue;
      const cs = getComputedStyle(el);
      const fs = Number.parseFloat(cs.fontSize);
      const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
      const name = `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}「${n.textContent.trim().slice(0, 12)}」`;
      if (!seen.has(el)) {
        seen.add(el);
        if (fs < minFont) unscaled.push(`${name} ${fs}px`);
        const lh = cs.lineHeight === 'normal' ? fs : Number.parseFloat(cs.lineHeight);
        if (lh < fs - 0.5) overlap.push(`${name} 行の高さ ${lh}px < 文字 ${fs}px`);
      }
      // 文字の箱（行ごと）。上下は字面に近づけるため、行の箱を文字の大きさの 0.8 倍に縮めて比べる
      const range = document.createRange();
      range.selectNodeContents(n);
      const clip = clipBox(el);
      const hardClip = clipBox(el, true);
      const rects = [];
      // 文字の切れ: 文字が切る祖先の左右の外に出る（「…」で省く作り = text-overflow: ellipsis の要素は除く）
      const ellipsis = getComputedStyle(el).textOverflow === 'ellipsis';
      let cut = false;
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        if (!ellipsis && (r.left < hardClip.left - 2 || r.right > hardClip.right + 2)) cut = true;
        const mid = (r.top + r.bottom) / 2;
        const half = Math.min(r.height, fs) * 0.4;
        const b = {
          left: Math.max(r.left, clip.left),
          right: Math.min(r.right, clip.right),
          top: Math.max(mid - half, clip.top),
          bottom: Math.min(mid + half, clip.bottom),
        };
        if (b.right - b.left > 1 && b.bottom - b.top > 1) rects.push(b);
      }
      if (cut) overlap.push(`${name} の文字が切れる（切る祖先の外）`);
      if (rects.length > 0 && !inPop) texts.push({ el, name, rects, layer: layerOf(el) });
    }
    const hit = (a, b) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i];
        const b = texts[j];
        if (a.layer !== b.layer) continue;
        if (a.rects.some((ra) => b.rects.some((rb) => hit(ra, rb)))) {
          overlap.push(`${a.name} と ${b.name} の文字が重なる`);
        }
      }
    }
    // 横スクロールの元（窓の右端を超える要素のうち、子が超えていないもの。先頭の 3 つ）
    const wide = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (wide.length >= 3) break;
      if (el.closest('[data-ui-check-wide], [data-ui-check-clip]')) continue;
      const r = el.getBoundingClientRect();
      if (r.right <= window.innerWidth + 1 || r.width === 0) continue;
      if ([...el.children].some((c) => c.getBoundingClientRect().right > window.innerWidth + 1))
        continue;
      const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
      wide.push(
        `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}「${(el.textContent || '').trim().slice(0, 12)}」右端 ${Math.round(r.right)}px`,
      );
    }
    return {
      bodyFont: Number.parseFloat(getComputedStyle(document.body).fontSize),
      unscaled,
      overlap,
      wide,
    };
  }, minFont);
}

async function waitReady(page, h1) {
  // 「取引」（取引のタブの根の題）は「取引の詳細」「取引を編集」に部分一致しないよう、題の全体で比べる（#127）
  const text = h1 === '取引' ? /^\s*取引\s*$/ : h1;
  await page
    .locator('main h1', { hasText: text })
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });
}

/**
 * 取引の詳細に着いた（見出しは取引の名前で、「取引の詳細」は読み込み中だけ。一覧から開くと読み込み済みの取引ですぐ名前になるので、
 * URL と判定の枠で見る。RP1 と同じ）
 */
async function waitDetail(page) {
  await expectPollAsync(
    async () => /^\/trades\/[^/]+$/.test(new URL(page.url()).pathname),
    '詳細の URL',
  );
  await page.locator('main .verdict').first().waitFor({ state: 'visible', timeout: 15000 });
}

function pad(s, n) {
  return s + ' '.repeat(Math.max(0, n - [...s].length));
}

async function main() {
  process.chdir(ROOT);
  try {
    zoomCss();
  } catch (e) {
    console.error(`文字の拡大の CSS を作れません: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  if (!(await emulatorUp())) {
    console.error(
      `Auth のエミュレーター（${AUTH_EMULATOR}）に繋がりません。別の端末で \`npm run emulators\` を起動してください。`,
    );
    process.exit(2);
  }
  let chromium;
  let createServer;
  try {
    ({ chromium } = await import('playwright'));
    ({ createServer } = await import('vite'));
  } catch (e) {
    console.error(
      `読み込めません（npm ci を済ませてください）: ${e instanceof Error ? e.message : e}`,
    );
    process.exit(2);
  }

  const port = await freePort();
  const server = await createServer({
    configFile: join(ROOT, 'vite.config.ts'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
  });
  await server.listen();
  const base = `http://127.0.0.1:${port}`;

  let browser;
  try {
    browser = await chromium.launch();
    // 書きかけがある間のタブを閉じる・再読み込み・移動の確認（beforeunload。#75 R8）は受けて進む（ほかのダイアログは
    // 今までどおり閉じる）。数は dialogsSeen に積む（DR1 が見る）
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (o) => {
      const ctx = await newContext(o);
      ctx.on('page', (pg) =>
        pg.on('dialog', (d) => {
          dialogsSeen.push(d.type());
          if (d.type() === 'beforeunload') d.accept().catch(() => {});
          else d.dismiss().catch(() => {});
        }),
      );
      return ctx;
    };
  } catch (e) {
    await server.close();
    console.error(
      `Chromium を起動できません。一度 \`npx playwright install chromium\` を流してください。\n${e instanceof Error ? e.message.split('\n')[0] : e}`,
    );
    process.exit(2);
  }

  // ログインした状態（IndexedDB の中のログインの記録）を 1 回作り、各状態の文脈で使い回す
  let signedIn;
  try {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await c.newPage();
    await p.goto(`${base}/login`);
    await waitReady(p, 'ログイン');
    await loginViaPopup(p);
    await waitReady(p, 'ホーム');
    signedIn = await c.storageState({ indexedDB: true });
    await c.close();
  } catch (e) {
    await browser.close();
    await server.close();
    console.error(
      `エミュレーターでログインできません（ログインの画面は apis.google.com を読みます。ネットに出られるか確かめてください）: ${e instanceof Error ? e.message.split('\n')[0] : e}`,
    );
    process.exit(2);
  }

  if (opts.shots) mkdirSync(opts.shots, { recursive: true });
  const problems = [];
  let states = 0;
  let worstH = 0;
  let smallTotal = 0;
  let clippedTotal = 0;
  let nestTotal = 0;
  let barTotal = 0;
  let zoomTotal = 0;
  let zoomUnscaled = 0;
  let zoomOverlap = 0;
  let zoomKnown = 0;
  /** 枠の入れ子 3 段以上（Issue #33 AC-5。部品の見本 /dev/parts は見本を並べる画面なので数えない） */
  const checkNest = (label, m) => {
    if (label.includes('/dev/parts')) return;
    nestTotal += m.nest.length;
    for (const x of m.nest.slice(0, 5)) {
      console.log(`    入れ子 3 段: ${x}`);
    }
    if (m.nest.length > 0)
      problems.push(`${label}: 入れ子 3 段以上 ${m.nest.length} 件（${m.nest[0]}）`);
  };

  try {
    // ── 画面 × 幅 × テーマ（C1〜C3）
    if (!opts.zoom)
      console.log(
        `画面の検査: ${PAGES.length} 画面 × ${SIZES.length} 幅 × ${THEMES.length} テーマ${opts.injectWide ? `（幅 ${opts.injectWide}px の要素を足す）` : ''}`,
      );
    for (const theme of opts.zoom ? [] : THEMES) {
      for (const [w, hgt] of SIZES) {
        const pageFor = new Map();
        const contexts = [];
        const errors = [];
        let recApi;
        for (const forLoginPage of [false, true]) {
          const context = await browser.newContext({
            viewport: { width: w, height: hgt },
            reducedMotion: 'reduce',
            // 幅 720 未満は指で触る端末として開く（pointer: coarse・hover: none。PC だけの案内を出さない）
            hasTouch: w < 720,
            // ログイン画面だけはログインしていない文脈で開く（ログイン済みは戻り先へ置き換わる）
            ...(forLoginPage ? {} : { storageState: signedIn }),
          });
          contexts.push(context);
          await setupContext(context, theme);
          if (!forLoginPage) recApi = await installFakeApi(context);
          const page = await context.newPage();
          page.on('pageerror', (e) => errors.push(e.message));
          pageFor.set(forLoginPage, page);
        }
        for (const p of PAGES) {
          const page = pageFor.get(p.path === '/login');
          const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(p.path, 22)}`;
          try {
            await page.goto(base + p.path);
            await waitReady(page, p.h1);
            if (p.wait) await page.locator(p.wait).first().waitFor({ timeout: 15000 });
            const m = await measure(page, w === 360, TAP);
            states++;
            // 直す画面の帯の高さ（Issue #33 KEEP-7。変える前の値以下）
            if (w === 360 && p.path.endsWith('/edit')) {
              console.log(`    直す画面の帯 ${m.bar ? `${m.bar.h}px` : '無し'}`);
              if (!m.bar || m.bar.h > EDIT_BAR_MAX + 0.5)
                problems.push(`${label}: 直す画面の帯 ${m.bar?.h ?? '無し'}px > ${EDIT_BAR_MAX}px`);
            }
            worstH = Math.max(worstH, m.h);
            smallTotal += m.small.length;
            const ng = m.h > 0 || m.small.length > 0 || m.clipped.length > 0 || errors.length > 0;
            const targetCol = w === 360 ? `当たり<44 ${m.small.length}件` : '';
            console.log(`${label} 横 ${m.h}px  ${targetCol}${ng ? '  NG' : ''}`);
            if (m.h > 0) problems.push(`${label}: 横スクロール ${m.h}px`);
            clippedTotal += m.clipped.length;
            for (const s of m.clipped) {
              console.log(`    はみ出し: ${s}`);
              problems.push(`${label}: はみ出し ${s}`);
            }
            for (const s of m.small) {
              console.log(`    当たり<44: ${s}`);
              problems.push(`${label}: 当たり<44 ${s}`);
            }
            checkNest(label, m);
            for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
            if (opts.shots) {
              const slug = p.path === '/' ? 'home' : p.path.slice(1).replace(/\//g, '-');
              await page.screenshot({
                path: join(opts.shots, `${w}x${hgt}-${theme}-${slug}.png`),
                fullPage: true,
              });
              // 幅 360 は、少し下へスクロールした見える範囲も撮る（下部の行き先の面を通して文字が透けないかを見る）
              if (w === 360 && (p.path === '/' || p.path === '/trades')) {
                await page.evaluate(() => window.scrollTo(0, 240));
                await page.screenshot({
                  path: join(opts.shots, `${w}x${hgt}-${theme}-${slug}-viewport.png`),
                });
                await page.evaluate(() => window.scrollTo(0, 0));
              }
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
            console.log(`${label} 開けない  NG`);
            problems.push(`${label}: 開けない ${msg}`);
          }
        }
        // トーストの出た一覧（Issue #9。詳細から [消す] → 一覧に「取引を削除しました」と [元に戻す]）。測った後に [元に戻す]
        {
          const tp = pageFor.get(false);
          const label = `${w}x${hgt} ${pad(theme, 5)} ${pad('/trades（トースト）', 22)}`;
          try {
            await tp.goto(`${base}/trades/x-d1`);
            await waitReady(tp, 'US30 · L');
            await tp.getByRole('button', { name: '削除', exact: true }).click();
            await waitReady(tp, '取引');
            await tp.locator('.toast').waitFor({ timeout: 5000 });
            const m = await measure(tp, w === 360, TAP);
            states++;
            worstH = Math.max(worstH, m.h);
            smallTotal += m.small.length;
            clippedTotal += m.clipped.length;
            const ng = m.h > 0 || m.small.length > 0 || m.clipped.length > 0 || errors.length > 0;
            const targetCol = w === 360 ? `当たり<44 ${m.small.length}件` : '';
            console.log(`${label} 横 ${m.h}px  ${targetCol}${ng ? '  NG' : ''}`);
            if (m.h > 0) problems.push(`${label}: 横スクロール ${m.h}px`);
            for (const x of m.clipped) {
              console.log(`    はみ出し: ${x}`);
              problems.push(`${label}: はみ出し ${x}`);
            }
            for (const x of m.small) {
              console.log(`    当たり<44: ${x}`);
              problems.push(`${label}: 当たり<44 ${x}`);
            }
            checkNest(label, m);
            for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
            if (opts.shots) {
              await tp.screenshot({
                path: join(opts.shots, `${w}x${hgt}-${theme}-trades-toast.png`),
              });
            }
            await tp.getByRole('button', { name: '元に戻す' }).click();
            await tp.locator('.toast').waitFor({ state: 'detached', timeout: 5000 });
          } catch (e) {
            const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
            console.log(`${label} 開けない  NG`);
            problems.push(`${label}: 開けない ${msg}`);
          }
        }
        // 記録する画面の状態（Issue #13）
        const recPage = pageFor.get(false);
        for (const st of RECORD_STATES) {
          const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`/record（${st.name}）`, 22)}`;
          try {
            // 口座は状態ごとに入れ替える（無い状態 = 既定の口座 1 つ。設定から作り直す）
            setAccounts(recApi, []);
            st.prep?.(recApi);
            // チャートの読み取りの偽の応答を状態ごとに戻す（#27）
            recApi.chartTimeframes = [];
            recApi.chartRead = { status: 200, kind: 'chart', holdMs: 0 };
            await openRecord(recPage, base);
            await st.fn(recPage, recApi);
            // --inject-clip: 帯の見本（長い文・改行・背の高い要素）を足し、帯の測りが見逃さないことを確かめる
            if (opts.injectClip && w === 360) await injectBarSample(recPage);
            const m = await measure(recPage, w === 360, TAP);
            states++;
            worstH = Math.max(worstH, m.h);
            smallTotal += m.small.length;
            clippedTotal += m.clipped.length;
            const ng = m.h > 0 || m.small.length > 0 || m.clipped.length > 0 || errors.length > 0;
            const targetCol = w === 360 ? `当たり<44 ${m.small.length}件` : '';
            console.log(`${label} 横 ${m.h}px  ${targetCol}${ng ? '  NG' : ''}`);
            if (m.h > 0) problems.push(`${label}: 横スクロール ${m.h}px`);
            // 貼り付きの帯は 1 段（Issue #33 AC-1: 360 で 64px 以下・状態の文は 1 行で切れない。保存の失敗の知らせの間は
            // 例外。保存の後は帯を持たない）
            if (w === 360) {
              const bar = m.bar;
              console.log(
                `    帯 ${bar ? `${bar.h}px・文 ${bar.lines} 行${bar.cut ? '・切れ' : ''}「${bar.text}」` : '無し'}・全長 ${m.scrollH}px`,
              );
              if (!bar) {
                if (!st.noBar) problems.push(`${label}: 貼り付きの帯が無い`);
              } else if (!bar.error) {
                const why = [
                  bar.h > BAR_MAX + 0.5 ? `高さ ${bar.h}px > ${BAR_MAX}px` : '',
                  bar.lines > 1 ? `文 ${bar.lines} 行` : '',
                  bar.cut ? `文が切れる「${bar.text}」` : '',
                ].filter(Boolean);
                barTotal += why.length;
                for (const x of why) console.log(`    帯: ${x}`);
                if (why.length > 0) problems.push(`${label}: 帯 ${why.join('・')}`);
              }
            }
            for (const x of m.clipped) {
              console.log(`    はみ出し: ${x}`);
              problems.push(`${label}: はみ出し ${x}`);
            }
            for (const x of m.small) {
              console.log(`    当たり<44: ${x}`);
              problems.push(`${label}: 当たり<44 ${x}`);
            }
            checkNest(label, m);
            for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
            if (opts.shots) {
              // 判定の枠（明細の状態は明細の枠）を上の帯のすぐ下に寄せて、見える範囲を撮る
              // （全体を撮ると貼り付けた帯・ボタンが途中に重なる）
              await recPage.evaluate((sel) => {
                const v = document.querySelector(sel);
                if (v) window.scrollTo(0, v.getBoundingClientRect().top + window.scrollY - 76);
              }, st.anchor ?? '.verdict');
              // 説明のシートの状態は、開いたままか確かめてから撮る（#57・#129）
              if (st.reopen) await openInfo(recPage, st.reopen, true);
              await recPage.screenshot({
                path: join(opts.shots, `${w}x${hgt}-${theme}-${st.slug}.png`),
                fullPage: st.slug === 'record-1-open',
              });
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
            console.log(`${label} 開けない  NG`);
            problems.push(`${label}: 開けない ${msg}`);
          }
        }
        // 設定の画面の状態（Issue #5 の E16）。状態ごとに偽の API の設定・銘柄を元に戻してから開く
        for (const st of SETTINGS_STATES) {
          const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`/settings（${st.name}）`, 22)}`;
          try {
            recApi.instruments.splice(0, recApi.instruments.length, FAKE_US30);
            recApi.settings = {
              capitalYen: null,
              riskTolerancePct: 1,
              performanceUnit: 'R',
              capitalHistory: [],
            };
            setAccounts(recApi, []);
            recApi.aiUsage = { status: 200, body: FAKE_AI_USAGE };
            st.prep(recApi);
            await openSettings(recPage, base);
            await st.fn(recPage, recApi);
            const m = await measure(recPage, w === 360, TAP);
            states++;
            worstH = Math.max(worstH, m.h);
            smallTotal += m.small.length;
            clippedTotal += m.clipped.length;
            const ng = m.h > 0 || m.small.length > 0 || m.clipped.length > 0 || errors.length > 0;
            const targetCol = w === 360 ? `当たり<44 ${m.small.length}件` : '';
            console.log(`${label} 横 ${m.h}px  ${targetCol}${ng ? '  NG' : ''}`);
            if (m.h > 0) problems.push(`${label}: 横スクロール ${m.h}px`);
            for (const x of m.clipped) {
              console.log(`    はみ出し: ${x}`);
              problems.push(`${label}: はみ出し ${x}`);
            }
            for (const x of m.small) {
              console.log(`    当たり<44: ${x}`);
              problems.push(`${label}: 当たり<44 ${x}`);
            }
            checkNest(label, m);
            for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
            if (opts.shots) {
              await recPage.screenshot({
                path: join(opts.shots, `${w}x${hgt}-${theme}-${st.slug}.png`),
                fullPage: true,
              });
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
            console.log(`${label} 開けない  NG`);
            problems.push(`${label}: 開けない ${msg}`);
          }
        }
        // 一覧・ホーム・詳細・直す（口座 2 つ。Issue #47 D1・U16・U17・U19）。測った後に口座を戻す。
        // 直す画面は口座を替えて、欄の下の 1 行（今の資金で計算し直す）が出た形を測る
        const ACCOUNT_ROW = '.traderow__account:visible, .traderow__account-top:visible';
        for (const [path, h1, wait, slug, after] of [
          ['/trades', '取引', ACCOUNT_ROW, 'trades-accounts'],
          ['/', 'ホーム', ACCOUNT_ROW, 'home-accounts'],
          ['/trades/x-d1', 'US30 · L', '.verdict__account', 'trade-x-d1-accounts'],
          // 保有時間と口座が並ぶ見出しの下の行（#58 デザインレビュー: 360 で 1 行に収まるか）
          ['/trades/x-r3', 'US30 · S', '.verdict__account', 'trade-x-r3-accounts'],
          [
            '/trades/x-d1/edit',
            '取引を編集',
            '#record-account-field',
            'trade-x-d1-edit-accounts',
            async (pg) => {
              await seg(pg, '口座', '口座 B').click();
              await pg.locator('#record-account-hint').waitFor();
              await pg.locator('#record-account-field').scrollIntoViewIfNeeded();
            },
          ],
        ]) {
          const tp = pageFor.get(false);
          const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`${path}（口座 2 つ）`, 22)}`;
          try {
            setAccounts(recApi, ACCOUNTS_2);
            await tp.goto(base + path);
            await waitReady(tp, h1);
            await tp.locator(wait).first().waitFor({ timeout: 15000 });
            if (after) await after(tp);
            // 前の状態のタップの位置に行が来ると :hover の面が付き、枠として数えてしまう。ポインタを外してから測る
            await tp.mouse.move(0, 0);
            const m = await measure(tp, w === 360, TAP);
            states++;
            worstH = Math.max(worstH, m.h);
            smallTotal += m.small.length;
            clippedTotal += m.clipped.length;
            const ng = m.h > 0 || m.small.length > 0 || m.clipped.length > 0 || errors.length > 0;
            const targetCol = w === 360 ? `当たり<44 ${m.small.length}件` : '';
            console.log(`${label} 横 ${m.h}px  ${targetCol}${ng ? '  NG' : ''}`);
            if (m.h > 0) problems.push(`${label}: 横スクロール ${m.h}px`);
            for (const x of m.clipped) {
              console.log(`    はみ出し: ${x}`);
              problems.push(`${label}: はみ出し ${x}`);
            }
            for (const x of m.small) {
              console.log(`    当たり<44: ${x}`);
              problems.push(`${label}: 当たり<44 ${x}`);
            }
            checkNest(label, m);
            for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
            if (opts.shots) {
              await tp.screenshot({
                path: join(opts.shots, `${w}x${hgt}-${theme}-${slug}.png`),
                fullPage: true,
              });
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
            console.log(`${label} 開けない  NG`);
            problems.push(`${label}: 開けない ${msg}`);
          } finally {
            setAccounts(recApi, []);
          }
        }
        // ホームの規律の振り返り（Issue #88 AC-12）: 期間ごと・件数が少ない・0 件・期間の誤り・取り込みを含める / 外す・
        // 「数で見る」を開いた形。取引を一時だけ S1（架空の値）に替えて測り、後で戻す
        {
          const ymd = (d) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const today = new Date();
          const back5 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 5);
          const REVIEW_STATES = [
            ['/?period=7d', REVIEW_S1, '.curve', 'home-review-7d'],
            ['/?period=1d', REVIEW_S1, '.review__grid', 'home-review-1d'],
            ['/?period=1m', REVIEW_S1, '.curve', 'home-review-1m'],
            ['/?period=3m', REVIEW_S1, '.curve', 'home-review-3m'],
            [
              `/?period=custom&from=${ymd(today)}&to=${ymd(back5)}`,
              REVIEW_S1,
              '#review-to-error',
              'home-review-custom-error',
            ],
            [
              `/?period=custom&from=${ymd(back5)}&to=${ymd(today)}`,
              REVIEW_S1,
              '.curve',
              'home-review-custom',
            ],
            [
              '/?period=custom&from=2020-01-01&to=2020-01-31',
              REVIEW_S1,
              '.review__empty',
              'home-review-empty',
            ],
            ['/?period=7d', REVIEW_S2, '.review__missing', 'home-review-few'],
            // レビュー後に足した状態（#88 Phase 4b）: 差が無い・大きな負け・取引の多い期間（合成 120 件）・読み込み中・
            // 「i」を開いた・キーボードのフォーカス
            ['/?period=7d', REVIEW_NOGAP, '.curve', 'home-review-nogap'],
            ['/?period=7d', REVIEW_BIG, '.curve', 'home-review-bigloss'],
            ['/?period=3m', REVIEW_MANY, '.curve', 'home-review-many'],
            ['/?period=7d', REVIEW_S1, '.review .loading', 'home-review-loading', null, 200, 4000],
            [
              '/?period=7d',
              REVIEW_S1,
              '.curve',
              'home-review-info',
              async (pg) => {
                await pg.locator('.review button[aria-label="「規律コスト」の説明"]').click();
                await pg.locator('dialog.sheet[open] .info__lead').first().waitFor();
              },
            ],
            ['/?period=7d', REVIEW_CLEAN, '.curve', 'home-review-clean'],
            ['/?period=1d', REVIEW_OLD, '.review__empty', 'home-review-empty-1d'],
            ['/?period=7d', REVIEW_OLD, '.review__empty', 'home-review-empty-7d'],
            ['/?period=1m', REVIEW_OLD, '.review__empty', 'home-review-empty-1m'],
            ['/?period=3m', REVIEW_OLD, '.review__empty', 'home-review-empty-3m'],
            [
              '/?period=7d',
              REVIEW_S1,
              '.curve',
              'home-review-switching',
              async (pg) => {
                recApi.rangeHoldMs = 4000;
                await seg(pg, '期間', '1か月').click();
                await pg.locator('.review__body--busy').waitFor();
              },
            ],
            [
              '/?period=7d',
              REVIEW_S1,
              '.curve',
              'home-review-info-rate',
              async (pg) => {
                await pg.locator('.review button[aria-label="「計画どおり率」の説明"]').click();
                await pg.locator('dialog.sheet[open] .info__lead').first().waitFor();
              },
            ],
            [
              '/?period=7d',
              [...REVIEW_S1, ...REVIEW_IMPORTS],
              '.review__toggle',
              'home-review-focus-toggle',
              async (pg) => {
                await pg.locator('input[name="review-period"]:checked').focus();
                await pg.keyboard.press('Tab');
                await pg.waitForFunction(() =>
                  document.activeElement?.classList.contains('review__check'),
                );
              },
            ],
            [
              '/?period=7d',
              REVIEW_S1,
              '.review__table > summary',
              'home-review-focus-table',
              async (pg) => {
                await pg.locator('.review__table > summary').focus();
                await pg.keyboard.press('Enter');
                await pg.locator('.review__table table').waitFor();
                await pg.keyboard.press('Tab');
                await pg.waitForFunction(() =>
                  document.activeElement?.classList.contains('review__scroll'),
                );
                await pg.locator('.review__table').scrollIntoViewIfNeeded();
              },
            ],
            [
              '/?period=7d',
              REVIEW_S1,
              '.curve',
              'home-review-focus',
              async (pg) => {
                // 見出しから Tab で期間の選択へ（#127 でホームの [記録する] を無くしたので、見出しを起点にする）
                await pg.locator('main h1').first().focus();
                for (let i = 0; i < 8; i++) {
                  await pg.keyboard.press('Tab');
                  const at = await pg.evaluate(() => document.activeElement?.getAttribute('name'));
                  if (at === 'review-period') break;
                }
                await pg.waitForFunction(
                  () => document.activeElement?.getAttribute('name') === 'review-period',
                );
              },
            ],
            [
              '/?period=7d',
              [...REVIEW_S1, ...REVIEW_IMPORTS],
              '.review__toggle',
              'home-review-imports-off',
            ],
            [
              '/?period=7d&imports=1',
              [...REVIEW_S1, ...REVIEW_IMPORTS],
              '.review__toggle',
              'home-review-imports-on',
            ],
            ['/?period=7d', REVIEW_IMPORTS, '.review__toggle', 'home-review-imports-only'],
            [
              '/?period=7d',
              REVIEW_S1,
              '.review__table > summary',
              'home-review-table',
              async (pg) => {
                await pg.locator('.review__table > summary').click();
                await pg.locator('.review__table table').waitFor();
                await pg.locator('.review__table').scrollIntoViewIfNeeded();
              },
            ],
            ['/?period=7d', REVIEW_S1, '.review .notice--error', 'home-review-failed', null, 503],
          ];
          for (const [path, trades, wait, slug, after, rangeStatus, holdMs] of REVIEW_STATES) {
            const tp = pageFor.get(false);
            const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`振り返り ${slug.replace('home-review-', '')}`, 22)}`;
            const saved = recApi.trades;
            try {
              recApi.trades = [...trades];
              recApi.rangeStatus = rangeStatus ?? 200;
              recApi.rangeHoldMs = holdMs ?? 0;
              await tp.goto(base + path);
              await waitReady(tp, 'ホーム');
              await tp.locator(wait).first().waitFor({ timeout: 15000 });
              if (after) await after(tp);
              await tp.mouse.move(0, 0);
              const m = await measure(tp, w === 360, TAP);
              states++;
              worstH = Math.max(worstH, m.h);
              smallTotal += m.small.length;
              clippedTotal += m.clipped.length;
              const ng = m.h > 0 || m.small.length > 0 || m.clipped.length > 0 || errors.length > 0;
              const targetCol = w === 360 ? `当たり<44 ${m.small.length}件` : '';
              console.log(`${label} 横 ${m.h}px  ${targetCol}${ng ? '  NG' : ''}`);
              if (m.h > 0) problems.push(`${label}: 横スクロール ${m.h}px`);
              for (const x of m.clipped) {
                console.log(`    はみ出し: ${x}`);
                problems.push(`${label}: はみ出し ${x}`);
              }
              for (const x of m.small) {
                console.log(`    当たり<44: ${x}`);
                problems.push(`${label}: 当たり<44 ${x}`);
              }
              checkNest(label, m);
              for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
              if (opts.shots) {
                await tp.screenshot({
                  path: join(opts.shots, `${w}x${hgt}-${theme}-${slug}.png`),
                  fullPage: true,
                });
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
              console.log(`${label} 開けない  NG`);
              problems.push(`${label}: 開けない ${msg}`);
            } finally {
              recApi.trades = saved;
              recApi.rangeStatus = 200;
              recApi.rangeHoldMs = 0;
            }
          }
          // RV1（幅 360・ダークで 1 回）: 5 つの期間を順に押す → URL の検索部分が置き換わり（履歴の数が増えない）、
          // フォーカスは押した選択肢に残る（見出しへ移らない）。開き直すと同じ期間。7 日の S1 の数字が出る
          if (w === 360 && theme === 'dark') {
            const tp = pageFor.get(false);
            const saved = recApi.trades;
            const expectEq = (got, want, what) => {
              if (got !== want)
                throw new Error(`${what}: ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`);
            };
            try {
              recApi.trades = [...REVIEW_S1];
              await tp.goto(`${base}/`);
              await waitReady(tp, 'ホーム');
              await tp.locator('.review .curve').waitFor({ timeout: 15000 });
              const text7 = (await tp.locator('.review').textContent()) ?? '';
              for (const want of [
                '57%',
                '4 / 7 件',
                '崩れで −0.6R',
                '守っていれば +0.9R · 実際 +0.3R',
              ]) {
                expectEq(text7.includes(want), true, `RV1: 7 日の S1 に「${want}」`);
              }
              const len0 = await tp.evaluate(() => history.length);
              for (const [key, name] of [
                ['1d', '1日'],
                ['1m', '1か月'],
                ['3m', '3か月'],
                ['custom', '任意'],
                ['7d', '7日'],
              ]) {
                await seg(tp, '期間', name).click();
                await tp.waitForFunction((k) => location.search.includes(`period=${k}`), key);
                await tp.locator('.review__meta, #review-to-error').first().waitFor();
                const focused = await tp.evaluate(
                  () =>
                    document.activeElement?.getAttribute('value') ??
                    document.activeElement?.tagName,
                );
                expectEq(focused, key, `RV1: ${name} を押した後のフォーカス`);
              }
              expectEq(
                await tp.evaluate(() => history.length),
                len0,
                'RV1: 履歴の数（置き換えだけ）',
              );
              await seg(tp, '期間', '3か月').click();
              await tp.waitForFunction(() => location.search.includes('period=3m'));
              // 切り替えの途中は前の図を薄く残すので、図ではなく範囲の行に件数が出る（読み終えた）まで待つ
              await tp.waitForFunction(
                () => document.querySelector('.review__meta')?.textContent?.includes('件') === true,
              );
              const meta = await tp.locator('.review__meta').textContent();
              await tp.reload();
              await waitReady(tp, 'ホーム');
              await tp.waitForFunction(
                () => document.querySelector('.review__meta')?.textContent?.includes('件') === true,
              );
              expectEq(
                await tp.locator('.review__meta').textContent(),
                meta,
                'RV1: 再読み込みで同じ期間',
              );
              expectEq(
                await tp.locator('input[name="review-period"]:checked').getAttribute('value'),
                '3m',
                'RV1: 再読み込みで選ばれた期間',
              );
              console.log('RV1 期間の置き換え・フォーカス・再読み込み ok');
            } catch (e) {
              const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
              console.log(`RV1 NG ${msg}`);
              problems.push(`RV1: ${msg}`);
            } finally {
              recApi.trades = saved;
            }
          }
          // ST1（幅 360・ダークで 1 回。Issue #35）: ホームと一覧の直近の流れは点 10 個が 1 行に並び（同じ高さ・カードの中）、
          // 並びの名前が「直近 10 件の判定（古い順）」、見出しの文が出る。ホームは先頭（振り返りの前。#127 で [記録する] を無くした）
          if (w === 360 && theme === 'dark') {
            const tp = pageFor.get(false);
            try {
              for (const [at, h1] of [
                ['/', 'ホーム'],
                ['/trades', '取引'],
              ]) {
                await tp.goto(base + at);
                await waitReady(tp, h1);
                await tp.locator('.streak__item').first().waitFor({ timeout: 15000 });
                const r = await tp.evaluate(() => {
                  const card = document.querySelector('.streak');
                  const items = [...document.querySelectorAll('.streak__item')];
                  const cb = card?.getBoundingClientRect();
                  const tops = new Set(
                    items.map((li) => Math.round(li.getBoundingClientRect().top)),
                  );
                  const outside = items.filter((li) => {
                    const b = li.getBoundingClientRect();
                    return !cb || b.left < cb.left || b.right > cb.right;
                  }).length;
                  const order = [
                    ...document.querySelectorAll('.home__record, .streak, .review'),
                  ].map((e) =>
                    e.className.split(' ').find((c) => !['card', 'section'].includes(c)),
                  );
                  return {
                    n: items.length,
                    rows: tops.size,
                    outside,
                    label: document.querySelector('.streak__dots')?.getAttribute('aria-label'),
                    headline: document.querySelector('.streak__headline')?.textContent ?? '',
                    order,
                  };
                });
                const where = `ST1 ${at}`;
                if (r.n !== 10) throw new Error(`${where}: 点の数 ${r.n}（期待 10）`);
                if (r.rows !== 1) throw new Error(`${where}: 点の行 ${r.rows}（期待 1）`);
                if (r.outside !== 0) throw new Error(`${where}: カードの外の点 ${r.outside}`);
                if (r.label !== '直近 10 件の判定（古い順）')
                  throw new Error(`${where}: 並びの名前 ${r.label}`);
                if (!/続いています|直近の取引は/.test(r.headline))
                  throw new Error(`${where}: 見出しの文 ${r.headline}`);
                // ホームに [記録する] を置かない（下のタブの 1 か所。#127）
                if (at === '/' && r.order.join(',') !== 'streak,review')
                  throw new Error(`${where}: 並び ${r.order.join(',')}`);
              }
              console.log('ST1 直近の流れ（点 10 個が 1 行・名前・見出し・ホームの並び） ok');
            } catch (e) {
              const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
              console.log(`ST1 NG ${msg}`);
              problems.push(`ST1: ${msg}`);
            }
          }
        }
        // 詳細と編集（外貨建て。#47 PR-2 U32・U33・U34）: 外貨の取引を一時だけ足して測る
        for (const fx of [
          {
            path: '/trades/x-fx',
            h1: '架空指数U · L',
            slug: 'trade-x-fx',
            name: '外貨建て',
            trade: TX_FX,
            after: async (pg) => {
              await pg.locator('details.more > summary', { hasText: 'すべての欄' }).first().click();
              await pg.locator('.fields__row', { hasText: '1 USD = 150円' }).waitFor();
            },
          },
          {
            path: '/trades/x-fxu',
            h1: '架空指数U · L',
            slug: 'trade-x-fxu',
            name: 'USD の口座の取引',
            trade: TX_FXU,
            after: async (pg) => {
              await pg.locator('details.more > summary', { hasText: 'すべての欄' }).first().click();
              await pg.locator('.fields__row', { hasText: '50.00 USD' }).first().waitFor();
            },
          },
          {
            path: '/trades/x-fx/edit',
            h1: '取引を編集',
            slug: 'trade-x-fx-edit-usd',
            name: '編集で USD の口座へ',
            trade: TX_FX,
            after: async (pg) => {
              await seg(pg, '口座', '口座 D').click();
              await pg.locator('#record-account-hint', { hasText: '通貨が違うので' }).waitFor();
              await pg.locator('#record-account-field').scrollIntoViewIfNeeded();
            },
          },
        ]) {
          const tp = pageFor.get(false);
          const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`${fx.path}（${fx.name}）`, 22)}`;
          withUsdInstrument(recApi);
          setAccounts(recApi, [ACC_ONE, ACC_USD]);
          recApi.trades.push(fx.trade);
          try {
            await tp.goto(base + fx.path);
            await waitReady(tp, fx.h1);
            await tp.locator('.verdict').first().waitFor({ timeout: 15000 });
            await fx.after(tp);
            await tp.mouse.move(0, 0);
            const m = await measure(tp, w === 360, TAP);
            states++;
            worstH = Math.max(worstH, m.h);
            smallTotal += m.small.length;
            clippedTotal += m.clipped.length;
            const ng = m.h > 0 || m.small.length > 0 || m.clipped.length > 0 || errors.length > 0;
            const targetCol = w === 360 ? `当たり<44 ${m.small.length}件` : '';
            console.log(`${label} 横 ${m.h}px  ${targetCol}${ng ? '  NG' : ''}`);
            if (m.h > 0) problems.push(`${label}: 横スクロール ${m.h}px`);
            for (const x of m.clipped) problems.push(`${label}: はみ出し ${x}`);
            for (const x of m.small) problems.push(`${label}: 当たり<44 ${x}`);
            checkNest(label, m);
            for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
            if (opts.shots) {
              await tp.screenshot({
                path: join(opts.shots, `${w}x${hgt}-${theme}-${fx.slug}.png`),
                fullPage: true,
              });
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
            console.log(`${label} 開けない  NG`);
            problems.push(`${label}: 開けない ${msg}`);
          } finally {
            recApi.trades.splice(recApi.trades.indexOf(fx.trade), 1);
            setAccounts(recApi, []);
          }
        }
        // Issue #89: 追加のチャートの詳細（7 枚）と、編集の画面の差し替え・削除・追加の直後
        for (const cs of [
          {
            path: '/trades/x-c7',
            h1: 'US30 · L',
            slug: 'trade-x-c7',
            name: '詳細 7 枚',
            wait: 'canvas.chartview__canvas >> nth=6',
            after: async () => {},
          },
          {
            path: '/trades/x-d1/edit',
            h1: '取引を編集',
            slug: 'edit-chart-replace',
            name: '編集 差し替え',
            wait: '#edit-chart-exit canvas',
            after: async (pg) => {
              const frame = pg.locator('#edit-chart-exit');
              await frame.locator('.chart__name').click();
              await makeChart(pg, 'paste');
              await frame.locator('.chart__mark', { hasText: '差し替え' }).waitFor();
              await pg.locator('#edit-change', { hasText: 'チャート 1 か所を変更' }).waitFor();
              await frame.scrollIntoViewIfNeeded();
            },
          },
          {
            path: '/trades/x-c7/edit',
            h1: '取引を編集',
            slug: 'edit-chart-remove',
            name: '編集 削除',
            wait: '#edit-chart-x2 canvas',
            after: async (pg) => {
              await pg.getByRole('button', { name: '追加のチャート 1のチャートを削除' }).click();
              await pg.locator('#edit-chart-x2-restore').waitFor();
              await pg.locator('#edit-chart-x2').scrollIntoViewIfNeeded();
            },
          },
          {
            path: '/trades/x-d1/edit',
            h1: '取引を編集',
            slug: 'edit-chart-add',
            name: '編集 追加',
            wait: '#edit-chart-exit canvas',
            after: async (pg) => {
              await pg.locator('#edit-chart-add').click();
              const frame = pg.locator('#edit-chart-x1');
              await frame.locator('.chart__name').click();
              await makeChart(pg, 'paste');
              await frame.locator('.chart__mark', { hasText: '追加' }).waitFor();
              await frame.scrollIntoViewIfNeeded();
            },
          },
          // 再レビューで撮れていなかった状態（[元に戻す] の後・2 枠の削除・差し替えの失敗・保存の後。フォーカスの移りも写る）
          {
            path: '/trades/x-c7/edit',
            h1: '取引を編集',
            slug: 'edit-chart-restore',
            name: '編集 元に戻す',
            wait: '#edit-chart-x2 canvas',
            after: async (pg) => {
              await pg.getByRole('button', { name: '追加のチャート 1のチャートを削除' }).click();
              await pg.locator('#edit-chart-x2-restore').click();
              await pg.locator('#edit-chart-x2 canvas').waitFor();
              await expectPollAsync(
                async () =>
                  (await pg.evaluate(() => document.activeElement?.id)) === 'edit-chart-x2',
                '[元に戻す] の後のフォーカス',
              );
            },
          },
          {
            path: '/trades/x-d1/edit',
            h1: '取引を編集',
            slug: 'edit-chart-remove-main',
            name: '編集 決済時を削除',
            wait: '#edit-chart-exit canvas',
            after: async (pg) => {
              await pg.getByRole('button', { name: '決済時のチャートを削除' }).click();
              await pg
                .locator('#edit-chart-exit .chart__mark', { hasText: '削除（未保存）' })
                .waitFor();
              await expectPollAsync(
                async () =>
                  (await pg.evaluate(() => document.activeElement?.id)) ===
                  'edit-chart-exit-restore',
                '[削除] の後のフォーカス',
              );
            },
          },
          {
            path: '/trades/x-d1/edit',
            h1: '取引を編集',
            slug: 'edit-chart-replace-failed',
            name: '編集 差し替えの失敗',
            wait: '#edit-chart-exit canvas',
            after: async (pg) => {
              await pg.locator('#edit-chart-exit-file').setInputFiles({
                name: 'not-a-chart.png',
                mimeType: 'image/png',
                buffer: Buffer.from('これは画像ではない（架空）'),
              });
              await pg.locator('#edit-chart-exit', { hasText: '前のチャートのまま' }).waitFor();
              await pg.locator('#edit-chart-exit canvas').waitFor();
              await pg.locator('#edit-chart-exit').scrollIntoViewIfNeeded();
            },
          },
          {
            path: '/trades/x-c7/edit',
            h1: '取引を編集',
            slug: 'trade-x-c7-saved',
            name: '保存の後の詳細',
            wait: '#edit-chart-x1 canvas',
            after: async (pg) => {
              const frame = pg.locator('#edit-chart-x1');
              await frame.locator('.chart__name').click();
              await makeChart(pg, 'paste');
              await frame.locator('.chart__mark', { hasText: '差し替え済み' }).waitFor();
              await pg.locator('#edit-submit').click();
              await pg.locator('h1', { hasText: 'US30 · L' }).waitFor();
              await pg.locator('canvas.chartview__canvas >> nth=6').waitFor({ timeout: 15000 });
            },
          },
        ]) {
          const tp = pageFor.get(false);
          const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`${cs.path}（${cs.name}）`, 22)}`;
          recApi.trades.push(TX_C7);
          recApi.chartTimeframes = [];
          try {
            await tp.goto(base + cs.path);
            await waitReady(tp, cs.h1);
            await tp.locator(cs.wait).first().waitFor({ timeout: 15000 });
            await cs.after(tp);
            await tp.mouse.move(0, 0);
            const m = await measure(tp, w === 360, TAP);
            states++;
            worstH = Math.max(worstH, m.h);
            smallTotal += m.small.length;
            clippedTotal += m.clipped.length;
            const ng = m.h > 0 || m.small.length > 0 || m.clipped.length > 0 || errors.length > 0;
            const targetCol = w === 360 ? `当たり<44 ${m.small.length}件` : '';
            console.log(`${label} 横 ${m.h}px  ${targetCol}${ng ? '  NG' : ''}`);
            if (m.h > 0) problems.push(`${label}: 横スクロール ${m.h}px`);
            for (const x of m.clipped) problems.push(`${label}: はみ出し ${x}`);
            for (const x of m.small) problems.push(`${label}: 当たり<44 ${x}`);
            checkNest(label, m);
            for (const e of errors.splice(0)) problems.push(`${label}: ページのエラー ${e}`);
            if (opts.shots) {
              await tp.screenshot({
                path: join(opts.shots, `${w}x${hgt}-${theme}-${cs.slug}.png`),
                fullPage: true,
              });
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
            console.log(`${label} 開けない  NG`);
            problems.push(`${label}: 開けない ${msg}`);
          } finally {
            // 保存の場面は取引を置き換えるので、ID で外す
            const at = recApi.trades.findIndex((t) => t.id === TX_C7.id);
            if (at >= 0) recApi.trades.splice(at, 1);
          }
        }
        for (const c of contexts) await c.close();
      }
    }

    // ── 文字の拡大 200%（Issue #79・WCAG 1.4.4）。全画面と記録する画面・設定の画面・ホームの振り返りの主な状態 ×
    // 幅 360 / 1440（文字の拡大）と 720×450（1440 のページの拡大）× ダーク
    {
      const recStates = ZOOM_RECORD.map((slug) => {
        const st = RECORD_STATES.find((x) => x.slug === slug);
        if (!st) throw new Error(`ZOOM_RECORD の ${slug} が RECORD_STATES に無い`);
        return st;
      });
      const setStates = ZOOM_SETTINGS.map((slug) => {
        const st = SETTINGS_STATES.find((x) => x.slug === slug);
        if (!st) throw new Error(`ZOOM_SETTINGS の ${slug} が SETTINGS_STATES に無い`);
        return st;
      });
      const zoomStates = PAGES.length + recStates.length + setStates.length + 1;
      console.log('');
      console.log(
        `文字の拡大 ${ZOOM * 100}%: ${zoomStates} 状態 × ${ZOOM_SIZES.length} 窓（${ZOOM_SIZES.map((z) => `${z.w}x${z.h}${z.text ? '' : ' ページの拡大'}`).join('・')}）× ${ZOOM_THEMES.length} テーマ`,
      );
      for (const theme of ZOOM_THEMES) {
        for (const { w, h: hgt, text, dpr } of ZOOM_SIZES) {
          const contexts = [];
          const errors = [];
          const pageFor = new Map();
          let recApi;
          for (const forLoginPage of [false, true]) {
            const context = await browser.newContext({
              viewport: { width: w, height: hgt },
              ...(dpr ? { deviceScaleFactor: dpr } : {}),
              reducedMotion: 'reduce',
              hasTouch: w < 720,
              ...(forLoginPage ? {} : { storageState: signedIn }),
            });
            contexts.push(context);
            await setupContext(context, theme, text);
            if (!forLoginPage) recApi = await installFakeApi(context);
            const page = await context.newPage();
            page.on('pageerror', (e) => errors.push(e.message));
            pageFor.set(forLoginPage, page);
          }
          const kind = text ? '拡大' : 'ページの拡大';
          /**
           * 1 状態を測って記す。open は画面をその状態にする。open が途中で外れても、その時点の画面を測る。
           * 既知（ZOOM_KNOWN）は match に当たる外れだけを失敗にせず、当たらない外れは失敗にする
           */
          const zoomState = async (page, name, slug, open) => {
            const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`${name}（${kind}）`, 26)}`;
            const known = ZOOM_KNOWN[`${w}:${slug}`];
            const found = [];
            try {
              await open();
            } catch (e) {
              const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
              found.push(`開けない ${msg}`);
            }
            let line = `${label} 測れない`;
            try {
              await page.mouse.move(0, 0);
              const m = await measure(page, false, TAP, text ? ZOOM : 1);
              const z = await measureZoom(page, text ? ZOOM_MIN_FONT : 0);
              states++;
              zoomTotal++;
              worstH = Math.max(worstH, m.h);
              clippedTotal += m.clipped.length;
              zoomUnscaled += z.unscaled.length;
              zoomOverlap += z.overlap.length;
              if (text && z.bodyFont < ZOOM_MIN_FONT)
                found.push(`拡大が効いていない（本文 ${z.bodyFont}px）`);
              if (m.h > 0)
                found.push(
                  `横スクロール ${m.h}px${z.wide.length > 0 ? `（${z.wide.join('、')}）` : ''}`,
                );
              for (const x of m.clipped) found.push(`はみ出し ${x}`);
              for (const x of z.unscaled) found.push(`拡大の漏れ ${x}`);
              for (const x of z.overlap) found.push(`行の重なり ${x}`);
              line = `${label} 横 ${m.h}px  本文 ${z.bodyFont}px  漏れ ${z.unscaled.length}件  重なり ${z.overlap.length}件`;
              if (opts.shots) {
                await page.screenshot({
                  path: join(
                    opts.shots,
                    `${w}x${hgt}-${theme}-${text ? 'zoom' : 'pagezoom'}-${slug}.png`,
                  ),
                  fullPage: true,
                });
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
              found.push(`測れない ${msg}`);
            }
            for (const e of errors.splice(0)) found.push(`ページのエラー ${e}`);
            const isKnown = (x) => !!known && known.match.test(x);
            const bad = found.filter((x) => !isKnown(x));
            const knownHits = found.filter(isKnown);
            console.log(`${line}${bad.length > 0 ? '  NG' : knownHits.length > 0 ? '  既知' : ''}`);
            for (const x of found.slice(0, 10))
              console.log(`    ${isKnown(x) ? '既知: ' : ''}${x}`);
            if (found.length > 10) console.log(`    ほか ${found.length - 10} 件`);
            for (const x of bad) problems.push(`${label}: ${x}`);
            if (known && knownHits.length === 0)
              problems.push(`${label}: 既知（ZOOM_KNOWN）の外れが無い。ZOOM_KNOWN から消す`);
            if (knownHits.length > 0) {
              zoomKnown++;
              console.log(`    既知の理由: ${known.why}`);
            }
          };
          for (const p of PAGES) {
            const page = pageFor.get(p.path === '/login');
            const slug = p.path === '/' ? 'home' : p.path.slice(1).replace(/\//g, '-');
            await zoomState(page, p.path, slug, async () => {
              await page.goto(base + p.path);
              await waitReady(page, p.h1);
              if (p.wait) await page.locator(p.wait).first().waitFor({ timeout: 15000 });
            });
          }
          const recPage = pageFor.get(false);
          for (const st of recStates) {
            await zoomState(recPage, `/record（${st.name}）`, st.slug, async () => {
              setAccounts(recApi, []);
              st.prep?.(recApi);
              recApi.chartTimeframes = [];
              recApi.chartRead = { status: 200, kind: 'chart', holdMs: 0 };
              await openRecord(recPage, base);
              await st.fn(recPage, recApi);
            });
          }
          for (const st of setStates) {
            await zoomState(recPage, `/settings（${st.name}）`, st.slug, async () => {
              recApi.instruments.splice(0, recApi.instruments.length, FAKE_US30);
              recApi.settings = {
                capitalYen: null,
                riskTolerancePct: 1,
                performanceUnit: 'R',
                capitalHistory: [],
              };
              setAccounts(recApi, []);
              recApi.aiUsage = { status: 200, body: FAKE_AI_USAGE };
              st.prep(recApi);
              await openSettings(recPage, base);
              await st.fn(recPage, recApi);
            });
          }
          // ホームの規律の振り返り（取引のある 7 日・数の段・曲線・「数で見る」を開いた形）
          {
            const saved = recApi.trades;
            recApi.trades = [...REVIEW_S1];
            await zoomState(recPage, '/（振り返り・数で見る）', 'home-review-table', async () => {
              await recPage.goto(`${base}/?period=7d`);
              await waitReady(recPage, 'ホーム');
              await recPage.locator('.curve').first().waitFor({ timeout: 15000 });
              await recPage.locator('.review__table > summary').click();
              await recPage.locator('.review__table table').waitFor();
            });
            recApi.trades = saved;
          }
          for (const c of contexts) await c.close();
        }
      }
    }

    // ── 行き来・テーマ・ログインの手順。--inject-wide / --inject-clip のときは画面の崩れの確かめだけにする
    if (!opts.injectWide && !opts.injectClip && !opts.zoom) {
      console.log('');
      console.log(
        '行き来 V1〜V7・安全域 SA1・スクロール S1 / テーマ T2〜T4 / ログイン L1〜L7・Google のボタン G1 / 使えないアカウント F1〜F2 / フォーカスの枠 FOC1 / 記録する R1〜R5 / 文言の撮影 W1 / 明細の読み取り R6〜R10 / 密度と階層 R11〜R13 / 設定 SET1〜SET5 / 口座 ACC1〜ACC2 / 数量の比 SZ1 / 為替 FX1 / 説明の「i」IT1〜IT3・下のシート SH1〜SH3・用語集 GL1〜GL2・書きかけ DR1〜DR2・詳細と編集の「i」DI1・置き換え RP1 / 取引 T-L4〜T-X2 / ページ分け TL-P1〜TL-P5',
      );
      const flows = await runFlows(browser, base, signedIn);
      for (const [id, ok, detail] of flows) {
        console.log(`  ${pad(id, 4)} ${ok ? 'ok' : 'NG'}${detail ? `  ${detail}` : ''}`);
        if (!ok) problems.push(`${id}: ${detail}`);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  console.log('');
  console.log(`文字のリンクの見た目の操作（9.12）: ${LINKISH.size} 件`);
  for (const d of LINKISH) {
    console.log(`  ${d}`);
    problems.push(`文字のリンクの見た目の操作: ${d}`);
  }
  console.log(`［記録する］ が 2 か所以上の状態（縦の形）: ${RECORD_DUP.size} 件`);
  for (const d of RECORD_DUP) {
    console.log(`  ${d}`);
    problems.push(`［記録する］ の重複: ${d}`);
  }
  console.log(
    `要約: ${states} 状態、横スクロールの最大 ${worstH}px、幅 360 の当たり<44 ${smallTotal} 件、部品のはみ出し ${clippedTotal} 件、入れ子 3 段以上 ${nestTotal} 件、帯の外れ ${barTotal} 件、文字の拡大 ${zoomTotal} 状態（拡大の漏れ ${zoomUnscaled} 件・行の重なり ${zoomOverlap} 件・既知 ${zoomKnown} 状態）、外れ ${problems.length} 件`,
  );
  if (opts.shots) console.log(`撮影: ${opts.shots}（コミットしない）`);
  if (problems.length > 0) {
    console.log('NG');
    process.exit(1);
  }
  console.log('ok');
}

/** 読み取りの後に手で入れる 5 つ（打つ: LC・一言 / 選ぶ: 決めていた・そのまま・そのまま）。数を返す */
async function fillStatementTaps(page, lc = '99.0') {
  await page.locator('#record-lc').fill(lc);
  await page.locator('#record-broken').fill('押し目の安値を割ったら');
  await seg(page, 'LC を入る前に決めていたか', '決めていた').click();
  await seg(page, 'LC を動かしたか', 'そのまま').click();
  await seg(page, '時間足を変えたか', 'そのまま').click();
  return { typed: 2, chosen: 3 };
}

/** 非同期の条件が成り立つまで待つ（5 秒で外れ） */
async function expectPollAsync(cond, what) {
  for (let i = 0; i < 50; i++) {
    if (await cond()) return;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error(`${what}: 待っても成り立たない`);
}

/** 条件が成り立つまで待つ（10 秒で外れ） */
async function expectPoll(cond, what) {
  for (let i = 0; i < 100; i++) {
    if (cond()) return;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error(`${what}: 待っても成り立たない`);
}

/** 例の表の V1〜V6・S1・T2〜T4・L1〜L7 を実ブラウザで流す。[ID, ok, 詳細] の列を返す */
async function runFlows(browser, base, signedIn) {
  const out = [];
  const check = async (id, fn) => {
    try {
      const detail = await fn();
      out.push([id, true, detail ?? '']);
    } catch (e) {
      // 待ちの外れは何を待っていたかが 2 行目以降にあるので、3 行まで出す（#127）
      out.push([
        id,
        false,
        e instanceof Error
          ? e.message
              .split('\n')
              .filter((l) => l.trim() !== '')
              .slice(0, 3)
              .join(' | ')
          : String(e),
      ]);
    }
  };
  const expectEq = (got, want, what) => {
    if (got !== want)
      throw new Error(`${what}: ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`);
  };
  const path = (page) => new URL(page.url()).pathname;

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: signedIn,
  });
  // 行き来の手順は取引 0 件の偽の API で流す（V1 は下のタブの真ん中の ［＋ 記録］ を踏む。#127 でホームの [記録する] を無くした）
  await installFakeApi(ctx, { trades: [] });
  const page = await ctx.newPage();

  await check('V1', async () => {
    await page.goto(`${base}/`);
    await waitReady(page, 'ホーム');
    // ホームの中身に [記録する] を置かない（下のタブの 1 か所だけ。#127）
    expectEq(await page.locator('main a[href="/record"]').count(), 0, 'ホームの中の [記録する]');
    await page.locator('nav a[href="/record"]').click();
    await waitReady(page, '記録する');
    expectEq(path(page), '/record', 'URL');
    return 'ホーム → ［＋ 記録］ → /record';
  });
  await check('V2', async () => {
    await page.goBack();
    await waitReady(page, 'ホーム');
    expectEq(path(page), '/', 'URL');
    return '戻る → /';
  });
  await check('V3', async () => {
    await page.goto(`${base}/trades`);
    await waitReady(page, '取引');
    await page.reload();
    await waitReady(page, '取引');
    expectEq(path(page), '/trades', 'URL');
    return '直接開く・再読み込み → 一覧';
  });
  await check('V4', async () => {
    await page.goto(`${base}/trades/no-such-trade`);
    await waitReady(page, '取引の詳細');
    await page.getByText('この取引は見つかりません').waitFor();
    // 上の帯の「‹ 取引」と、空の状態の [一覧へ戻る]（#127）
    const link = page.locator('main .empty a[href="/trades"]');
    if ((await link.count()) !== 1) throw new Error('一覧へのボタンが 1 つでない');
    await link.click();
    await waitReady(page, '取引');
    return '「この取引は見つかりません」→ 一覧へ';
  });
  await check('V5', async () => {
    await page.goto(`${base}/trades`);
    await waitReady(page, '取引');
    await page.goto(`${base}/no-such-page`);
    await waitReady(page, 'ホーム');
    expectEq(path(page), '/', 'URL');
    await page.goBack();
    await waitReady(page, '取引');
    expectEq(path(page), '/trades', '戻った先');
    return '知らない URL → / に置き換え、戻る → /trades';
  });
  // ホーム画面に追加（Issue #77 の AC-6・例 E8）: 開発サーバーは CSP を付けないので、/ の文書だけに本番の manifest-src の
  // 許可（api の BASE_CSP の manifest-src 'self' と同じ。本番の値は image-check.sh が見る）を付けて開き、Chromium が manifest を
  // エラーなしで読むこと（CDP の Page.getAppManifest）と、manifest の読み込みが CSP で止まらないことを見る
  await check('PWA1', async () => {
    const c = await browser.newContext({ viewport: { width: 360, height: 780 } });
    try {
      await c.route(`${base}/`, async (route) => {
        const res = await route.fetch();
        await route.fulfill({
          response: res,
          headers: { ...res.headers(), 'content-security-policy': "manifest-src 'self'" },
        });
      });
      const p = await c.newPage();
      const blocked = [];
      p.on('console', (m) => {
        if (/manifest/i.test(m.text()) && /Refused|Content Security Policy/i.test(m.text()))
          blocked.push(m.type());
      });
      const seen = new Map();
      p.on('response', (r) => seen.set(new URL(r.url()).pathname, r.status()));
      await p.goto(`${base}/`);
      await p.waitForLoadState('load');
      const cdp = await c.newCDPSession(p);
      let got = await cdp.send('Page.getAppManifest');
      for (let i = 0; i < 20 && !got.data; i++) {
        await p.waitForTimeout(250);
        got = await cdp.send('Page.getAppManifest');
      }
      expectEq(new URL(got.url).pathname, '/manifest.webmanifest', 'manifest の URL');
      expectEq(got.errors.length, 0, 'manifest のエラーの件数');
      const m = JSON.parse(got.data ?? '{}');
      expectEq(m.display, 'standalone', 'display');
      expectEq(m.start_url, '/', 'start_url');
      expectEq(blocked.length, 0, 'manifest の CSP の違反の件数');
      for (const icon of m.icons ?? []) {
        const r = await p.request.get(`${base}${icon.src}`);
        expectEq(r.status(), 200, icon.src);
      }
      expectEq(seen.get('/manifest.webmanifest'), 200, '/manifest.webmanifest の状態');
      return `manifest のエラー 0 件・CSP の違反 0 件・アイコン ${(m.icons ?? []).length} つが 200`;
    } finally {
      await c.close();
    }
  });
  await check('S1', async () => {
    await page.goto(`${base}/dev/parts`);
    await waitReady(page, '部品の見本');
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForFunction(() => window.scrollY >= 1100);
    const before = await page.evaluate(() => window.scrollY);
    // 今のタブの中で進む（［＋ 記録］ = push。タブの切り替えは V7 で見る。#127）
    await page.locator('nav a[href="/record"]').click();
    await waitReady(page, '記録する');
    expectEq(await page.evaluate(() => window.scrollY), 0, '進んだ先のスクロール');
    await page.goBack();
    await waitReady(page, '部品の見本');
    await page
      .waitForFunction((y) => Math.abs(window.scrollY - y) <= 2, before, { timeout: 5000 })
      .catch(() => {});
    const after = await page.evaluate(() => window.scrollY);
    if (Math.abs(after - before) > 2)
      throw new Error(`戻った後のスクロール ${after}px（期待 ${before}px）`);
    // B2（#57 再レビュー・N12）: 「i」を開いたまま別の画面へ移って戻った後も、この画面の戻るの位置の復元が効く
    // （元の項目に scrollRestoration = manual が残らない）。部品の見本は読み込みの待ちが無いので、復元をそのまま測れる
    await page.evaluate(() => window.scrollTo(0, 0));
    // 説明のシートはモーダルなので、シートの中の ［用語集で見る］ で移る（#129）
    await openInfo(page, '「判定」の説明');
    await page.locator(`${OPEN_SHEET} .info__glossary`).click();
    await waitReady(page, '用語集');
    await page.goBack();
    await waitReady(page, '部品の見本');
    await page.waitForTimeout(300);
    const mode = await page.evaluate(() => history.scrollRestoration);
    expectEq(mode, 'auto', '戻った後の scrollRestoration');
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForFunction(() => window.scrollY >= 1100);
    const before2 = await page.evaluate(() => window.scrollY);
    await page.locator('nav a[href="/record"]').click();
    await waitReady(page, '記録する');
    await page.goBack();
    await waitReady(page, '部品の見本');
    await page
      .waitForFunction((y) => Math.abs(window.scrollY - y) <= 2, before2, { timeout: 5000 })
      .catch(() => {});
    const after2 = await page.evaluate(() => window.scrollY);
    if (Math.abs(after2 - before2) > 2)
      throw new Error(
        `「i」を開いたまま移って戻った後の戻るのスクロール ${after2}px（期待 ${before2}px）`,
      );
    return `進む → 先頭（0px）、戻る → 元の位置（${after}px）。「i」を開いたまま移って戻った後も auto・戻る → 元の位置（${after2}px）`;
  });
  await ctx.close();

  await check('V6', async () => {
    const c = await browser.newContext({
      viewport: { width: 360, height: 780 },
      storageState: signedIn,
    });
    await installFakeApi(c);
    const p = await c.newPage();
    let taps = 0;
    try {
      let sheets = 0;
      for (const from of PAGES.filter((x) => x.path !== '/login')) {
        // 全画面のシート（記録する・編集）の間は下のタブを隠し、左上に ✕（キャンセル）を出す（9.2・9.3・A2）
        if (SHEET_PATHS(from.path)) {
          await p.goto(base + from.path);
          await waitReady(p, from.h1);
          if (await p.locator('nav.appnav').isVisible())
            throw new Error(`${from.path} で下のタブが出ている`);
          const x = await p.locator('.appbar--sheet button[aria-label="キャンセル"]').boundingBox();
          if (!x || x.x > 60 || x.y > 60) throw new Error(`${from.path} の ✕ が左上に無い`);
          sheets++;
          continue;
        }
        for (const href of NAV_HREFS) {
          await p.goto(base + from.path);
          await waitReady(p, from.h1);
          const link = p.locator(`nav a[href="${href}"]`);
          const box = await link.boundingBox();
          if (!box) throw new Error(`${from.path} に ${href} が無い`);
          if (box.y < 0 || box.y + box.height > 780 || box.x < 0 || box.x + box.width > 360) {
            throw new Error(`${from.path} の ${href} が画面の外`);
          }
          await link.click();
          await p
            .waitForURL((u) => u.pathname === href, { timeout: 5000 })
            .catch(() => {
              throw new Error(`${from.path} → ${href}: URL が ${new URL(p.url()).pathname} のまま`);
            });
          taps++;
        }
      }
      return `幅 360 の ${PAGES.length - 1 - sheets} 画面 × 5 項目（タブ 4 つ + ［＋ 記録］）= ${taps} 回、すべて 1 タップ。全画面のシート ${sheets} 画面は下のタブを隠し、左上に ✕`;
    } finally {
      await c.close();
    }
  });

  // V7（#127。ui-guidelines 9.7 の表）: タブごとの積み重ねと戻る（縦の形 390×844）。印の無い起動だけ履歴を組み直す
  // （/trades/x-r1 を直接開く → 戻ると一覧 → もう 1 回でホーム。再読み込みでは積まない）・ホーム → 取引 → 行 → 設定（戻ると
  // ホーム）→ 取引で詳細が出てスクロールの位置が戻る・同じタブを押し直すと根・詳細で説明を開いたまま再読み込みすると層は
  // 開かず、戻る 1 回で一覧。広い形（1280×800）では、記録するを開いて書きかけのまま設定のタブへ → 閉じて「記録の入力は残って
  // います」、取引のタブへ戻ると一覧（記録するは取引の積み重ねに残らない）
  await check('V7', async () => {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: signedIn,
      hasTouch: true,
    });
    await installFakeApi(c);
    const p = await c.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    const at = () => new URL(p.url()).pathname;
    const steps = [];
    try {
      // 印の無い起動（直接開いた）→ [/, /trades, /trades/x-r1]。再読み込みでは組み直さない
      await p.goto(`${base}/trades/x-r1`);
      await waitReady(p, 'US30 · L');
      const len0 = await p.evaluate(() => history.length);
      await p.reload();
      await waitReady(p, 'US30 · L');
      expectEq(await p.evaluate(() => history.length), len0, '再読み込みの後の履歴の数');
      // 組み直しは利用者の最初の操作で書く（操作の無いまま積んだ段は Chrome が戻るで飛ばす。触らずに戻ればアプリを出る）
      await p.locator('main h1').first().click();
      expectEq(await p.evaluate(() => history.length), len0 + 2, '操作の後の組み直し（+2 段）');
      await p.goBack();
      await waitReady(p, '取引');
      expectEq(at(), '/trades', '直接開いた詳細の戻る');
      await p.goBack();
      await waitReady(p, 'ホーム');
      expectEq(at(), '/', 'もう 1 回の戻る');
      steps.push('直接開いた詳細 → 戻る 2 回でホーム（再読み込みで積まない）');
      // ホーム → 取引 → 行 → 設定 → 取引（詳細と位置が戻る）
      await p.locator('nav a[href="/trades"]').click();
      await waitReady(p, '取引');
      await p.locator('a.traderow[href="/trades/x-r1"]').click();
      await waitReady(p, 'US30 · L');
      await p.locator('.ruler__plot').first().waitFor({ timeout: 15000 });
      await p.waitForTimeout(300);
      const want = await p.evaluate(() =>
        Math.min(400, document.documentElement.scrollHeight - window.innerHeight),
      );
      if (want < 100) throw new Error(`詳細のスクロールできる量 ${want}px（100px 未満）`);
      await p.evaluate((v) => window.scrollTo(0, v), want);
      await p.waitForFunction((v) => window.scrollY >= v - 2, want);
      const y = await p.evaluate(() => window.scrollY);
      await p.locator('nav a[href="/settings"]').click();
      await waitReady(p, '設定');
      expectEq(at(), '/settings', '設定のタブ');
      await p.goBack();
      await waitReady(p, 'ホーム');
      expectEq(at(), '/', '設定の根の戻る');
      await p.locator('nav a[href="/trades"]').click();
      await waitReady(p, 'US30 · L');
      expectEq(at(), '/trades/x-r1', '取引のタブで前に開いていた詳細');
      await p
        .waitForFunction((want) => Math.abs(window.scrollY - want) <= 2, y, { timeout: 5000 })
        .catch(() => {});
      const y2 = await p.evaluate(() => window.scrollY);
      if (Math.abs(y2 - y) > 2) throw new Error(`戻した位置 ${y2}px（期待 ${y}px）`);
      await p.goBack();
      await waitReady(p, '取引');
      expectEq(at(), '/trades', '積み直した詳細の戻る');
      steps.push(`取引 → 詳細 → 設定（戻るとホーム）→ 取引で詳細と位置 ${Math.round(y2)}px が戻る`);
      // 同じタブを押し直すと根へ
      await p.locator('a.traderow[href="/trades/x-r1"]').click();
      await waitReady(p, 'US30 · L');
      await p.locator('nav a[href="/trades"]').click();
      await waitReady(p, '取引');
      expectEq(at(), '/trades', '同じタブの押し直し');
      await p.goBack();
      await waitReady(p, 'ホーム');
      steps.push('同じタブを押し直すと根（戻るとホーム）');
      // 説明を開いたまま再読み込み → 層は開かず、戻る 1 回で一覧
      await p.locator('nav a[href="/trades"]').click();
      await waitReady(p, '取引');
      await p.locator('a.traderow[href="/trades/x-r1"]').click();
      await waitReady(p, 'US30 · L');
      await p.locator('.ruler__plot').first().waitFor({ timeout: 15000 });
      await openInfo(p, '「LC の物差し」の説明');
      await p.waitForTimeout(200);
      await p.reload();
      await waitReady(p, 'US30 · L');
      await p.locator('.ruler__plot').first().waitFor({ timeout: 15000 });
      await p.waitForTimeout(300);
      expectEq(await sheetCount(p), 0, '再読み込みの後の説明');
      await p.goBack();
      await waitReady(p, '取引');
      expectEq(at(), '/trades', '層の段で再読み込みした後の戻る 1 回');
      steps.push('説明を開いたまま再読み込み → 開かない・戻る 1 回で一覧');
      // 説明を閉じた直後（層の段を戻している途中）にタブを替える → 層の段を戻してから替える。[/, /settings]・戻るとホーム
      // （#127 のレビュー N9。説明のシートはモーダルで、開いている間はタブを押せない。#129）
      await p.locator('a.traderow[href="/trades/x-r1"]').click();
      await waitReady(p, 'US30 · L');
      await p.locator('.ruler__plot').first().waitFor({ timeout: 15000 });
      await openInfo(p, '「LC の物差し」の説明');
      await closeSheet(p);
      await p.locator('nav a[href="/settings"]').click();
      await waitReady(p, '設定');
      // 戻るは利用者の戻ると同じ history.back（Chrome が操作の無い段を飛ばすかも見る。#127 のレビュー N3）
      await p.evaluate(() => history.back());
      await waitReady(p, 'ホーム');
      expectEq(at(), '/', '説明を開いたまま設定のタブへ移った後の戻る');
      steps.push('説明を閉じた直後に設定のタブ → 戻るとホーム');
      // 用語集の中で言葉を 2 つたどる → 取引のタブ → 戻るとホーム。設定のタブの押し直しは根（#127 のレビュー B1）
      await p.locator('nav a[href="/settings"]').click();
      await waitReady(p, '設定');
      await p.locator('a[href="/glossary"]').first().click();
      await waitReady(p, '用語集');
      await p.locator('#glossary-judgment a.glink', { hasText: 'LC' }).first().click();
      await p.waitForTimeout(200);
      await p.locator('#glossary-lc a.glink', { hasText: '1R' }).first().click();
      await p.waitForTimeout(200);
      expectEq(new URL(p.url()).hash !== '', true, '用語集の中でたどった');
      // 取引のタブは前に開いていた詳細（記憶）が出る。押し直して根へ、戻るとホーム
      await p.locator('nav a[href="/trades"]').click();
      await waitReady(p, 'US30 · L');
      expectEq(at(), '/trades/x-r1', '用語集でたどった後の取引のタブ（記憶の詳細）');
      await p.locator('nav a[href="/trades"]').click();
      await waitReady(p, '取引');
      await p.evaluate(() => history.back());
      await waitReady(p, 'ホーム');
      expectEq(at(), '/', '用語集でたどった後に取引のタブ → 根 → 戻る');
      // 設定のタブは前に開いていた用語集（記憶。たどった段は 1 段にまとめる）が出る
      await p.locator('nav a[href="/settings"]').click();
      await waitReady(p, '用語集');
      await p.locator('#glossary-judgment a.glink', { hasText: 'LC' }).first().click();
      await p.waitForTimeout(200);
      await p.locator('nav a[href="/settings"]').click();
      await waitReady(p, '設定');
      expectEq(at(), '/settings', '用語集でたどった後の設定のタブの押し直し');
      await p.evaluate(() => history.back());
      await waitReady(p, 'ホーム');
      steps.push(
        '用語集で言葉をたどった後: 取引のタブ（記憶の詳細）→ 押し直しで根 → 戻るとホーム・設定のタブの押し直しは根',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } catch (e) {
      // どの段で外れたか（済んだ段の数・今の URL・ページのエラー）を添える
      throw new Error(
        `縦の形の ${steps.length + 1} 段目（URL ${p.url().replace(base, '')}・エラー ${errors.join(' / ') || 'なし'}）: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
      );
    } finally {
      await c.close();
    }
    // 広い形: 記録するを開いたままタブを替える → 閉じて書きかけを残す
    const w = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      storageState: signedIn,
    });
    await installFakeApi(w);
    const q = await w.newPage();
    try {
      await q.goto(`${base}/trades`);
      await waitReady(q, '取引');
      await q.locator('nav a[href="/record"]').click();
      await waitReady(q, '記録する');
      await q.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
      await q.locator('#record-entry').fill('100.5');
      await q.locator('nav a[href="/settings"]').click();
      await waitReady(q, '設定');
      await q.locator('.toast', { hasText: '記録の入力は残っています' }).waitFor({ timeout: 5000 });
      await q.locator('nav a[href="/trades"]').click();
      await waitReady(q, '取引');
      expectEq(new URL(q.url()).pathname, '/trades', '取引のタブに戻った先');
      await q.locator('nav a[href="/record"]').click();
      await waitReady(q, '記録する');
      await q.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
      expectEq(await q.locator('#record-entry').inputValue(), '100.5', '残した書きかけ');
      steps.push('広い形で記録するを開いたまま設定のタブ → 閉じて残す・取引のタブは一覧');
    } catch (e) {
      throw new Error(
        `広い形（URL ${q.url().replace(base, '')}）: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
      );
    } finally {
      await w.close();
    }
    return steps.join(' / ');
  });

  // SA1（#127。ui-guidelines 9.6・9.10）: 安全域の差し替え（縦: 上 47・下 34）で、上の帯・下のタブ・記録する画面の下の帯の
  // 押せるものが安全域の外（内側）にあり、上の安全域に面が敷かれ、タブの根の大きな題が上の安全域の下にある。Chromium では
  // env() が 0 なので、トークン --safe-* を差し替えて見る（実機の確かめは手で）
  await check('SA1', async () => {
    const out = [];
    for (const theme of THEMES) {
      const c = await browser.newContext({
        viewport: { width: 390, height: 844 },
        storageState: signedIn,
        hasTouch: true,
      });
      try {
        await setupContext(c, theme);
        await c.addInitScript(() => {
          const put = () => {
            const st = document.createElement('style');
            st.textContent =
              ':root:root{--safe-top:47px;--safe-bottom:34px;--safe-left:0px;--safe-right:0px}';
            document.head.append(st);
          };
          if (document.head) put();
          else document.addEventListener('DOMContentLoaded', put);
        });
        await installFakeApi(c);
        const p = await c.newPage();
        for (const [path, h1, wait] of [
          ['/', 'ホーム', '.traderow'],
          ['/trades', '取引', '.traderow'],
          ['/trades/x-d1', 'US30 · L', 'canvas.chartview__canvas'],
          ['/record', '記録する', '#record-entry'],
          ['/review', '振り返り', '.review'],
          ['/settings', '設定', null],
        ]) {
          await p.goto(base + path);
          await waitReady(p, h1);
          if (wait) await p.locator(wait).first().waitFor({ timeout: 15000 });
          const r = await p.evaluate(() => {
            const vh = window.innerHeight;
            const bad = [];
            const sel =
              '.appnav a, .appbar a, .appbar button, .record__submit--bar button, .rootbar';
            for (const el of document.querySelectorAll(sel)) {
              const b = el.getBoundingClientRect();
              if (b.width === 0 || b.height === 0) continue;
              if (getComputedStyle(el).visibility === 'hidden') continue;
              if (b.top < 47 - 0.5 || b.bottom > vh - 34 + 0.5) {
                const name = (el.getAttribute('aria-label') || el.textContent || '').trim();
                bad.push(`${name.slice(0, 10)} ${Math.round(b.top)}〜${Math.round(b.bottom)}`);
              }
            }
            const face = document.querySelector('.statusbar-bg')?.getBoundingClientRect();
            const big = document.querySelector('main .pagehead__title')?.getBoundingClientRect();
            const bar = document.querySelector('main .appbar')?.getBoundingClientRect();
            return {
              bad,
              face: face ? Math.round(face.height) : 0,
              titleTop: big ? big.top : bar ? bar.top : -1,
              barTop: bar ? bar.top : null,
            };
          });
          const where = `${theme} ${path}`;
          if (r.bad.length > 0) throw new Error(`${where}: 安全域に重なる ${r.bad.join(' / ')}`);
          expectEq(r.face, 47, `${where} の上の安全域の面`);
          // 大きな題は上の安全域の下。上の帯は端（0）から敷き、中身（押せるもの）は上の安全域の下（上で見た）
          if (r.barTop === null && r.titleTop < 47)
            throw new Error(`${where}: 大きな題 ${Math.round(r.titleTop)}px が上の安全域に重なる`);
          if (opts.shots)
            await p.screenshot({
              path: join(
                opts.shots,
                `390x844-${theme}-safe-${path === '/' ? 'home' : path.slice(1).replace(/\//g, '-')}.png`,
              ),
            });
        }
        out.push(theme);
      } finally {
        await c.close();
      }
    }
    return `${out.join('・')} × 6 画面: 押せるものは安全域（上 47・下 34）の内側、上の安全域に面`;
  });

  await check('T2', async () => {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: 'light',
      storageState: signedIn,
    });
    const p = await c.newPage();
    try {
      await p.goto(`${base}/`);
      await waitReady(p, 'ホーム');
      const r = await p.evaluate(() => {
        const html = document.documentElement;
        const attr = html.getAttribute('data-theme');
        html.removeAttribute('data-theme');
        const bare = getComputedStyle(html).getPropertyValue('--bg').trim().toLowerCase();
        return { attr, bare, light: matchMedia('(prefers-color-scheme: light)').matches };
      });
      expectEq(r.light, true, 'OS の設定がライト');
      expectEq(r.attr, 'dark', 'data-theme');
      expectEq(r.bare, darkBg(), 'data-theme なしの --bg');
    } finally {
      await c.close();
    }
    return 'OS がライトでもダーク（data-theme なしでも --bg がダーク）';
  });

  await check('T3', async () => {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: signedIn,
    });
    // 設定の画面は /api を読む（#5）。手元の API への proxy の失敗を出さないよう偽の API を入れる
    await installFakeApi(c);
    const p = await c.newPage();
    try {
      await p.goto(`${base}/settings`);
      await waitReady(p, '設定');
      await p.locator('label.seg__item', { hasText: 'ライト' }).click();
      expectEq(await p.getAttribute('html', 'data-theme'), 'light', '切り替え直後');
      await p.reload();
      await waitReady(p, '設定');
      expectEq(await p.getAttribute('html', 'data-theme'), 'light', '開き直した後');
      const checked = await p.locator('input[type="radio"][value="light"]').isChecked();
      expectEq(checked, true, 'ライトが選ばれている');
    } finally {
      await c.close();
    }
    return 'ライトを選んで開き直す → ライト';
  });

  await check('T4', async () => {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: signedIn,
    });
    await installFakeApi(c);
    await c.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('denied', 'SecurityError');
        },
      });
    });
    const p = await c.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    try {
      await p.goto(`${base}/settings`);
      await waitReady(p, '設定');
      expectEq(await p.getAttribute('html', 'data-theme'), 'dark', '開いたとき');
      await p.locator('label.seg__item', { hasText: 'ライト' }).click();
      expectEq(await p.getAttribute('html', 'data-theme'), 'light', '切り替え後');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '保存が例外 → ダークで開き、切り替えはその場で効く';
  });

  // ── ログインの門（L1〜L7）。ログインしていない文脈から始める
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    // ログイン画面・取引の一覧の見出しが一度でも描かれたかを記録する（L1・L4 のちらつきの確かめ）
    await c.addInitScript(() => {
      const seen = new Set();
      window.__uiCheckSeen = seen;
      new MutationObserver(() => {
        for (const h of document.querySelectorAll('main h1')) seen.add(h.textContent ?? '');
      }).observe(document, { childList: true, subtree: true });
    });
    const apiCalls = [];
    await c.route('**/api/**', (route) => {
      const auth = route.request().headers().authorization ?? '';
      apiCalls.push(auth);
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' });
    });
    const p = await c.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    const seen = () => p.evaluate(() => [...window.__uiCheckSeen]);
    const callApi = () =>
      p.evaluate(async () => {
        const m = await import('/src/auth/session.ts');
        try {
          const r = await m.api('/api/health');
          return `status ${r.status}`;
        } catch (e) {
          return e instanceof Error ? e.name : 'error';
        }
      });
    try {
      await check('L1', async () => {
        await p.goto(`${base}/trades`);
        await waitReady(p, 'ログイン');
        const u = new URL(p.url());
        expectEq(`${u.pathname}${u.search}`, '/login?next=%2Ftrades', 'URL');
        const s = await seen();
        if (s.includes('取引')) throw new Error('一覧の中身が一度描かれた');
        return '一覧の URL → /login?next=%2Ftrades、一覧の中身は出ない';
      });
      // G1（Issue #52）: Google でログインするボタン。ダーク / ライト × 幅 360 / 1440 で、読み上げの名前で見つかり、
      // 当たり 44 以上・はみ出さない・配色はガイドラインの値（地・1px の枠・文字）・ロゴは 20px の 4 色・ロゴが文字の左
      await check('G1', async () => {
        const want = {
          dark: { bg: 'rgb(19, 19, 20)', line: 'rgb(142, 145, 143)', ink: 'rgb(227, 227, 227)' },
          light: { bg: 'rgb(255, 255, 255)', line: 'rgb(116, 119, 117)', ink: 'rgb(31, 31, 31)' },
        };
        const seenSizes = [];
        for (const theme of ['dark', 'light']) {
          for (const w of [360, 1440]) {
            await p.setViewportSize({ width: w, height: 800 });
            await p.evaluate(([k, t]) => localStorage.setItem(k, t), [THEME_KEY, theme]);
            await p.goto(`${base}/login`);
            await waitReady(p, 'ログイン');
            const btn = p.getByRole('button', { name: 'Google でログイン', exact: true });
            expectEq(await btn.count(), 1, `${theme} ${w}: ボタンの数`);
            const m = await btn.evaluate((el) => {
              const cs = getComputedStyle(el);
              const r = el.getBoundingClientRect();
              const logo = el.querySelector('svg');
              const text = el.querySelector('.gsi__text');
              const lr = logo?.getBoundingClientRect();
              const tr = text?.getBoundingClientRect();
              return {
                w: r.width,
                h: r.height,
                right: r.right,
                vw: document.documentElement.clientWidth,
                scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                bg: cs.backgroundColor,
                line: cs.borderTopColor,
                lineW: cs.borderTopWidth,
                ink: cs.color,
                fs: cs.fontSize,
                lh: cs.lineHeight,
                fills: [...(logo?.querySelectorAll('path') ?? [])].map((x) =>
                  x.getAttribute('fill'),
                ),
                logo: lr ? [lr.width, lr.height] : null,
                logoLeft: lr && tr ? lr.right <= tr.left : false,
                gap: lr && tr ? Math.round(tr.left - lr.right) : null,
              };
            });
            const label = `${theme} ${w}`;
            if (m.h < TAP || m.w < TAP) throw new Error(`${label}: 当たり ${m.w}×${m.h}`);
            if (m.right > m.vw + 0.5 || m.scroll > 0) throw new Error(`${label}: はみ出し`);
            expectEq(m.bg, want[theme].bg, `${label}: 地`);
            expectEq(m.line, want[theme].line, `${label}: 枠の色`);
            expectEq(m.lineW, '1px', `${label}: 枠の太さ`);
            expectEq(m.ink, want[theme].ink, `${label}: 文字の色`);
            expectEq(`${m.fs}/${m.lh}`, '14px/20px', `${label}: 文字`);
            expectEq(
              [...m.fills].sort().join(','),
              ['#34A853', '#4285F4', '#EA4335', '#FBBC05'].join(','),
              `${label}: ロゴの色`,
            );
            expectEq(m.logo?.join('x'), '20x20', `${label}: ロゴの大きさ`);
            if (!m.logoLeft) throw new Error(`${label}: ロゴが文字の左に無い`);
            expectEq(m.gap, 10, `${label}: ロゴと文字の間`);
            seenSizes.push(`${label} ${Math.round(m.w)}×${Math.round(m.h)}`);
          }
        }
        await p.setViewportSize({ width: 390, height: 844 });
        await p.evaluate((k) => localStorage.removeItem(k), THEME_KEY);
        // 続く L6・L2 のため、L1 と同じ状態（/login?next=%2Ftrades）に戻す
        await p.goto(`${base}/trades`);
        await waitReady(p, 'ログイン');
        return `Google のボタン: ガイドラインの配色・1px の枠・14/20・ロゴ 20px の 4 色・間 10px（${seenSizes.join(' / ')}）`;
      });
      await check('L6', async () => {
        const before = apiCalls.length;
        const r = await callApi();
        expectEq(r, 'NotSignedIn', '要求の結果');
        expectEq(apiCalls.length, before, '/api への要求の数');
        return 'ログインしていない → /api へ送らず NotSignedIn';
      });
      await check('L2', async () => {
        await loginViaPopup(p);
        await waitReady(p, '取引');
        expectEq(path(p), '/trades', 'URL');
        return 'エミュレーターの架空の利用者でログイン → /trades（開こうとした画面）';
      });
      await check('L5', async () => {
        const before = apiCalls.length;
        const r = await callApi();
        expectEq(r, 'status 200', '要求の結果');
        expectEq(apiCalls.length, before + 1, '/api への要求の数');
        const h = apiCalls[apiCalls.length - 1] ?? '';
        // トークンの値は出力しない（形だけ見る: Bearer + JWT の 3 つの部分）
        if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]*$/.test(h))
          throw new Error('Authorization が Bearer <ID トークン> でない');
        return '/api の要求に Authorization: Bearer <ID トークン>';
      });
      await check('L4', async () => {
        await p.reload();
        await waitReady(p, '取引');
        expectEq(path(p), '/trades', 'URL');
        const s = await seen();
        if (s.includes('ログイン')) throw new Error('再読み込みでログイン画面が描かれた');
        return '再読み込み → ログインのまま /trades（ログイン画面はちらつかない）';
      });
      await check('L3', async () => {
        await p.locator('nav a[href="/settings"]').click();
        await waitReady(p, '設定');
        await p.getByRole('button', { name: 'ログアウト' }).click();
        await waitReady(p, 'ログイン');
        expectEq(path(p), '/login', 'ログアウトの後');
        await p.evaluate(() => window.__uiCheckSeen.clear());
        await p.goBack();
        await waitReady(p, 'ログイン');
        expectEq(path(p), '/login', '戻るの後');
        const s = await seen();
        if (s.includes('設定') || s.includes('取引'))
          throw new Error('戻るで前の画面の中身が描かれた');
        return 'ログアウト → /login、戻る → ログイン画面のまま（中身は出ない）';
      });
      expectEq(errors.length, 0, 'ページのエラー');
    } catch (e) {
      out.push(['L*', false, e instanceof Error ? e.message.split('\n')[0] : String(e)]);
    } finally {
      await c.close();
    }
  }

  // ── 使えないアカウント（Issue #43 の例 L3・L4）。ログイン済みの文脈で、偽の /api がすべて 403 を返す
  //   F1: どの画面を開いても中身を出さず「このアカウントでは使えません」と [別のアカウントでログイン]。幅 360 と 1440 ×
  //       ダーク / ライトで横スクロール 0・当たり 44 以上・見出しは 2 行まで（--shots なら撮る）。ホームは /api を読まないが、
  //       ログインの確かめの 1 回で出る
  //   F2: [別のアカウントでログイン] → ログアウトしてログイン画面に置き換わる
  {
    const forbiddenCtx = async (w, hgt, theme) => {
      const c = await browser.newContext({
        viewport: { width: w, height: hgt },
        storageState: signedIn,
      });
      await setupContext(c, theme);
      // 記録の中身（取引の行）が一度でも描かれたかを記録する（画面の見出しは 403 が返るまでの間に出てよい。
      // 中身は API が 403 を返すので届かない）
      await c.addInitScript(() => {
        window.__uiCheckRows = 0;
        new MutationObserver(() => {
          window.__uiCheckRows += document.querySelectorAll('.traderow').length;
        }).observe(document, { childList: true, subtree: true });
      });
      await c.route('**/api/**', (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: '{"error":"forbidden"}',
        }),
      );
      return c;
    };
    const TITLE = 'このアカウントでは使えません';
    await check('F1', async () => {
      const notes = [];
      for (const [w, hgt] of SIZES.filter(([sw]) => sw === 360 || sw === 1440)) {
        for (const theme of THEMES) {
          const c = await forbiddenCtx(w, hgt, theme);
          try {
            const p = await c.newPage();
            const errors = [];
            p.on('pageerror', (e) => errors.push(e.message));
            for (const at of ['/', '/trades', '/settings']) {
              await p.goto(`${base}${at}`);
              await waitReady(p, TITLE);
              expectEq(path(p), at, `${at} の URL（置き換えない）`);
              const rows = await p.evaluate(() => window.__uiCheckRows);
              if (rows > 0) throw new Error(`${at}: 取引の行が描かれた`);
              if ((await p.locator('nav.appnav').count()) > 0)
                throw new Error(`${at}: 行き先が出ている`);
              await p
                .getByRole('button', { name: '別のアカウントでログイン' })
                .waitFor({ state: 'visible' });
            }
            // 見出しの行数（句の中で折り返さず 2 行まで。デザインレビュー #43）
            const lines = await p.evaluate(() => {
              const h = document.querySelector('main h1');
              if (!h) return 0;
              const lh = Number.parseFloat(getComputedStyle(h).lineHeight);
              return Math.round(h.getBoundingClientRect().height / lh);
            });
            if (lines > 2) throw new Error(`${w} ${theme}: 見出しが ${lines} 行`);
            const m = await measure(p, w === 360, TAP);
            if (m.h > 0) throw new Error(`${w} ${theme}: 横スクロール ${m.h}px`);
            if (m.small.length > 0)
              throw new Error(`${w} ${theme}: 当たり<44 ${m.small.join('・')}`);
            if (m.clipped.length > 0)
              throw new Error(`${w} ${theme}: はみ出し ${m.clipped.join('・')}`);
            expectEq(errors.length, 0, 'ページのエラー');
            if (opts.shots) {
              await p.screenshot({
                path: join(opts.shots, `${w}x${hgt}-${theme}-forbidden.png`),
                fullPage: true,
              });
            }
            notes.push(`${w}${theme === 'dark' ? 'D' : 'L'} 見出し ${lines} 行`);
          } finally {
            await c.close();
          }
        }
      }
      return `/・/trades・/settings → 使えない旨と [別のアカウントでログイン] だけ（横 0px。${notes.join('・')}）`;
    });
    await check('F2', async () => {
      const c = await forbiddenCtx(390, 844, 'dark');
      try {
        const p = await c.newPage();
        await p.goto(`${base}/trades`);
        await waitReady(p, TITLE);
        await p.getByRole('button', { name: '別のアカウントでログイン' }).click();
        await waitReady(p, 'ログイン');
        expectEq(path(p), '/login', 'ログアウトの後');
        return '[別のアカウントでログイン] → ログアウトして /login（ログイン画面）';
      } finally {
        await c.close();
      }
    });
  }

  await check('L7', async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    // エミュレーターが止まっている状態を、エミュレーターへの要求をすべて遮断して再現する
    await c.route(`${AUTH_EMULATOR}/**`, (route) => route.abort('connectionrefused'));
    const p = await c.newPage();
    try {
      await p.goto(`${base}/trades`);
      await waitReady(p, 'ログイン');
      const popupWait = p.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
      await p.getByRole('button', { name: 'Google でログイン' }).click();
      const popup = await popupWait;
      await p
        .getByRole('alert')
        .filter({ hasText: 'ログインのサービスと通信できませんでした' })
        .waitFor({ timeout: 30000 });
      if (popup && !popup.isClosed()) await popup.close();
      // 白い画面になっていない（見出しとボタンが残る）
      await waitReady(p, 'ログイン');
      await p.getByRole('button', { name: 'Google でログイン' }).waitFor();
    } finally {
      await c.close();
    }
    return 'エミュレーターに繋がらない → 「ログインのサービスと通信できませんでした」、画面は残る';
  });

  // ── 記録する（R1〜R5。Issue #13）。偽の記録の API で流す
  const recordContext = async (fakeOpts) => {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: signedIn,
    });
    const fake = await installFakeApi(c, fakeOpts);
    const p = await c.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    return { c, p, fake, errors };
  };

  // FOC1（#52）: 幅 360 で、外側の枠がフォーカスを示す欄（数・文字・日時の欄 = .numfield の中の入力）と選択（.select）に
  // キーでフォーカスしたとき、内側の要素に共通の輪（outline）が出ず、外側の枠の光（box-shadow）だけが出る
  // （角丸の枠の外に四角い枠がずれて重ならない）。--shots なら LC の欄にフォーカスした状態を撮る
  await check('FOC1', async () => {
    const { c, p, errors } = await recordContext();
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await openRecord(p, base);
      const targets = p.locator('.numfield input:not([disabled]), select.select:not([disabled])');
      const n = await targets.count();
      if (n < 3) throw new Error(`欄の数 ${n}`);
      const bad = [];
      let checked = 0;
      let visible = 0;
      for (let i = 0; i < n; i++) {
        const t = targets.nth(i);
        if (!(await t.isVisible())) continue;
        visible++;
        await t.focus();
        // キーで来たフォーカスにする（:focus-visible を確かに当てる）
        await p.keyboard.press('Shift+Tab');
        await p.keyboard.press('Tab');
        const m = await t.evaluate((el) => {
          const cs = getComputedStyle(el);
          const frame = el.closest('.numfield') ?? el;
          // 輪は透明（forced-colors のときだけ見える）。見える輪の色・幅が無いこと
          const invisible =
            cs.outlineStyle === 'none' ||
            cs.outlineWidth === '0px' ||
            cs.outlineColor === 'rgba(0, 0, 0, 0)' ||
            cs.outlineColor === 'transparent';
          return {
            id: el.id || el.tagName,
            focused: document.activeElement === el,
            focusVisible: el.matches(':focus-visible'),
            outline: invisible,
            ring: getComputedStyle(frame).boxShadow !== 'none',
          };
        });
        if (!m.focused) {
          bad.push(`${m.id}: フォーカスが移らない`);
          continue;
        }
        if (!m.focusVisible) bad.push(`${m.id}: :focus-visible が当たらない`);
        if (!m.outline) bad.push(`${m.id}: 内側に見える outline`);
        if (!m.ring) bad.push(`${m.id}: 外側の枠の光が無い`);
        checked++;
      }
      if (checked === 0 || checked !== visible) bad.push(`見た欄 ${checked} / 見える欄 ${visible}`);
      if (bad.length) throw new Error(bad.join(' / '));
      if (opts.shots) {
        await p.locator('#record-lc').focus();
        await p.keyboard.press('Shift+Tab');
        await p.keyboard.press('Tab');
        await p.locator('#record-lc').scrollIntoViewIfNeeded();
        await p.screenshot({ path: join(opts.shots, '360x780-dark-record-focus-viewport.png') });
      }
      expectEq(errors.length, 0, 'ページのエラー');
      return `幅 360: ${checked} 個の欄・選択（:focus-visible）で、内側の見える outline 0・外側の枠の光あり`;
    } finally {
      await c.close();
    }
  });

  await check('R1', async () => {
    const { c, p, errors } = await recordContext();
    try {
      await openRecord(p, base);
      expectEq(await p.locator('#record-instrument').inputValue(), 'US30', '銘柄');
      expectEq(await p.locator('#record-quantity').inputValue(), '2', '数量');
      const t = await p.locator('#record-exit-time').inputValue();
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) throw new Error(`決済の時刻 ${t}`);
      for (const g of [
        'L / S',
        'LC を入る前に決めていたか',
        'LC を動かしたか',
        '時間足を変えたか',
      ]) {
        const n = await p.locator(`[role="radiogroup"][aria-label="${g}"] input:checked`).count();
        expectEq(n, 0, `${g} の選択`);
      }
      expectEq(
        await p.locator('button[type="submit"]').isDisabled(),
        true,
        '[記録する] が押せない',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '開いた → 銘柄 US30・数量 2・決済の時刻 = 今、L / S とタップは未選択、[記録する] は押せない';
  });

  await check('R2', async () => {
    const { c, p, errors } = await recordContext();
    try {
      await openRecord(p, base);
      await fillRecord(p, EX_E1, false);
      // タップの前でも R は出る
      await p.locator('.verdict .num--xl', { hasText: '−1.6R' }).waitFor({ timeout: 5000 });
      await fillRecord(p, EX_E1);
      await p.locator('.verdict .badge', { hasText: 'B 悪い損失' }).waitFor({ timeout: 5000 });
      const reasons = await p.locator('.reasons__item').allInnerTexts();
      if (!reasons.includes('LC を広げた（99.5 → 99.2）'))
        throw new Error(`理由 ${reasons.join(' / ')}`);
      // 資金が未設定の説明は、理由の一覧から分けた注記の 1 行（Issue #33 AC-8）
      await p
        .locator('.verdict__aside', { hasText: '資金が未設定のため、過剰リスクは判定していません' })
        .waitFor();
      expectEq(await p.locator('button[type="submit"]').isDisabled(), false, '[記録する] が押せる');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'E1 → B・「LC を広げた（99.5 → 99.2）」・−1.6R・注記「資金が未設定のため、過剰リスクは判定していません」';
  });

  await check('R3', async () => {
    const { c, p, fake } = await recordContext({ delayMs: 400 });
    try {
      await openRecord(p, base);
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').dblclick();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
      expectEq(fake.posts.length, 1, 'POST /api/trades の数');
      await p.getByRole('button', { name: '次の取引を記録' }).click();
      await p.locator('#record-entry').waitFor();
      expectEq(await p.locator('#record-entry').inputValue(), '', '次の取引のイン');
      expectEq(await p.locator('#record-instrument').inputValue(), 'US30', '次の取引の銘柄');
    } finally {
      await c.close();
    }
    return '[記録する] を素早く 2 回 → 保存の要求は 1 件、[次の取引を記録] で空の入力';
  });

  await check('R4', async () => {
    const { c, p } = await recordContext();
    const snap = () =>
      p.evaluate(async () => {
        const dbs = indexedDB.databases ? await indexedDB.databases() : [];
        return {
          ls: Object.keys(localStorage).sort(),
          ss: Object.keys(sessionStorage).sort(),
          idb: dbs.map((d) => d.name).sort(),
          values: Object.keys(localStorage)
            .map((k) => localStorage.getItem(k) ?? '')
            .concat(Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k) ?? ''))
            .join('\n'),
        };
      });
    try {
      await openRecord(p, base);
      const before = await snap();
      await fillRecord(p, EX_E1);
      await p.locator('#record-broken').fill('架空の崩れの条件');
      await p.locator('button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
      const after = await snap();
      expectEq(JSON.stringify(after.ls), JSON.stringify(before.ls), 'localStorage のキー');
      expectEq(JSON.stringify(after.ss), JSON.stringify(before.ss), 'sessionStorage のキー');
      expectEq(JSON.stringify(after.idb), JSON.stringify(before.idb), 'IndexedDB の名前');
      for (const v of ['99.2', '架空の崩れの条件']) {
        if (after.values.includes(v)) throw new Error(`Web Storage に ${v}`);
      }
    } finally {
      await c.close();
    }
    return '入力・保存の前後で Web Storage のキーと IndexedDB の名前が増えず、取引の値も無い';
  });

  await check('R5', async () => {
    const { c, p, errors } = await recordContext({ failTrades: 503 });
    try {
      await openRecord(p, base);
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').click();
      await p
        .getByRole('alert')
        .filter({ hasText: '保存できませんでした。入力内容は残っています。' })
        .waitFor({ timeout: 10000 });
      expectEq(await p.locator('#record-entry').inputValue(), '100.00', '入力が残る');
      const body = (await p.locator('main').textContent()) ?? '';
      if (body.includes('unavailable')) throw new Error('応答の本文が画面に出た');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '503 → 決まった文言、入力は残る、応答の本文は出ない';
  });

  // W1（#74 デザインレビューの撮れていなかった状態）: 空の状態（ホーム・一覧）・記録と編集の保存の通信の失敗・削除の失敗の
  // トースト・ログインが切れた一覧・ログインのサービスと通信できない・1440 の用語集の全体を、幅 360 と 1440 のダークで開き、
  // 文言が出ること・横スクロール 0・短いボタン（10 字以下）が 2 行に折れないこと（高さ 56px 以下）を見る。--shots なら全体を撮る
  await check('W1', async () => {
    const seen = [];
    const shortButtonsTall = (p) =>
      p.evaluate(() =>
        [...document.querySelectorAll('button, a.btn')]
          .filter((b) => {
            const r = b.getBoundingClientRect();
            const t = (b.textContent ?? '').trim();
            return r.width > 0 && r.height > 0 && t.length > 0 && t.length <= 10;
          })
          .filter((b) => b.getBoundingClientRect().height > 56)
          .map((b) => (b.textContent ?? '').trim()),
      );
    const measure = async (p, w, slug, text) => {
      await p.getByText(text, { exact: false }).first().waitFor({ timeout: 20000 });
      const h = await p.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (h > 0) throw new Error(`${w} ${slug}: 横スクロール ${h}px`);
      const tall = await shortButtonsTall(p);
      if (tall.length > 0) throw new Error(`${w} ${slug}: 2 行に折れたボタン ${tall.join(' / ')}`);
      if (opts.shots)
        await p.screenshot({
          path: join(opts.shots, `${w}x${w === 360 ? 780 : 900}-dark-w74-${slug}.png`),
          fullPage: true,
        });
      seen.push(`${w}:${slug}`);
    };
    const signedInPage = async (w, fakeOpts) => {
      const c = await browser.newContext({
        viewport: { width: w, height: w === 360 ? 780 : 900 },
        storageState: signedIn,
      });
      await setupContext(c, 'dark');
      const fake = await installFakeApi(c, fakeOpts);
      const p = await c.newPage();
      return { c, p, fake };
    };
    for (const w of [360, 1440]) {
      // 空の状態（ホーム・一覧）
      {
        const { c, p } = await signedInPage(w, { trades: [] });
        try {
          await p.goto(`${base}/`);
          await waitReady(p, 'ホーム');
          await measure(p, w, 'home-empty', '3 つの質問に答えると判定が表示されます');
          await p.goto(`${base}/trades`);
          await waitReady(p, '取引');
          await measure(p, w, 'trades-empty', 'まだ取引がありません');
        } finally {
          await c.close();
        }
      }
      // 記録の保存の通信の失敗
      {
        const { c, p } = await signedInPage(w);
        try {
          await openRecord(p, base);
          await fillRecord(p, EX_E1);
          await p.route('**/api/trades', (route) =>
            route.request().method() === 'POST'
              ? route.abort('connectionrefused')
              : route.fallback(),
          );
          await p.locator('button[type="submit"]').click();
          await measure(
            p,
            w,
            'record-network-failed',
            '通信できませんでした。入力内容は残っています。',
          );
        } finally {
          await c.close();
        }
      }
      // 編集の保存の通信の失敗
      {
        const { c, p } = await signedInPage(w);
        try {
          await p.goto(`${base}/trades/x-e1/edit`);
          await waitReady(p, '取引を編集');
          await p.route('**/api/trades/x-e1', (route) =>
            route.request().method() === 'PUT'
              ? route.abort('connectionrefused')
              : route.fallback(),
          );
          await p.locator('#edit-submit').click();
          await measure(
            p,
            w,
            'edit-network-failed',
            '通信できませんでした。入力内容は残っています。',
          );
        } finally {
          await c.close();
        }
      }
      // 削除の失敗のトースト（[削除] → 8 秒後の DELETE が失敗）
      {
        const { c, p } = await signedInPage(w);
        try {
          // keepalive の DELETE はページの route に掛からないので、文脈の route（偽の API より後に足す = 先に当たる）で返す
          await c.route('**/api/trades/x-d1', (route) =>
            route.request().method() === 'DELETE'
              ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
              : route.fallback(),
          );
          await p.goto(`${base}/trades/x-d1`);
          await waitReady(p, 'US30 · L');
          await p.getByRole('button', { name: '削除', exact: true }).click();
          // [元に戻す] にフォーカス・ポインタがある間は取り消しの時間が止まるので、外へ出す
          await p.locator('.toast').first().waitFor();
          await p.mouse.move(1, 1);
          await p.evaluate(() => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          });
          await p
            .getByText('削除できませんでした', { exact: false })
            .first()
            .waitFor({ timeout: 20000 });
          await measure(
            p,
            w,
            'delete-failed',
            '削除できませんでした。もう一度 [削除] を押してください。',
          );
        } finally {
          await c.close();
        }
      }
      // ログインが切れた（一覧の読み込みが 401）
      {
        const { c, p } = await signedInPage(w);
        try {
          await p.route('**/api/trades**', (route) =>
            route.request().method() === 'GET'
              ? route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
              : route.fallback(),
          );
          await p.goto(`${base}/trades`);
          await waitReady(p, '取引');
          await measure(p, w, 'auth-expired', 'もう一度ログイン');
        } finally {
          await c.close();
        }
      }
      // 用語集の全体
      {
        const { c, p } = await signedInPage(w);
        try {
          await p.goto(`${base}/glossary`);
          await waitReady(p, '用語集');
          await measure(p, w, 'glossary-full', '判定に関わる言葉の意味です。');
        } finally {
          await c.close();
        }
      }
      // ログインのサービスと通信できない（ログインの失敗）
      {
        const c = await browser.newContext({
          viewport: { width: w, height: w === 360 ? 780 : 900 },
        });
        await setupContext(c, 'dark');
        await c.route(`${AUTH_EMULATOR}/**`, (route) => route.abort('connectionrefused'));
        const p = await c.newPage();
        try {
          await p.goto(`${base}/login`);
          await waitReady(p, 'ログイン');
          const popupWait = p.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
          await p.getByRole('button', { name: 'Google でログイン' }).click();
          const popup = await popupWait;
          await p
            .getByRole('alert')
            .filter({ hasText: 'ログインのサービスと通信できませんでした' })
            .waitFor({ timeout: 30000 });
          if (popup && !popup.isClosed()) await popup.close();
          await measure(p, w, 'login-unreachable', 'ログインのサービスと通信できませんでした');
        } finally {
          await c.close();
        }
      }
    }
    return `${seen.length} 状態（空の状態・保存と削除の失敗・ログインが切れた・用語集の全体・ログインの失敗 × 360 / 1440）で文言が出て、横スクロール 0・短いボタンは 1 行`;
  });

  // ── 決済明細の読み取り（R6〜R10。Issue #15）。偽の読み取りの API で流す（実際の AI は呼ばない）
  const synthetic = readFileSync(join(ROOT, SYNTHETIC_STATEMENT));

  await check('R6', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
      await openRecord(p, base);
      // 画像の貼り付け 1 回 → 1 件
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.field__mark').first().waitFor({ timeout: 10000 });
      expectEq(fake.reads.length, 1, '貼り付けの後の要求');
      // ファイル選択 1 回 → 1 件（合成の明細の画像）
      await p
        .locator('#record-statement-file')
        .setInputFiles({ name: 's05.png', mimeType: 'image/png', buffer: synthetic });
      await expectPoll(() => fake.reads.length === 2, 'ファイル選択の後の要求');
      // E14: LC の欄にフォーカスして文字「99.0」を貼る → 要求は増えず、LC に入る
      await p.evaluate(() => navigator.clipboard.writeText('99.0'));
      await p.locator('#record-lc').fill('');
      await p.locator('#record-lc').focus();
      await p.keyboard.press('ControlOrMeta+V');
      await p.waitForTimeout(300);
      expectEq(await p.locator('#record-lc').inputValue(), '99.0', 'LC の欄');
      expectEq(fake.reads.length, 2, '文字の貼り付けの後の要求');
      // 表計算のコピーのように文字と画像の両方を持つクリップボードを LC の欄に貼る → 横取りせず文字が入る（レビュー指摘 1）
      await p.evaluate(async () => {
        const c = document.createElement('canvas');
        c.width = 40;
        c.height = 20;
        c.getContext('2d').fillRect(0, 0, 10, 10);
        const png = await new Promise((ok) => c.toBlob(ok, 'image/png'));
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob(['98.5'], { type: 'text/plain' }),
            'image/png': png,
          }),
        ]);
      });
      await p.locator('#record-lc').fill('');
      await p.locator('#record-lc').focus();
      await p.keyboard.press('ControlOrMeta+V');
      await p.waitForTimeout(300);
      expectEq(await p.locator('#record-lc').inputValue(), '98.5', '文字と画像を貼った LC の欄');
      // 合成の貼り付けでも同じ（文字の欄では preventDefault しない）
      const prevented = await p.evaluate(async () => {
        const c = document.createElement('canvas');
        c.width = 40;
        c.height = 20;
        const png = await new Promise((ok) => c.toBlob(ok, 'image/png'));
        const dt = new DataTransfer();
        dt.setData('text/plain', '98.5');
        dt.items.add(new File([png], 'cells.png', { type: 'image/png' }));
        const ev = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        });
        document.getElementById('record-lc').dispatchEvent(ev);
        return ev.defaultPrevented;
      });
      expectEq(prevented, false, '文字の欄の貼り付けを横取りした');
      await p.waitForTimeout(300);
      expectEq(fake.reads.length, 2, '文字と画像の貼り付けの後の要求');
      // 文字の欄でもクリップボードが画像だけなら明細として受ける（再レビューの指摘 1）
      await p.evaluate(async () => {
        const c = document.createElement('canvas');
        c.width = 600;
        c.height = 300;
        const g = c.getContext('2d');
        g.fillStyle = 'white';
        g.fillRect(0, 0, 600, 300);
        const png = await new Promise((ok) => c.toBlob(ok, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      });
      await p.locator('#record-instrument').focus();
      await p.keyboard.press('ControlOrMeta+V');
      await expectPoll(() => fake.reads.length === 3, '銘柄の欄に画像だけを貼った後の要求');
      // E12: 画像として読めないファイル → 要求 0 件・決まった文言
      await p
        .locator('#record-statement-file')
        .setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('架空の文字') });
      await p
        .getByRole('alert')
        .filter({ hasText: '画像を読み込めませんでした' })
        .waitFor({ timeout: 10000 });
      expectEq(fake.reads.length, 3, '読めないファイルの後の要求');
      for (const r of fake.reads) {
        if (!['image/png', 'image/jpeg'].includes(r.contentType))
          throw new Error(`Content-Type ${r.contentType}`);
      }
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '画像の貼り付け 1 件・ファイル選択 1 件・LC の欄への文字の貼り付け 0 件（LC に 99.0）・文字と画像の貼り付けも 0 件（LC に 98.5）・銘柄の欄に画像だけを貼ると 1 件・読めないファイル 0 件';
  });

  await check('R7', async () => {
    const { c, p, fake } = await recordContext();
    const sizes = [];
    try {
      await openRecord(p, base);
      const cases = [
        { name: 'E2', spec: { w: 3000, h: 1500, type: 'image/png', noise: true }, ratio: 2 },
        { name: 'E3', spec: { w: 1200, h: 800, type: 'image/jpeg', quality: 0.9 }, ratio: 1.5 },
      ];
      for (const k of cases) {
        const src = Buffer.from(await makeImage(p, k.spec, 'bytes'));
        const before = fake.reads.length;
        await p
          .locator('#record-statement-file')
          .setInputFiles({ name: `${k.name}.img`, mimeType: k.spec.type, buffer: src });
        await expectPoll(() => fake.reads.length === before + 1, `${k.name} の要求`);
        const sent = fake.reads[before];
        const info = imageInfoOf(sent.body);
        if (!info) throw new Error(`${k.name}: 本文の形式が読めない`);
        if (info.type !== sent.contentType)
          throw new Error(`${k.name}: 形式と Content-Type が違う`);
        if (sent.body.length > 500000) throw new Error(`${k.name}: ${sent.body.length} B`);
        if (Math.max(info.w, info.h) > 2000) throw new Error(`${k.name}: ${info.w}×${info.h}`);
        if (Math.abs(info.w / info.h - k.ratio) > 0.01)
          throw new Error(`${k.name}: 縦横比 ${info.w}×${info.h}`);
        if (src.equals(sent.body)) throw new Error(`${k.name}: 元のバイト列のまま送った`);
        sizes.push(
          `${k.name} ${k.spec.w}×${k.spec.h} ${src.length.toLocaleString('en-US')} B → ${info.type.slice(6)} ${info.w}×${info.h} ${sent.body.length.toLocaleString('en-US')} B`,
        );
      }
    } finally {
      await c.close();
    }
    return sizes.join(' / ');
  });

  await check('R8', async () => {
    const { c, p, fake } = await recordContext();
    const snap = () =>
      p.evaluate(async () => {
        const dbs = indexedDB.databases ? await indexedDB.databases() : [];
        return {
          ls: Object.keys(localStorage).sort(),
          ss: Object.keys(sessionStorage).sort(),
          idb: dbs.map((d) => d.name).sort(),
          caches: (await caches.keys()).sort(),
          href: location.href,
          state: JSON.stringify(history.state),
          values: Object.keys(localStorage)
            .map((k) => localStorage.getItem(k) ?? '')
            .concat(Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k) ?? ''))
            .join('\n'),
        };
      });
    try {
      await openRecord(p, base);
      const before = await snap();
      // E1 を貼って保存 → 次の取引 → E10（3 行）を貼って 2 行を保存・1 行を飛ばす
      fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.field__mark').first().waitFor({ timeout: 10000 });
      await fillStatementTaps(p);
      await p.locator('button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
      await p.getByRole('button', { name: '次の取引を記録' }).click();
      fake.read = { status: 200, rows: READ_E10, holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.statement__row', { hasText: '1 / 3 行目' }).waitFor({ timeout: 10000 });
      await p.getByRole('radio', { name: /日本時間（そのまま）/ }).check();
      await fillStatementTaps(p);
      await p.locator('button[type="submit"]').click();
      await p.locator('.statement__row', { hasText: '2 / 3 行目' }).waitFor({ timeout: 10000 });
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'record-statement-row',
        '次の行の番号へのフォーカス（レビュー指摘 3）',
      );
      await p.getByRole('button', { name: 'この行をスキップ' }).click();
      await p.locator('.statement__row', { hasText: '3 / 3 行目' }).waitFor();
      await p.getByRole('status').filter({ hasText: '次の行（3 / 3）' }).waitFor({ timeout: 5000 });
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'record-statement-row',
        '飛ばした後の行の番号へのフォーカス',
      );
      await fillStatementTaps(p, '49');
      await p.locator('button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
      expectEq(fake.posts.length, 3, '保存の要求');
      const after = await snap();
      // 端末に書いてよいのは選んだタイムゾーンの ID の鍵 1 つだけ（#58 KEEP-7）
      const zone = await p.evaluate(() => localStorage.getItem('loss-note.statementTimeZone'));
      expectEq(zone, 'jst', '覚えたタイムゾーン');
      after.ls = after.ls.filter((k) => k !== 'loss-note.statementTimeZone');
      for (const k of ['ls', 'ss', 'idb', 'caches']) {
        expectEq(JSON.stringify(after[k]), JSON.stringify(before[k]), k);
      }
      expectEq(after.href, before.href, 'URL');
      // 履歴の state は画面の行き来の印（appDepth・appTab・appStack）だけ。印は利用者の最初の操作で書く（#127）ので、前後で
      // 印の鍵を除いて比べる（記録の中身を書かない）
      const withoutMark = (raw) => {
        const v = JSON.parse(raw ?? 'null');
        if (!v || typeof v !== 'object') return 'null';
        const { appDepth: _d, appTab: _t, appStack: _s, ...rest } = v;
        return Object.keys(rest).length === 0 ? 'null' : JSON.stringify(rest);
      };
      expectEq(withoutMark(after.state), withoutMark(before.state), '履歴の state（印を除く）');
      for (const v of ['架空指数A', '架空指数D', '押し目の安値']) {
        if (after.values.includes(v)) throw new Error(`Web Storage に ${v}`);
      }
      if (before.caches.length !== 0) throw new Error('Cache Storage が空でない');
    } finally {
      await c.close();
    }
    return 'E1・E10 の流れの前後で Web Storage・IndexedDB・Cache Storage・URL・履歴の state が同じ（保存 3 件）';
  });

  await check('R9', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await openRecord(p, base);
      await p.locator('#record-lc').fill('99.5');
      const msgs = [];
      for (const [status, want] of [
        [503, '今は読み取りを使えません。手入力してください。'],
        [400, 'この画像は読み取れません。別の画像を貼り付けるか、手入力してください。'],
        [502, '読み取れませんでした。もう一度貼り付けるか、手入力してください。'],
      ]) {
        fake.read = { status, rows: [], holdMs: 0 };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.getByRole('alert').filter({ hasText: want }).waitFor({ timeout: 10000 });
        msgs.push(status);
      }
      fake.read = { status: 200, rows: [], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p
        .getByRole('alert')
        .filter({ hasText: '決済明細として読めませんでした' })
        .waitFor({ timeout: 10000 });
      expectEq(await p.locator('#record-lc').inputValue(), '99.5', '入力が残る');
      const body = (await p.locator('main').textContent()) ?? '';
      if (body.includes('SECRET') || body.includes('read_unavailable'))
        throw new Error('応答の本文が画面に出た');
      // やめて手で入れる（E13）: 読み取り中にやめ、後で届いた応答で欄が変わらない
      fake.read = { status: 200, rows: [READ_E1], holdMs: 1500 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.getByRole('button', { name: '明細の読み取りをキャンセル' }).click();
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'record-instrument',
        'やめた後のフォーカス（レビュー指摘 2）',
      );
      await p.waitForTimeout(2000);
      expectEq(await p.locator('#record-instrument').inputValue(), 'US30', 'やめた後の銘柄');
      expectEq(await p.locator('.field__mark').count(), 0, 'やめた後の印');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '503・400・502・0 行 → 決まった文言、入力は残る、本文は出ない。やめた後の応答は捨てる';
  });

  await check('R10', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await openRecord(p, base);
      const t0 = Date.now();
      await p
        .locator('#record-statement-file')
        .setInputFiles({ name: 's05.png', mimeType: 'image/png', buffer: synthetic });
      await p.locator('.field__mark').first().waitFor({ timeout: 10000 });
      expectEq(await p.locator('#record-instrument').inputValue(), '架空指数A', '銘柄');
      expectEq(await p.locator('#record-quantity').inputValue(), '2', '数量');
      expectEq(await p.locator('#record-fee').isVisible(), true, '手数料が開かずに見える');
      const typed = await fillStatementTaps(p);
      await p.locator('.verdict .badge', { hasText: 'A' }).waitFor({ timeout: 5000 });
      await p.locator('.verdict .num--xl', { hasText: '−1.0R' }).waitFor({ timeout: 5000 });
      await p.locator('button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
      const ms = Date.now() - t0;
      const sent = fake.posts[0];
      expectEq(sent.source, 'statement', '出どころ');
      expectEq(JSON.stringify(sent.fees), JSON.stringify([{ amountYen: 150 }]), '手数料');
      expectEq(sent.exit.orderType, 'unknown', '注文の種類');
      expectEq(errors.length, 0, 'ページのエラー');
      return `合成の明細を選ぶ → 打つ ${typed.typed}・選ぶ ${typed.chosen} → A・−1.0R → 保存（自動の操作で ${(ms / 1000).toFixed(1)} 秒）`;
    } finally {
      await c.close();
    }
  });

  // ── 密度と階層（Issue #33）。R11 = タップの直後に判定が見える / R12 = 開いた直後の 1 画面 / R13 = 数字の書体と並び
  await check('R11', async () => {
    const scenes = [
      ['場面 B', EX_E1, 'B 悪い損失', true],
      ['場面 危', EX_E3, '危ない勝ち', true],
      ['場面 C', EX_E16, 'C 極悪な損失', false],
      ['例 8（S・広げた）', EX_S8, 'B 悪い損失', true],
    ];
    const runs = [
      [360, 780, 'dark'],
      [360, 780, 'light'],
      [1440, 900, 'dark'],
      [1440, 900, 'light'],
      // KEEP-8（iPhone の Safari）の代わりに自動で見る幅。動きを減らす設定（寄せる動きは即時）もここで見る
      [390, 844, 'dark', 'reduce'],
    ];
    let n = 0;
    for (const [w, h, theme, motion] of runs) {
      const c = await browser.newContext({
        viewport: { width: w, height: h },
        storageState: signedIn,
        ...(motion ? { reducedMotion: motion } : {}),
      });
      try {
        await setupContext(c, theme);
        await installFakeApi(c);
        const p = await c.newPage();
        for (const [name, ex, label, withR] of scenes) {
          await openRecord(p, base);
          await fillRecord(p, ex, true, false);
          // 最後のタップ（時間足「そのまま」）を貼り付きの帯のすぐ上に置き、判定のバッジが見える範囲の外にあることを確かめて
          // から、座標で押す（Playwright の click の自動の寄せに頼らない。寄せるのはアプリだけ。コードレビュー指摘 4）
          const last = seg(p, '時間足を変えたか', 'そのまま');
          await last.evaluate((el) => {
            const vh = window.innerHeight;
            const bar =
              document.querySelector('.record__submit')?.getBoundingClientRect().top ?? vh;
            window.scrollBy(0, el.getBoundingClientRect().bottom - (Math.min(bar, vh) - 12));
          });
          await scrollSettled(p);
          const before = await verdictInView(p, false);
          if (!before.some((x) => x.startsWith('バッジ ')))
            throw new Error(
              `${w}x${h} ${theme} ${name}: 押す前から判定のバッジが見えている（確かめにならない）`,
            );
          const y0 = await p.evaluate(() => window.scrollY);
          const box = await last.boundingBox();
          if (!box) throw new Error(`${name}: 最後のタップが描かれていない`);
          await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          // 押した後は、スクロールの操作をしない
          await p.locator('.verdict .badge', { hasText: label }).waitFor({ timeout: 5000 });
          await p.waitForTimeout(150);
          await scrollSettled(p);
          const ng = await verdictInView(p, withR);
          if ((await p.evaluate(() => window.scrollY)) <= y0)
            ng.push('押した後にアプリが判定を寄せていない');
          // 押したタップは見える範囲に残る（フォーカスも押した radio のまま）
          const kept = await last.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const top = Math.max(
              0,
              ...[...document.querySelectorAll('.apphead, .appbar')]
                .filter((e) => ['sticky', 'fixed'].includes(getComputedStyle(e).position))
                .map((e) => e.getBoundingClientRect())
                .filter((r) => r.height > 0)
                .map((r) => r.bottom),
            );
            return {
              seen: r.bottom > top + 0.5,
              focus: el.contains(document.activeElement),
            };
          });
          if (!kept.seen) ng.push('押したタップが上の帯の下に隠れた');
          if (!kept.focus) ng.push('フォーカスが押したタップから動いた');
          // タップの直後の見える範囲を撮る（目で見る補助。スクロールしない）
          if (opts.shots) {
            await p.screenshot({
              path: join(
                opts.shots,
                `${w}x${h}-${theme}-r11-${ex === EX_E1 ? 'b' : ex === EX_E3 ? 'risky' : ex === EX_E16 ? 'c' : 's8'}.png`,
              ),
            });
          }
          if (ng.length > 0) throw new Error(`${w}x${h} ${theme} ${name}: ${ng.join(' / ')}`);
          n++;
        }
      } finally {
        await c.close();
      }
    }
    return `判定が見える範囲の外にある状態で最後のタップを座標で押す → アプリが寄せて、バッジと R が見える範囲の中・押したタップも残る・フォーカスは動かない（${n} 件 = 4 場面 × 360 / 1440 × 両テーマ + 390（動きを減らす設定））、判定の枠はタップの枠のすぐ後`;
  });

  await check('R12', async () => {
    const out = [];
    // 口座 1 つの形は 2,550px、口座 2 つ・3 つの形は 2,646px まで（#47）。どの形でも開いた直後の 1 画面に
    // [スクショを選ぶ] と銘柄の欄
    const shapes = [
      { label: '口座 1', accounts: undefined, max: TOTAL_MAX },
      { label: '口座 2', accounts: ACCOUNTS_2, max: TOTAL_MAX_ACCOUNTS },
      { label: '口座 3', accounts: ACCOUNTS_3_LONG, max: TOTAL_MAX_ACCOUNTS },
    ];
    for (const theme of THEMES)
      for (const shape of shapes) {
        const c = await browser.newContext({
          viewport: { width: 360, height: 780 },
          storageState: signedIn,
        });
        try {
          await setupContext(c, theme);
          await installFakeApi(c, shape.accounts ? { accounts: shape.accounts } : {});
          const p = await c.newPage();
          await openRecord(p, base);
          const m = await p.evaluate(() => {
            const vh = window.innerHeight;
            const top = Math.max(
              0,
              ...[...document.querySelectorAll('.apphead, .appbar')]
                .filter((e) => ['sticky', 'fixed'].includes(getComputedStyle(e).position))
                .map((e) => e.getBoundingClientRect())
                .filter((r) => r.height > 0)
                .map((r) => r.bottom),
            );
            const navEl = document.querySelector('.appnav');
            const navRect = navEl?.getBoundingClientRect();
            const nav = navRect && navRect.height > 0 ? navRect.top : vh;
            const bar =
              document.querySelector('.record__submit')?.getBoundingClientRect().top ?? vh;
            const bottom = Math.min(nav, bar, vh);
            const seen = (sel) => {
              const r = document.querySelector(sel)?.getBoundingClientRect();
              return !!r && r.height > 0 && r.top >= top - 0.5 && r.bottom <= bottom + 0.5;
            };
            const notice = document.querySelector('.statement__notice');
            const cs = notice ? getComputedStyle(notice) : null;
            const lines = notice
              ? Math.round(notice.getBoundingClientRect().height / Number.parseFloat(cs.lineHeight))
              : 0;
            return {
              scrollY: window.scrollY,
              pick: seen('label[for="record-statement-file"]'),
              instrument: seen('#record-instrument'),
              noticeText: notice?.textContent ?? '',
              lines,
              hidden: !!notice?.closest('details, dialog'),
              total: document.documentElement.scrollHeight,
            };
          });
          if (m.scrollY !== 0) throw new Error(`開いた直後のスクロール ${m.scrollY}px`);
          if (!m.pick) throw new Error(`${theme}: [スクショを選ぶ] が見える範囲に無い`);
          if (!m.instrument) throw new Error(`${theme}: 銘柄の欄が見える範囲に無い`);
          for (const t of ['AI の提供元（Anthropic）に送', '切り取って', '保存しません'])
            if (!m.noticeText.includes(t)) throw new Error(`${theme}: 注意に「${t}」が無い`);
          if (m.lines > 3) throw new Error(`${theme}: 注意が ${m.lines} 行（3 行まで）`);
          if (m.hidden) throw new Error(`${theme}: 注意が畳まれている`);
          if (m.total > shape.max)
            throw new Error(`${theme} ${shape.label}: 全長 ${m.total}px（${shape.max}px まで）`);
          out.push(`${theme} ${shape.label} 注意 ${m.lines} 行・全長 ${m.total}px`);
        } finally {
          await c.close();
        }
      }
    return `360×780 の開いた直後に [スクショを選ぶ] と銘柄の欄が見える、${out.join(' / ')}`;
  });

  await check('R13', async () => {
    const c = await browser.newContext({
      viewport: { width: 360, height: 780 },
      storageState: signedIn,
    });
    try {
      await setupContext(c, 'dark');
      await installFakeApi(c);
      const p = await c.newPage();
      await openRecord(p, base);
      await fillRecord(p, EX_E1);
      // 損益（円）を入れて R・リスク・損益の 3 つのラベルを並べる（架空の値）
      await p.locator('.more__summary').click();
      await p.locator('#record-pnl').fill('-8,000');
      await p.locator('.verdict .badge', { hasText: 'B 悪い損失' }).waitFor({ timeout: 5000 });
      await p.locator('.verdict__stat dt', { hasText: '損益' }).waitFor({ timeout: 5000 });
      const m = await p.evaluate(() => {
        const r = document.querySelector('.verdict .num--xl');
        const cs = getComputedStyle(r);
        const tops = [...document.querySelectorAll('.verdict__stat dt')].map(
          (dt) => dt.getBoundingClientRect().top,
        );
        return { size: cs.fontSize, family: cs.fontFamily, text: r.textContent, tops };
      });
      expectEq(m.size, '36px', '大きな R の文字の大きさ');
      if (/mono/i.test(m.family)) throw new Error(`大きな R の書体が等幅 ${m.family}`);
      expectEq(m.text, '−1.6R', 'R の文字（負の符号は U+2212）');
      expectEq(m.tops.length, 3, 'ラベルの数');
      const spread = Math.max(...m.tops) - Math.min(...m.tops);
      if (spread > 1) throw new Error(`ラベルの上端の差 ${spread.toFixed(1)}px`);
      return `判定 B の R は 36px・本文の書体（${m.family.split(',')[0]}）、R・リスク・損益のラベルの上端の差 ${spread.toFixed(1)}px`;
    } finally {
      await c.close();
    }
  });

  // ── チャートの時間足の読み取り（CR1。Issue #27）。偽の記録の API が 4 時間足・日足を返す
  await check('CR1', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await openRecord(p, base);
      await p.locator('.charts__notice', { hasText: 'AI（Anthropic）に送ります' }).waitFor();
      fake.chartTimeframes = ['4h', '1d'];
      await fillRecord(p, EX_E1);
      await pasteChart(p, 'entry');
      await pasteChart(p, 'exit');
      await expectPollAsync(
        async () => (await p.locator('#record-chart-exit-tf').inputValue()) === '1d',
        '読み取りで埋まった決済時の時間足',
      );
      expectEq(
        await p.locator('#record-chart-entry-tf').inputValue(),
        '4h',
        'エントリー時の時間足',
      );
      expectEq(await p.locator('#record-chart-entry-tf-mark').textContent(), 'チャートから', '印');
      expectEq(fake.chartReads, 2, '時間足の読み取りの要求');
      expectEq(fake.reads.length, 0, '明細の読み取りの要求');
      await p
        .locator('.reasons__item', { hasText: '時間足を変えた（4 時間足 → 日足・チャートから）' })
        .waitFor();
      // 利用者が直すと印が消える
      await p.locator('#record-chart-entry-tf').selectOption('1h');
      expectEq(await p.locator('#record-chart-entry-tf-mark').count(), 0, '直した後の印');
      const overflow = await p.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expectEq(overflow, 0, '横スクロール');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'チャートを 2 枠に貼る → 時間足の読み取り 2 回・欄に 4 時間足 / 日足と印・判定に「チャートから」・直すと印が消える・横スクロール 0';
  });

  // ── 根拠の足のチャート（C1〜C3。Issue #12）。偽の記録の API で流す
  await check('C1', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await openRecord(p, base);
      // エントリー時の枠を選んで貼る → 枠に入り、明細の読み取りの要求は 0
      await p.locator('#record-chart-entry .chart__name').click();
      expectEq(
        await p.evaluate(() => document.activeElement?.id),
        'record-chart-entry',
        '枠をクリックしたときのフォーカス',
      );
      await makeChart(p, 'paste');
      await p.locator('#record-chart-entry canvas.chart__preview').waitFor({ timeout: 10000 });
      expectEq(fake.reads.length, 0, '枠に貼った後の明細の読み取りの要求');
      // Tab で決済時の枠へ移って貼る → 決済時の枠に入る
      await p.locator('#record-chart-exit').focus();
      await makeChart(p, 'paste');
      await p.locator('#record-chart-exit canvas.chart__preview').waitFor({ timeout: 10000 });
      expectEq(fake.reads.length, 0, '2 枚目の後の明細の読み取りの要求');
      // 時間足の欄はチャートのある枠だけ（2 枚あるので 2 つ）。[削除] で欄も消え、フォーカスは枠へ
      expectEq(await p.locator('.chart select').count(), 2, '時間足の欄の数');
      await p.locator('#record-chart-exit-tf').selectOption('1d');
      // レビュー指摘 1: 時間足の欄にフォーカスが残ったまま貼る → 目印（輪・「ここに貼り付け」）は出ておらず、
      // チャートは置き換わらず時間足も消えない（明細の読み取りへ。目印と行き先が一致する）
      await p.locator('#record-chart-exit-tf').focus();
      const ringOnSelect = await p.evaluate(
        () => getComputedStyle(document.querySelector('#record-chart-exit .chart__ready')).display,
      );
      expectEq(ringOnSelect, 'none', '時間足の欄にフォーカスがあるときの「ここに貼り付け」');
      const exitPreviewBefore = await p.evaluate(
        () => document.querySelector('#record-chart-exit canvas.chart__preview') !== null,
      );
      await makeChart(p, 'paste');
      await expectPoll(() => fake.reads.length === 1, '時間足の欄に貼った後の明細の読み取りの要求');
      await p.locator('.field__mark').first().waitFor({ timeout: 10000 });
      expectEq(exitPreviewBefore, true, '貼る前の決済時のプレビュー');
      expectEq(await p.locator('#record-chart-exit-tf').inputValue(), '1d', '貼った後の時間足');
      expectEq(await p.locator('canvas.chart__preview').count(), 2, '貼った後のチャートの枚数');
      // 枠そのものにフォーカスがあるときは目印が出る
      await p.locator('#record-chart-exit').focus();
      expectEq(
        await p.evaluate(
          () =>
            getComputedStyle(document.querySelector('#record-chart-exit .chart__ready')).display,
        ),
        'block',
        '枠にフォーカスがあるときの「ここに貼り付け」',
      );
      await p
        .locator('#record-chart-exit')
        .getByRole('button', { name: '決済時のチャートを削除' })
        .click();
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'record-chart-exit',
        '[削除] の後のフォーカス',
      );
      expectEq(await p.locator('.chart select').count(), 1, '外した後の時間足の欄の数');
      // 枠の外（本文）に貼る → 明細の読み取りへ 1 件、チャートの枠は増えない
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await expectPoll(() => fake.reads.length === 2, '枠の外に貼った後の明細の読み取りの要求');
      expectEq(await p.locator('canvas.chart__preview').count(), 1, '枠の外に貼った後のチャート');
      // [チャートを選ぶ]（ファイル）でも決済時の枠に入る
      const bytes = Buffer.from(await makeChart(p, 'bytes'));
      await p
        .locator('#record-chart-exit-file')
        .setInputFiles({ name: `${CHART_MARKER}.png`, mimeType: 'image/png', buffer: bytes });
      await p.locator('#record-chart-exit canvas.chart__preview').waitFor({ timeout: 10000 });
      expectEq(fake.reads.length, 2, 'ファイルを選んだ後の明細の読み取りの要求');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '枠をクリック / Tab で選んで貼る → その枠（明細の要求 0）・時間足の欄にフォーカスで貼る → 目印なし・明細へ・チャートと時間足は不変・枠の外に貼る → 明細・[チャートを選ぶ] → 枠・[削除] → 欄が消えフォーカスは枠';
  });

  await check('C2', async () => {
    const { c, p, fake } = await recordContext();
    const snap = () =>
      p.evaluate(async () => {
        const dbs = indexedDB.databases ? await indexedDB.databases() : [];
        return {
          ls: Object.keys(localStorage).sort(),
          ss: Object.keys(sessionStorage).sort(),
          idb: dbs.map((d) => d.name).sort(),
          caches: (await caches.keys()).sort(),
          href: location.href,
          state: JSON.stringify(history.state),
          values: Object.keys(localStorage)
            .map((k) => localStorage.getItem(k) ?? '')
            .concat(Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k) ?? ''))
            .join('\n'),
        };
      });
    try {
      await openRecord(p, base);
      const before = await snap();
      await fillRecord(p, EX_E1);
      await pasteChart(p, 'entry');
      await pasteChart(p, 'exit');
      await p.locator('button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
      await p.getByText('チャート 2 枚も保存しました').waitFor();
      await p.getByRole('button', { name: '次の取引を記録' }).click();
      // もう 1 枚貼ってから一覧へ移る（保存しないチャートは送らない。E12）
      await pasteChart(p, 'entry');
      const postsBefore = fake.chartPosts.length;
      // 記録している間は下のタブが隠れているので、戻るで離れる（#127）
      await p.goBack();
      await waitReady(p, 'ホーム');
      expectEq(fake.chartPosts.length, postsBefore, '離れた後のチャートの送信');
      const after = await snap();
      for (const k of ['ls', 'ss', 'idb', 'caches']) {
        expectEq(JSON.stringify(after[k]), JSON.stringify(before[k]), k);
      }
      if (after.ls.some((k) => k !== THEME_KEY)) throw new Error(`localStorage の鍵 ${after.ls}`);
      if (after.ss.length !== 0) throw new Error(`sessionStorage の鍵 ${after.ss}`);
      if (after.caches.length !== 0) throw new Error('Cache Storage が空でない');
      // 送った画像のバイト列の一部（base64・16 進）と印が、端末の保存先の値に無い
      const sent = fake.chartPosts[0]?.charts.entry?.bytes;
      if (!sent) throw new Error('チャートが送られていない');
      const needles = [
        CHART_MARKER,
        sent.subarray(64, 160).toString('base64'),
        sent.subarray(64, 96).toString('hex'),
      ];
      const idbText = await p.evaluate(async () => {
        const dbs = indexedDB.databases ? await indexedDB.databases() : [];
        const out = [];
        for (const d of dbs) {
          const db = await new Promise((ok, ng) => {
            const r = indexedDB.open(d.name);
            r.onsuccess = () => ok(r.result);
            r.onerror = () => ng(r.error);
          });
          for (const name of db.objectStoreNames) {
            const all = await new Promise((ok) => {
              const r = db.transaction(name).objectStore(name).getAll();
              r.onsuccess = () => ok(r.result);
              r.onerror = () => ok([]);
            });
            out.push(JSON.stringify(all));
          }
          db.close();
        }
        return out.join('\n');
      });
      for (const n of needles) {
        if (after.values.includes(n)) throw new Error('Web Storage にチャートの画像');
        if (idbText.includes(n)) throw new Error('IndexedDB にチャートの画像');
      }
      if (after.href.includes(CHART_MARKER) || (after.state ?? '').includes(CHART_MARKER))
        throw new Error('URL・履歴にチャート');
    } finally {
      await c.close();
    }
    return '貼る → 保存 → 次の取引で 1 枚 → 一覧へ: Web Storage の鍵はテーマだけ・IndexedDB の名前と Cache Storage は前と同じ・値に画像なし・離れた後の送信 0';
  });

  await check('C3', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await openRecord(p, base);
      await pasteChart(p, 'entry');
      await pasteChart(p, 'exit');
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.field__mark').first().waitFor({ timeout: 10000 });
      const typed = await fillStatementTaps(p);
      await p.locator('.verdict .badge', { hasText: 'A' }).waitFor({ timeout: 5000 });
      await p.locator('button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
      expectEq(fake.chartPosts.length, 1, 'チャートつきの保存の要求');
      expectEq(fake.chartPosts[0].parts.join(','), 'record,entryChart,exitChart', '部分');
      for (const slot of ['entry', 'exit']) {
        const ch = fake.chartPosts[0].charts[slot];
        const info = imageInfoOf(ch.bytes);
        if (!info || info.type !== ch.type) throw new Error(`${slot}: 形式`);
        if (ch.bytes.length > 500000 || Math.max(info.w, info.h) > 2000)
          throw new Error(`${slot}: ${ch.bytes.length} B ${info.w}×${info.h}`);
      }
      expectEq(fake.reads.length, 1, '明細の読み取りの要求');
      expectEq(errors.length, 0, 'ページのエラー');
      return `チャート 2 枚 + 明細 1 枚 → 打つ ${typed.typed}・選ぶ ${typed.chosen} → A → 1 要求（record・entryChart・exitChart）で保存`;
    } finally {
      await c.close();
    }
  });

  // ── 設定（SET1〜SET5。Issue #5・#47 の口座）。偽の記録の API で流す
  await check('SET1', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      // 円建ての銘柄にしておく（1R・リスク（%）を価格から出せる。5.1）
      fake.instruments[0] = { ...FAKE_US30, priceCurrency: 'JPY' };
      await openSettings(p, base);
      await p.locator('.instlist__item', { hasText: '資金 未設定 · 許容 1%' }).waitFor();
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await p.locator('#settings-account-capital').fill('1,000,000');
      await p.getByText('1 回の負けは 10,000円 までです').waitFor();
      await p.locator('#settings-account-save').click();
      await p
        .getByRole('status')
        .filter({ hasText: '口座 1 を保存しました' })
        .waitFor({ timeout: 5000 });
      expectEq(fake.accounts.find((a) => a.id === 'default')?.capitalYen, 1000000, '保存した資金');
      expectEq(
        fake.writes.some((x) => x.key === 'PUT /api/settings'),
        false,
        '設定の API に書かない',
      );
      await p.reload();
      await openSettings(p, base);
      await p.locator('.instlist__item', { hasText: '1,000,000円 · 許容 1%' }).waitFor();
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await p.locator('summary', { hasText: '資金の履歴（1 件）' }).waitFor();
      expectEq(
        await p.locator('#settings-account-capital').inputValue(),
        '1,000,000',
        '開き直した欄',
      );
      // 記録する画面で 5.1 の例（L・イン 100.00・LC 99.50・数量 10,000・決済 99.40）→ リスク 0.5%
      await openRecord(p, base);
      await fillRecord(p, {
        side: 'L',
        entry: '100.00',
        exit: '99.40',
        lc: '99.50',
        decided: true,
        move: 'そのまま',
      });
      await p.locator('.verdict .num', { hasText: '0.5%' }).waitFor({ timeout: 5000 });
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '資金 1,000,000 を保存 → 開き直しても 1,000,000円・履歴 1 件 → 記録する画面でリスク 0.5%';
  });

  await check('SET2', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      seedSettings(fake);
      await openSettings(p, base);
      // E9: [直す] → 名前の欄にフォーカス → 株価指数・usd・刻み 0.1 → 保存
      await p.getByRole('button', { name: 'US30 を編集' }).click();
      await p.locator('#settings-inst-name').waitFor();
      // フォーカスは描き直しの後の effect で移る（待つ）
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'settings-inst-name',
        '開いた後のフォーカス',
      );
      await p.locator('#settings-inst-kind').selectOption('index');
      await p.locator('#settings-inst-currency').fill('usd');
      await p.locator('#settings-inst-step').fill('0.1');
      await p.locator('form.instedit button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: 'US30 を保存しました' }).waitFor();
      const want = '株価指数 · 現物・CFD · USD 建て · 乗数 1 · 刻み 0.1';
      await p.locator('.instlist__item', { hasText: want }).waitFor();
      // フォーカスは描き直しの後の effect で移る（待つ）
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id)) === 'settings-edit-inst-us30',
        '閉じた後のフォーカス',
      );
      await p.reload();
      await openSettings(p, base);
      await p.locator('.instlist__item', { hasText: want }).waitFor();
      // E10・E11: 重複の名前・乗数 0 → 送らずに欄の誤り
      const before = fake.writes.length;
      await p.getByRole('button', { name: 'XAU を編集' }).click();
      await p.locator('#settings-inst-name').fill('日経２２５ ');
      await p.locator('#settings-inst-multiplier').fill('0');
      await p.locator('form.instedit button[type="submit"]').click();
      await p
        .locator('#settings-inst-name-error', { hasText: '同じ名前の銘柄があります' })
        .waitFor();
      await p.locator('#settings-inst-multiplier-error').waitFor();
      expectEq(fake.writes.length, before, '誤りのときの書き込み');
      await p.getByRole('button', { name: 'キャンセル' }).click();
      // フォーカスは描き直しの後の effect で移る（待つ）
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id)) === 'settings-edit-inst-xau',
        'やめた後のフォーカス',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'E9 を直して保存 → 一覧・開き直しても同じ、E10・E11 は送らない、フォーカスは名前の欄 ⇄ [直す]';
  });

  await check('SET3', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      seedSettings(fake);
      await openSettings(p, base);
      // E13: 名前だけで足す
      await p.locator('#settings-new-name').fill('GOLD');
      await p.getByRole('button', { name: '追加', exact: true }).click();
      await p.getByRole('status').filter({ hasText: 'GOLD を追加しました' }).waitFor();
      const row = p.locator('.instlist__item', { hasText: 'GOLD' });
      await row.filter({ hasText: '初期値のまま' }).waitFor();
      await row
        .filter({ hasText: 'その他 · 現物・CFD · 価格の通貨 未設定 · 乗数 1 · 刻み 1' })
        .waitFor();
      const post = fake.writes.find((x) => x.key === 'POST /api/instruments');
      expectEq(JSON.stringify(post?.body), JSON.stringify({ name: 'GOLD' }), '足す本文');
      // E7（A7）: 口座 1 の許容リスク 2.5 → 警告を出して保存できる
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await p.locator('#settings-account-risk').fill('2.5');
      await p.getByRole('status').filter({ hasText: '2% を超えています' }).waitFor();
      await p.locator('#settings-account-save').click();
      await p.getByRole('status').filter({ hasText: '口座 1 を保存しました' }).waitFor();
      expectEq(
        fake.accounts.find((a) => a.id === 'default')?.riskTolerancePct,
        2.5,
        '保存した許容リスク',
      );
      // E8: 3.1 は送らない
      const before = fake.writes.length;
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await p.locator('#settings-account-risk').fill('3.1');
      await p.locator('#settings-account-save').click();
      await p.locator('#settings-account-risk-error').waitFor();
      expectEq(fake.writes.length, before, '範囲外のときの書き込み');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'E13 GOLD を名前だけで足す（初期値のまま・既定の 5 欄）、E7 は警告つきで保存、E8 は送らない';
  });

  await check('SET4', async () => {
    const focused = (p) => p.evaluate(() => document.activeElement?.id ?? '');
    // 誤りのまま [保存] → 最初の誤りの欄へフォーカス。口座の欄は欄の下の文言だけで、要約の知らせは出さない
    // （記録する画面の足す欄と同じ。#47 再レビュー 4）
    {
      const { c, p, fake, errors } = await recordContext({ failAccounts: 503 });
      try {
        seedSettings(fake);
        await openSettings(p, base);
        await p.getByRole('button', { name: '口座 1 を編集' }).click();
        await p.locator('#settings-account-risk').fill('3.1');
        await p.locator('#settings-account-capital').fill('0');
        await p.locator('#settings-account-save').click();
        await p.locator('form.instedit .field--error').nth(1).waitFor();
        expectEq(
          await p.getByRole('alert').filter({ hasText: '誤りのある欄があります' }).count(),
          0,
          '口座の欄の要約の知らせ',
        );
        await expectPollAsync(
          async () => (await focused(p)) === 'settings-account-capital',
          '誤りの欄へ',
        );
        // 保存に失敗して戻った → 押した [保存] へ
        await p.locator('#settings-account-capital').fill('1000000');
        await p.locator('#settings-account-risk').fill('1');
        await p.locator('#settings-account-save').click();
        await p.getByRole('alert').filter({ hasText: '保存できませんでした' }).waitFor();
        await expectPollAsync(
          async () => (await focused(p)) === 'settings-account-save',
          '[保存] へ',
        );
        // やめると口座の [直す] へ戻る
        await p.locator('form.instedit').getByRole('button', { name: 'キャンセル' }).click();
        await expectPollAsync(
          async () => (await focused(p)) === 'settings-account-edit-default',
          'やめた後のフォーカス',
        );
        // 銘柄: 誤りのまま [保存] → 最初の誤りの欄（価格の通貨）

        await p.getByRole('button', { name: 'US30 を編集' }).click();
        await p.locator('#settings-inst-multiplier').fill('0');
        await p.locator('#settings-inst-currency').fill('US');
        await p.locator('#settings-inst-save').click();
        await expectPollAsync(
          async () => (await focused(p)) === 'settings-inst-currency',
          '銘柄の誤りの欄へ',
        );
        expectEq(errors.length, 0, 'ページのエラー');
      } finally {
        await c.close();
      }
    }
    // 記録する画面: 保存に失敗して戻った → [記録する] へ
    {
      const { c, p, errors } = await recordContext({ failTrades: 503 });
      try {
        await openRecord(p, base);
        await fillRecord(p, EX_E1);
        await p.locator('#record-submit').click();
        await p.getByRole('alert').filter({ hasText: '保存できませんでした' }).waitFor();
        await expectPollAsync(async () => (await focused(p)) === 'record-submit', '[記録する] へ');
        expectEq(errors.length, 0, 'ページのエラー');
      } finally {
        await c.close();
      }
    }
    return '誤りのまま押す → 最初の誤りの欄・知らせ、保存の失敗 → 押したボタン（設定の [保存]・記録する画面の [記録する]）';
  });

  // ── 言葉の説明の「i」（Issue #57。#129 で説明のシート）。幅 360 で、偽の記録の API で流す
  // IT1: 押して開く → ✕ で閉じる・Esc で閉じてフォーカスが「i」へ・外（後ろの暗い面）を押して閉じる（押した所の欄には届かない）・
  //      同時に 1 つ（開いている間、後ろの「i」は押せない）
  // IT2: 未選択のまま「i」を押し・Enter で開いても、選択・帯の文・下書きが変わらず、保存の要求 0（AC-5）
  // IT3: 開いて戻る → シートだけが閉じ、URL・画面・下書きはそのまま・履歴の長さは開く前と同じ。✕・Esc・外で閉じた後も
  //      履歴の長さは開く前に戻り、その後の戻るは前の画面へ（H1）
  const infoState = (p, name) => infoButton(p, name).getAttribute('aria-expanded');
  const popCount = sheetCount;

  await check('IT1', async () => {
    const { c, p, errors } = await recordContext();
    const TF = '「時間足を変えたか」の説明';
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await openRecord(p, base);
      const b = infoButton(p, TF);
      expectEq(await infoState(p, TF), 'false', '押す前');
      expectEq(await b.getAttribute('aria-haspopup'), 'dialog', 'aria-haspopup');
      expectEq(await popCount(p), 0, '押す前のシート');
      await openInfo(p, TF);
      expectEq(await infoState(p, TF), 'true', '1 回目');
      expectEq(await sheetTitle(p), '時間足を変えたか', 'シートの見出し');
      const txt = await p.locator(OPEN_SHEET).textContent();
      for (const w of ['長い足へ', 'B 悪い損失', '短い足へ'])
        if (!txt?.includes(w)) throw new Error(`シートに「${w}」が無い`);
      // 開くとフォーカスはシートの見出しへ
      expectEq(
        await p.evaluate(() => document.activeElement?.classList.contains('sheet__title')),
        true,
        '開いた後のフォーカス',
      );
      // ✕ で閉じる → フォーカスは「i」
      await closeSheet(p);
      await expectPollAsync(async () => (await popCount(p)) === 0, '✕ で閉じる');
      expectEq(await infoState(p, TF), 'false', '✕ の後');
      expectEq(await focusLabel(p), TF, '✕ の後のフォーカス');
      // Esc: 閉じてフォーカスが「i」
      await b.focus();
      await p.keyboard.press('Enter');
      await expectPollAsync(async () => (await infoState(p, TF)) === 'true', 'Enter で開く');
      await settleSheet(p);
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await popCount(p)) === 0, 'Esc で閉じる');
      expectEq(await focusLabel(p), TF, 'Esc の後のフォーカス');
      // 外を押すと閉じる（後ろの欄には届かない）・フォーカスは「i」
      await openInfo(p, TF);
      await pressBackdrop(p);
      await expectPollAsync(async () => (await popCount(p)) === 0, '外を押して閉じる');
      expectEq(await focusLabel(p), TF, '外を押した後のフォーカス');
      // シートの中を押しても閉じない
      await openInfo(p, TF);
      await p.locator(`${OPEN_SHEET} .sheet__body`).click({ position: { x: 4, y: 4 } });
      await p.waitForTimeout(150);
      expectEq(await popCount(p), 1, '中を押した後のシート');
      // 同時に 1 つ: 開いている間、後ろの「i」は押せない（モーダルの外は inert）
      const reached = await infoButton(p, '「LC を動かしたか」の説明')
        .click({ timeout: 1000, trial: true })
        .then(() => true)
        .catch(() => false);
      expectEq(reached, false, '開いている間に後ろの「i」を押せる');
      expectEq(await popCount(p), 1, '同時に開いている数');
      await closeSheet(p);
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '押して開く（aria-haspopup="dialog"・aria-expanded false → true・見出しへフォーカス）、✕・Esc・外を押すで閉じてフォーカスは「i」、中を押しても閉じない、開いている間は後ろの「i」を押せない（同時に 1 つ）、中身に「長い足へ・B 悪い損失・短い足へ」';
  });

  await check('IT2', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await openRecord(p, base);
      await fillRecord(p, EX_E1, false);
      const snap = () =>
        p.evaluate(() => ({
          checked: [...document.querySelectorAll('input[type="radio"]:checked')].map(
            (e) => `${e.getAttribute('name')}=${e.getAttribute('value')}`,
          ),
          status: document.querySelector('.record__status, .record__missing')?.textContent ?? '',
          values: [
            ...document.querySelectorAll('input:not([type="radio"]):not([type="file"]), select'),
          ].map((e) => e.value),
          badge: document.querySelector('.verdict .badge')?.textContent ?? '',
          url: location.pathname,
        }));
      const before = await snap();
      if (!before.status) throw new Error('帯の文が無い');
      const MOVE = '「LC を動かしたか」の説明';
      await infoButton(p, MOVE).click();
      await p.locator(OPEN_SHEET).waitFor();
      await closeSheet(p);
      await expectPollAsync(async () => (await popCount(p)) === 0, '✕ で閉じる');
      await infoButton(p, MOVE).focus();
      await p.keyboard.press('Enter');
      await p.locator(OPEN_SHEET).waitFor();
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await popCount(p)) === 0, 'Esc で閉じる');
      const after = await snap();
      expectEq(JSON.stringify(after), JSON.stringify(before), '入力の状態');
      expectEq(fake.posts.length, 0, '保存の要求');
      expectEq(errors.length, 0, 'ページのエラー');
      return `未選択のまま「i」を押す・✕・Enter・Esc: 選択・帯の文（${before.status}）・欄の値・判定が同じ、保存の要求 0`;
    } finally {
      await c.close();
    }
  });

  await check('IT3', async () => {
    const { c, p, errors } = await recordContext();
    const TF = '「時間足を変えたか」の説明';
    const DEC = '「LC を入る前に決めていたか」の説明';
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/`);
      await waitReady(p, 'ホーム');
      await p.locator('.appnav a[href="/record"]').click();
      await waitReady(p, '記録する');
      await p.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
      await fillRecord(p, EX_E1, false);
      const len = () => p.evaluate(() => history.length);
      const y = () => p.evaluate(() => Math.round(window.scrollY));
      const base0 = await len();
      // 開いて戻る → シートだけが閉じる
      await openInfo(p, TF);
      await expectPollAsync(async () => (await len()) === base0 + 1, '開いたら履歴に 1 段');
      await p.goBack();
      await expectPollAsync(async () => (await popCount(p)) === 0, '戻るで閉じる');
      expectEq(new URL(p.url()).pathname, '/record', '戻った後の URL');
      expectEq(await p.locator('main h1').first().textContent(), '記録する', '戻った後の画面');
      expectEq(await p.locator('#record-entry').inputValue(), '100.00', '下書き');
      expectEq(await focusLabel(p), TF, '戻るの後のフォーカス');
      // B1（レビュー）の置き換え（#129）: スクロールした所で開いて外を押す → シートだけが閉じ、窓の位置は変わらない
      await infoButton(p, DEC).scrollIntoViewIfNeeded();
      await p.evaluate(() => window.scrollBy(0, 120));
      await openInfo(p, DEC);
      const y2 = await y();
      await pressBackdrop(p);
      await expectPollAsync(async () => (await popCount(p)) === 0, '外を押して閉じる');
      await p.waitForTimeout(250);
      const y3 = await y();
      if (Math.abs(y3 - y2) > 2) throw new Error(`外を押した後に位置が ${y2} → ${y3}`);
      // B1: 開いて戻る → シートだけ閉じ、位置は変わらない
      await openInfo(p, DEC);
      const y4 = await y();
      await p.goBack();
      await expectPollAsync(
        async () => (await popCount(p)) === 0,
        '戻るで閉じる（スクロールの後）',
      );
      await p.waitForTimeout(250);
      const y5 = await y();
      if (Math.abs(y5 - y4) > 2) throw new Error(`戻るの後に位置が ${y4} → ${y5}`);
      expectEq(new URL(p.url()).pathname, '/record', 'スクロールの後の戻るの URL');
      // ✕ で閉じる → 積んだ段を戻して数を合わせる（その後の戻るは 1 回で前の画面へ。進む側には積んだ段の項目が残り、
      // 進むで入ると押し戻される = option-simulator と同じ規則。レビュー N3 b・N8 a）
      for (const [how, close] of [
        ['✕', closeSheet],
        ['Esc', (q) => q.keyboard.press('Escape')],
        ['外', pressBackdrop],
      ]) {
        await openInfo(p, TF);
        await close(p);
        await expectPollAsync(async () => (await popCount(p)) === 0, `${how} で閉じる`);
        await p.waitForTimeout(200);
        await p.goBack();
        await waitReady(p, 'ホーム');
        expectEq(new URL(p.url()).pathname, '/', `${how} で閉じた後の戻る`);
        await p.goForward();
        await waitReady(p, '記録する');
        await p.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
      }
      // 開いたままシートの中の ［用語集で見る］ で画面を移る → 用語集。戻る 1 回で記録する画面（N8 b）
      await openInfo(p, TF);
      await p.locator(`${OPEN_SHEET} .info__glossary`).click();
      await waitReady(p, '用語集');
      expectEq(new URL(p.url()).pathname, '/glossary', '開いたまま移った先');
      expectEq(await popCount(p), 0, '移った先のシート');
      await expectNoSheetShown(p, '用語集へ移った後');
      await p.goBack();
      await expectPollAsync(
        async () => new URL(p.url()).pathname === '/record',
        '戻る 1 回で記録する画面',
      );
      await waitReady(p, '記録する');
      expectEq(await popCount(p), 0, '戻った後のシート');
      // B2（再レビュー）: 開いたまま移って戻った後も、その画面の戻るの位置の復元は効く（scrollRestoration が manual で残らない）
      await expectRestore(p, '開いたまま一覧へ移って戻った後');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '開いて戻る → シートだけ閉じ、URL /record・画面・下書き・フォーカス（「i」）はそのまま。スクロールした所で開いて外を押す・戻る → 位置は変わらない（B1）。✕ / Esc / 外で閉じた後の戻るは 1 回でホームへ。開いたまま用語集へ移り、戻る 1 回で記録する画面';
  });

  // ── 下のシート（#129。ui-guidelines 9.3・9.6・9.10）。説明のシートで流す
  // SH1: 360×780・390×844 × ダーク / ライトと、文字の拡大 200%（ダーク）で「判定」の説明（判定の一覧つきの長い説明）を開く →
  //      下から出る（下端が窓の下端・左右いっぱい）・窓の中・最大 86%・中を最後までスクロールして ［用語集で見る］ が見える・
  //      ✕ の当たり 44・Tab を 12 回押してもシートの外の要素へ移らない（✕ と ［用語集で見る］ に届く）・✕ で閉じたら「i」へ。
  //      安全域を上 47・下 34 に差し替えた 390×844 で、シートの押せるものが安全域の内側
  await check('SH1', async () => {
    const out = [];
    const runs = [];
    for (const theme of THEMES)
      for (const [w, h] of [
        [360, 780],
        [390, 844],
      ])
        runs.push({ theme, w, h, zoom: false, safe: false });
    for (const [w, h] of [
      [360, 780],
      [390, 844],
    ])
      runs.push({ theme: 'dark', w, h, zoom: true, safe: false });
    runs.push({ theme: 'dark', w: 390, h: 844, zoom: false, safe: true });
    const J = '「判定」の説明';
    for (const run of runs) {
      const { c, p, errors } = await recordContext();
      const label = `${run.w}x${run.h} ${run.theme}${run.zoom ? ' 拡大' : ''}${run.safe ? ' 安全域' : ''}`;
      try {
        await setupContext(c, run.theme, run.zoom);
        if (run.safe)
          await c.addInitScript(() => {
            const put = () => {
              const st = document.createElement('style');
              st.textContent =
                ':root:root{--safe-top:47px;--safe-bottom:34px;--safe-left:0px;--safe-right:0px}';
              document.head.append(st);
            };
            if (document.head) put();
            else document.addEventListener('DOMContentLoaded', put);
          });
        await p.setViewportSize({ width: run.w, height: run.h });
        await openRecord(p, base);
        await fillRecord(p, EX_E1);
        await p.locator('.verdict .badge', { hasText: 'B 悪い損失' }).waitFor();
        const r = await openInfo(p, J);
        // 下から出る（下端が窓の下端・左右いっぱい）
        if (Math.abs(r.bottom - r.vh) > 1) throw new Error(`${label}: 下端 ${r.bottom} / ${r.vh}`);
        if (r.left > 0.5 || r.right < r.vw - 0.5)
          throw new Error(`${label}: 左右 ${r.left}〜${r.right} / ${r.vw}`);
        // ✕ の当たり
        const x = await p.locator(`${OPEN_SHEET} .sheet__close`).boundingBox();
        if (!x || x.width < TAP - 0.5 || x.height < TAP - 0.5)
          throw new Error(`${label}: ✕ の当たり ${x?.width}×${x?.height}`);
        if (opts.shots && run.w === 390 && !run.safe)
          await p.screenshot({
            path: join(opts.shots, `390x844-${run.theme}${run.zoom ? '-zoom' : ''}-sheet-info.png`),
          });
        // 中を最後までスクロールすると ［用語集で見る］ が見える
        const end = await p.evaluate((sel) => {
          const d = document.querySelector(sel);
          const body = d?.querySelector('.sheet__body');
          const g = d?.querySelector('.info__glossary');
          if (!d || !body || !g) return null;
          body.scrollTop = body.scrollHeight;
          const br = body.getBoundingClientRect();
          const gr = g.getBoundingClientRect();
          return {
            inside: gr.top >= br.top - 0.5 && gr.bottom <= br.bottom + 0.5,
            scroll: body.scrollHeight - body.clientHeight,
            page: document.documentElement.scrollWidth - window.innerWidth,
          };
        }, OPEN_SHEET);
        if (!end) throw new Error(`${label}: シートの中身が無い`);
        if (!end.inside)
          throw new Error(`${label}: 最後までスクロールしても ［用語集で見る］ が見えない`);
        if (end.page > 0) throw new Error(`${label}: 横スクロール ${end.page}px`);
        if (opts.shots && run.w === 390 && run.zoom)
          await p.screenshot({ path: join(opts.shots, '390x844-dark-zoom-sheet-info-end.png') });
        // 中身がスクロールする形（文字の拡大）で下の方のリンクからたどる → 中身は先頭から・見出しは新しい言葉。Esc で戻っても
        // 先頭から（#129 のデザインレビュー a-3）
        if (run.zoom) {
          const bodyTop = () =>
            p.evaluate(
              (sel) => document.querySelector(`${sel} .sheet__body`)?.scrollTop ?? -1,
              OPEN_SHEET,
            );
          const link = p.locator(`${OPEN_SHEET} .sheet__body button.glink`).last();
          await link.scrollIntoViewIfNeeded();
          if ((await bodyTop()) <= 0)
            throw new Error(`${label}: 下の方のリンクで中身がスクロールしていない`);
          await link.click();
          await expectPollAsync(async () => (await sheetTitle(p)) !== '判定', `${label}: たどる`);
          expectEq(await bodyTop(), 0, `${label}: たどった後の中身の位置`);
          await p.locator(`${OPEN_SHEET} .sheet__body`).evaluate((b) => {
            b.scrollTop = b.scrollHeight;
          });
          await p.keyboard.press('Escape');
          await expectPollAsync(
            async () => (await sheetTitle(p)) === '判定',
            `${label}: Esc で戻る`,
          );
          expectEq(await bodyTop(), 0, `${label}: 戻った後の中身の位置`);
        }
        // 安全域: シートの押せるものが上 47・下 34 の内側
        if (run.safe) {
          const bad = await p.evaluate((sel) => {
            const d = document.querySelector(sel);
            const vh = window.innerHeight;
            const out = [];
            for (const el of d?.querySelectorAll('button, a') ?? []) {
              const b = el.getBoundingClientRect();
              if (b.width === 0 || b.height === 0) continue;
              const body = el.closest('.sheet__body')?.getBoundingClientRect();
              // 中のスクロールで隠れている物は見ない（見えている物だけ）
              if (body && (b.bottom <= body.top || b.top >= body.bottom)) continue;
              if (b.top < 47 - 0.5 || b.bottom > vh - 34 + 0.5)
                out.push(
                  `${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 10)} ${Math.round(b.top)}〜${Math.round(b.bottom)}`,
                );
            }
            return out;
          }, OPEN_SHEET);
          if (bad.length > 0) throw new Error(`${label}: 安全域に掛かる ${bad.join(' / ')}`);
        }
        // フォーカスを閉じ込める: Tab を 12 回押しても外の要素へ移らない
        const seen = new Set();
        for (let i = 0; i < 12; i++) {
          await p.keyboard.press('Tab');
          const f = await p.evaluate((sel) => {
            const d = document.querySelector(sel);
            const a = document.activeElement;
            if (!a || a === document.body) return { where: 'body', name: '' };
            return {
              where: d?.contains(a) ? 'inside' : 'outside',
              name: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 12),
            };
          }, OPEN_SHEET);
          if (f.where === 'outside') throw new Error(`${label}: Tab でシートの外（${f.name}）へ`);
          seen.add(f.name);
        }
        for (const want of ['閉じる', '用語集で見る'])
          if (![...seen].some((n) => n.startsWith(want)))
            throw new Error(`${label}: Tab で「${want}」に届かない（${[...seen].join(' / ')}）`);
        // ✕ で閉じたら「i」へ
        await closeSheet(p);
        await expectPollAsync(async () => (await sheetCount(p)) === 0, `${label}: ✕ で閉じる`);
        expectEq(await focusLabel(p), J, `${label}: 閉じた後のフォーカス`);
        expectEq(errors.length, 0, `${label}: ページのエラー`);
        out.push(`${label}（高さ ${Math.round((r.height / r.vh) * 100)}%・中 ${end.scroll}px）`);
      } finally {
        await c.close();
      }
    }
    return `下から・窓の中・最大 86%・中を最後までスクロール・✕ 44・Tab で外へ出ない・閉じたら「i」・安全域の内側（${out.join(' / ')}）`;
  });

  // SH2（#129 AC-4）: 詳細で [削除] → 一覧に「〜を削除しました」+ [元に戻す] → 別の取引の詳細で説明のシートを開いたまま 9 秒 →
  //      トーストは残り DELETE 0 → 閉じてから 8.5 秒で DELETE 1
  await check('SH2', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await p.setViewportSize({ width: 390, height: 844 });
      await p.goto(`${base}/trades/x-d1`);
      await waitReady(p, 'US30 · L');
      await p.locator('canvas.chartview__canvas').nth(1).waitFor();
      await p.getByRole('button', { name: '削除', exact: true }).click();
      await waitReady(p, '取引');
      const toast = p.locator('.toast').filter({ hasText: 'を削除しました' });
      await toast.waitFor();
      await p.locator('a.traderow[href="/trades/x-r1"]').click();
      await waitReady(p, 'US30 · L');
      await p.locator('.ruler__plot').first().waitFor({ timeout: 15000 });
      await openInfo(p, '「判定」の説明');
      await p.waitForTimeout(9000);
      expectEq(await toast.count(), 1, 'シートを開いている間のトースト');
      expectEq(fake.deletes.length, 0, 'シートを開いている間の DELETE');
      await closeSheet(p);
      await expectPollAsync(async () => (await sheetCount(p)) === 0, '✕ で閉じる');
      await p.waitForTimeout(2000);
      expectEq(fake.deletes.length, 0, '閉じて 2 秒の DELETE（8 秒を置き直す）');
      await p.waitForTimeout(6500);
      await expectPollAsync(async () => fake.deletes.length === 1, '閉じて 8.5 秒で DELETE');
      expectEq(fake.deletes.join(' '), 'x-d1', 'DELETE の取引');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '削除のトーストが出ている間に説明のシートを開いて 9 秒: トーストは残り DELETE 0、閉じて 2 秒で 0・8.5 秒で 1（8 秒を置き直す）';
  });

  // SH3（#129 AC-8・9.3）: 形ごとの見せ方を <html data-form> で替える（属性を書くのは U9 #134。ここでは検査が付ける）。
  //      横（844×390・landscape）= 右のパネル（右端・高さいっぱい・幅 400 以下）、広い（1440×900・wide）= 説明は押した「i」の
  //      そばの吹き出し（幅 360 以下・窓の中・「i」との縦のすき間 16px 以下で左右が重なる）、入力のシート（.sheet--form）は中央の
  //      ダイアログ（幅 480 以下・中央）。どちらも同じ dialog の要素のまま
  await check('SH3', async () => {
    const out = [];
    const { c, p, errors } = await recordContext();
    const form = (f) => p.evaluate((v) => document.documentElement.setAttribute('data-form', v), f);
    try {
      // 横: 右のパネル
      await p.setViewportSize({ width: 844, height: 390 });
      await openRecord(p, base);
      await fillRecord(p, EX_E1);
      await p.locator('.verdict .badge', { hasText: 'B 悪い損失' }).waitFor();
      await form('landscape');
      const lr = await openInfo(p, '「判定」の説明');
      if (Math.abs(lr.right - lr.vw) > 1 || lr.top > 0.5 || Math.abs(lr.bottom - lr.vh) > 1)
        throw new Error(
          `横: 右のパネルでない（${Math.round(lr.left)},${Math.round(lr.top)}〜${Math.round(lr.right)},${Math.round(lr.bottom)}）`,
        );
      if (lr.width > 400.5) throw new Error(`横: パネルの幅 ${lr.width}px`);
      if (opts.shots)
        await p.screenshot({ path: join(opts.shots, '844x390-dark-sheet-landscape.png') });
      await closeSheet(p);
      await expectPollAsync(async () => (await sheetCount(p)) === 0, '横: ✕ で閉じる');
      out.push(`横 ${Math.round(lr.width)}×${Math.round(lr.height)} 右端`);
      // 広い: 押した「i」のそばの吹き出し
      await p.setViewportSize({ width: 1440, height: 900 });
      await form('wide');
      const name = '「判定」の説明';
      const wr = await openInfo(p, name);
      const btn = await infoButton(p, name).boundingBox();
      if (!btn) throw new Error('広い: 「i」が無い');
      if (wr.width > 360.5) throw new Error(`広い: 吹き出しの幅 ${wr.width}px`);
      const gap = Math.min(Math.abs(wr.top - (btn.y + btn.height)), Math.abs(btn.y - wr.bottom));
      const overlapX = Math.min(wr.right, btn.x + btn.width) - Math.max(wr.left, btn.x);
      if (gap > 16 || overlapX <= 0)
        throw new Error(
          `広い: 「i」のそばでない（すき間 ${Math.round(gap)}px・左右の重なり ${Math.round(overlapX)}px）`,
        );
      if (opts.shots)
        await p.screenshot({ path: join(opts.shots, '1440x900-dark-sheet-wide-info.png') });
      out.push(`広い 説明 ${Math.round(wr.width)}px・すき間 ${Math.round(gap)}px`);
      // 広い: 入力のシートは中央のダイアログ（同じ要素のクラスを替えて見る）
      const fr = await p.evaluate(() => {
        const d = document.querySelector('dialog.sheet[open]');
        if (!d) return null;
        d.classList.replace('sheet--info', 'sheet--form');
        const r = d.getBoundingClientRect();
        const res = {
          w: r.width,
          cx: (r.left + r.right) / 2,
          cy: (r.top + r.bottom) / 2,
          vw: document.documentElement.clientWidth,
          vh: window.innerHeight,
          h: r.height,
        };
        d.classList.replace('sheet--form', 'sheet--info');
        return res;
      });
      if (!fr) throw new Error('広い: シートが無い');
      if (fr.w > 480.5 || Math.abs(fr.cx - fr.vw / 2) > 1 || Math.abs(fr.cy - fr.vh / 2) > 1)
        throw new Error(`広い: 入力のシートが中央でない（幅 ${fr.w}・中心 ${fr.cx},${fr.cy}）`);
      if (fr.h > fr.vh * 0.8 + 1) throw new Error(`広い: 入力のシートの高さ ${fr.h}px`);
      out.push(`広い 入力 ${Math.round(fr.w)}px 中央`);
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await sheetCount(p)) === 0, '広い: Esc で閉じる');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return `data-form で見せ方を替える（${out.join(' / ')}）`;
  });

  // GL1（#57 オーナーの要望）: 「i」の中の用語集のリンクを 3 段たどり、戻るで 1 つずつ前の説明へ戻り、最後に吹き出しが閉じて
  // 記録する画面のまま。もう一度戻ると前の画面。[‹ 前の説明] と Esc でも 1 つずつ戻る。「用語集で見る」で用語集の画面のその項目へ
  await check('GL1', async () => {
    const { c, p, errors } = await recordContext();
    const J = '「判定」の説明';
    // シートの見出し（「i」の言葉そのものを見ている間は「判定」。#129）
    const title = () => sheetTitle(p);
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/`);
      await waitReady(p, 'ホーム');
      await p.locator('.appnav a[href="/record"]').click();
      await waitReady(p, '記録する');
      await p.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
      await fillRecord(p, EX_E1);
      await p.locator('.verdict .badge', { hasText: 'B 悪い損失' }).waitFor();
      const len = () => p.evaluate(() => history.length);
      const base0 = await len();
      await openInfo(p, J);
      await followLink(p, 'LC', 'LC');
      await followLink(p, '1R', '1R');
      await followLink(p, 'R', 'R');
      await expectPollAsync(async () => (await len()) === base0 + 4, '履歴に 4 段（「i」+ 3 つ）');
      if (opts.shots) await p.screenshot({ path: join(opts.shots, '360x780-dark-gl1-depth3.png') });
      for (const want of ['1R', 'LC']) {
        await p.goBack();
        await expectPollAsync(async () => (await title()) === want, `戻るで「${want}」`);
      }
      await p.goBack();
      await expectPollAsync(
        async () => (await popCount(p)) === 1 && (await title()) === '判定',
        '戻るで「判定」',
      );
      await p.goBack();
      await expectPollAsync(async () => (await popCount(p)) === 0, '最後の戻るで閉じる');
      expectEq(new URL(p.url()).pathname, '/record', '閉じた後の URL');
      expectEq(await p.locator('#record-entry').inputValue(), '100.00', '下書き');
      await p.goBack();
      await waitReady(p, 'ホーム');
      await p.goForward();
      await waitReady(p, '記録する');
      await p.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
      // [‹ 前の説明] と Esc でも 1 つずつ
      await openInfo(p, J);
      await followLink(p, 'LC', 'LC');
      await followLink(p, '根拠が崩れる条件', '根拠が崩れる条件');
      await p.locator(`${OPEN_SHEET} .info__up`).click();
      await expectPollAsync(async () => (await title()) === 'LC', '[‹ 前の説明] で LC');
      await p.keyboard.press('Escape');
      await expectPollAsync(
        async () => (await popCount(p)) === 1 && (await title()) === '判定',
        'Esc で「判定」',
      );
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await popCount(p)) === 0, 'Esc で閉じる');
      // 2 段たどってから操作をはさまずに Esc を続けて 2 回 → 1 段ずつ戻って「判定」（close watcher の 2 回目でシートごと
      // 閉じない。#129 のレビュー N1）→ もう 1 回で閉じる
      await openInfo(p, J);
      await followLink(p, 'LC', 'LC');
      await followLink(p, '1R', '1R');
      await p.keyboard.press('Escape');
      await p.keyboard.press('Escape');
      await expectPollAsync(
        async () => (await popCount(p)) === 1 && (await title()) === '判定',
        'Esc を続けて 2 回で「判定」',
      );
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await popCount(p)) === 0, 'Esc の 3 回目で閉じる');
      await p.waitForTimeout(250);
      await p.goBack();
      await waitReady(p, 'ホーム');
      await p.goForward();
      await waitReady(p, '記録する');
      await p.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
      // 記録する画面でも「用語集で見る」を出す（書きかけは画面を移っても残る。#75 R9。移って戻るは DR1）
      await openInfo(p, '「時間足を変えたか」の説明');
      expectEq(
        await p.locator(`${OPEN_SHEET} .info__glossary`).count(),
        1,
        '記録する画面の「用語集で見る」',
      );
      await p.keyboard.press('Escape');
      // 取引の詳細から「用語集で見る」→ 用語集の画面のその項目 → 戻るで詳細（元の項目は auto のまま）
      await fillRecord(p, EX_E1);
      await p.locator('#record-submit').click();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('main a[href^="/trades/"]').first().click();
      await waitDetail(p);
      await openInfo(p, '「時間足を変えたか」の説明');
      await p.locator(`${OPEN_SHEET} .info__glossary`).click();
      await waitReady(p, '用語集');
      expectEq(new URL(p.url()).hash, '#glossary-timeframeChange', '用語集の項目');
      await p.waitForTimeout(300);
      const seen = await p.evaluate(() => {
        const r = document.getElementById('glossary-timeframeChange')?.getBoundingClientRect();
        return r ? r.top >= 0 && r.top < window.innerHeight / 2 : false;
      });
      expectEq(seen, true, '用語集の項目が見える');
      await p.goBack();
      await waitDetail(p);
      await p.waitForTimeout(300);
      expectEq(
        await p.evaluate(() => history.scrollRestoration),
        'auto',
        '「用語集で見る」から戻った後の scrollRestoration',
      );
      // 「用語集で見る」→ 用語集の中で 2 回たどる → 上の「‹ 取引の詳細」で 1 回で詳細へ（たどった段を飛ばす）
      await openInfo(p, '「時間足を変えたか」の説明');
      await p.locator(`${OPEN_SHEET} .info__glossary`).click();
      await waitReady(p, '用語集');
      await p.locator('#glossary-timeframeChange a.glink', { hasText: '時間足' }).first().click();
      await expectPollAsync(
        async () => new URL(p.url()).hash === '#glossary-timeframe',
        '時間足へ',
      );
      await p.locator('#glossary-timeframe a.glink').first().click();
      await expectPollAsync(
        async () => new URL(p.url()).hash === '#glossary-timeframeChange',
        '時間足を変えたかへ',
      );
      // シートの閉じる動きが終わり、移った先の窓にシートが残っていない（#129 のデザインレビュー a-1）
      await expectNoSheetShown(p, '用語集へ移った後');
      if (opts.shots)
        await p.screenshot({ path: join(opts.shots, '360x780-dark-glossary-from.png') });
      await p.locator('button.appbar__back', { hasText: '取引の詳細' }).click();
      await waitDetail(p);
      expectEq(new URL(p.url()).pathname.startsWith('/trades/'), true, '‹ 取引の詳細 の行き先');
      // 説明のシートから用語集へ移った後に下のタブを替えて戻る → ホーム（層の段を巻き戻してから積む。#129 のレビュー N6）
      await openInfo(p, '「時間足を変えたか」の説明');
      await p.locator(`${OPEN_SHEET} .info__glossary`).click();
      await waitReady(p, '用語集');
      await p.locator('nav a[href="/settings"]').click();
      await waitReady(p, '設定');
      await p.evaluate(() => history.back());
      await waitReady(p, 'ホーム');
      expectEq(new URL(p.url()).pathname, '/', '用語集から設定のタブ → 戻る');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '判定 → LC → 1R → R と 3 段たどる（履歴 +4）→ 戻るで 1R → LC → 判定 → 閉じる（記録する画面・下書きのまま）→ 次の戻るでホーム。[‹ 前の説明]・Esc でも 1 つずつ。記録する画面にも「用語集で見る」がある。詳細の「用語集で見る」で用語集の項目 → 戻るで詳細（auto）、用語集の中で 2 回たどってから「‹ 取引の詳細」で 1 回で詳細';
  });

  // DR1（#75）: 記録する画面の書きかけ。入力 → 「用語集で見る」で用語集へ（「記録の入力は残っています」）→ 戻ると同じ値。
  // [キャンセル] は見出しの右・360 で横スクロール 0・当たり 44 以上。押すと前の画面（一覧）+「記録の入力を破棄しました」と
  // [元に戻す]（フォーカス）→ 押すと記録する画面に同じ値。入力が無い [キャンセル] はトーストなしで一覧へ。
  // 入力がある間の再読み込みだけブラウザの確認（beforeunload）
  await check('DR1', async () => {
    const { c, p, errors } = await recordContext();
    const toast = (t) => p.locator('.toast', { hasText: t });
    const cancel = p.locator('.appbar--sheet button[aria-label="キャンセル"]');
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('.appnav a[href="/record"]').click();
      await waitReady(p, '記録する');
      await p.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
      await p.locator('#record-entry').fill('100.5');
      // キャンセルは全画面のシートの左上の ✕（読み上げの名前「キャンセル」。下の帯は 1 段・文 1 行のまま。#127・#33）・
      // 横スクロール・当たり
      const bar = await p.evaluate(() => {
        const cancelBtn = document.querySelector('.appbar--sheet button[aria-label="キャンセル"]');
        const cr = cancelBtn?.getBoundingClientRect();
        return {
          inHead: !!cancelBtn?.closest('.appbar__start'),
          inBar: !!document.querySelector('.record__submit button[aria-label*="キャンセル"]'),
          left: cr ? cr.left : 999,
          top: cr ? cr.top : 999,
          h: cr ? Math.min(cr.height, cr.width) : 0,
          over: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      expectEq(bar.inHead && !bar.inBar, true, '✕ は上の帯の左');
      expectEq(bar.left < 60 && bar.top < 60, true, '✕ は左上');
      expectEq(bar.h >= 44, true, '✕ の当たり 44 以上');
      expectEq(bar.over <= 0, true, '360 の横スクロール 0');
      if (opts.shots) await p.screenshot({ path: join(opts.shots, '360x780-dark-dr1-bar.png') });
      // 「用語集で見る」で移って戻る → 書きかけが残る
      await openInfo(p, '「時間足を変えたか」の説明');
      await p.locator(`${OPEN_SHEET} .info__glossary`).click();
      await waitReady(p, '用語集');
      await toast('記録の入力は残っています').waitFor({ timeout: 5000 });
      if (opts.shots) await p.screenshot({ path: join(opts.shots, '360x780-dark-dr1-kept.png') });
      await p.goBack();
      await waitReady(p, '記録する');
      await p.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
      expectEq(await p.locator('#record-entry').inputValue(), '100.5', '戻った後の下書き');
      // 記録している間は下のタブを隠す（下の帯は 1 段。#127・A2。今いる画面のナビを押す #75 B1 は routes.test.ts）
      expectEq(await p.locator('nav.appnav').isVisible(), false, '記録している間の下のタブ');
      expectEq(await p.locator('#record-entry').inputValue(), '100.5', '戻った後の下書き（2）');
      // [キャンセル] → 一覧 + 破棄のトースト・[元に戻す] にフォーカス → 押すと同じ値
      await cancel.click();
      await waitReady(p, '取引');
      await toast('記録の入力を破棄しました').waitFor({ timeout: 5000 });
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'toast-draft-undo',
        '[元に戻す] にフォーカス',
      );
      if (opts.shots)
        await p.screenshot({ path: join(opts.shots, '360x780-dark-dr1-discarded.png') });
      await p.locator('#toast-draft-undo').click();
      await waitReady(p, '記録する');
      await p.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
      expectEq(await p.locator('#record-entry').inputValue(), '100.5', '[元に戻す] の後の下書き');
      // 再読み込みは確認（beforeunload）を受けて進む
      const before = dialogsSeen.filter((t) => t === 'beforeunload').length;
      await p.reload();
      await waitReady(p, '記録する');
      expectEq(
        dialogsSeen.filter((t) => t === 'beforeunload').length,
        before + 1,
        '入力がある再読み込みの確認',
      );
      // 再読み込みで書きかけは消える（記憶の中だけ）→ 入力が無い [キャンセル] はトーストなしで前の画面（一覧）
      await p.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
      expectEq(await p.locator('#record-entry').inputValue(), '', '再読み込みの後');
      await cancel.click();
      await waitReady(p, '取引');
      expectEq(await p.locator('.toast').count(), 0, '入力が無いキャンセルのトースト');
      // URL を直接開いた記録する画面（アプリの中の前の画面が無い）の [キャンセル] はホームへ置き換える
      await p.goto(`${base}/record`);
      await waitReady(p, '記録する');
      await p.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
      await cancel.click();
      await waitReady(p, 'ホーム');
      expectEq(await p.locator('.toast').count(), 0, '入力が無いキャンセルのトースト');
      const quiet = dialogsSeen.filter((t) => t === 'beforeunload').length;
      await p.reload();
      await waitReady(p, 'ホーム');
      expectEq(
        dialogsSeen.filter((t) => t === 'beforeunload').length,
        quiet,
        '入力が無い再読み込み',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '入力 → 用語集へ（残っています）→ 戻ると同じ値。キャンセルは左上の ✕・当たり 44 以上・360 で横スクロール 0・下のタブを隠す。押すと一覧 + 破棄のトースト（[元に戻す] にフォーカス）→ [元に戻す] で同じ値。入力がある再読み込みだけ beforeunload の確認、入力が無い [キャンセル] はトーストなしで一覧・URL を直接開いたときはホーム';
  });

  // DR2（#75 レビュー後）: 書きかけの知らせと戻った後の画面を 360 / 1440 × ダーク / ライトで測って撮る。記録: 入力して離れる
  // （「残っています」・［＋ 記録］ の印の点）→ 戻る（見出しの下の「前の入力の続きです」）→ 左上の ✕（破棄のトースト。どの幅でも
  // 下の帯には置かない）→ 入力の無い ✕（トーストなし）。離れるのは幅 720 未満は戻る（下のタブは隠れている）、それ以上は取引の
  // タブ（#127）。編集: 変更して離れる（取引の名前つきの「残っています」）→ 詳細の [編集] の印の点 → 戻る（「前の変更の続きです」）
  // → ✕（破棄のトースト）
  await check('DR2', async () => {
    const out = [];
    for (const theme of THEMES)
      for (const [w, hgt] of [
        [360, 780],
        [1440, 900],
      ]) {
        const c = await browser.newContext({
          viewport: { width: w, height: hgt },
          storageState: signedIn,
        });
        try {
          await setupContext(c, theme);
          await installFakeApi(c);
          const p = await c.newPage();
          const errors = [];
          p.on('pageerror', (e) => errors.push(e.message));
          const toast = (t) => p.locator('.toast', { hasText: t });
          const shot = async (name) => {
            const over = await p.evaluate(
              () => document.documentElement.scrollWidth - window.innerWidth,
            );
            expectEq(over <= 0, true, `${w} ${theme} ${name} の横スクロール`);
            if (opts.shots)
              await p.screenshot({
                path: join(opts.shots, `${w}x${hgt}-${theme}-dr2-${name}.png`),
              });
          };
          await p.goto(`${base}/trades`);
          await waitReady(p, '取引');
          await p.locator('.appnav a[href="/record"]').click();
          await waitReady(p, '記録する');
          await p.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
          await p.locator('#record-entry').fill('100.5');
          // 離れる: 幅 720 未満は下のタブが隠れているので戻る、それ以上は取引のタブ（同じタブの押し直し = 根へ。#127）
          if (w >= 720) await p.locator('.appnav a[href="/trades"]').click();
          else await p.goBack();
          await waitReady(p, '取引');
          await toast('記録の入力は残っています').waitFor({ timeout: 5000 });
          expectEq(
            await p.locator('.appnav a[href="/record"] .draftdot').count(),
            1,
            'ナビの印の点',
          );
          // トーストは浮いた ［＋ 記録］ に重ならない（#127 デザイン a1）
          if (w < 720) {
            const over = await p.evaluate(() => {
              const t = document.querySelector('.toast')?.getBoundingClientRect();
              const f = document.querySelector('.appnav__fab')?.getBoundingClientRect();
              return t && f ? Math.max(0, t.bottom - f.top) : -1;
            });
            expectEq(over, 0, 'トーストと ［＋ 記録］ の重なり（px）');
          }
          await shot('kept');
          await p.locator('.appnav a[href="/record"]').click();
          await waitReady(p, '記録する');
          // 幅 720 以上は記録している間も行き先が見える: 今いる画面の ［＋ 記録］ を押すと履歴を積まず、見出しへフォーカス
          // （#75 B1・R6。#127 のレビュー N10）
          if (w >= 720) {
            await p.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
            const len = await p.evaluate(() => history.length);
            await p.locator('.appnav a[href="/record"]').click();
            await expectPollAsync(
              async () => (await p.evaluate(() => document.activeElement?.tagName)) === 'H1',
              '今いる画面の ［＋ 記録］ で見出しへフォーカス',
            );
            expectEq(
              await p.evaluate(() => history.length),
              len,
              '今いる画面の ［＋ 記録］ で履歴を積まない',
            );
          }
          await p
            .locator('#record-resumed', { hasText: '前の入力の続きです' })
            .waitFor({ timeout: 5000 });
          expectEq(await p.locator('#record-entry').inputValue(), '100.5', '戻った後の下書き');
          expectEq(
            await p.locator('.appnav a[href="/record"] .draftdot').count(),
            0,
            '戻った後の印',
          );
          // キャンセルはどの幅でも左上の ✕ だけ（下の帯に置かない。#127）
          expectEq(
            await p.locator('.appbar--sheet button[aria-label="キャンセル"]').isVisible(),
            true,
            '左上の ✕',
          );
          expectEq(
            await p.locator('.record__submit button[aria-label*="キャンセル"]').count(),
            0,
            '下の帯のキャンセル',
          );
          await shot('restored');
          await p.locator('.appbar--sheet button[aria-label="キャンセル"]').click();
          await waitReady(p, '取引');
          await toast('記録の入力を破棄しました').waitFor({ timeout: 5000 });
          await shot('discarded');
          await p.locator('.toast button[aria-label="通知を閉じる"]').first().click();
          await p.locator('.appnav a[href="/record"]').click();
          await waitReady(p, '記録する');
          await p.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
          expectEq(await p.locator('#record-resumed').count(), 0, '捨てた後は続きの 1 行なし');
          await p.locator('.appbar--sheet button[aria-label="キャンセル"]').click();
          await waitReady(p, '取引');
          await p.waitForTimeout(200);
          expectEq(await p.locator('.toast').count(), 0, '入力の無い [キャンセル] のトースト');
          await shot('empty-cancel');
          // 編集
          await p.goto(`${base}/trades/x-e1`);
          await waitReady(p, '取引の詳細');
          await p.locator('a[href="/trades/x-e1/edit"]').click();
          await waitReady(p, '取引を編集');
          await p.locator('#edit-submit').waitFor({ state: 'visible', timeout: 15000 });
          const ex = await p.locator('#record-exit').inputValue();
          await p.locator('#record-exit').fill(`${ex}1`);
          // 離れる: 幅 720 未満は戻る（詳細へ）、それ以上は取引のタブ（根の一覧へ）→ 行を押して詳細へ（#127）
          if (w >= 720) {
            await p.locator('.appnav a[href="/trades"]').click();
            await waitReady(p, '取引');
          } else {
            await p.goBack();
            await waitReady(p, '取引の詳細');
          }
          await toast('の編集の変更は残っています').waitFor({ timeout: 5000 });
          await shot('edit-kept');
          if (w >= 720) {
            await p.locator('a.traderow[href="/trades/x-e1"]').click();
            await waitReady(p, '取引の詳細');
          }
          // 印は離れた画面（編集）の後始末で付くので、出るのを待つ
          await p
            .locator('a[href="/trades/x-e1/edit"] .draftdot')
            .waitFor({ state: 'attached', timeout: 5000 });
          expectEq(
            await p.locator('a[href="/trades/x-e1/edit"] .draftdot').count(),
            1,
            '[編集] の印の点',
          );
          await shot('detail-dot');
          await p.locator('a[href="/trades/x-e1/edit"]').click();
          await waitReady(p, '取引を編集');
          await p
            .locator('.draft__resumed', { hasText: '前の変更の続きです' })
            .waitFor({ timeout: 5000 });
          expectEq(await p.locator('#record-exit').inputValue(), `${ex}1`, '戻った後の編集');
          await p.locator('.appbar--sheet button[aria-label="キャンセル"]').click();
          await waitReady(p, '取引の詳細');
          await toast('の編集の変更を破棄しました').waitFor({ timeout: 5000 });
          await shot('edit-discarded');
          expectEq(errors.length, 0, 'ページのエラー');
          out.push(`${w}-${theme}`);
        } finally {
          await c.close();
        }
      }
    // N6: 入力したままログアウト → ログイン → 記録する画面は既定（書きかけは捨てる・印も無い）
    const { c, p, errors } = await recordContext();
    try {
      await p.goto(`${base}/record`);
      await waitReady(p, '記録する');
      await p.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
      // 押して入れる（利用者の操作で履歴の組み直しが書かれる。#127）
      await p.locator('#record-entry').click();
      await p.locator('#record-entry').fill('100.5');
      // 記録している間は下のタブが隠れているので、戻る（ホーム）から設定のタブへ（#127）
      await p.goBack();
      await waitReady(p, 'ホーム');
      await p.locator('.appnav a[href="/settings"]').click();
      await waitReady(p, '設定');
      expectEq(
        await p.locator('.appnav a[href="/record"] .draftdot').count(),
        1,
        'ログアウト前の印',
      );
      await p.getByRole('button', { name: 'ログアウト' }).click();
      await waitReady(p, 'ログイン');
      await loginViaPopup(p);
      await waitReady(p, 'ホーム');
      expectEq(
        await p.locator('.appnav a[href="/record"] .draftdot').count(),
        0,
        'ログインの後の印',
      );
      // 設定のタブでログアウトした後のログイン: ホームのタブが選ばれ、履歴はホームの 1 段（#127 のレビュー B2）
      expectEq(
        await p.locator('.appnav a[aria-current="page"]').getAttribute('href'),
        '/',
        'ログインの後に選ばれたタブ',
      );
      await p.locator('.appnav a[href="/record"]').click();
      await waitReady(p, '記録する');
      await p.locator('#record-entry').waitFor({ state: 'visible', timeout: 15000 });
      expectEq(await p.locator('#record-entry').inputValue(), '', 'ログインの後の下書き');
      expectEq(await p.locator('#record-resumed').count(), 0, 'ログインの後の続きの 1 行');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return `${out.join('・')}: 残っています（［＋ 記録］ の点）→ 戻る（続きの 1 行・キャンセルは左上の ✕ だけ）→ 破棄 → 入力なしの ✕ はトーストなし。編集: 取引の名前つきの残っています → 詳細の [編集] の点 → 続きの 1 行 → 破棄。入力したままログアウト → ログイン → 既定の下書き`;
  });

  // GL2（#76）: 用語集の画面。設定から開く・文の中の言葉で 3 回たどり、戻るで 1 つずつ前の項目・最後に設定へ。
  // 360 / 1440 × 両テーマで横スクロール 0・当たり<44 0 件（文の中のリンクは例外）・はみ出し 0
  await check('GL2', async () => {
    const out = [];
    for (const theme of THEMES)
      for (const [w, h] of [
        [360, 780],
        [1440, 900],
      ]) {
        const { c, p, errors } = await recordContext();
        try {
          await setupContext(c, theme);
          await p.setViewportSize({ width: w, height: h });
          await openSettings(p, base);
          await p.getByRole('link', { name: '用語集を開く' }).click();
          await waitReady(p, '用語集');
          const m = await measure(p, w === 360, TAP);
          if (m.h > 0) throw new Error(`${theme} ${w}: 横スクロール ${m.h}px`);
          if (m.small.length > 0)
            throw new Error(`${theme} ${w}: 当たり<44 ${m.small.join(' / ')}`);
          if (m.clipped.length > 0)
            throw new Error(`${theme} ${w}: はみ出し ${m.clipped.join(' / ')}`);
          if (opts.shots)
            await p.screenshot({ path: join(opts.shots, `${w}x${h}-${theme}-glossary.png`) });
          const hash = () => new URL(p.url()).hash;
          await p.locator('#glossary-judgment a.glink', { hasText: 'LC' }).first().click();
          await expectPollAsync(async () => hash() === '#glossary-lc', 'LC へ');
          await p.locator('#glossary-lc a.glink', { hasText: '1R' }).first().click();
          await expectPollAsync(async () => hash() === '#glossary-oneR', '1R へ');
          await p.locator('#glossary-oneR a.glink', { hasText: 'R' }).first().click();
          await expectPollAsync(async () => hash() === '#glossary-r', 'R へ');
          if (opts.shots && w === 360)
            await p.screenshot({ path: join(opts.shots, `${w}x${h}-${theme}-glossary-r.png`) });
          for (const want of ['#glossary-oneR', '#glossary-lc', '']) {
            await p.goBack();
            await expectPollAsync(async () => hash() === want, `戻るで ${want || '先頭'}`);
          }
          expectEq(new URL(p.url()).pathname, '/glossary', '用語集のまま');
          await p.goBack();
          await waitReady(p, '設定');
          expectEq(errors.length, 0, 'ページのエラー');
          out.push(`${theme} ${w}`);
        } finally {
          await c.close();
        }
      }
    return `設定 → 用語集（横 0・当たり<44 0・はみ出し 0）→ 判定 → LC → 1R → R → 戻るで 1R → LC → 先頭 → 設定（${out.join(' / ')}）`;
  });

  // RP1（#57 再レビュー 3 の B3・N14）: 「i」を開いて閉じた直後（積んだ段を戻している途中）に画面を置き換える操作（[消す] = 一覧へ・
  // [保存] = 詳細へ）で移っても、戻るで消した取引・保存し終えた編集の画面へ戻らない（積んだ段を戻してから置き換える）。説明のシートは
  // モーダルで、開いている間は後ろを押せない（#129）ので、Esc で閉じてキーで押す・✕ で閉じて速くクリックするの両方
  await check('RP1', async () => {
    const out = [];
    for (const how of ['key', 'click']) {
      const { c, p, errors } = await recordContext();
      try {
        await p.setViewportSize({ width: 360, height: 780 });
        await openRecord(p, base);
        await fillRecord(p, EX_E1);
        await p.locator('#record-submit').click();
        await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
        await p.goto(`${base}/trades`);
        await waitReady(p, '取引');
        await p.locator('main a[href^="/trades/"]').first().click();
        await p.locator('.verdict').first().waitFor({ timeout: 15000 });
        const detail = new URL(p.url()).pathname;
        // 保存: 詳細 → 編集 →「i」を開いたまま [保存] → 詳細 → 戻る → 詳細（編集の画面ではない）
        await p.locator(`main a[href="${detail}/edit"]`).first().click();
        await waitReady(p, '取引を編集');
        await openInfo(p, '「LC を動かしたか」の説明');
        const save = p.locator('#edit-submit');
        if (how === 'key') {
          await p.keyboard.press('Escape');
          await expectPollAsync(async () => (await popCount(p)) === 0, 'Esc で閉じる');
          await save.focus();
          await p.keyboard.press('Enter');
        } else {
          await closeSheet(p);
          await save.click();
        }
        // 詳細の見出しは取引の名前（読み込み中だけ「取引の詳細」）なので、URL と判定の枠で着いたことを見る
        await expectPollAsync(async () => new URL(p.url()).pathname === detail, '保存の後に詳細へ');
        await p.locator('.verdict').first().waitFor({ timeout: 15000 });
        // 保存の後は前の画面（詳細）へ戻る（9.7 の 6・#127。置き換えではないので、次の戻るは詳細の前 = 一覧。編集の画面へ戻らない）
        await p.goBack();
        await p.waitForTimeout(500);
        expectEq(
          new URL(p.url()).pathname,
          '/trades',
          `${how}: 保存の後の戻る（編集の画面へ戻らない）`,
        );
        // 削除: 詳細で「i」を開いたまま [消す] → 一覧 → 戻る → 一覧より前（消した取引の詳細ではない）
        await p.goto(`${base}${detail}`);
        await p.locator('.verdict').first().waitFor({ timeout: 15000 });
        await openInfo(p, '「判定」の説明');
        const del = p.getByRole('button', { name: '削除', exact: true });
        if (how === 'key') {
          await p.keyboard.press('Escape');
          await expectPollAsync(async () => (await popCount(p)) === 0, 'Esc で閉じる');
          await del.focus();
          await p.keyboard.press('Enter');
        } else {
          await closeSheet(p);
          await del.click();
        }
        await waitReady(p, '取引');
        await p.goBack();
        await p.waitForTimeout(500);
        const back = new URL(p.url()).pathname;
        if (back === detail)
          throw new Error(`${how}: 削除の後の戻るで消した取引（${back}）へ戻った`);
        expectEq(errors.length, 0, 'ページのエラー');
        out.push(`${how}: 保存の後の戻る = 一覧（編集へ戻らない）・削除の後の戻る = ${back}`);
      } finally {
        await c.close();
      }
    }
    return `「i」を開いて閉じた直後に置き換える（${out.join(' / ')}）`;
  });

  // DI1（#57 デザインレビューの撮れていなかった状態・レビュー N4）: 取引の詳細（物差し・タップの答えの札の「i」）と編集の画面の
  // 「i」を開き、説明のシートが窓に収まる。幅 320 の物差しの「i」のシートが縦長にならない（幅 200px 以上）
  await check('DI1', async () => {
    const out = [];
    for (const theme of THEMES)
      for (const [w, h] of [
        [320, 700],
        [360, 780],
        [1440, 900],
      ]) {
        const { c, p, errors } = await recordContext();
        try {
          await setupContext(c, theme);
          await p.setViewportSize({ width: w, height: h });
          await openRecord(p, base);
          await fillRecord(p, EX_E1);
          await p.locator('#record-submit').click();
          await p
            .getByRole('status')
            .filter({ hasText: '記録しました' })
            .waitFor({ timeout: 10000 });
          await p.goto(`${base}/trades`);
          await waitReady(p, '取引');
          await p.locator('main a[href^="/trades/"]').first().click();
          await waitDetail(p);
          const rr = await openInfo(p, '「LC の物差し」の説明');
          const width = Math.round(rr.right - rr.left);
          if (width < 200) throw new Error(`${theme} ${w}: 物差しの説明のシートの幅 ${width}px`);
          if (opts.shots && w !== 320)
            await p.screenshot({
              path: join(opts.shots, `${w}x${h}-${theme}-detail-info-ruler.png`),
            });
          // 開いている間は後ろを押せないので、閉じてから次の「i」を押す
          await p.keyboard.press('Escape');
          await openInfo(p, '「時間足を変えたか」の説明');
          if (opts.shots && w !== 320)
            await p.screenshot({
              path: join(opts.shots, `${w}x${h}-${theme}-detail-info-tap.png`),
            });
          await p.keyboard.press('Escape');
          if (w !== 320) {
            await p.locator('main a[href$="/edit"]').first().click();
            await waitReady(p, '取引を編集');
            await openInfo(p, '「LC を動かしたか」の説明');
            if (opts.shots)
              await p.screenshot({ path: join(opts.shots, `${w}x${h}-${theme}-edit-info.png`) });
          }
          expectEq(errors.length, 0, 'ページのエラー');
          out.push(`${theme} ${w}${w === 320 ? `（物差しのシート ${width}px）` : ''}`);
        } finally {
          await c.close();
        }
      }
    return `詳細の物差し・タップの答えの札・編集の画面の「i」が窓に収まる（${out.join(' / ')}）`;
  });

  // ── 口座（Issue #47 PR-1。ACC1・ACC2・SET5）。幅 360 で、偽の記録の API で流す
  await check('ACC1', async () => {
    const { c, p, fake, errors } = await recordContext({ accounts: ACCOUNTS_2 });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      // 円建ての銘柄（リスク（%）を価格から出せる）
      fake.instruments[0] = { ...FAKE_US30, priceCurrency: 'JPY' };
      await openRecord(p, base);
      await fillRecord(p, EX_E1);
      await p
        .locator('.verdict__account', { hasText: '口座 1 の資金 1,000,000円 に対して' })
        .waitFor();
      const riskOf = () =>
        p.locator('.verdict__stat', { hasText: 'リスク' }).locator('.num').textContent();
      expectEq(await riskOf(), '0.5%', '口座 1 のリスク');
      // 1 タップで口座 B へ → リスク・1 行がその場で変わる（1R 5,000 ÷ 200,000 = 2.5%）
      await seg(p, '口座', '口座 B').click();
      await p
        .locator('.verdict__account', { hasText: '口座 B の資金 200,000円 に対して' })
        .waitFor();
      expectEq(await riskOf(), '2.5%', '口座 B のリスク');
      await p.locator('.reasons__item', { hasText: '過剰リスク（2.5%）' }).waitFor();
      const h = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expectEq(h, 0, '横スクロール');
      await p.locator('#record-submit').click();
      await p
        .getByRole('status')
        .filter({ hasText: '口座 B に記録しました' })
        .waitFor({ timeout: 10000 });
      expectEq(fake.posts.at(-1)?.accountId, 'acc-b', '本文の口座');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '口座 2 つ: Segment の 1 タップで口座 B → リスク 0.5% → 2.5%・過剰リスクの理由・判定の枠の 1 行がその場で変わる、横スクロール 0、「口座 B に記録しました」';
  });

  // ── 通貨と為替（Issue #47 PR-2。FX1）。幅 360 で、USD 建ての銘柄を選ぶと為替の欄が出て、円建てに戻すと消える（AC-21）
  await check('FX1', async () => {
    const { c, p, fake, errors } = await recordContext({ capitalYen: 1000000 });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      fake.instruments[0] = { ...FAKE_US30, priceCurrency: 'JPY' };
      withUsdInstrument(fake);
      await openRecord(p, base);
      await fillFx(p);
      await p.locator('#record-fx').waitFor();
      await p.locator('#record-instrument-hint', { hasText: 'USD 建て' }).waitFor();
      const h1 = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expectEq(h1, 0, '横スクロール（為替の欄あり）');
      await p.locator('#record-fx').fill('150');
      await p.locator('#record-fx-line', { hasText: '1 USD = 150円' }).waitFor();
      // 円建ての銘柄へ戻す → 為替の欄・建ての 1 行が消える（消えた欄の値は本文に入れない）
      await p.locator('#record-instrument').fill('US30');
      await p.locator('#record-fx').waitFor({ state: 'detached' });
      expectEq(await p.locator('#record-instrument-hint').count(), 0, '建ての 1 行');
      const h2 = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expectEq(h2, 0, '横スクロール（為替の欄なし）');
      // 数量を円建ての例に合わせて記録する（本文に為替が無い）
      await p.locator('#record-quantity').fill('10000');
      await p.locator('#record-submit').click();
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor({ timeout: 10000 });
      expectEq(JSON.stringify(fake.posts.at(-1)?.exit?.fxRate), undefined, '本文の為替');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'USD 建てで為替の欄と「USD 建て」が出て、円建てに戻すと消える。横スクロール 0、本文に為替なし';
  });

  await check('ACC2', async () => {
    const { c, p, fake, errors } = await recordContext({ capitalYen: 1000000 });
    const focused = () => p.evaluate(() => document.activeElement?.id ?? '');
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await openRecord(p, base);
      await fillRecord(p, EX_E1, false);
      const before = await p.locator('#record-entry').inputValue();
      // 口座 1 つ: 口座の欄は無く、[＋ 口座を追加] だけ
      expectEq(await p.locator('[role="radiogroup"][aria-label="口座"]').count(), 0, '口座の欄');
      await p.locator('#record-account-add').click();
      await expectPollAsync(
        async () => (await focused()) === 'record-account-new-name',
        '名前の欄へ',
      );
      // Esc で閉じて [＋ 口座を追加] へ戻る
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await focused()) === 'record-account-add', 'Esc の後');
      expectEq(await p.locator('.accountadd').count(), 0, '閉じた欄');
      // もう一度開き、Enter で足す（記録の送信にならない）
      await p.locator('#record-account-add').click();
      await p.locator('#record-account-new-name').fill('口座 C');
      await p.locator('#record-account-new-capital').fill('300,000');
      await p.locator('#record-account-new-capital').press('Enter');
      await p.locator('[role="radiogroup"][aria-label="口座"]').waitFor();
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.getAttribute('name'))) ===
          'record-account',
        '選ばれた口座へ',
      );
      const checked = await p
        .locator('input[name="record-account"]:checked')
        .evaluate((e) => e.closest('label')?.textContent ?? '');
      expectEq(checked.trim(), '口座 C', '選ばれた口座');
      expectEq(fake.posts.length, 0, '記録の送信');
      const post = fake.writes.find((x) => x.key === 'POST /api/accounts');
      expectEq(
        JSON.stringify(post?.body),
        JSON.stringify({ name: '口座 C', capitalYen: 300000 }),
        '足す本文',
      );
      expectEq(await p.locator('#record-entry').inputValue(), before, '入れていた欄');
      expectEq(new URL(p.url()).pathname, '/record', '画面を移らない');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'その場で足す: 開くと名前の欄へ・Esc で閉じて [＋ 口座を追加] へ・Enter で足す（記録しない）→ 口座 C が選ばれた Segment が出てフォーカス、本文は名前と資金だけ、入れていた欄はそのまま';
  });

  // SZ1（#67 AC-8）: 判定の枠の数量と提案の数量の行が、記録する画面・取引の詳細・編集の画面に出て、区切り（「数量 10,000 ·」
  // 「適正の数量 4,000（2.5 倍）」）の中で折れず、幅 360 でも区切りの間でだけ折れ、色が注記と同じ --ink-3（判定の色を使わない）、
  // 数の段の直後、横スクロール 0。場面: 0.5 倍・Z2（2.5 倍）・ちょうど 1.0 倍・Z9（最小の数量でも許容リスクを超える）・2 桁と 3 桁の
  // 比・提案の数量が小数 / 7 桁・1R が出ない（行なし）・エントリー 2 つ（詳細）・編集の画面で口座を付け替え。--shots なら各場面の
  // 判定の枠を 360 ダーク・360 ライト・1440 ダークで撮る。値はすべて架空
  await check('SZ1', async () => {
    /** エントリー 2 つ（100.00 × 5,000・99.80 × 5,000、LC 99.50、円建て）→ 1R 4,000 ÷ 10,000 = 0.4 倍 */
    const TX_Z14 = exampleTrade(
      'x-z14',
      1700000000099,
      {
        entries: [
          { price: 100, quantity: 5000 },
          { price: 99.8, quantity: 5000 },
        ],
        statementPnlYen: -4000,
      },
      { snapshot: { ...SNAP, instrument: { ...SNAP.instrument, priceCurrency: 'JPY' } } },
    );
    const { c, p, fake, errors } = await recordContext({
      accounts: ACCOUNTS_2,
      trades: [fakeTrade('t-last', FAKE_US30.id, 2, 1700000100000), ...EXAMPLE_TRADES, TX_Z14],
    });
    const seen = [];
    /** 数量の行の文字・行の数・区切りごとの行の数・色・横スクロール・数の段の直後か */
    const lineOf = () =>
      p.locator('.verdict__sizing').evaluate((e) => {
        const cs = getComputedStyle(e);
        const probe = document.createElement('span');
        probe.style.color = 'var(--ink-3)';
        document.body.append(probe);
        const ink3 = getComputedStyle(probe).color;
        probe.remove();
        const lh = Number.parseFloat(cs.lineHeight);
        const lines = (el) => Math.round(el.getBoundingClientRect().height / lh);
        return {
          text: e.textContent,
          lines: lines(e),
          // 区切りの中の行の数（区切りは inline-block なので、文字の範囲の行の上端の数で数える。#79）
          segLines: [...e.querySelectorAll('.verdict__seg')].map((s) => {
            const r = document.createRange();
            r.selectNodeContents(s);
            return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
          }),
          ink3: cs.color === ink3,
          h: document.documentElement.scrollWidth - window.innerWidth,
          afterStats: e.previousElementSibling?.classList.contains('verdict__stats') ?? false,
        };
      });
    /** 判定の枠を 360 ダーク・360 ライト・1440 ダークで撮る（--shots のときだけ） */
    const shoot = async (slug) => {
      if (!opts.shots) return;
      const v = p.locator('.verdict');
      await v.scrollIntoViewIfNeeded();
      await v.screenshot({ path: join(opts.shots, `sz1-360-dark-${slug}.png`) });
      await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await v.screenshot({ path: join(opts.shots, `sz1-360-light-${slug}.png`) });
      await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await p.setViewportSize({ width: 1440, height: 900 });
      await v.scrollIntoViewIfNeeded();
      await v.screenshot({ path: join(opts.shots, `sz1-1440-dark-${slug}.png`) });
      await p.setViewportSize({ width: 360, height: 780 });
    };
    const expectLine = async (want, what, slug) => {
      await p.locator('.verdict__sizing', { hasText: want }).waitFor();
      const l = await lineOf();
      expectEq(l.text, want, `${what} の文字`);
      expectEq(
        l.segLines.every((n) => n === 1),
        true,
        `${what} の区切りの中で折れない ${l.segLines}`,
      );
      if (l.lines > l.segLines.length)
        throw new Error(`${what} の行の数 ${l.lines}（区切り ${l.segLines.length}）`);
      expectEq(l.ink3, true, `${what} の色が --ink-3`);
      expectEq(l.h, 0, `${what} の横スクロール`);
      expectEq(l.afterStats, true, `${what} が数の段の直後`);
      seen.push(`${what} ${l.lines} 行`);
      await shoot(slug);
    };
    /** 記録する画面を開き直して、銘柄の値・下書きを入れる */
    const fresh = async (inst) => {
      fake.instruments[0] = { ...FAKE_US30, ...inst };
      await openRecord(p, base);
    };
    const fillAt = async (ex, quantity, account = '口座 1') => {
      await fillRecord(p, ex);
      await p.locator('#record-quantity').fill(quantity);
      await seg(p, '口座', account).click();
    };
    const AT = (entry, lc) => ({ ...EX_SAFE, entry, exit: lc, lc });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      // 円建て・乗数 1。口座 1（1,000,000・1%）: 1R 0.50 × 10,000 = 5,000 → 0.5 倍、提案 20,000
      await fresh({ priceCurrency: 'JPY' });
      await fillRecord(p, EX_E1);
      await expectLine('数量 10,000 · 適正の数量 20,000（実際は 0.5 倍）', '口座 1', 'record-05');
      // Z2: 口座 B（200,000・1%）→ 2.5 倍、10,000 × 2,000 ÷ 5,000 = 4,000
      await seg(p, '口座', '口座 B').click();
      await expectLine('数量 10,000 · 適正の数量 4,000（実際は 2.5 倍）', 'Z2', 'record-z2');
      // ちょうど 1.0 倍: 数量 20,000 → 1R 10,000 ÷ 10,000
      await fresh({ priceCurrency: 'JPY' });
      await fillAt(EX_E1, '20000');
      await expectLine('数量 20,000 · 適正の数量 20,000（実際は 1.0 倍）', '1.0 倍', 'record-z4');
      // 7 桁: 数量 1,234,567・LC 99.99 → 1R 12,345.67 → 1.23… → 1.3 倍、提案 1,234,567 × 10,000 ÷ 12,345.67 = 1,000,000
      await fresh({ priceCurrency: 'JPY' });
      await fillAt(AT('100.00', '99.99'), '1234567');
      await expectLine(
        '数量 1,234,567 · 適正の数量 1,000,000（実際は 1.3 倍）',
        '7 桁',
        'record-7digits',
      );
      // 12 桁（#40 レビュー 4）: 数量 123,456,789,012・イン 100,000・LC 50,000 → 提案 0。1 つの区切りが幅 360 の枠より長いので、
      // 区切りの中で折れてよいが、枠からはみ出さない（横スクロール 0・区切りの右端が行の右端の内側）
      await fresh({ priceCurrency: 'JPY' });
      await fillAt(AT('100000', '50000'), '123456789012');
      {
        const want =
          '数量 123,456,789,012（許容リスクの 617283945060.0 倍） · 最小の数量でも許容リスクを超えます';
        await p.locator('.verdict__sizing', { hasText: want }).waitFor();
        const l = await lineOf();
        expectEq(l.text, want, '12 桁 の文字');
        expectEq(l.h, 0, '12 桁 の横スクロール');
        const over = await p.locator('.verdict__sizing').evaluate((e) => {
          const right = e.getBoundingClientRect().right;
          return [...e.querySelectorAll('.verdict__seg')].map((s) =>
            Math.round(s.getBoundingClientRect().right - right),
          );
        });
        expectEq(
          over.every((d) => d <= 0),
          true,
          `12 桁 の区切りが行からはみ出さない ${over}`,
        );
        seen.push(`12 桁 ${l.lines} 行（はみ出し 0）`);
        await shoot('record-12digits');
      }
      // 小数: 乗数 100,000・刻み 0.01・イン 150.00・LC 149.50・数量 0.37 → 1R 18,500 → 1.85 → 1.9 倍、提案 0.2
      await fresh({ priceCurrency: 'JPY', multiplier: 100000, quantityStep: 0.01 });
      await fillAt(AT('150.00', '149.50'), '0.37');
      await expectLine('数量 0.37 · 適正の数量 0.2（実際は 1.9 倍）', '小数', 'record-decimal');
      // 乗数 100: Z9（イン 38,000・LC 37,600・数量 1 → 1R 40,000 → 4.0 倍、0.25 → 0）
      await fresh({ priceCurrency: 'JPY', multiplier: 100 });
      await fillAt(AT('38000', '37600'), '1');
      await expectLine(
        '数量 1（許容リスクの 4.0 倍） · 最小の数量でも許容リスクを超えます',
        'Z9',
        'record-z9',
      );
      // 2 桁: 数量 12 → 1R 480,000 ÷ 10,000 = 48.0 倍 / 3 桁: 口座 B（許容額 2,000）→ 240.0 倍
      await p.locator('#record-quantity').fill('12');
      await expectLine(
        '数量 12（許容リスクの 48.0 倍） · 最小の数量でも許容リスクを超えます',
        '2 桁',
        'record-48x',
      );
      await seg(p, '口座', '口座 B').click();
      await expectLine(
        '数量 12（許容リスクの 240.0 倍） · 最小の数量でも許容リスクを超えます',
        '3 桁',
        'record-240x',
      );
      // 1R が出ない: 価格の通貨が未設定（為替が要る）で明細の損益も無い → 行を出さない
      await fresh({});
      await fillAt(EX_E1, '10000');
      await p.locator('.verdict .badge').first().waitFor();
      expectEq(await p.locator('.verdict__sizing').count(), 0, '1R が出ないときの行');
      seen.push('1R なし 0 行');
      await shoot('record-no-1r');
      // 詳細（x-d1: 1R = 8,000 × 0.50 ÷ 0.80 = 5,000、資金 1,000,000・1%）と「すべての欄」の 2 行
      await p.goto(`${base}/trades/x-d1`);
      await waitReady(p, 'US30 · L');
      await expectLine('数量 10,000 · 適正の数量 20,000（実際は 0.5 倍）', '詳細', 'detail');
      await p.locator('details.more > summary').click();
      const rows = await p.locator('.fields__row').allTextContents();
      expectEq(
        rows
          .filter((r) => r.startsWith('適正の数量') || r.startsWith('許容リスクに対する数量'))
          .join(' / '),
        '適正の数量20,000 / 許容リスクに対する数量0.5 倍',
        'すべての欄の 2 行',
      );
      if (opts.shots) {
        await p
          .locator('details.more')
          .screenshot({ path: join(opts.shots, 'sz1-360-dark-detail-fields.png') });
      }
      // エントリー 2 つ（詳細）: 数量は合計・比だけ
      await p.goto(`${base}/trades/x-z14`);
      await waitReady(p, 'US30 · L');
      await expectLine('数量 10,000（許容リスクの 0.4 倍）', 'エントリー 2 つ', 'detail-z14');
      // 編集の画面: 口座 B に付け替える → 2.5 倍・適正の数量 4,000
      await p.goto(`${base}/trades/x-d1/edit`);
      await waitReady(p, '取引を編集');
      await expectLine('数量 10,000 · 適正の数量 20,000（実際は 0.5 倍）', '編集の画面', 'edit-a');
      await seg(p, '口座', '口座 B').click();
      await expectLine(
        '数量 10,000 · 適正の数量 4,000（実際は 2.5 倍）',
        '編集の画面の口座 B',
        'edit-b',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return `幅 360: 区切りの中で折れない・--ink-3・数の段の直後・横スクロール 0（${seen.join(' / ')}）。すべての欄の 2 行`;
  });

  await check('SET5', async () => {
    const { c, p, fake, errors } = await recordContext({ accounts: [ACC_ONE, ACC_D] });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await openSettings(p, base);
      await p.locator('#settings-account-add').click();
      await p.locator('#settings-account-name').fill('口座 C');
      await p.locator('#settings-account-save').click();
      await p.getByRole('status').filter({ hasText: '口座 C を追加しました' }).waitFor();
      const names = await p.locator('.instlist__name').allTextContents();
      expectEq(
        names.filter((n) => n.startsWith('口座')).join(' / '),
        '口座 1 / 口座 C / 口座 D',
        '名前の順',
      );
      const added = fake.accounts.find((a) => a.name === '口座 C');
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id)) ===
          `settings-account-edit-${added?.id}`,
        '新しい行の [直す] へ',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '設定で「口座 C」を足す → 名前の順の位置に入り、「口座 C を追加しました」、フォーカスは新しい行の [直す]';
  });

  // ── 取引の一覧・詳細・直す・消す（Issue #9 の例の表 L4・H1・D1・D2・E1・E2・X1・X2）。偽の記録の API で流す
  const rowsOf = (p) =>
    p.locator('a.traderow').evaluateAll((as) =>
      as.map((a) => ({
        href: a.getAttribute('href'),
        badge: a.querySelector('.badge')?.textContent ?? '',
        badgeClass: a.querySelector('.badge')?.className ?? '',
        text: a.textContent ?? '',
      })),
    );
  const verdictOf = (p) =>
    p
      .locator('.verdict')
      .first()
      .evaluate((v) => ({
        badge: v.querySelector('.badge')?.textContent ?? '',
        text: v.textContent ?? '',
        reasons: [...v.querySelectorAll('.reasons__item')].map((li) => li.textContent ?? ''),
      }));
  /** canvas の真ん中に画素がある（描けている）か */
  const drawn = (p) =>
    p.locator('canvas.chartview__canvas').evaluateAll((cs) =>
      cs.map((c) => {
        const d = c.getContext('2d')?.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
        return { label: c.getAttribute('aria-label'), alpha: d ? d[3] : 0 };
      }),
    );
  // 開いている dialog だけ（説明のシートの dialog は閉じたまま置いてある。#129）
  const noDialogs = (p) => p.locator('dialog[open], [role="dialog"], [role="alertdialog"]').count();

  await check('T-L4', async () => {
    const { c, p, errors } = await recordContext({ trades: [TX_L1, TX_L2, TX_L3] });
    try {
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('a.traderow').nth(2).waitFor();
      const rows = await rowsOf(p);
      expectEq(rows.map((r) => r.href).join(' '), '/trades/x-l2 /trades/x-l3 /trades/x-l1', '並び');
      expectEq(rows[0].badge, '計画どおりの勝ち', 'L2 の判定');
      // 出ない値は行では「—」だけ、理由は一覧の下の脚注に 1 回だけ（Issue #9 のデザインレビュー 2・#33 の 4b 指摘 3）
      if (!rows[0].text.includes('+2.0R') || !rows[0].text.endsWith('—'))
        throw new Error(`L2 の行: ${rows[0].text}`);
      expectEq(rows[1].badge, '危ない勝ち', 'L3 の判定');
      if (!rows[1].badgeClass.includes('badge--break')) throw new Error('L3 の段が崩れでない');
      if ((rows[1].text.match(/—/g) ?? []).length !== 2)
        throw new Error(`L3 の行: ${rows[1].text}`);
      const notes = (await p.locator('.tradelist__notes').textContent()) ?? '';
      for (const want of [
        'リスクの「—」: 資金を設定すると表示されます（1 件）',
        'R・リスクの「—」: LC が無いため表示されません（1 件）',
      ]) {
        if (!notes.includes(want)) throw new Error(`一覧の下の理由に「${want}」が無い`);
      }
      expectEq(rows[2].badge, 'A いい損失', 'L1 の判定');
      if (!rows[2].text.includes('−1.0R') || !rows[2].text.includes('0.5%'))
        throw new Error(`L1 の行: ${rows[2].text}`);
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '並び L2 → L3 → L1、各行の判定・R・リスク（出ない値は「—」、理由は一覧の下に 1 回）が例どおり';
  });

  await check('T-H1', async () => {
    const { c, p, errors } = await recordContext({ trades: [...TX_H1].reverse() });
    try {
      await p.goto(`${base}/`);
      await waitReady(p, 'ホーム');
      await p.locator('a.traderow').first().waitFor();
      const rows = await rowsOf(p);
      expectEq(
        rows.map((r) => r.href).join(' '),
        '/trades/x-h0 /trades/x-h1 /trades/x-h2 /trades/x-h3 /trades/x-h4',
        '直近 5 件の並び',
      );
      expectEq(rows[1].badge, '危ない勝ち', '2 件目の判定');
      if (!rows[1].badgeClass.includes('badge--break')) throw new Error('2 件目の段が崩れでない');
      // ホームの中に [記録する] を置かない（下のタブの ［＋ 記録］ の 1 か所。#127）。「すべての取引」の押せる行
      expectEq(await p.locator('main a[href="/record"]').count(), 0, 'ホームの中の [記録する]');
      await p.locator('main a.rowlink[href="/trades"]').first().waitFor();
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'ホームに新しい順の 5 件、2 件目の危ない勝ちは B と同じ崩れの段。[記録する] は下のタブだけ・「すべての取引」は押せる行';
  });

  // ── 一覧のページ分け（Issue #87 の例 #8〜#10・AC-12）。合成の取引 120 件（架空の値）で流す
  const manyTrades = (n) =>
    Array.from({ length: n }, (_, i) => {
      const t = fakeTrade(`p${String(i).padStart(3, '0')}`, FAKE_US30.id, 1, 1600000000000 + i);
      return {
        ...t,
        record: { ...t.record, exit: { ...t.record.exit, time: T_1110 - i * 60000 } },
      };
    });
  const scrollToBottom = (p) =>
    p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const countText = (p) => p.locator('.tradelist-card__count').textContent();

  await check('TL-P1', async () => {
    const { c, p, fake, errors } = await recordContext({ trades: manyTrades(120) });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('a.traderow').nth(49).waitFor();
      expectEq(await p.locator('a.traderow').count(), 50, '最初の行の数');
      expectEq(
        (await countText(p))?.trim(),
        '50 件を表示中（決済の新しい順・続きあり）',
        '最初の件数の文',
      );
      expectEq(fake.tradeGets.join(' | '), 'limit=50', '最初の要求');
      // 末尾へ送ると続きが自動で出る（ボタンを押さない）
      await scrollToBottom(p);
      await p.locator('a.traderow').nth(99).waitFor({ timeout: 5000 });
      await scrollToBottom(p);
      await p.getByText('全 120 件（決済の新しい順）').waitFor({ timeout: 5000 });
      expectEq(await p.locator('a.traderow').count(), 120, '最後の行の数');
      expectEq(await p.locator('.tradelist-more').count(), 0, '最後まで読んだ後の末尾の段');
      expectEq(
        (await p.locator('.tradelist-end').textContent())?.trim(),
        '全 120 件を表示しました',
        '末尾の文',
      );
      expectEq(
        (await p.locator('main [role="status"]').last().textContent())?.trim(),
        '全 120 件を表示しました',
        '読み上げの欄',
      );
      const gets = fake.tradeGets.length;
      expectEq(gets, 3, '一覧の要求の数');
      await scrollToBottom(p);
      await p.waitForTimeout(300);
      expectEq(fake.tradeGets.length, gets, '最後まで読んだ後の要求');
      const overflow = await p.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expectEq(overflow, 0, '幅 360 の横スクロール');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '120 件: 最初 50 行 → 末尾へ送ると 100 → 120 行で「全 120 件」・要求 3 回で止まる・幅 360 で横スクロール 0';
  });

  await check('TL-P2', async () => {
    const { c, p, fake, errors } = await recordContext({ trades: manyTrades(120) });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('a.traderow').nth(49).waitFor();
      await scrollToBottom(p);
      await p.locator('a.traderow').nth(99).waitFor({ timeout: 5000 });
      // 80 行目まで送ってから詳細を開き、戻る
      const row = p.locator('a.traderow').nth(79);
      await row.scrollIntoViewIfNeeded();
      await p.waitForTimeout(200);
      const before = await p.evaluate(() => window.scrollY);
      const rowsBefore = await p.locator('a.traderow').count();
      await row.click();
      await waitReady(p, 'US30 · L');
      fake.tradesPageDelayMs = 1500;
      await p.goBack();
      await waitReady(p, '取引');
      // 読み直しを待たせている間も、読み込み済みの行と位置が出ている
      expectEq(await p.locator('a.traderow').count(), rowsBefore, '戻った直後の行の数');
      const after = await p.evaluate(() => window.scrollY);
      if (Math.abs(after - before) > 4)
        throw new Error(`戻った後の位置 ${after}px（期待 ${before}px）`);
      fake.tradesPageDelayMs = 0;
      await p.waitForTimeout(1800);
      expectEq(await p.locator('a.traderow').count(), rowsBefore, '読み直しの後の行の数');
      expectEq(errors.length, 0, 'ページのエラー');
      return `${rowsBefore} 行まで読んで 80 行目の詳細 → 戻る: ${rowsBefore} 行と位置（${after}px / ${before}px）が保たれ、読み直しの後も同じ`;
    } finally {
      await c.close();
    }
  });

  await check('TL-P3', async () => {
    const { c, p, errors } = await recordContext({ trades: manyTrades(70) });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('a.traderow').nth(49).waitFor();
      // 続きの読みを失敗させる → 50 行は残り、文言と [再読み込み]
      const nextPage = (url) => url.pathname === '/api/trades' && url.searchParams.has('cursor');
      await p.route(nextPage, (r) =>
        r.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"unavailable"}',
        }),
      );
      await scrollToBottom(p);
      await p.getByText('続きを読み込めませんでした。').waitFor({ timeout: 5000 });
      expectEq(await p.locator('a.traderow').count(), 50, '失敗の後の行の数');
      if (opts.shots) {
        await p.screenshot({ path: join(opts.shots, '360x780-trades-more-failed.png') });
      }
      await p.unroute(nextPage);
      await p.getByRole('button', { name: '再読み込み' }).click();
      await p.getByText('全 70 件（決済の新しい順）').waitFor({ timeout: 5000 });
      const overflow = await p.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expectEq(overflow, 0, '幅 360 の横スクロール');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '続きの読みの失敗: 50 行が残り、文言と [再読み込み] → 押すと「全 70 件」・横スクロール 0';
  });

  // TL-P4（#87 のコードレビュー 1・2）: キーで [続きを読み込む] を押すと、読み込み中も同じボタンにフォーカスが残り
  // （aria-busy）、末尾の段の高さが変わらない。最後まで読むとフォーカスは読み足した最初の行へ移る（body に落ちない）
  await check('TL-P4', async () => {
    const { c, p, fake, errors } = await recordContext({ trades: manyTrades(70) });
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('a.traderow').nth(49).waitFor();
      fake.tradesPageDelayMs = 1500;
      const btn = p.locator('#trades-more');
      const h0 = await p
        .locator('.tradelist-more')
        .evaluate((e) => e.getBoundingClientRect().height);
      await btn.focus();
      await p.keyboard.press('Enter');
      await p.locator('#trades-more[aria-busy="true"]').waitFor({ timeout: 3000 });
      expectEq(
        await p.evaluate(() => document.activeElement?.id),
        'trades-more',
        '読み込み中のフォーカス',
      );
      const h1 = await p
        .locator('.tradelist-more')
        .evaluate((e) => e.getBoundingClientRect().height);
      if (Math.abs(h1 - h0) > 0.5) throw new Error(`末尾の段の高さ ${h0}px → ${h1}px`);
      await p.getByText('全 70 件（決済の新しい順）').waitFor({ timeout: 5000 });
      const active = await p.evaluate(() => ({
        tag: document.activeElement?.tagName,
        href: document.activeElement?.getAttribute('href'),
      }));
      expectEq(`${active.tag} ${active.href}`, 'A /trades/p050', '最後まで読んだ後のフォーカス');
      expectEq(errors.length, 0, 'ページのエラー');
      return `Enter → 読み込み中も同じボタンにフォーカス（高さ ${h0}px のまま）→ 最後まで読むと 51 行目へフォーカス`;
    } finally {
      await c.close();
    }
  });

  // TL-P5（#87 のデザインレビュー）: 続きを読んでいる・最後まで読んだ・件数の多い一覧・戻った位置・続きの読みの失敗を
  // 360 / 1440 × ダーク / ライトで測り（横スクロール 0）、--shots なら撮る
  await check('TL-P5', async () => {
    const out = [];
    for (const [w, hgt] of [
      [360, 780],
      [1440, 900],
    ]) {
      for (const theme of THEMES) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: hgt },
          storageState: signedIn,
          ...(w < 720 ? { hasTouch: true } : {}),
        });
        await setupContext(ctx, theme);
        const fake = await installFakeApi(ctx, { trades: manyTrades(120) });
        const p = await ctx.newPage();
        const errors = [];
        p.on('pageerror', (e) => errors.push(e.message));
        const snap = async (slug) => {
          const overflow = await p.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          if (overflow !== 0) throw new Error(`${w} ${theme} ${slug}: 横スクロール ${overflow}px`);
          if (opts.shots) {
            await p.screenshot({
              path: join(opts.shots, `${w}x${hgt}-${theme}-trades-${slug}.png`),
            });
          }
        };
        try {
          await p.goto(`${base}/trades`);
          await waitReady(p, '取引');
          await p.locator('a.traderow').nth(49).waitFor();
          await snap('more-many');
          // 続きを読んでいる（応答を待たせる）
          fake.tradesPageDelayMs = 3000;
          await scrollToBottom(p);
          await p.locator('#trades-more[aria-busy="true"]').waitFor({ timeout: 3000 });
          await p.evaluate(() =>
            document.querySelector('.tradelist-more')?.scrollIntoView({ block: 'end' }),
          );
          await snap('more-loading');
          fake.tradesPageDelayMs = 0;
          await p.locator('a.traderow').nth(99).waitFor({ timeout: 6000 });
          await scrollToBottom(p);
          await p.locator('.tradelist-end').waitFor({ timeout: 5000 });
          await scrollToBottom(p);
          await p.waitForTimeout(200);
          await snap('more-end');
          // 80 行目の詳細から戻った位置
          const row = p.locator('a.traderow').nth(79);
          await row.scrollIntoViewIfNeeded();
          await p.waitForTimeout(200);
          await row.click();
          await waitReady(p, 'US30 · L');
          await p.goBack();
          await waitReady(p, '取引');
          await p.waitForTimeout(300);
          await snap('more-restored');
          // 続きの読みの失敗（開き直して 2 ページ目を断る）
          const nextPage = (url) =>
            url.pathname === '/api/trades' && url.searchParams.has('cursor');
          await p.route(nextPage, (r) =>
            r.fulfill({
              status: 503,
              contentType: 'application/json',
              body: '{"error":"unavailable"}',
            }),
          );
          await p.goto(`${base}/trades`);
          await waitReady(p, '取引');
          await p.locator('a.traderow').nth(49).waitFor();
          await scrollToBottom(p);
          await p.getByText('続きを読み込めませんでした。').waitFor({ timeout: 5000 });
          await scrollToBottom(p);
          await p.waitForTimeout(200);
          await snap('more-failed');
          if (errors.length > 0) throw new Error(`${w} ${theme}: ページのエラー ${errors.length}`);
          out.push(`${w}-${theme}`);
        } finally {
          await ctx.close();
        }
      }
    }
    return `${out.join('・')}: 件数の多い一覧・続きを読んでいる・最後まで・戻った位置・続きの読みの失敗で横スクロール 0`;
  });

  await check('T-D1', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await p.goto(`${base}/trades/x-d1`);
      await waitReady(p, 'US30 · L');
      await p.locator('canvas.chartview__canvas').nth(1).waitFor();
      const v = await verdictOf(p);
      expectEq(v.badge, 'B 悪い損失', '判定');
      if (!v.text.includes('−1.6R') || !v.text.includes('0.5%'))
        throw new Error(`判定の枠: ${v.text}`);
      for (const want of [
        'LC を広げた（99.5 → 99.2）',
        '時間足を変えた（4 時間足 → 日足・チャートから）',
      ]) {
        if (!v.reasons.includes(want)) throw new Error(`理由に「${want}」が無い`);
      }
      await expectPollAsync(async () => (await drawn(p)).every((d) => d.alpha > 0), '2 枚が描ける');
      const d = await drawn(p);
      expectEq(
        d.map((x) => x.label).join(' / '),
        'エントリー時のチャート（4 時間足） / 決済時のチャート（日足）',
        'チャートの名前',
      );
      const tfs = await p.locator('.chartview__tf').allTextContents();
      expectEq(tfs.join(' / '), '時間足: 4 時間足 / 時間足: 日足', '時間足');
      expectEq(fake.chartGets.join(' '), 'x-d1-entry x-d1-exit', 'チャートの GET');
      expectEq(await p.locator('img').count(), 0, 'img の数');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'B・−1.6R・0.5%・2 つの理由、2 枚のチャート（API のバイト列を canvas に描く）と時間足';
  });

  // Issue #58: 詳細の見出しの下の行に保有時間（エントリーの時刻のある取引だけ）と、記録する画面の「取引」の枠の
  // エントリーの時刻（決済の時刻と並ぶ・「ほかの欄」に無い）。幅 360 で見出しの下の行がはみ出さない
  await check('H58', async () => {
    const { c, p, errors } = await recordContext();
    const out = [];
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades/x-r3`);
      await waitReady(p, 'US30 · S');
      const when = (await p.locator('.detail__when').textContent()) ?? '';
      if (!when.includes('· 保有 2 日 4 時間')) throw new Error(`x-r3 の見出しの下: ${when}`);
      const over = await p.evaluate(() => {
        const e = document.querySelector('.detail__when');
        const r = e?.getBoundingClientRect();
        return r ? r.right - document.documentElement.clientWidth : 0;
      });
      if (over > 0.5) throw new Error(`見出しの下の行が ${over}px はみ出す`);
      // 360 はエントリーの時刻を頭に出さない・1440 は出す（デザインレビュー 5）
      if (await p.locator('.detail__entry').isVisible())
        throw new Error('360 でエントリーの時刻が見える');
      await p.setViewportSize({ width: 1440, height: 900 });
      const wide = (await p.locator('.detail__entry').textContent()) ?? '';
      if (!(await p.locator('.detail__entry').isVisible()) || !wide.startsWith('エントリー 2026/'))
        throw new Error(`1440 のエントリーの時刻: ${wide}`);
      await p.setViewportSize({ width: 360, height: 780 });
      out.push(`x-r3「${when}」（1440 は頭に「${wide.trim()}」）`);
      await p.goto(`${base}/trades/x-r1`);
      await waitReady(p, 'US30 · L');
      const none = (await p.locator('.detail__when').textContent()) ?? '';
      if (none.includes('保有')) throw new Error(`エントリーの時刻の無い x-r1 に保有: ${none}`);
      out.push(`x-r1「${none}」（保有なし）`);
      await openRecord(p, base);
      const m = await p.evaluate(() => {
        const sec = document.querySelector('section[aria-labelledby="record-trade-title"]');
        const ids = [...(sec?.querySelectorAll('input') ?? [])].map((i) => i.id);
        const more = document.querySelector('details.more');
        const label = document.querySelector('label[for="record-entry-time"]')?.textContent ?? '';
        const entry = document.querySelector('#record-entry-time')?.getBoundingClientRect();
        const exit = document.querySelector('#record-exit-time')?.getBoundingClientRect();
        return {
          ids,
          inMore: !!more?.querySelector('#record-entry-time'),
          label,
          below: entry && exit ? exit.top - entry.top : null,
        };
      });
      const iEntry = m.ids.indexOf('record-entry-time');
      if (iEntry < 0 || iEntry > m.ids.indexOf('record-exit-time'))
        throw new Error(`「取引」の欄の並び: ${m.ids.join(' ')}`);
      if (m.inMore) throw new Error('「ほかの欄」にエントリーの時刻がある');
      if (!m.label.includes('エントリーの時刻（任意）')) throw new Error(`欄の名前: ${m.label}`);
      out.push(
        `記録する画面の「取引」: ${m.ids.join(' ')}（360 でエントリー → 決済の縦の差 ${m.below}px）`,
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return out.join(' / ');
  });

  await check('T-D2', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await p.goto(`${base}/trades/x-d2`);
      await waitReady(p, 'US30 · L');
      await p.locator('canvas.chartview__canvas').first().waitFor();
      const figs = await p.locator('figure.chartview').allTextContents();
      if (!figs[1]?.includes('チャートなし')) throw new Error(`決済時の枠: ${figs[1]}`);
      expectEq(await p.locator('canvas.chartview__canvas').count(), 1, 'canvas の数');
      expectEq(fake.chartGets.join(' '), 'x-d2-entry', 'チャートの GET');
      const v = await verdictOf(p);
      if (v.reasons.some((r) => r.startsWith('時間足を変えた')))
        throw new Error('時間足を変えたが出た');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '決済時の枠は「チャートなし」（GET を送らない）、理由に時間足を変えたは出ない';
  });

  // Issue #34: LC の物差し（AC-4）・決済までの行動の答え（AC-7）・「すべての欄」の畳み（AC-8）。x-d1 は例の表 E2 と同じ形
  // （広げた後 99.2・決済 99.2）で、チャートからの時間足（4 時間足 → 日足）が判定に効く
  await check('T-D3', async () => {
    const { c, p, errors } = await recordContext();
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades/x-d1`);
      await waitReady(p, 'US30 · L');
      const list = p.locator('ul[aria-label="LC の物差し"]');
      await list.waitFor();
      expectEq(
        (await list.locator('li').allTextContents()).join(' / '),
        '広げた後の LC 99.2（−1.6R） / 決済 99.2（−1.6R） / 決めた LC 99.5（−1.0R） / イン 100 / LC を 0.6R 超えて決済',
        '物差しの一覧',
      );
      expectEq(
        await p.locator('.verdict svg.ruler__plot').getAttribute('aria-hidden'),
        'true',
        '物差しの図の aria-hidden',
      );
      // 判定の枠の中で、数の段の後・理由の前
      const order = await p
        .locator('.verdict')
        .evaluate((v) =>
          [...v.children]
            .map((e) => e.className)
            .filter((c) => /verdict__stats|^ruler$|^reasons$|^taps$/.test(c)),
        );
      expectEq(order.join(' '), 'verdict__stats ruler reasons taps', '判定の枠の中の順');
      // 広げた後の LC〜決めた LC の破線の太線と、越えた区間の実線の太線。目盛りは −1R・0・+1R
      expectEq(await p.locator('.verdict .ruler__widen').count(), 1, '広げた区間');
      expectEq(await p.locator('.verdict .ruler__over').count(), 1, '越えた区間');
      expectEq(
        (await p.locator('.verdict .ruler__tick').allTextContents()).join(' '),
        '−1R 0 +1R',
        '目盛り',
      );
      const rulerH = await p
        .locator('.verdict .ruler')
        .evaluate((e) => e.getBoundingClientRect().height);
      if (rulerH > 120) throw new Error(`物差しの段の高さ ${rulerH}px（120px 以下）`);
      // 判定の枠の中、理由の下に 決済までの行動の答えの札
      expectEq(
        await p.locator('.verdict ul.taps').getAttribute('aria-label'),
        '決済までの行動の答え',
        '札の一覧の名前',
      );
      const off = await p.locator('.verdict ul.taps li.taps__item--off').allTextContents();
      expectEq(
        off.join(' / '),
        'LC を動かしたか: 広げた（99.2）計画から外れた / 時間足を変えたか: 4 時間足 → 日足計画から外れた',
        '外れた答え',
      );
      const note = await p.locator('.verdict').textContent();
      if (!note?.includes('あなたの答え: そのまま ／ チャート: 4 時間足 → 日足'))
        throw new Error('時間足の食い違いの 1 行が無い');
      // 「すべての欄」は閉じていて、押すと開く
      const more = p.locator('details.more');
      expectEq(await more.getAttribute('open'), null, '既定で閉じる');
      expectEq((await more.locator('summary').textContent())?.trim(), 'すべての欄', '見出し');
      if (await more.locator('.fields__row').first().isVisible())
        throw new Error('閉じているのに行が見える');
      await more.locator('summary').click();
      await more.locator('.fields__row').first().waitFor({ state: 'visible' });
      const labels = await more.locator('.fields__label').allTextContents();
      // 先頭は口座の 3 行（口座の数によらない。#47 U18）、その後に記録する画面の欄の順
      if (
        labels.slice(0, 4).join(' / ') !==
          '口座 / 口座の資金（記録したとき） / 許容リスク（記録したとき） / 銘柄' ||
        !labels.includes('時間足を変えたか')
      )
        throw new Error(`すべての欄: ${labels.join(' / ')}`);
      expectEq(errors.length, 0, 'ページのエラー');
      return `物差しの一覧 5 行・図は読み上げから外す・数の段 → 物差し → 理由 → 札、広げた区間・越えた区間・目盛り、札の外れは 2 つ、「すべての欄」は閉じて開く（物差しの段の高さ ${Math.round(rulerH)}px @360）`;
    } finally {
      await c.close();
    }
  });

  await check('T-E1', async () => {
    const { c, p, fake, errors } = await recordContext({ capitalYen: 2000000 });
    try {
      await p.goto(`${base}/trades/x-e1`);
      await waitReady(p, 'US30 · L');
      await p.locator('a[href="/trades/x-e1/edit"]').click();
      await waitReady(p, '取引を編集');
      await p.locator('#edit-submit').waitFor();
      expectEq(await p.locator('#record-lc').inputValue(), '99.5', 'LC の欄');
      expectEq((await verdictOf(p)).badge, 'B 悪い損失', '編集前');
      await seg(p, 'LC を動かしたか', 'そのまま').click();
      expectEq(
        await p.locator('#edit-change').textContent(),
        '判定: B 悪い損失 −1.0R → A いい損失 −1.0R',
        '保存の帯の直す前 → 直した後',
      );
      const v = await verdictOf(p);
      expectEq(v.badge, 'A いい損失', 'プレビュー');
      if (!v.text.includes('−1.0R') || !v.text.includes('0.5%') || v.text.includes('0.3%'))
        throw new Error(`プレビュー: ${v.text}`);
      await p.locator('#edit-submit').click();
      await waitReady(p, 'US30 · L');
      expectEq(path(p), '/trades/x-e1', '保存の後の URL');
      await p.locator('.verdict .badge').first().waitFor();
      const after = await verdictOf(p);
      expectEq(after.badge, 'A いい損失', '保存の後');
      if (!after.text.includes('0.5%')) throw new Error(`保存の後: ${after.text}`);
      expectEq(fake.puts.length, 1, 'PUT の数');
      expectEq(JSON.stringify(fake.puts[0].body.lcMove), '{"kind":"none"}', 'LC を動かしたか');
      expectEq(fake.trades.find((t) => t.id === 'x-e1').snapshot.capitalYen, 1000000, '写した資金');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '直す前 B →「そのまま」でプレビューも保存後も A・−1.0R・0.5%（今の資金 2,000,000 円の 0.3% にならない）';
  });

  await check('T-E2', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await p.goto(`${base}/trades/x-e2`);
      await waitReady(p, 'US30 · L');
      await p.locator('.verdict .badge').first().waitFor();
      const before = await verdictOf(p);
      expectEq(before.badge, 'B 悪い損失', '編集前');
      if (!before.reasons.some((r) => r.includes('チャートから'))) throw new Error('直す前の理由');
      await p.goto(`${base}/trades/x-e2/edit`);
      await waitReady(p, '取引を編集');
      const notice = await p.locator('#edit-orphans').textContent();
      if (
        !notice?.includes('エントリー時: 4 時間足・決済時: 日足') ||
        !notice.includes('保存時に削除されます')
      )
        throw new Error(`外す旨: ${notice}`);
      await p.locator('#edit-submit').click();
      await waitReady(p, 'US30 · L');
      await p.locator('.verdict .badge').first().waitFor();
      expectEq((await verdictOf(p)).badge, 'A いい損失', '保存の後');
      const body = fake.puts[0]?.body ?? {};
      expectEq(
        'entryChartTimeframe' in body || 'exitChartTimeframe' in body,
        false,
        '本文の時間足',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'チャートの無い枠の時間足を外す旨を出し、何も変えずに保存 → 200、保存の後 A';
  });

  // Issue #31: 記録したときの値と今の値（AC-1・AC-3・AC-4・AC-6・AC-7・N-3・N-5）。値はすべて架空。
  // x-e3 / x-e4 は L1 と同じ値（イン 100.00・LC 99.50・決済 99.50・数量 10,000・明細の損益 −5,000 円 → −1.0R・1R 5,000 円）。
  // 口座は 2 つ（オーナーの場面）。口座 1 の今の資金 200,000 円 → 5,000 / 200,000 = 2.5% で過剰リスクの B
  const OWNER_ACCOUNTS = () => [acct('default', '口座 1', 200000), ACC_B];
  const resnapTrade = (id, createdAt, capitalYen, days) =>
    exampleTrade(
      id,
      createdAt,
      { exit: { ...TX_L1.record.exit, time: T_1110 - days * DAY_MS } },
      { snapshot: { ...SNAP, capitalYen } },
    );
  const overflowX = (p) =>
    p.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, 0));
  /** 360 ライト・1440 ダークで、枠を見える所に寄せて撮る（全体と見えている範囲の 2 枚） */
  const shootPair = async (p, sel, slug) => {
    if (!opts.shots) return;
    for (const [w, h, theme] of [
      [360, 780, 'light'],
      [1440, 900, 'dark'],
    ]) {
      await p.setViewportSize({ width: w, height: h });
      await p.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await p.locator(sel).first().scrollIntoViewIfNeeded();
      await p.mouse.move(0, 0);
      await p.screenshot({
        path: join(opts.shots, `${w}x${h}-${theme}-${slug}.png`),
        fullPage: true,
      });
      await p.screenshot({ path: join(opts.shots, `${w}x${h}-${theme}-${slug}-viewport.png`) });
    }
    await p.setViewportSize({ width: 360, height: 780 });
    await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  };

  await check('T-E3', async () => {
    const { c, p, fake, errors } = await recordContext({ accounts: OWNER_ACCOUNTS() });
    try {
      fake.trades.push(resnapTrade('x-e3', 1700000000008, null, 30));
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades/x-e3/edit`);
      await waitReady(p, '取引を編集');
      await p.locator('#edit-submit').waitFor();
      const panel = p.locator('section.resnap');
      await panel.waitFor();
      const ptext = (await panel.textContent()) ?? '';
      if (
        !ptext.includes('この取引には資金が保存されていないため、過剰リスクを判定していません。') ||
        !ptext.includes('200,000円') ||
        !ptext.includes('2.5%') ||
        !ptext.includes('「A いい損失」から「B 悪い損失」に変わります') ||
        ptext.includes('写')
      )
        throw new Error(`枠: ${ptext}`);
      const v0 = await verdictOf(p);
      expectEq(v0.badge, 'A いい損失', '開いたとき');
      if (!v0.text.includes('資金が未設定のため、過剰リスクは判定していません'))
        throw new Error(`注記: ${v0.text}`);
      const near = p.locator('.verdict .verdict__action button');
      expectEq((await near.textContent())?.trim(), '今の値で再計算', '注記のそばのボタン');
      expectEq(
        await p.locator('input[name="edit-resnapshot"][value="recorded"]').isChecked(),
        true,
        '2 択の既定',
      );
      expectEq(await overflowX(p), 0, '360px の横スクロール（選ぶ前）');
      await shootPair(p, '.verdict__action', 'edit-resnapshot-owner-before');
      await near.scrollIntoViewIfNeeded();
      await near.focus();
      await p.keyboard.press('Enter');
      await expectPollAsync(
        async () => (await verdictOf(p)).badge === 'B 悪い損失',
        '選んだ後のプレビュー',
      );
      // N-3: 押したボタンは消えるので、フォーカスは「今の値」へ
      await expectPollAsync(
        () =>
          p.evaluate(() => {
            const a = document.activeElement;
            return (
              a instanceof HTMLInputElement && a.name === 'edit-resnapshot' && a.value === 'current'
            );
          }),
        'フォーカスの行き先',
      );
      const v1 = await verdictOf(p);
      if (v1.text.includes('資金が未設定') || !v1.text.includes('2.5%'))
        throw new Error(`選んだ後: ${v1.text}`);
      expectEq(
        await p.locator('.verdict .verdict__action').count(),
        0,
        '選んだ後の注記のそばのボタン',
      );
      expectEq(
        await p.locator('#edit-change').textContent(),
        '今の値で再計算 · 判定: A いい損失 −1.0R → B 悪い損失 −1.0R',
        '保存の帯',
      );
      if (
        !((await p.locator('#edit-resnapshot-status').textContent()) ?? '').includes(
          '戻すには「記録したとき」',
        )
      )
        throw new Error('戻し方の文');
      expectEq(await overflowX(p), 0, '360px の横スクロール（選んだ後）');
      await shootPair(p, 'section.resnap', 'edit-resnapshot-owner-after');
      await p.locator('#edit-submit').click();
      await waitReady(p, 'US30 · L');
      expectEq(path(p), '/trades/x-e3', '保存の後の URL');
      expectEq(fake.puts.length, 1, 'PUT の数');
      expectEq(fake.puts[0].query, '?snapshot=current', 'PUT のクエリ');
      expectEq(
        fake.trades.find((t) => t.id === 'x-e3').snapshot.capitalYen,
        200000,
        '保存した資金',
      );
      await p.locator('.verdict .badge').first().waitFor();
      const after = await verdictOf(p);
      expectEq(after.badge, 'B 悪い損失', '保存の後');
      if (!after.text.includes('2.5%') || after.text.includes('資金が未設定'))
        throw new Error(`保存の後: ${after.text}`);
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '口座 2 つ・資金が空の取引: 目立つ枠（未設定 → 200,000円・— → 2.5%・A → B の 1 文）と注記のそばの [今の値で再計算] → Enter で B・帯「今の値で再計算 · 判定: A → B」・フォーカスは「今の値」→ 保存で ?snapshot=current・保存した資金 200,000 円・詳細 2.5%（360px 横スクロール 0）';
  });

  await check('T-E4', async () => {
    const { c, p, fake, errors } = await recordContext({ accounts: OWNER_ACCOUNTS() });
    try {
      // 記録したとき 1,000,000 円（0.5% = A）、今 200,000 円（2.5% = B）。勧めない（折りたたみ）
      fake.trades.push(resnapTrade('x-e4', 1700000000009, 1000000, 31));
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades/x-e4/edit`);
      await waitReady(p, '取引を編集');
      await p.locator('#edit-submit').waitFor();
      expectEq(await p.locator('section.resnap').count(), 0, '目立つ枠');
      const fold = p.locator('details.resnap');
      expectEq(await fold.evaluate((d) => d.open), false, '開いたときは畳む');
      const sum = (await fold.locator('summary').textContent()) ?? '';
      if (!sum.includes('記録したときの値') || !sum.includes('今の値と 1 か所違います'))
        throw new Error(`見出し: ${sum}`);
      expectEq(await p.locator('.verdict .verdict__action').count(), 0, '注記のそばのボタン');
      await fold.locator('summary').click();
      const ftext = (await fold.textContent()) ?? '';
      if (
        !ftext.includes('1,000,000円') ||
        !ftext.includes('「A いい損失」から「B 悪い損失」に変わります')
      )
        throw new Error(`中身: ${ftext}`);
      await p.locator('input[name="edit-resnapshot"][value="current"]').check();
      expectEq((await verdictOf(p)).badge, 'B 悪い損失', '今の値のプレビュー');
      expectEq(await overflowX(p), 0, '360px の横スクロール');
      await shootPair(p, 'details.resnap', 'edit-resnapshot-fold-open');
      await p.locator('input[name="edit-resnapshot"][value="recorded"]').check();
      expectEq((await verdictOf(p)).badge, 'A いい損失', '戻した後');
      await p.locator('#edit-submit').click();
      await waitReady(p, 'US30 · L');
      expectEq(fake.puts[0].query, '', '戻した後の PUT にクエリなし');
      expectEq(
        fake.trades.find((t) => t.id === 'x-e4').snapshot.capitalYen,
        1000000,
        '資金は記録したときのまま',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '資金が入っていた取引: 折りたたみ「記録したときの値（今の値と 1 か所違います）」・注記のそばのボタンなし → 開くと A → B の 1 文 →「今の値」で B →「記録したとき」で戻して保存はクエリなし・資金はそのまま';
  });

  await check('T-X1', async () => {
    const { c, p, fake, errors } = await recordContext();
    let dialogs = 0;
    p.on('dialog', (d) => {
      dialogs++;
      void d.dismiss();
    });
    try {
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('a.traderow').first().waitFor();
      const n = (await rowsOf(p)).length;
      await p.locator('a.traderow[href="/trades/x-d1"]').click();
      await waitReady(p, 'US30 · L');
      await p.getByRole('button', { name: '削除', exact: true }).click();
      await waitReady(p, '取引');
      expectEq(path(p), '/trades', '消した後の URL');
      await p
        .locator('.toast')
        .filter({ hasText: 'US30 L' })
        .filter({ hasText: 'を削除しました' })
        .waitFor();
      // [消す] の後のフォーカスは [元に戻す]（8 秒の間にキーで届く。レビュー指摘 3）
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id ?? '')) === 'toast-undo',
        '[元に戻す] へフォーカス',
      );
      expectEq(dialogs, 0, 'ダイアログ');
      expectEq(await noDialogs(p), 0, '確認の画面');
      const rows = await rowsOf(p);
      expectEq(rows.length, n - 1, '一覧の件数');
      if (rows.some((r) => r.href === '/trades/x-d1')) throw new Error('消した取引が一覧に残る');
      // アプリの中で詳細の URL を開く（戻る・進むと同じ道）
      await p.evaluate(() => {
        window.history.pushState(null, '', '/trades/x-d1');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await waitReady(p, '取引の詳細');
      await p.getByText('この取引は見つかりません').waitFor();
      expectEq(fake.deletes.length, 0, '取り消しの時間の間の DELETE');
      // 取り消しの時間（8 秒）が過ぎたら DELETE が 1 回。直接開いても見つからない
      await p.waitForTimeout(8500);
      await expectPollAsync(async () => fake.deletes.length === 1, 'DELETE が届く');
      expectEq(fake.deletes.join(' '), 'x-d1', 'DELETE の取引');
      await p.reload();
      await waitReady(p, '取引の詳細');
      await p.getByText('この取引は見つかりません').waitFor();
      expectEq(fake.deletes.length, 1, 'DELETE の数');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '確認なしで消える、一覧 N → N − 1、アプリの中で開くと見つからない、8 秒後に DELETE 1 回・再読み込みでも見つからない';
  });

  await check('T-X2', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await p.goto(`${base}/trades/x-d1`);
      await waitReady(p, 'US30 · L');
      await p.locator('canvas.chartview__canvas').nth(1).waitFor();
      await p.getByRole('button', { name: '削除', exact: true }).click();
      await waitReady(p, '取引');
      await p.getByRole('button', { name: '元に戻す' }).click();
      await p.locator('a.traderow[href="/trades/x-d1"]').waitFor();
      await p.waitForTimeout(8500);
      expectEq(fake.deletes.length, 0, 'DELETE');
      await p.locator('a.traderow[href="/trades/x-d1"]').click();
      await waitReady(p, 'US30 · L');
      expectEq(path(p), '/trades/x-d1', '同じ ID');
      await p.locator('canvas.chartview__canvas').nth(1).waitFor();
      await expectPollAsync(
        async () => (await drawn(p)).filter((d) => d.alpha > 0).length === 2,
        '2 枚',
      );
      expectEq((await verdictOf(p)).badge, 'B 悪い損失', '判定');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '[元に戻す] で DELETE を送らず、同じ ID が一覧に戻り、詳細に B と 2 枚のチャート';
  });

  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
