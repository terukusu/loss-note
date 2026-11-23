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
// LC の ［なし］ で止めた欄（#171）は手順 LN1（読み取りが終わっても「なし」のまま）・LN2（欄をタップすると外れてフォーカス）。
// LC を動かしたかの「取消」と逆指値の未設定の切り替え（#165）は手順 LM1（1 タップずつ・判定の 1 行・選べない取消と理由の 1 行・360 の幅・LC の欄の名前の「i」（#201）・LC の行の下の添え「エントリー後に決めた価格は入れず「LC なし」へ」（LC なしの間は「LC を決めずに入った取引として記録します」）が 1 行で収まり決めていたかの問いが無い（#202）。--shots で 2 つの状態を撮る）。
// 決済明細の読み取り（Issue #15）は、読み取り中・読み取りの後・複数行（タイムゾーンの確認）・読み取りの失敗の状態を同じ幅とテーマで
// 測り、手順 R6〜R10（貼り付けとファイル選択で 1 件ずつ・文字の貼り付けで 0 件 / 実物の canvas で描き直した本文の形式・寸法・
// バイト数 / 端末に残さない / 失敗の文言 / E1 を貼って打つ 2・選ぶ 2 で判定と保存）を流す。読み取りの API も偽物（架空の行）で、
// 実際の AI は呼ばない。画像はページの中の canvas で作るか、合成の明細 tools/statement-eval/synthetic/ を使う。
// 根拠の足のチャート（Issue #12）は、2 枠にチャートがある状態（時間足の欄つき）を同じ幅とテーマで測り、手順 C1〜C3
// （枠を選んで貼る → チャート・枠の外に貼る → 明細 / 貼る → 保存 → 離れるの後に端末の保存先に画像が無い / 2 枚と明細で
// 打つ 2・選ぶ 2 → 1 要求の multipart で保存）を流す。チャートの画像もページの中の canvas で作る（架空）。
// 取引の一覧・詳細・直す（Issue #9）は、取引のある一覧・ホーム・詳細（チャート 2 枚）・直すを同じ幅とテーマで測り
// （トーストの出た一覧も）、手順 T-L4・T-H1・T-D1・T-D2・T-D3・T-E1・T-E2・T-X1・T-X2（例の表の L4・H1・D1・D2・E1・E2・X1・X2 と #34 の物差し）を流す。
// 例の取引とチャートの画像（このスクリプトが作る小さな PNG）はすべて架空。
// 一覧のページ分け（Issue #87）は、合成の取引 120 件で手順 TL-P1（末尾へ送ると続きが自動で出て「全 120 件」・要求 3 回・
// 幅 360 で横スクロール 0）・TL-P2（80 行目の詳細から戻ると行の数と位置が保たれる）・TL-P3（続きの読みの失敗と
// [再読み込み]）・TL-P4（キーで押したときのフォーカスと末尾の段の高さ）・TL-P5（5 つの状態を 360 / 1440 × ダーク /
// ライトで測って撮る）を流す。月の区切り（Issue #132）は合成の取引 60 件で手順 TL-M1（月の見出しの数・貼り付く見出し・390×844 の撮影）、口座の名前の置き場は TL-A1。
// 設定の画面（Issue #5）は、開いた直後（資金・履歴 3 件・銘柄 3 件）・銘柄を直している・誤りと警告・資金が未設定の状態を
// 同じ幅とテーマで測り、手順 SET1〜SET3（資金を保存して記録する画面でリスク 0.5% / 銘柄を直す・誤りは送らない・
// フォーカス / 名前だけで足す・許容リスクの警告と範囲 / 誤り・失敗の後のフォーカス）を流す。セグメントのチェックの記号が
// 文字の前にあって項目の中に収まるかも、部品のはみ出しと一緒に数える。
// #133 で設定はタブの根のまとめた一覧（/settings）と次の画面（/settings/accounts・/settings/instruments・/settings/ai-usage）に
// 分け、口座・銘柄の編集と追加は下のシートにした。状態は画面ごとに開き、編集・追加はシートを開いた状態で測る。手順 SET6（根 → 次の
// 画面 → 戻る・直接開く・AI が読めなくても口座の [保存]）を足した。
// 口座（Issue #47 PR-1）: 記録する画面の口座 2 つ（Segment）・3 つ（長い名前の「…」）・4 つ（select）・その場で足す欄・足す欄の誤り、
// 設定の口座の一覧（2 つ・資金が未設定の行）・直す欄・足す欄・誤り、一覧と詳細（口座 2 つ）を同じ幅とテーマで測り、
// 手順 ACC1（口座 2 つで 1 タップで替わる・判定の枠の 1 行がその場で変わる）・ACC2（その場で足す: Enter で足す・Esc で閉じて
// フォーカスを戻す・足した口座が選ばれる・入れていた欄が残る）・SET5（設定で口座を追加 → 名前の順・知らせ・新しい行の [直す] へ）を流す。
// 数量と提案の数量（Issue #67）: 手順 SZ1（幅 360 の記録する画面・詳細・編集の画面で、判定の枠の数量の行が区切りの中で折れず・
// --ink-3・数の段の直後・横スクロール 0。2〜3 桁の比・小数 / 7 桁の提案の数量・1R が出ない・エントリー 2 つも。詳細の「すべての欄」に 2 行）を流す。
// R12 は 1 画面に収まる（#130。2026-11-21 に 2 段へ）: 390×844 の 1 段目と 2 段目の 4 つの状態で 0px、360×780 は口座 1・2・3 の形で 120px 以下。
// 読み取りの終わりの知らせ（Issue #166）: 手順 RD1（完了の文・キャンセルの文と同じ読み上げの領域・読めた / 失敗したときだけ 1 回の
// 動き（200ms 以下・動きを減らす設定で 0）・シートを閉じた後・次の行の知らせ・幅 360 で切れない）を流す。
// 通貨と為替（Issue #47 PR-2・U34）: 記録する画面の為替の欄（USD 建て）・為替 7 桁・明細から逆算した為替・為替の誤り・USD の口座、
// 設定の USD の口座の行と通貨を直せない口座の直す欄、詳細（外貨建て）を同じ幅とテーマで測る。円の口座・円建ての形は今のまま。
// 記録する画面の密度と階層（Issue #33）: 全状態で枠の入れ子（線か、最も近い面と違う面の色を持つ箱の祖先）が 3 段以上の要素を
// 数え、幅 360 の記録する画面の全状態で下の帯の高さ（判定の 1 行 + [記録する] の 112px まで。#130）と状態の文の行数（1 行まで）・
// 切れ（scrollWidth）、直す画面の帯の高さ（変える前の 161.1px まで）を測る。手順 R11（最後のタップの直後に下の帯の判定の 1 行の
// バッジと R が窓の中。スクロールしない）・R12（1 画面に収まる: 390×844 の 1 段目と 2 段目の 4 つの状態で縦のスクロール 0、
// 読み取りが流れ込んでも LC が動かない、注意 3 行以下、360×780 は 120px 以下）・KB1（キーボードで欄が隠れない: 390×844 → 420 の
// Android の形と iOS の形で LC・一言・広げた後の LC が上下 16px 以上の余白で見え、下の帯を隠す。決定キーで LC → 一言 → 閉じる。#172）・R13（大きな R は 44px（#131。前は 36px）・本文の書体、ラベルの
// 上端が揃う）・R14（向きを変えても LC・取引の欄のシートの欄の要素・値・フォーカスが残る）を流す。#130 で取引の欄・ほかの欄・
// タイムゾーン・判定・チャートの詳細は下のシートに置いたので、手順はシートを開いてから欄を入れる。幅 720 未満の画面は指で触る端末（hasTouch）として開く。
// 言葉の説明の「i」（Issue #57。#129 で吹き出しから説明のシートへ）: 記録する画面で説明を 1 つ開いた状態（時間足・判定）を同じ幅と
// テーマで測り、シートが窓の中に収まることを見る。手順 IT1（押して開く・✕・Esc でフォーカスが「i」・外を押す・同時に 1 つ）・
// IT2（押しても入力の状態が変わらず保存の要求 0）・IT3（戻るでシートだけを閉じ、画面は移らない・閉じた後の履歴の数）を流す。
// 下のシート（#129。ui-guidelines 9.3・9.10）: 手順 SH1（360×780・390×844 × ダーク / ライトと文字の拡大 200%: 下から出る・窓の中・
// 最大 86%・中がスクロールで最後まで届く・✕ の当たり 44・Tab でシートの外へ出ない・閉じたら「i」へ・安全域を差し替えて押せるものが
// 内側）・SH2（シートを開いている間はトーストの取り消しの時間が止まる）・SH3（<html data-form> を付けた横・広いの見せ方）を流す。
// 文字の拡大 200%（Issue #79・WCAG 1.4.4）: 文字の大きさのトークン（tokens.css の --fs-*）を全部 2 倍にし、ルートの文字の
// 大きさも 200% にした状態で、全画面と記録する画面・設定の画面・振り返りのタブの主な状態を 360×780 と 1440×900 × ダークで
// 測る。文字は px のトークンなので、ルートの文字の大きさだけを 2 倍にしても変わらない。トークンを 2 倍にするのは、文字だけの
// 拡大（Android の Chrome の文字の拡大。px の文字も大きくなり、窓の幅は変わらない）に当たる。あわせて 1440×900 のページの拡大
// 200%（窓 720×450・DPR 2・等倍の文字）も同じ状態で測る。横スクロール 0px・部品のはみ出し 0 件に加えて、拡大の漏れ（文字が
// 20px 未満 = トークンを通らない大きさ）と行の重なり（行の高さが文字より小さい・文字どうしの重なり・切れ）を数える。当たり・
// 帯の高さ・全長・入れ子は拡大では見ない（文字に合わせて大きくなるのが正しい）。残している崩れは ZOOM_KNOWN（外れの文言で絞る）。
// 等倍の状態では、ボタン・バッジが 2 行に折れていないかも部品のはみ出しに数える（#79 で親より広いときだけ折り返す作りにした）。
// ホームの 1 画面（#128。ui-guidelines 9.4・9.10）: 手順 HM1（等倍の文字の 390×844・360×780 × ダーク / ライト × 取引 0 件・取引あり・
// 書きかけありで縦のスクロール量 0px・見える直近の行の数・主役の数字 44px、文字の拡大 200% では縦に伸びて切れず横 0）・HM2（押せる
// カードの行き先 = 取引のタブ・振り返りのタブを今月で・詳細）を流す。規律の振り返りの状態は振り返りのタブ `/review` と次の画面
// 「数で見る」（`/review/table`）で測る（RV1 は期間の置き換えと「数で見る ›」の往復）。
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
  // ホームの直近の取引は詰めた行（#128）。h1 は印と「損失ノート」、読み上げで「ホーム」
  { path: '/', h1: 'ホーム', wait: '.homerow' },
  { path: '/record', h1: '記録する' },
  { path: '/trades', h1: '取引', wait: '.traderow' },
  // 振り返りのタブ（#128 で作り直した）と次の画面「数で見る」
  { path: '/review', h1: '振り返り', wait: '.review' },
  { path: '/review/table', h1: '数で見る', wait: '.review__card' },
  { path: '/trades/no-such-trade', h1: '取引の詳細' },
  { path: '/trades/x-d1', h1: 'US30 · L', wait: 'canvas.chartview__canvas >> nth=1' },
  { path: '/trades/x-e1/edit', h1: '取引を編集', wait: '#edit-submit' },
  // Issue #34: 物差しの場面（危ない勝ちで LC を広げていた・TP を入れた・ショート）
  { path: '/trades/x-r1', h1: 'US30 · L', wait: '.ruler__plot' },
  { path: '/trades/x-r2', h1: 'US30 · L', wait: '.ruler__plot' },
  { path: '/trades/x-r3', h1: 'US30 · S', wait: '.ruler__plot' },
  { path: '/settings', h1: '設定' },
  // 設定の次の画面（#133）
  { path: '/settings/accounts', h1: '口座', wait: '.setrow' },
  { path: '/settings/instruments', h1: '銘柄', wait: '.setrow' },
  { path: '/settings/ai-usage', h1: 'AI の利用状況', wait: '.usage' },
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
/**
 * 記録する画面の下の帯の高さの上限（幅 360）。Issue #33 AC-1 の 64px（状態の文 1 行 + [記録する] を横に 1 段）は、#130 で
 * 「判定の 1 行（押すと判定のシート）+ [記録する]」を縦に積む 1 つの帯（ui-guidelines 9.4・9.11）に替えたので、2 つの当たり
 * （44px × 2）と段の間・上下の余白（4 + 8 × 2）と線 1px の 109px に、端数の余白を足した 112px にした。状態の文が 1 行で切れない
 * ことは同じに見る
 */
const BAR_MAX = 112;
/**
 * 記録する画面の 360×780 の縦のスクロールの上限（#130。ui-guidelines 9.10: 全長の上限 R12 の 2,550px を「390×844 で 0px」と
 * 「360×780 で 120px 以下」に置き換えた）
 */
const RECORD_OVER_360 = 120;
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
  'record-45-read-long-name',
  'record-46-read-real-digits',
  'record-9-rows',
  'record-8g-rows-next2',
  'record-10-read-failed',
  'record-12-charts',
  'record-15-accounts-2',
  'record-21-fx',
  'record-11-info-tap',
];
const ZOOM_SETTINGS = [
  'settings-1-open',
  'settings-5-accounts',
  'settings-3-errors',
  'settings-2-editing',
];
/**
 * 文字の拡大で残している崩れ（`幅:slug` → { match: 既知の外れの文言の正規表現, why: 理由 }）。match に当たる外れだけを
 * 既知として数え（失敗にしない）、当たらない外れは失敗にする。match に当たる外れが無くなったら「消す」で失敗にする。
 * 理由は handoff と docs/ui-guidelines.md 5 章
 */
// 説明の吹き出しが窓より高くなる件（360:record-11-info-tap。#110）は、説明のシート（最大 86dvh・中のスクロール）で解いた（#129）。
// 物差しの見出しが図に重なる件（#110。文字どうしではないので数えていなかった）は、見出しを図の上の 1 行にして解き（#131）、
// 測り（measureZoom の「物差しの見出しが図に重なる」）を足した
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
/**
 * #202 の例 #6: 前からの「価格あり・決めていなかった」の取引（後から書いた LC 99.5・決済 100.75 → 危ない勝ち +1.5R）。値は架空。
 * EXAMPLE_TRADES には入れない（一覧の件数を変えない。LD1 だけが使う）
 */
const TX_LATE = exampleTrade('x-late', 1700000000020, {
  lcDecidedBeforeEntry: false,
  exit: {
    time: T_1110 - DAY_MS,
    price: 100.75,
    orderType: 'unknown',
    reason: 'other',
    gapSlip: 'unanswered',
  },
  statementPnlYen: 7500,
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
/**
 * ホームの今月の規律（#128）の取引: S1 の 7 件の決済を今日の 0:01〜0:07 に寄せる（月の初めに流しても今月に入る）。
 * 直近の流れの点 10 個は TX_H1（7 件）と合わせて出す
 */
function homeMonthTrades() {
  const t = new Date();
  const start = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return REVIEW_S1.map((x, i) => ({
    ...x,
    record: { ...x.record, exit: { ...x.record.exit, time: start + (i + 1) * 60_000 } },
  }));
}
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
/**
 * 振り返りの気づき（#162）の心理ごとの集計の取引（架空の値。Issue の例 E1 の形）: 平常心 5 件（A 3・計画どおりの勝ち 2）、
 * 取り戻したい 5 件（B 3・危ない勝ち 1・C 1）、ほかは 1〜2 件（件数が少ない行。長めの名前も入れる）、タグなし 1 件
 */
const withTags = (t, tags) => ({ ...t, emotionTags: tags });
const REVIEW_INSIGHT = [
  withTags(reviewTrade(0, 'rvi-1', 99.5), ['calm']),
  withTags(reviewTrade(0, 'rvi-2', 99.55), ['calm']),
  withTags(reviewTrade(1, 'rvi-3', 101), ['calm']),
  withTags(reviewTrade(1, 'rvi-4', 99.5), ['calm']),
  withTags(reviewTrade(2, 'rvi-5', 100.75), ['calm']),
  withTags(reviewTrade(2, 'rvi-6', 99.2, { lcMove: { kind: 'widened', after: 99.2 } }), [
    'wantPosition',
    'recoup',
  ]),
  withTags(reviewTrade(3, 'rvi-7', 99, { lcMove: { kind: 'widened', after: 99 } }), ['recoup']),
  withTags(reviewTrade(3, 'rvi-8', 100.5, { timeframeChange: 'longer' }), [
    'overconfident',
    'recoup',
  ]),
  withTags(reviewTrade(4, 'rvi-9', 99, { lc: undefined, lcDecidedBeforeEntry: false }), [
    'recoup',
    'cantCut',
  ]),
  reviewTrade(4, 'rvi-10', 99.5),
  withTags(reviewTrade(5, 'rvi-11', 99.4, { lcMove: { kind: 'widened', after: 99.4 } }), [
    'fomo',
    'recoup',
    'confirmation',
  ]),
  withTags(reviewTrade(6, 'rvi-12', 99.5), ['lossAversion']),
  withTags(reviewTrade(6, 'rvi-13', 100.6), ['lossAversion']),
];
/**
 * 名前の長い心理が値の出る行になる期間（#162 のデザインレビュー）: 乗り遅れ怖い 5 件（B 2・A 3）・都合よく解釈 5 件（A 4・C 1）と、
 * 件数の少ない平常心 2 件（平常心は件数が少なくても基準の場所に出る）
 */
const REVIEW_INSIGHT_LONG = [
  ...[0, 1, 2, 3, 4].map((i) =>
    withTags(
      reviewTrade(
        i,
        `rvl-f${i}`,
        i < 2 ? 99.2 : 99.5,
        i < 2 ? { lcMove: { kind: 'widened', after: 99.2 } } : {},
      ),
      ['fomo'],
    ),
  ),
  ...[0, 1, 2, 3, 4].map((i) =>
    withTags(
      reviewTrade(
        i,
        `rvl-c${i}`,
        99.5,
        i === 4 ? { lc: undefined, lcDecidedBeforeEntry: false } : {},
      ),
      ['confirmation'],
    ),
  ),
  withTags(reviewTrade(5, 'rvl-k1', 101), ['calm']),
  withTags(reviewTrade(6, 'rvl-k2', 99.5), ['calm']),
];
/** 期間の取引（#185）の状態ごとの題 */
const REVIEW_TRADES_TITLE = {
  'review-trades': '取り戻したい',
  'review-trades-streak': '連勝の後',
  'review-trades-empty': '期間の取引',
};
/**
 * 連勝の後（#185）の取引（架空の値。Issue の例 B3 の形）: 決済の古い順に W W B W W A W W B W W A W W A の 15 件（W = 計画どおりの
 * 勝ち +1.0R）。連勝の後は 3・6・9・12・15 件目の 5 件（60%・崩れで −1.5R）。3・9 件目に「調子に乗った」。決済は 7 日の中で 1 分ずつ
 */
const REVIEW_STREAK = Array.from({ length: 15 }, (_, k) => {
  const n = k + 1;
  const off = n % 3 === 0;
  const price = !off ? 100.5 : n === 3 ? 99.25 : n === 9 ? 99 : n === 15 ? 99.6 : 99.5;
  const over = n === 3 || n === 9 ? { lcMove: { kind: 'widened', after: price } } : {};
  const t = reviewTrade(0, `rvs-${n}`, price, over);
  const traded = {
    ...t,
    createdAt: 1700000002000 + n,
    record: { ...t.record, exit: { ...t.record.exit, time: reviewExit(5) + n * 60_000 } },
  };
  return n === 3 || n === 9 ? withTags(traded, ['overconfident']) : traded;
});
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

/** 実際の桁の架空の銘柄と取引（#164 のレビュー。編集の画面の要約を測る）。値は架空 */
const FAKE_REAL = {
  ...FAKE_US30,
  id: 'inst-real',
  name: '架空ミニ指数先物 26/12',
  multiplier: 1000,
};
const TX_REAL = exampleTrade(
  'x-real',
  1700000000031,
  {
    instrumentId: FAKE_REAL.id,
    lc: 61180,
    entries: [{ price: 61234.5, quantity: 1 }],
    exit: {
      time: T_1110,
      price: 61139.5,
      orderType: 'unknown',
      reason: 'lc',
      gapSlip: 'unanswered',
    },
    statementPnlYen: -95000,
  },
  { snapshot: { ...SNAP, instrument: { ...SNAP.instrument, multiplier: 1000 } } },
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
/** 心理のタグの付いた取引（#156。外貨建ての取引の写しに 3 つ。一覧の順） */
const TX_EMO = {
  ...TX_FX,
  id: 'x-emo',
  emotionTags: ['wantPosition', 'overconfident', 'recoup'],
};
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
/**
 * 明細の読み取りが終わって要約が出た印: 読めた最初の行は名前の上の完了の文（#166）、次の行・ほかは名前の右の札「読み取り」
 */
const READ_DONE = '.rsum__status--done, .rsum__mark';
/**
 * 実際の桁の架空の明細の行（#164 のレビュー）: オーナーの例と同じ桁（6 万台・小数 1 桁、損益 6 桁、名前の長さ）。値は架空
 */
const READ_REAL = {
  ...READ_E1,
  symbol: '架空ミニ指数先物 26/12',
  entryPrice: 61234.5,
  exitPrice: 61139.5,
  quantity: 1,
  pnl: -95000,
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
 * api.chartRead（{ status, kind, holdMs }。後から書き換えてよい）で状態・種類・待ちを変える。要求の数を api.chartReads に残す。
 * 返す時間足は要求が届いた時点で取り出す（待たせた後に取り出すと、画面を離れた後に目覚めた前の状態の要求が、次の状態の
 * 時間足を横取りする。#149）
 * 口座の通貨（Issue #47 PR-2）: 口座はいつも currency を返す（無い = JPY）。POST / PUT の currency は任意（PUT の省略は今のまま）。
 * 取引のある口座の通貨を変える PUT は 409 currencyLocked。取引の snapshot に口座の通貨（accountCurrency）を写す
 */
/** 心理のタグの一覧の順（core/emotion-tags.ts の EMOTION_TAG_IDS と同じ。偽の API が並べ直すのに使う。#156） */
const EMOTION_ORDER = JSON.parse(
  readFileSync(new URL('../tests/fixtures/records/emotion-tags.json', import.meta.url), 'utf8'),
).ids;

/**
 * 記録の保存の後: 心理のシート「記録しました」（#156）が開くのを待って ［あとで］ で閉じ、保存の後の画面の知らせを待つ
 * （シートは modal なので、閉じないと後ろの ［次の取引を記録］ などを押せない）
 */
async function waitSaved(p, text) {
  const sheet = p.locator('#record-emotion-sheet[open]');
  await sheet.waitFor({ timeout: 10000 });
  await sheet.locator('.emotions__actions button').click();
  await p.locator('#record-emotion-sheet[open]').waitFor({ state: 'detached', timeout: 10000 });
  await p.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 10000 });
}

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
    // 心理のタグ（Issue #156。形は routes.py の put_trade_emotions: 取引の集合のタグを置き換え、空なら鍵ごと消す）
    if (key === 'PUT /api/trade-emotions') {
      const b = JSON.parse(req.postData() ?? '{}');
      const ids = Array.isArray(b.tradeIds) ? b.tradeIds : [];
      const idx = ids.map((id) => api.trades.findIndex((t) => t.id === id));
      if (ids.length === 0 || idx.some((i) => i < 0))
        return json(route, 404, { error: 'not_found' });
      const tags = EMOTION_ORDER.filter((t) => (b.tags ?? []).includes(t));
      for (const i of idx) {
        const { emotionTags: _old, ...rest } = api.trades[i];
        api.trades[i] = tags.length > 0 ? { ...rest, emotionTags: tags } : rest;
      }
      return json(route, 200, { tags });
    }
    const profileM = /^\/api\/statement-profiles\/([0-9a-f]{32})$/.exec(path);
    if (req.method() === 'PUT' && profileM) {
      api.profiles.push({ key: profileM[1], body: JSON.parse(req.postData() ?? '{}') });
      return route.fulfill({ status: 204 });
    }
    if (key === 'POST /api/chart-reads') {
      api.chartReads++;
      const r = api.chartRead;
      // 時間足は届いた時点で取り出す（#149。「チャートの読み取り中」の状態は 20 秒待たせたまま次の状態へ移るので、待った後に
      // 取り出すと、同じ窓で後に流れる状態（「2 段目（読み取りの後・判定）」など）の時間足を横取りして、その状態が開けない）
      const timeframe =
        r.status === 200 && r.kind === 'chart' ? (api.chartTimeframes.shift() ?? null) : null;
      if (r.holdMs) {
        await new Promise((ok) => {
          const t = setTimeout(ok, r.holdMs);
          t.unref?.();
        });
      }
      try {
        if (r.status !== 200) return await json(route, r.status, { error: 'read_unavailable' });
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
  // 2 段（2026-11-21）: 開いた直後は 1 段目「スクショを入れる」（［明細なしで手入力］ が見える）
  await page.locator('#record-manual').waitFor({ state: 'visible', timeout: 15000 });
}

/**
 * 明細を貼って 2 段目「振り返る」へ移る（シートを開かない = 履歴の段が混ざらない。2026-11-21）。fake は偽の API
 */
async function toReviewByPaste(page, fake) {
  fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
  await makeImage(page, STATEMENT_SPEC, 'paste');
  await page.locator('#record-lc').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator(READ_DONE).first().waitFor({ timeout: 10000 });
}

/**
 * 要約のカード（#record-summary・#edit-summary）の中で切れている文字の数（#164: 名前・数・時刻を「…」で省略しない）。
 * 名前と塊（.rsum__part）・札が自分の箱にも要約の箱にも収まっているかを見る
 */
async function summaryCuts(page, sel = '#record-summary') {
  return page.evaluate((s) => {
    const box = document.querySelector(s);
    if (!box) return ['要約が無い'];
    const outer = box.getBoundingClientRect();
    const out = [];
    for (const el of box.querySelectorAll('.rsum__name, .rsum__part, .rsum__mark, .rsum__status')) {
      const r = el.getBoundingClientRect();
      const cut =
        el.scrollWidth > el.clientWidth + 0.5 ||
        r.right > outer.right + 0.5 ||
        r.left < outer.left - 0.5 ||
        getComputedStyle(el).textOverflow === 'ellipsis';
      if (cut) out.push(el.textContent ?? '');
    }
    return out;
  }, sel);
}

/**
 * 実際の桁の要約（#164 のレビュー）: 2・3 行目の文、切れた文字 0、行の頭に「·」「→」が来ない、文字が等倍で幅 390 以上なら
 * 2・3 行目は 1 行ずつ
 */
async function expectRealSummary(page, sel) {
  const got = await page.evaluate((s) => {
    const box = document.querySelector(s);
    const line = (c) => {
      const el = box?.querySelector(c);
      if (!el) return { text: '', lines: 0, heads: [] };
      const lh = Number.parseFloat(getComputedStyle(el).lineHeight);
      // 塊ごとの行の頭（前の塊より下の行に来た塊の先頭の文字）
      const heads = [];
      let top = null;
      for (const part of el.querySelectorAll('.rsum__part')) {
        const t = part.getBoundingClientRect().top;
        if (top !== null && t > top + 1) heads.push((part.textContent ?? '').trim().charAt(0));
        top = t;
      }
      return {
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        lines: Math.round(el.getBoundingClientRect().height / lh),
        heads,
      };
    };
    return {
      l2: line('.rsum__l2'),
      l3: line('.rsum__l3'),
      w: window.innerWidth,
      zoom: !!document.querySelector('style[data-ui-check-zoom]'),
    };
  }, sel);
  if (got.l2.text !== 'L · 数量 1 · イン 61,234.5 → 決済 61,139.5')
    throw new Error(`要約の 2 行目「${got.l2.text}」`);
  if (!/^11\/10 \d\d:\d\d 決済 · 明細の損益 −95,000円$/.test(got.l3.text))
    throw new Error(`要約の 3 行目「${got.l3.text}」`);
  for (const l of [got.l2, got.l3])
    for (const h of l.heads)
      if (h === '·' || h === '→') throw new Error(`折り返した行の頭に「${h}」（${l.text}）`);
  if (got.w >= 390 && !got.zoom && (got.l2.lines !== 1 || got.l3.lines !== 1))
    throw new Error(
      `幅 ${got.w}: 2 行目 ${got.l2.lines} 行・3 行目 ${got.l3.lines} 行（1 行ずつ）`,
    );
  const cuts = await summaryCuts(page, sel);
  if (cuts.length > 0) throw new Error(`要約の文字が切れる: ${cuts.join('、')}`);
}

/** 記録する画面の 1 段目「スクショを入れる」へ戻る（2 段目なら上の帯の ［スクショ］。2026-11-21） */
async function toInput(page) {
  const back = page.locator('#record-to-input');
  if (await back.isVisible()) await back.click();
  await page.locator('#record-statement-file').waitFor({ state: 'attached', timeout: 5000 });
}

/**
 * 記録する画面の 2 段目「振り返る」へ移り、LC の欄が出るまで待つ（2026-11-21）。LC が見えていればそのまま（書きかけに戻った
 * ときなど）。1 段目なら、要約があれば ［振り返りへ進む］、無ければ ［明細なしで手入力］（取引の欄のシートが開くので閉じる）
 */
async function toReview(page) {
  const lc = page.locator('#record-lc');
  const go = page.locator('#record-proceed');
  const manual = page.locator('#record-manual');
  await lc.or(go).or(manual).first().waitFor({ state: 'visible', timeout: 15000 });
  if (await lc.isVisible()) return;
  if (await go.isVisible()) {
    await go.click();
  } else {
    await manual.click();
    await page.locator('#record-fields-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
    await settleSheet(page);
    await closeSheets(page);
  }
  await lc.waitFor({ state: 'visible', timeout: 15000 });
}

/**
 * 取引の欄のシート（#130。銘柄・L / S・数量・イン・決済・時刻）を開く。要約があれば ［編集］、1 段目で要約があれば
 * ［振り返りへ進む］ の後に ［編集］、無ければ ［明細なしで手入力］（2 段目へ移ってシートが開く。2026-11-21）。
 * 開いていればそのまま
 */
async function openFields(page) {
  if ((await page.locator('#record-fields-sheet[open]').count()) > 0) return;
  // ほかのシート（判定・チャート）が開いていれば閉じてから
  await closeSheets(page);
  const go = page.locator('#record-proceed');
  if (await go.isVisible()) {
    await go.click();
    await page.locator('#record-lc').waitFor({ state: 'visible', timeout: 5000 });
  }
  const edit = page.locator('#record-edit-fields');
  if (await edit.isVisible()) await edit.click();
  else await page.locator('#record-manual').click();
  await page.locator('#record-fields-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
  await settleSheet(page);
}

/** ほかの欄（取引の欄のシートの段 2。#130） */
async function openMore(page) {
  await openFields(page);
  if ((await page.locator('#record-fields-sheet[open] #record-pnl').count()) > 0) return;
  await page.locator('#record-more').click();
  await page.locator('#record-fields-sheet[open] #record-pnl').waitFor({ timeout: 5000 });
  await settleSheet(page);
}

/** 判定のシート（下の帯の判定の 1 行を押す。#130） */
async function openVerdict(page) {
  // 編集の全画面のシートも同じ形（#131。id の頭が edit）
  const pre = new URL(page.url()).pathname.endsWith('/edit') ? 'edit' : 'record';
  await closeSheets(page);
  await page.locator(`#${pre}-verdict-line`).click();
  await page.locator(`#${pre}-verdict-sheet[open]`).waitFor({ state: 'visible', timeout: 5000 });
  await settleSheet(page);
}

/** チャートのシート（2 段目のチャートの行・1 段目のチャートのある小さな枠を押す。#130・2026-11-21） */
async function openChartSheet(page) {
  if ((await page.locator('#record-chart-sheet[open]').count()) > 0) return;
  await closeSheets(page);
  await page.locator('.rchart--full, .rchartrow--full').first().click();
  await page.locator('#record-chart-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
  await settleSheet(page);
}

/** 編集の全画面のシートのチャートのシートを開く（#131。チャートのある小さな枠が読み戻せてから） */
async function openEditChartSheet(page) {
  if ((await page.locator('#edit-chart-sheet[open]').count()) > 0) return;
  const mini = page.locator('#edit-mini-entry.rchart--full, #edit-mini-exit.rchart--full').first();
  await mini.locator('canvas').waitFor({ timeout: 15000 });
  await mini.click();
  await page.locator('#edit-chart-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
  await settleSheet(page);
}

/** 編集の取引の欄のシートを開く（#131。要約の ［編集］）。step = 'more' ならほかの欄まで */
async function openEditFields(page, step = 'main') {
  if ((await page.locator('#edit-fields-sheet[open]').count()) === 0) {
    await page.locator('#edit-edit-fields').click();
    await page.locator('#edit-fields-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
  }
  if (step === 'more') {
    await page.locator('#edit-more').click();
    await page.locator('#edit-fields-sheet[open] #record-pnl').waitFor({ timeout: 5000 });
  }
  await settleSheet(page);
}

/** 詳細の「すべての欄 ›」で次の画面へ（#131） */
async function openFieldsScreen(page) {
  await page.locator('a.rowlink', { hasText: 'すべての欄' }).click();
  await page.locator('h1', { hasText: 'すべての欄' }).waitFor({ timeout: 5000 });
  await page.locator('.fields__row').first().waitFor({ timeout: 15000 });
}

/** 開いているシートを上から全部閉じる（右上の ✕） */
async function closeSheets(page) {
  for (let i = 0; i < 4; i++) {
    const open = page.locator('dialog.sheet[open]');
    if ((await open.count()) === 0) return;
    await open.last().locator('.sheet__close').click();
    await settleSheet(page);
  }
}

const seg = (page, group, text) =>
  page.locator(`[role="radiogroup"][aria-label="${group}"] label.seg__item`, { hasText: text });

/**
 * 記録する画面の例（Issue #13 の例の表。値は架空）。taps = false ならタップの前で止める。LC を入る前に決めていたかは聞かず、
 * LC の欄から決める（価格 = 決めていた・LC なし = 決めていなかった。#202）
 */
async function fillRecord(page, ex, taps = true, lastTap = true) {
  // 取引の欄は取引の欄のシートで入れて閉じる（#130）。LC・2 つのタップは 1 画面のまま
  await openFields(page);
  await page.locator('#record-instrument').fill('US30');
  await seg(page, 'L / S', ex.side === 'S' ? 'S ショート' : 'L ロング').click();
  await page.locator('#record-entry').fill(ex.entry);
  await page.locator('#record-exit').fill(ex.exit);
  await page.locator('#record-quantity').fill('10000');
  await closeSheets(page);
  if (ex.lc === 'none') await page.locator('button.lcnone').click();
  else await page.locator('#record-lc').fill(ex.lc);
  if (!taps) return;
  if (ex.lc !== 'none') {
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
  move: '広げた',
  after: '99.20',
};
/** 危ない勝ち: LC を広げて耐え、+0.75 で決済（5.6 #13 の形。#202 で「決めていなかった」は記録する画面で選べないので広げたに替えた） */
const EX_E3 = {
  side: 'L',
  entry: '100.00',
  exit: '100.75',
  lc: '99.50',
  move: '広げた',
  after: '99.20',
};
const EX_E16 = { side: 'L', entry: '100.00', exit: '99.20', lc: 'none' };
/** 計画どおりの勝ち（そのまま・そのまま。+2.0R）。値は架空 */
const EX_SAFE = {
  side: 'L',
  entry: '100.00',
  exit: '101.00',
  lc: '99.50',
  move: 'そのまま',
};
/** Issue #33 例 8: S ショートで LC を広げた（広げた後の LC の欄が出る）。値は架空 */
const EX_S8 = {
  side: 'S',
  entry: '150.00',
  exit: '151.00',
  lc: '150.50',
  move: '広げた',
  after: '151.00',
};

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

/**
 * チャートを貼り、プレビューが出るまで待つ。エントリー時は 1 段目の枠か 2 段目のチャートの行に貼り（空はファイルの欄、ある枠・行は
 * そのものに data-chart-slot。2026-11-21）、決済時は 1 段目の小さな枠があればそこへ、無ければ（2 段目）チャートのシートの枠を
 * 選んで貼ってシートを閉じる。追加の枠はチャートのシートの枠を選んで（クリックでフォーカスして）貼る
 */
async function pasteChart(page, slot) {
  const mini = `#record-mini-${slot}`;
  if (slot === 'entry' || (slot === 'exit' && (await page.locator(mini).count()) > 0)) {
    const full = (await page.locator(`button${mini}`).count()) > 0;
    await makeChart(page, 'paste', full ? mini : `${mini}-file`);
    await page.locator(`${mini} canvas`).waitFor({ timeout: 10000 });
    return;
  }
  const sheet = slot === 'exit';
  if (sheet) await openChartSheet(page);
  const frame = page.locator(`#record-chart-${slot}`);
  await frame.locator('.chart__name').click();
  await makeChart(page, 'paste');
  await frame.locator('canvas.chart__preview').waitFor({ timeout: 10000 });
  if (sheet) await closeSheets(page);
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
async function fillFx(page, exit = '99.50', keepOpen = true) {
  await openFields(page);
  await page.locator('#record-instrument').fill(FAKE_USD_IDX.name);
  await seg(page, 'L / S', 'L ロング').click();
  await page.locator('#record-entry').fill('100.00');
  await page.locator('#record-exit').fill(exit);
  await page.locator('#record-quantity').fill('100');
  await closeSheets(page);
  await page.locator('#record-lc').fill('99.50');
  await seg(page, 'LC を動かしたか', 'そのまま').click();
  await seg(page, '時間足を変えたか', 'そのまま').click();
  // 為替の欄は取引の欄のシートの中（撮る・入れるために開いておく）
  if (keepOpen) await openFields(page);
}

const RECORD_STATES = [
  { slug: 'record-1-open', name: '開いた直後', fn: async () => {} },
  { slug: 'record-2-typing', name: '入力の途中', fn: (p) => fillRecord(p, EX_E1, false) },
  {
    slug: 'record-3-judged-b',
    name: '判定 B',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor();
    },
  },
  {
    slug: 'record-4-risky-win',
    name: '危ない勝ち',
    fn: async (p) => {
      await fillRecord(p, EX_E3);
      await p.locator('.vline .badge', { hasText: '危ない勝ち' }).waitFor();
    },
  },
  {
    slug: 'record-5-no-lc-c',
    name: 'LC なしの C',
    fn: async (p) => {
      await fillRecord(p, EX_E16);
      await p.locator('.vline .badge', { hasText: 'C 極悪な損失' }).waitFor();
    },
  },
  {
    // 保存の後は心理のシート「記録しました」が開く（#156。何も選んでいない = ［あとで］）
    slug: 'record-6-saved',
    name: '保存の後',
    noBar: true,
    anchor: '#record-emotion-sheet',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').click();
      await p.locator('#record-emotion-sheet[open]').waitFor();
      await p
        .locator('#record-emotion-sheet .emotions__actions button', { hasText: 'あとで' })
        .waitFor();
    },
  },
  {
    slug: 'record-6b-saved-emotion',
    name: '保存の後・心理 3 つ',
    noBar: true,
    anchor: '#record-emotion-sheet',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').click();
      const sheet = p.locator('#record-emotion-sheet[open]');
      await sheet.waitFor();
      for (const name of ['ポジりたい', '調子に乗った', '取り戻したい']) {
        // 選ぶ前後でチップの外寸が同じ（✓ の分だけ幅が増えて後ろのチップが動かない。#156 のデザインレビュー 2）
        const chip = sheet.getByRole('button', { name, exact: true });
        const before = await chip.boundingBox();
        await chip.click();
        await sheet.locator('.chip--toggle[aria-pressed="true"]', { hasText: name }).waitFor();
        // 押し込み（:active の scale）の戻りの動きが終わってから測る
        await p.waitForTimeout(300);
        const after = await chip.boundingBox();
        if (before && after && Math.abs(before.width - after.width) > 0.5)
          throw new Error(`${name}: 選ぶと幅が ${before.width}px → ${after.width}px`);
      }
      await sheet.locator('.emotions__actions button', { hasText: '完了' }).waitFor();
    },
  },
  {
    slug: 'record-6c-saved-closed',
    name: '保存の後・シートを閉じた',
    noBar: true,
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').click();
      await p.locator('#record-emotion-sheet[open]').waitFor();
      await p
        .locator('#record-emotion-sheet .emotions__actions button', { hasText: 'あとで' })
        .click();
      await p.locator('#record-emotion-sheet:not([open])').waitFor({ state: 'attached' });
      await p.getByRole('status').filter({ hasText: '記録しました' }).waitFor();
    },
  },
  {
    slug: 'record-7-reading',
    name: '明細の読み取り中',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 20000 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.getByRole('status').filter({ hasText: '読み取り中' }).waitFor();
      // プレビューは取引の欄のシートの中（1 画面は要約の骨組み。#130）
      await p.locator('canvas.statement__preview').waitFor({ state: 'attached' });
    },
  },
  {
    slug: 'record-8-read',
    name: '読み取りの後',
    // 1 画面（要約 3 行・LC から判定まで）を撮る。印のついた取引の欄は record-8b（シート）で撮る
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
    },
  },
  {
    slug: 'record-8b-read-fields',
    name: '読み取りの後（取引の欄）',
    anchor: '#record-fields-sheet',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await openFields(p);
      await p.locator('#record-fields-sheet .field__mark').first().waitFor();
    },
  },
  // 読み取りの終わりの知らせ（#166）: 入力が必要な欄つきの完了の文・失敗・キャンセル・複数行の次の行の知らせ
  {
    slug: 'record-8c-read-missing',
    name: '読み取りの後（入力が必要な欄 2）',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [{ ...READ_E1, quantity: null, exitTime: null }], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.rsum__status--done', { hasText: '入力が必要な欄 2' }).waitFor();
    },
  },
  {
    slug: 'record-8d-read-failed',
    name: '読み取りの失敗',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 502, rows: [], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.rstmt__card--retry [role="alert"]').waitFor();
    },
  },
  {
    slug: 'record-8e-read-cancelled',
    name: '読み取りのキャンセル',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 20000 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.getByRole('button', { name: '明細の読み取りをキャンセル' }).click();
      await p.locator('.rstmt__card--retry', { hasText: '読み取りをキャンセルしました' }).waitFor();
    },
  },
  {
    slug: 'record-8f-rows-next',
    name: '複数行の次の行の知らせ',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1, { ...READ_E1, symbol: '架空指数C' }], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.rsum__status--done', { hasText: '2 行を読み取りました' }).waitFor();
      await fillStatementTaps(p);
      await p.locator('#record-submit').click();
      await p.locator('.rsum__status--notice', { hasText: '1 / 2 行目を記録しました' }).waitFor();
    },
  },
  {
    // #180: 3 行の明細で 1 行目・2 行目を記録した後の 2 行目の知らせ（名前の上の 1 行）
    slug: 'record-8g-rows-next2',
    name: '複数行の 2 行目の後',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = {
        status: 200,
        rows: [READ_E1, { ...READ_E1, symbol: '架空指数C' }, { ...READ_E1, symbol: '架空指数D' }],
        holdMs: 0,
      };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.rsum__status--done', { hasText: '3 行を読み取りました' }).waitFor();
      for (const want of ['1 / 3 行目を記録しました', '2 / 3 行目を記録しました']) {
        await fillStatementTaps(p);
        await p.locator('#record-submit').click();
        await p.locator('.rsum__status--notice', { hasText: want }).waitFor();
      }
    },
  },
  {
    slug: 'record-9-rows',
    name: '複数行・時間帯',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: READ_E10, holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      // 行の進み具合は上の帯の右（9.3）。タイムゾーンのシートは自動では開かない（要約の行に印と ［タイムゾーンを選ぶ］。#130）
      await p.locator('.appbar__meta', { hasText: '1 / 3 行目' }).waitFor();
      await p.locator('.rsum__tzmark', { hasText: '時刻が未確定' }).waitFor();
      mustEq(
        await p.locator('#record-tz-sheet[open]').count(),
        0,
        '自動で開いたタイムゾーンのシート',
      );
      await p.locator('#record-tz-open').click();
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
      await p.locator('#record-tz-open').click();
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
      // 覚えたタイムゾーンで入れたときは要約の行に印を出さず、［タイムゾーンを選ぶ］ だけ（#58・#130）
      await p.locator('#record-tz-open').waitFor();
      mustEq(await p.locator('.rsum__tzmark').count(), 0, '覚えたタイムゾーンの印');
      await p.locator('#record-tz-open').click();
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
      // スマホの縦長のスクショ（1080 × 2340）。描き直すと 923 × 2000。プレビューは取引の欄のシートの先頭（#130）
      await makeImage(p, { w: 1080, h: 2340, type: 'image/png' }, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await openFields(p);
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
      await p.locator('#record-chart-exit-tf-mark').waitFor({ state: 'attached' });
      // 2 段目のチャートの行の 2 行目に読めた決済時の時間足（2026-11-21）
      await p.locator('#record-mini-entry', { hasText: '決済時 · 日足' }).waitFor();
      await openVerdict(p);
      await p
        .locator('.reasons__item', { hasText: '時間足を変えた（4 時間足 → 日足・チャートから）' })
        .waitFor();
      // チャートのシートで、枠を選んだ状態（輪と「貼り付けると差し替えられます」）を撮る
      await openChartSheet(p);
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
      // 2 段目のチャートの行（チャートのシートの中は「時間足を読み取っています…」。#130・2026-11-21）
      await p.locator('#record-mini-entry', { hasText: '時間足を読み取り中' }).waitFor();
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
      await openChartSheet(p);
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
      await openChartSheet(p);
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
      // 2026-11-21: 1 段目の空のチャートの枠はエントリー時だけ（決済時は入れてから見せる）。案の出し方は枠によらず同じなので
      // エントリー時の枠で見る
      await pasteChart(p, 'entry');
      await openChartSheet(p);
      await p.locator('#record-chart-entry-tf').selectOption('4h');
      await p.locator('#record-chart-entry .chart__suggest').waitFor({ timeout: 10000 });
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
      await p.locator('#record-mini-entry', { hasText: '決済時 · 日足' }).waitFor();
      // タップの下の 1 行（2 段目）と、判定のシートの理由の 2 行目
      await p.locator('.record__taps .field__hint', { hasText: 'チャートでは' }).waitFor();
      await openVerdict(p);
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
      // 追加の枠はチャートのシートの中（シートはチャートのある小さな枠から開く。#130）
      await pasteChart(p, 'entry');
      await openChartSheet(p);
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
      await pasteChart(p, 'entry');
      await openChartSheet(p);
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
      await pasteChart(p, 'entry');
      await openChartSheet(p);
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
      await pasteChart(p, 'entry');
      await openChartSheet(p);
      for (let i = 0; i < 5; i++) await p.locator('#record-chart-add').click();
      await pasteChart(p, 'x5');
      if (!(await p.locator('#record-chart-add').isDisabled()))
        throw new Error('5 枚で [＋ 追加] が押せる');
    },
  },
  // 2026-11-21: 記録する画面の 2 段（モックと同じ 6 状態。1 段目の空 = record-1-open・2 段目の読み取り中 = record-7-reading）
  {
    slug: 'record-40-stage1-statement',
    name: '1 段目（明細あり）',
    anchor: '.rin',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 20000 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      // 明細を選ぶとすぐ 2 段目（読み取りを待たない）。上の帯の ［スクショ］ で 1 段目へ戻る
      await p.locator('#record-lc').waitFor({ state: 'visible', timeout: 10000 });
      await p.locator('#record-to-input').click();
      await p.locator('.rin__card--filled .rin__desc', { hasText: '読み取り中' }).waitFor();
      await p.locator('#record-proceed').waitFor();
    },
  },
  // #184: 明細の削除・［元に戻す］・読み直しの途中・読み直しが失敗して前の明細に戻った状態
  {
    slug: 'record-45-stage1-removed',
    name: '1 段目（明細の削除の後）',
    anchor: '.rin',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await p.locator('#record-to-input').click();
      await p.locator('#record-statement-remove').click();
      await p
        .locator('.rin__removed', {
          hasText: '明細の値を削除しました。LC・一言・タップ・チャートは残っています',
        })
        .waitFor();
      if ((await p.locator('#record-statement-remove').count()) !== 0)
        throw new Error('削除の後も ［削除］ が残っている');
      // 押したボタンは消えるので、フォーカスは同じ枠の ［元に戻す］ へ
      await p.waitForFunction(() => document.activeElement?.id === 'record-statement-undo', null, {
        timeout: 3000,
      });
    },
  },
  {
    slug: 'record-46-stage1-undo',
    name: '1 段目（削除を元に戻す）',
    anchor: '.rin',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await p.locator('#record-to-input').click();
      const reads = api.reads.length;
      await p.locator('#record-statement-remove').click();
      await p.locator('#record-statement-undo').click();
      await p.locator('#record-statement-remove').waitFor();
      await p.locator('.rin__card--filled .rin__desc', { hasText: '読み取りました' }).waitFor();
      if (api.reads.length !== reads) throw new Error('削除・［元に戻す］ で読み取りの要求が出た');
    },
  },
  {
    slug: 'record-47-reread-reading',
    name: '2 段目（読み直しの途中）',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await p.locator('#record-to-input').click();
      api.read = { status: 200, rows: [READ_E1], holdMs: 20000 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.rsum__status--reading', { hasText: '別の明細を読み取り中…' }).waitFor({
        timeout: 10000,
      });
    },
  },
  {
    slug: 'record-48-reread-failed',
    name: '2 段目（読み直しの失敗で前の明細）',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await p.locator('#record-to-input').click();
      api.read = { status: 503, rows: [], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      const alert = p.locator('.rstmt [role="alert"]', { hasText: '今は読み取りを使えません' });
      await alert.waitFor({ timeout: 10000 });
      const said = await alert.textContent();
      if (!said?.includes('前の明細に戻しました。') || said.includes('手入力'))
        throw new Error(`前の明細に戻した文になっていない: ${said}`);
      // 前の明細の要約（読み取りの印つき）が出たまま
      await p.locator('#record-summary').waitFor();
    },
  },
  {
    slug: 'record-44-stage1-chart',
    name: '1 段目（明細とチャートあり）',
    anchor: '.rin',
    fn: async (p, api) => {
      // 明細とエントリー時のチャートが入った 1 段目（デザインレビュー a4）
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      api.chartTimeframes = ['1h'];
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await p.locator('#record-to-input').click();
      await pasteChart(p, 'entry');
      await p.locator('#record-mini-entry', { hasText: '1 時間足' }).waitFor({ timeout: 10000 });
      await p.locator('#record-proceed').waitFor();
    },
  },
  {
    // #164: 長い銘柄の名前も切らずに折り返す。向き・数量・イン → 決済・決済の時刻・明細の損益に見出し
    slug: 'record-45-read-long-name',
    name: '2 段目（長い銘柄の名前）',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = {
        status: 200,
        rows: [{ ...READ_E1, symbol: '架空ミニ指数先物 2026年12月限 ラージ' }],
        holdMs: 0,
      };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      const l2 = (await p.locator('#record-summary .rsum__l2').textContent()) ?? '';
      if (!/^L · 数量 2 · イン 100 → 決済 99$/.test(l2.replace(/\s+/g, ' ').trim()))
        throw new Error(`要約の 2 行目「${l2}」`);
      const l3 = (await p.locator('#record-summary .rsum__l3').textContent()) ?? '';
      if (!/^11\/10 \d\d:\d\d 決済 · 明細の損益 −2,000円$/.test(l3.replace(/\s+/g, ' ').trim()))
        throw new Error(`要約の 3 行目「${l3}」`);
      const cuts = await summaryCuts(p);
      if (cuts.length > 0) throw new Error(`要約の文字が切れる: ${cuts.join('、')}`);
    },
  },
  {
    // #164 のレビュー: 実際の桁の架空の値（6 万台の小数 1 桁の価格・6 桁の損益・オーナーの例と同じ長さの名前）。
    // 2・3 行目は ［編集］ の下まで全幅で、幅 390 以上では 1 行ずつ。行の頭に「·」「→」が来ない。何も切れない
    slug: 'record-46-read-real-digits',
    name: '2 段目（実際の桁）',
    anchor: '.rstmt',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_REAL], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await expectRealSummary(p, '#record-summary');
    },
  },
  {
    slug: 'record-41-read-judged',
    name: '2 段目（読み取りの後・判定）',
    anchor: '.rinput',
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      api.chartTimeframes = ['1h'];
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await pasteChart(p, 'entry');
      await p.locator('#record-mini-entry', { hasText: '1 時間足' }).waitFor({ timeout: 10000 });
      await p.locator('#record-lc').fill('99');
      await p.locator('#record-broken').fill('押し目の安値を割ったら');
      await seg(p, 'LC を動かしたか', 'そのまま').click();
      await seg(p, '時間足を変えたか', 'そのまま').click();
      await p.locator('.vline .badge').waitFor();
    },
  },
  {
    slug: 'record-42-manual',
    name: '2 段目（手入力）',
    anchor: '.rinput',
    fn: async (p) => {
      // ［明細なしで手入力］ は 2 段目へ移って取引の欄のシートを開く。閉じると要約と「未入力」のチップ
      await p.locator('#record-manual').click();
      await p.locator('#record-fields-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
      await settleSheet(p);
      await seg(p, 'L / S', 'S ショート').click();
      await closeSheets(p);
      await p.locator('.rsum__chip').first().waitFor();
    },
  },
  {
    slug: 'record-43-rows-accounts',
    name: '2 段目（2 行・口座 3 つ）',
    anchor: '.rinput',
    prep: (api) => setAccounts(api, ACCOUNTS_3_LONG),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1, { ...READ_E1, symbol: '架空指数C' }], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.appbar__sub', { hasText: '1 / 2 行目' }).waitFor();
      await p.locator('.rsum__accounts [role="radiogroup"]').waitFor();
    },
  },
  {
    slug: 'record-13-error',
    name: '誤り 1 欄',
    fn: async (p) => {
      // 帯の長い文の例 3（「誤り 1 欄・あと N 欄」）。決済の欄は取引の欄のシートの中（#130）
      await openFields(p);
      await p.locator('#record-exit').fill('x');
      await closeSheets(p);
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
      await openVerdict(p);
      await p
        .locator('.verdict__account', { hasText: '口座 B の資金 200,000円 に対して' })
        .waitFor();
    },
  },
  {
    // 口座 2 つの要約の下の Segment（#130。［明細なしで手入力］ の後の要約）
    slug: 'record-15b-accounts-2-top',
    name: '口座 2 つ（要約の下）',
    anchor: '.rstmt',
    prep: (api) => setAccounts(api, ACCOUNTS_2),
    fn: async (p) => {
      await openFields(p);
      await closeSheets(p);
      await seg(p, '口座', '口座 B').click();
      await p
        .locator('.seg--truncate .seg__input:checked[value="acc-b"]')
        .waitFor({ state: 'attached' });
    },
  },
  {
    // 口座 2 つで選択を替えた 2 枚目（✓ の幅を先に取り、境目が動かないこと。再レビュー N2）
    slug: 'record-15c-accounts-2-top-default',
    name: '口座 2 つ（要約の下・口座 1）',
    anchor: '.rstmt',
    prep: (api) => setAccounts(api, ACCOUNTS_2),
    fn: async (p) => {
      await openFields(p);
      await closeSheets(p);
      await seg(p, '口座', '口座 B').click();
      await seg(p, '口座', '口座 1').click();
      await p
        .locator('.seg--truncate .seg__input:checked[value="default"]')
        .waitFor({ state: 'attached' });
    },
  },
  {
    // 「ほかの欄（任意）」を開いた形（取引の欄のシートの段 2。決済の理由の .select の見た目。#130）
    slug: 'record-20-more-open',
    name: 'ほかの欄を開いた',
    anchor: '#record-fields-sheet',
    fn: async (p) => {
      await openMore(p);
      await p.locator('#record-exit-reason').waitFor();
      await p.locator('#record-exit-reason').scrollIntoViewIfNeeded();
    },
  },
  {
    slug: 'record-16-accounts-3-long',
    name: '口座 3 つ・長い名前',
    anchor: '.rstmt',
    prep: (api) => setAccounts(api, ACCOUNTS_3_LONG),
    fn: async (p) => {
      await openFields(p);
      await closeSheets(p);
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
      // 口座 4 つ以上は取引の欄のシートの select（要約の先頭の札から開く。#130）
      await openFields(p);
      await p.locator('select#record-account').selectOption('acc-c');
      await fillRecord(p, EX_E1);
      await p.locator('.rsum__account', { hasText: '口座 C' }).waitFor();
      await openVerdict(p);
      await p.locator('.verdict__account', { hasText: '口座 C（資金は未設定）' }).waitFor();
    },
  },
  {
    slug: 'record-18-add-open',
    name: '口座を追加する欄',
    anchor: '#record-fields-sheet',
    fn: async (p) => {
      await openFields(p);
      await p.locator('#record-account-add').click();
      await p.locator('#record-account-new-name').fill('口座 C');
      await p.locator('#record-account-new-capital').fill('300,000');
    },
  },
  {
    slug: 'record-19-add-error',
    name: '口座を追加する欄の誤り',
    anchor: '#record-fields-sheet',
    fn: async (p) => {
      await openFields(p);
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
      await openMore(p);
      await p.locator('#record-pnl').fill('-9100');
      await p.locator('#record-fee').fill('100');
      await p.getByRole('button', { name: '取引の欄へ戻る' }).click();
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
    anchor: '.record__taps',
    fn: async (p) => {
      await openFields(p);
      await p.locator('#record-instrument').fill('US30');
      await seg(p, 'L / S', 'S ショート').click();
      await p.locator('#record-entry').fill('150.00');
      await p.locator('#record-exit').fill('150.20');
      await p.locator('#record-quantity').fill('10000');
      await closeSheets(p);
      await p.locator('#record-lc').fill('150.50');
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
      await openFields(p);
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
      await openVerdict(p);
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
      await openVerdict(p);
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
    anchor: '#record-fields-sheet',
    prep: (api) => setAccounts(api, [{ ...ACC_USD, id: 'default' }]),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await openMore(p);
      await p.locator('#record-money-note', { hasText: '明細の損益は JPY です' }).waitFor();
    },
  },
  {
    // 口座 2 つ・明細の特徴の覚えあり（#66 AC-11・R4: 提案の口座 B が選ばれ、口座の欄に印「自動で選択」）
    slug: 'record-29-account-suggested',
    name: '明細から口座',
    anchor: '.rstmt',
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
    anchor: '.rstmt',
    prep: (api) => setAccounts(api, ACCOUNTS_ALNUM),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0, profile: PROFILE_NEW };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p
        .locator('#record-account-hint', { hasText: 'この明細の口座を選んでください' })
        .waitFor();
      await p.locator(READ_DONE).first().waitFor();
      mustEq(await p.locator('#record-account-mark').count(), 0, '初めての明細の口座の印');
    },
  },
  {
    // 自動で選んだ後に選び直した（#66 R4: 印「自動で選択」が消える・「直した」にしない）
    slug: 'record-32-account-rechosen',
    name: '選び直した口座',
    anchor: '.rstmt',
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
    anchor: '.rstmt',
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
    anchor: '#record-fields-sheet',
    prep: (api) =>
      setAccounts(api, [...ACCOUNTS_ALNUM, { ...ACC_C, id: 'accC' }, { ...ACC_D, id: 'accD' }]),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_E1], holdMs: 0, profile: PROFILE_B };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      // 口座 4 つ以上は要約の先頭の札、select と印は取引の欄のシートの中（#130）
      await p.locator('.rsum__account', { hasText: '口座 B' }).waitFor();
      await openFields(p);
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
      await p.locator(READ_DONE).first().waitFor();
      await fillRecord(p, EX_E1);
      await p.locator('button[type="submit"]').click();
      // 心理のシート（#156）を閉じてから、保存の後の 1 行を見る
      await waitSaved(p, '記録しました');
      await p.getByText('次からこの明細は', { exact: false }).waitFor();
      mustEq(api.profiles.length, 1, '覚えの送信');
    },
  },
  {
    // USD の口座に USD の明細（#66 C4: 損益・手数料が入る・注記なし）
    slug: 'record-36-usd-statement-usd',
    name: 'USD の口座に USD の明細',
    anchor: '#record-fields-sheet',
    prep: (api) => setAccounts(api, [{ ...ACC_USD, id: 'default' }]),
    fn: async (p, api) => {
      api.read = { status: 200, rows: [READ_USD], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await openMore(p);
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
    anchor: '#record-fields-sheet',
    fn: async (p, api) => {
      api.read = {
        status: 200,
        rows: [{ ...READ_E1, pnl: -62, feesTotal: 2, fees: [2], pnlCurrency: 'USD' }],
        holdMs: 0,
      };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor();
      await openMore(p);
      await p.locator('#record-money-note', { hasText: '明細の損益は USD です' }).waitFor();
    },
  },
  {
    slug: 'record-10-read-failed',
    name: '読み取りの失敗',
    anchor: '.rstmt',
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
    anchor: '.record__taps',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await openInfo(p, '「LC を動かしたか」の説明');
      await p.getByText('広げた（リスクが増える向き）', { exact: false }).first().waitFor();
    },
  },
  {
    // #201: LC の欄の名前の横の「i」で「逆指値 未設定」の説明（「LC なし」との違い・取消へのリンク）
    slug: 'record-11c-info-stop',
    name: '説明（逆指値 未設定）',
    reopen: '「逆指値 未設定」の説明',
    anchor: '.record__lc',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await openInfo(p, '「逆指値 未設定」の説明');
      await p
        .getByText('「LC なし」（LC を入る前に決めていなかった）とは違います', { exact: false })
        .first()
        .waitFor();
    },
  },
  {
    slug: 'record-11-info-tap',
    name: '説明（時間足）',
    reopen: '「時間足を変えたか」の説明',
    anchor: '.record__taps',
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
      await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor();
      await openVerdict(p);
      await openInfo(p, '「判定」の説明');
    },
  },
  {
    slug: 'record-13-info-r',
    name: '説明（R）',
    reopen: '「R」の説明',
    fn: async (p) => {
      await fillRecord(p, EX_E1);
      await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor();
      await openVerdict(p);
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
      await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor();
      await openVerdict(p);
      await openInfo(p, '「LC の物差し」の説明');
    },
  },
  {
    slug: 'record-15-info-statement',
    name: '説明（明細）',
    reopen: '「明細の送り方」の説明',
    // 明細の注意は 1 段目の明細の枠の下（2026-11-21）
    anchor: '.rin',
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
      await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor();
      // 判定は判定のシートの中（#130）。開いてから説明を開いてたどる
      await openVerdict(p);
      await openInfo(p, '「判定」の説明');
      await followLink(p, 'LC', 'LC');
      await followLink(p, '1R', '1R');
    },
  },
];

/** 層を開いたまま移って戻った後、元の項目の scrollRestoration が auto に戻っている（#57 再レビュー B2・N12） */
/**
 * 詳細で消す（#131: 削除は上の帯の「…」の操作のシートの中。確認は挟まない）。how = 'key' はキーで「…」を開き、シートの
 * 「削除」へフォーカスして Enter
 */
async function deleteFromDetail(page, how = 'click') {
  const more = page.locator('#detail-more');
  if (how === 'key') {
    await more.focus();
    await page.keyboard.press('Enter');
  } else {
    await more.click();
  }
  await page.locator('#detail-actions-sheet[open]').waitFor({ timeout: 5000 });
  const del = page.locator('#detail-action-delete');
  if (how === 'key') {
    await del.focus();
    await page.keyboard.press('Enter');
  } else {
    await del.click();
  }
}

async function expectRestore(page, what) {
  // 記録する画面は戻ると読み込み直す（中身が描けるまで背が低い）ので、ブラウザの位置の復元そのものは S1（部品の見本）で測る。
  // ここでは元の項目に manual が残っていないこと（B2）だけを見る
  await toReview(page);
  await page.waitForTimeout(300);
  const mode = await page.evaluate(() => history.scrollRestoration);
  if (mode !== 'auto') throw new Error(`${what}: scrollRestoration = ${mode}`);
}

/** 「i」のボタン（シートを開いている間、後ろは inert なので役割ではなく名前の属性で探す） */
const infoButton = (page, name) => page.locator(`button.info[aria-label="${name}"]`).first();
/**
 * 開いている説明のシート（#129）。記録する画面のシート（取引の欄・判定など。#130。id は record-…-sheet）の上に重なることがあるので、
 * それらは除く。明細の送り方の説明（id record-statement-info）は説明のシートなので除かない（#131 で見つけた: 前は record- の頭で
 * 全部を除いていて「説明（明細）」の状態が「シートが無い」になっていた）
 */
const OPEN_SHEET = 'dialog.sheet[open]:not([id^="record-"][id$="-sheet"])';
const sheetCount = (page) => page.locator(OPEN_SHEET).count();
/** 開いているシートの見出し（無ければ null）。重なっているときは一番上（記録する画面の判定のシートの上の説明。#130） */
async function sheetTitle(page) {
  const t = page.locator(`${OPEN_SHEET} .sheet__title`);
  return (await t.count()) === 0 ? null : ((await t.last().textContent())?.trim() ?? '');
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

/**
 * 開いているシートの箱と窓の大きさ（#129。窓の中か・下からか・最大の高さを見る）。sel を渡せばそのシート（既定は記録する画面の
 * 全画面の中のシートを除く OPEN_SHEET）
 */
async function sheetBox(page, sel = OPEN_SHEET) {
  return page.evaluate((sel) => {
    // 重なっているときは一番上（後に開いた方。#130）
    const d = [...document.querySelectorAll(sel)].at(-1);
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
  }, sel);
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
  await page
    .locator(`${OPEN_SHEET}`)
    .last()
    .locator('button.glink', { hasText: linkText })
    .first()
    .click();
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
const closeSheet = (page) => page.locator(`${OPEN_SHEET} .sheet__close`).last().click();

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

/** 設定の画面の題と、開いた後に待つ要素（#133: 設定はタブの根のまとめた一覧と、口座・銘柄・AI の利用状況の次の画面に分けた） */
const SETTINGS_SCREENS = {
  '/settings': { h1: '設定', wait: '#settings-link-accounts .rowlink__meta' },
  '/settings/accounts': { h1: '口座', wait: '#settings-account-add' },
  '/settings/instruments': { h1: '銘柄', wait: '#settings-inst-add' },
  '/settings/ai-usage': { h1: 'AI の利用状況', wait: '.usage' },
};

/** 設定の画面を開き、中身（根は口座の数の添え、口座・銘柄は ［＋ 〇〇を追加］）が出るまで待つ */
async function openSettings(page, base, path = '/settings') {
  const screen = SETTINGS_SCREENS[path];
  if (!screen) throw new Error(`openSettings: 知らない画面 ${path}`);
  await page.goto(`${base}${path}`);
  await waitReady(page, screen.h1);
  await page.locator(screen.wait).first().waitFor({ state: 'visible', timeout: 15000 });
}

/** 開いている下のシート（設定の編集・追加。#133）が見えるまで待つ */
async function waitSettingsSheet(page, id) {
  await page.locator(`dialog#${id}[open]`).waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * 設定の画面の状態（幅 × テーマで測る）。path は開く画面（#133）、prep は開く前に偽の API を整え、fn は開いた画面をその状態にする。
 * 編集・追加は下のシートを開いた状態で測る
 */
const SETTINGS_STATES = [
  {
    slug: 'settings-1-open',
    name: '根（まとめた一覧）',
    path: '/settings',
    prep: seedSettings,
    fn: async (p) => {
      await p.locator('#settings-link-aiUsage .rowlink__meta').waitFor();
    },
  },
  {
    slug: 'settings-5-accounts',
    name: '口座 2 つ（未設定の行）',
    path: '/settings/accounts',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_C]);
    },
    fn: async (p) => {
      await p.locator('.setrow', { hasText: '資金 未設定 · 許容 1%' }).waitFor();
    },
  },
  {
    slug: 'settings-6-account-edit',
    name: '口座の編集のシート',
    path: '/settings/accounts',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_B]);
    },
    fn: async (p) => {
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      await p.locator('#settings-account-name').waitFor();
      await p.locator('.sethistory__title', { hasText: '資金の履歴（3 件）' }).waitFor();
    },
  },
  {
    slug: 'settings-7-account-add',
    name: '口座の追加のシート',
    path: '/settings/accounts',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, ACCOUNTS_2);
    },
    fn: async (p) => {
      await p.locator('#settings-account-add').click();
      await waitSettingsSheet(p, 'settings-account-sheet');
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
    path: '/settings/accounts',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_USD]);
    },
    fn: async (p) => {
      await p.locator('.setrow', { hasText: '10,000.00 USD · 許容 1%' }).waitFor();
      await p.getByRole('button', { name: '口座 D を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      await p.locator('#settings-account-currency').waitFor();
    },
  },
  {
    // #47 PR-2 U31: 取引のある口座（既定の口座。例の取引は口座が付いていない）の直す欄は通貨が文字
    slug: 'settings-9-currency-locked',
    name: '通貨を変更できない口座',
    path: '/settings/accounts',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_USD]);
    },
    fn: async (p) => {
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      // 通貨を変える操作のときだけ取引を確かめる（開いたときは読まない）。取引のある口座は文字に戻る
      await p.locator('input#settings-account-currency').fill('USD');
      await p
        .locator('#settings-account-currency', { hasText: '取引があるので変更できません' })
        .waitFor();
    },
  },
  {
    slug: 'settings-15-instruments',
    name: '銘柄の一覧',
    path: '/settings/instruments',
    prep: seedSettings,
    fn: async (p) => {
      await p.locator('.setrow', { hasText: '初期値のまま' }).waitFor();
    },
  },
  {
    slug: 'settings-2-editing',
    name: '銘柄の編集のシート',
    path: '/settings/instruments',
    prep: seedSettings,
    fn: async (p) => {
      await p.getByRole('button', { name: 'US30 を編集' }).click();
      await waitSettingsSheet(p, 'settings-inst-sheet');
      await p.locator('#settings-inst-name').waitFor();
      await p.locator('#settings-inst-kind').selectOption('index');
      await p.locator('#settings-inst-currency').fill('USD');
    },
  },
  {
    slug: 'settings-16-inst-add',
    name: '銘柄の追加のシート',
    path: '/settings/instruments',
    prep: seedSettings,
    fn: async (p) => {
      await p.locator('#settings-inst-add').click();
      await waitSettingsSheet(p, 'settings-inst-add-sheet');
      await p.locator('#settings-new-name').fill('xau');
      await p
        .locator('#settings-new-name-error', { hasText: '同じ名前の銘柄があります' })
        .waitFor();
    },
  },
  {
    // 口座の誤りと警告（#133 で銘柄の誤りは settings-3b-inst-errors に分けた。画面が別になったため）
    slug: 'settings-3-errors',
    name: '口座の誤りと警告',
    path: '/settings/accounts',
    prep: seedSettings,
    fn: async (p) => {
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      await p.locator('#settings-account-capital').fill('1000.5');
      await p.locator('#settings-account-risk').fill('2.5');
      await p.getByRole('status').filter({ hasText: '2% を超えています' }).waitFor();
    },
  },
  {
    slug: 'settings-3b-inst-errors',
    name: '銘柄の誤り',
    path: '/settings/instruments',
    prep: seedSettings,
    fn: async (p) => {
      await p.getByRole('button', { name: 'US30 を編集' }).click();
      await waitSettingsSheet(p, 'settings-inst-sheet');
      await p.locator('#settings-inst-name').fill('日経２２５ ');
      await p.locator('#settings-inst-currency').fill('US');
      await p.locator('#settings-inst-multiplier').fill('0');
      await p.getByText('同じ名前の銘柄があります').waitFor();
    },
  },
  {
    slug: 'settings-4-unset',
    name: '資金が未設定',
    path: '/settings/accounts',
    prep: (api) => {
      api.instruments.splice(0, api.instruments.length, FAKE_US30_AUTO);
    },
    fn: async (p) => {
      await p
        .locator('.setrow', { hasText: '資金を入力するとリスク（%）が表示されます' })
        .waitFor();
    },
  },
  {
    slug: 'settings-8-usage-reached',
    name: 'AI 金額で届いた',
    path: '/settings/ai-usage',
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
    path: '/settings/ai-usage',
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
    path: '/settings/ai-usage',
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
    path: '/settings/ai-usage',
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
    path: '/settings/ai-usage',
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
    path: '/settings/ai-usage',
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
    path: '/settings/ai-usage',
    prep: (api) => {
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_B]);
      api.aiUsage = { status: 503, body: { error: 'read_unavailable' } };
    },
    fn: async (p) => {
      // AC-7（#62）の「読めなくても口座の編集と [保存] は使える」は、#133 で別の画面になったので SET6 で見る
      await p.getByText('利用状況を読み込めませんでした').waitFor();
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
          // 下のシート（dialog.sheet とその面）は画面と同じ 1 枚の面の層で、枠の段に数えない（シートの上の中身は画面の中身と
          // 同じ規則で数える。#130 で取引の欄・チャートのシートの中に今の枠を置いた）
          if (
            el !== document.body &&
            el !== document.documentElement &&
            !el.matches('dialog.sheet, .sheet__panel')
          ) {
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
          // 判定が出ている間の状態の文は読み上げだけ（.sr-only）なので、見えている判定の 1 行（.vline）を測る（#130）
          const statusEl =
            barEl.querySelector('.record__status:not(.sr-only), .record__missing') ??
            barEl.querySelector('.vline');
          let lines = 0;
          if (statusEl && statusEl.textContent.trim() !== '') {
            const range = document.createRange();
            range.selectNodeContents(statusEl);
            // 縦に重なる箱は同じ行（判定の 1 行はバッジ・大きな R・リスクの高さが違う。#130）
            const rects = [...range.getClientRects()]
              .filter((rr) => rr.width > 0 && rr.height > 0)
              .sort((a, b) => a.top - b.top);
            let bottom = -Infinity;
            for (const rr of rects) {
              if (rr.top >= bottom - 1) {
                lines++;
                bottom = rr.bottom;
              } else bottom = Math.max(bottom, rr.bottom);
            }
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
    // LC の物差しの見出し（「LC の物差し」と「i」）が図の印・目盛りに重なる（文字どうしではないので上では数えない。#110・#131）
    for (const head of document.querySelectorAll('.ruler__head')) {
      const plot = head.closest('.ruler')?.querySelector('.ruler__plot');
      if (!plot) continue;
      const hr = head.getBoundingClientRect();
      if (hr.width < 1 || hr.height < 1) continue;
      for (const g of plot.querySelectorAll('.ruler__mark, .ruler__tick, .ruler__beyond')) {
        const gr = g.getBoundingClientRect();
        if (gr.width < 0.5 && gr.height < 0.5) continue;
        if (hit(hr, gr)) {
          overlap.push(
            `物差しの見出しが図（${g.getAttribute('class')?.split(' ')[0] ?? ''}「${(g.textContent ?? '').trim()}」）に重なる`,
          );
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
            await deleteFromDetail(tp);
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
                // 1 段目「スクショを入れる」は判定の帯・［記録する］ を置かない（2026-11-21）
                const input = (await recPage.locator('form[data-stage="input"]').count()) > 0;
                if (!st.noBar && !input) problems.push(`${label}: 貼り付きの帯が無い`);
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
          const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`${st.path}（${st.name}）`, 22)}`;
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
            await openSettings(recPage, base, st.path);
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
        // #132: 口座の名前は幅によらず 1 行目の銘柄・L / S の後ろ（デザイン a1）
        const ACCOUNT_ROW = '.traderow__account:visible';
        for (const [path, h1, wait, slug, after] of [
          ['/trades', '取引', ACCOUNT_ROW, 'trades-accounts'],
          // ホームの詰めた行は 2 行目に口座の名前（#128）
          ['/', 'ホーム', '.homerow__sub:has-text(" · 口座")', 'home-accounts'],
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
        // 振り返りのタブの規律の振り返り（Issue #88 AC-12。#128 でホームから `/review` へ移した。期待は同じ）: 期間ごと・件数が
        // 少ない・0 件・期間の誤り・取り込みを含める / 外す・「数で見る」の画面。取引を一時だけ S1（架空の値）に替えて測り、後で戻す
        {
          const ymd = (d) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const today = new Date();
          const back5 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 5);
          const REVIEW_STATES = [
            ['/review?period=7d', REVIEW_S1, '.curve', 'review-7d'],
            ['/review?period=1d', REVIEW_S1, '.review__ratecard', 'review-1d'],
            ['/review?period=1m', REVIEW_S1, '.curve', 'review-1m'],
            ['/review?period=3m', REVIEW_S1, '.curve', 'review-3m'],
            [
              `/review?period=custom&from=${ymd(today)}&to=${ymd(back5)}`,
              REVIEW_S1,
              '#review-to-error',
              'review-custom-error',
            ],
            [
              `/review?period=custom&from=${ymd(back5)}&to=${ymd(today)}`,
              REVIEW_S1,
              '.curve',
              'review-custom',
            ],
            [
              '/review?period=custom&from=2020-01-01&to=2020-01-31',
              REVIEW_S1,
              '.review__empty',
              'review-empty',
            ],
            ['/review?period=7d', REVIEW_S2, '.review__missing', 'review-few'],
            // レビュー後に足した状態（#88 Phase 4b）: 差が無い・大きな負け・取引の多い期間（合成 120 件）・読み込み中・
            // 「i」を開いた・キーボードのフォーカス
            ['/review?period=7d', REVIEW_NOGAP, '.curve', 'review-nogap'],
            ['/review?period=7d', REVIEW_BIG, '.curve', 'review-bigloss'],
            ['/review?period=3m', REVIEW_MANY, '.curve', 'review-many'],
            ['/review?period=7d', REVIEW_S1, '.review .loading', 'review-loading', null, 200, 4000],
            [
              '/review?period=7d',
              REVIEW_S1,
              '.curve',
              'review-info',
              async (pg) => {
                await pg.locator('.review button[aria-label="「規律コスト」の説明"]').click();
                await pg.locator('dialog.sheet[open] .info__lead').first().waitFor();
              },
            ],
            ['/review?period=7d', REVIEW_CLEAN, '.curve', 'review-clean'],
            ['/review?period=1d', REVIEW_OLD, '.review__empty', 'review-empty-1d'],
            ['/review?period=7d', REVIEW_OLD, '.review__empty', 'review-empty-7d'],
            ['/review?period=1m', REVIEW_OLD, '.review__empty', 'review-empty-1m'],
            ['/review?period=3m', REVIEW_OLD, '.review__empty', 'review-empty-3m'],
            [
              '/review?period=7d',
              REVIEW_S1,
              '.curve',
              'review-switching',
              async (pg) => {
                recApi.rangeHoldMs = 4000;
                await seg(pg, '期間', '1か月').click();
                await pg.locator('.review__body--busy').waitFor();
              },
            ],
            [
              '/review?period=7d',
              REVIEW_S1,
              '.curve',
              'review-info-rate',
              async (pg) => {
                await pg.locator('.review button[aria-label="「計画どおり率」の説明"]').click();
                await pg.locator('dialog.sheet[open] .info__lead').first().waitFor();
              },
            ],
            [
              '/review?period=7d',
              [...REVIEW_S1, ...REVIEW_IMPORTS],
              '.review__toggle',
              'review-focus-toggle',
              async (pg) => {
                await pg.locator('input[name="review-period"]:checked').focus();
                await pg.keyboard.press('Tab');
                await pg.waitForFunction(() =>
                  document.activeElement?.classList.contains('review__check'),
                );
              },
            ],
            // 「数で見る」は次の画面（#128。その場で開く折りたたみをやめた）: 見出しから Tab で横に送る表の箱へ
            [
              '/review/table?period=7d',
              REVIEW_S1,
              '.review__table table',
              'review-focus-table',
              async (pg) => {
                await pg.locator('main h1').first().focus();
                for (let i = 0; i < 6; i++) {
                  await pg.keyboard.press('Tab');
                  const at = await pg.evaluate(() =>
                    document.activeElement?.classList.contains('review__scroll'),
                  );
                  if (at) break;
                }
                await pg.waitForFunction(() =>
                  document.activeElement?.classList.contains('review__scroll'),
                );
              },
            ],
            [
              '/review?period=7d',
              REVIEW_S1,
              '.curve',
              'review-focus',
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
              '/review?period=7d',
              [...REVIEW_S1, ...REVIEW_IMPORTS],
              '.review__toggle',
              'review-imports-off',
            ],
            [
              '/review?period=7d&imports=1',
              [...REVIEW_S1, ...REVIEW_IMPORTS],
              '.review__toggle',
              'review-imports-on',
            ],
            ['/review?period=7d', REVIEW_IMPORTS, '.review__toggle', 'review-imports-only'],
            // 気づき（#162）: 心理ごとの集計（件数が十分な行・件数が少ない行・平常心）と、心理の付いた取引が無い期間
            ['/review?period=7d&view=insight', REVIEW_INSIGHT, '.insight__row', 'review-insight'],
            ['/review?period=7d&view=insight', REVIEW_S1, '.insight', 'review-insight-none'],
            [
              '/review?period=7d&view=insight',
              REVIEW_INSIGHT_LONG,
              '.insight__row',
              'review-insight-long',
            ],
            // 気づきの連勝の後のカード（#185）
            ['/review?period=7d&view=insight', REVIEW_STREAK, '.winrun', 'review-insight-streak'],
            // 期間の取引（#185）: 心理の行から・連勝の後から・知らない心理
            [
              '/review/trades?period=7d&emotion=recoup',
              REVIEW_INSIGHT,
              '.traderow',
              'review-trades',
            ],
            [
              '/review/trades?period=7d&after=winStreak',
              REVIEW_STREAK,
              '.traderow',
              'review-trades-streak',
            ],
            [
              '/review/trades?period=7d&emotion=foo',
              REVIEW_INSIGHT,
              '.review__empty',
              'review-trades-empty',
            ],
            ['/review/table?period=7d', REVIEW_S1, '.review__table table', 'review-table'],
            ['/review/table?period=7d', [], '.review__empty', 'review-table-empty'],
            ['/review?period=7d', REVIEW_S1, '.review .notice--error', 'review-failed', null, 503],
          ];
          for (const [path, trades, wait, slug, after, rangeStatus, holdMs] of REVIEW_STATES) {
            const tp = pageFor.get(false);
            const label = `${w}x${hgt} ${pad(theme, 5)} ${pad(`振り返り ${slug.replace('review-', '')}`, 22)}`;
            const saved = recApi.trades;
            try {
              recApi.trades = [...trades];
              recApi.rangeStatus = rangeStatus ?? 200;
              recApi.rangeHoldMs = holdMs ?? 0;
              await tp.goto(base + path);
              await waitReady(
                tp,
                path.startsWith('/review/table')
                  ? '数で見る'
                  : path.startsWith('/review/trades')
                    ? REVIEW_TRADES_TITLE[slug]
                    : '振り返り',
              );
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
          // RV1（幅 360・ダークで 1 回。#128 で振り返りのタブ `/review` へ）: 5 つの期間を順に押す → URL の検索部分が置き換わり
          // （履歴の数が増えない）、フォーカスは押した選択肢に残る（見出しへ移らない）。開き直すと同じ期間。7 日の S1 の数字が出る。
          // 「数で見る ›」は同じ期間の次の画面（`/review/table?period=3m`）で、戻ると同じ期間の振り返り
          if (w === 360 && theme === 'dark') {
            const tp = pageFor.get(false);
            const saved = recApi.trades;
            const expectEq = (got, want, what) => {
              if (got !== want)
                throw new Error(`${what}: ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`);
            };
            try {
              recApi.trades = [...REVIEW_S1];
              await tp.goto(`${base}/review`);
              await waitReady(tp, '振り返り');
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
                ['custom', '指定'],
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
                // 貼り付く期間の帯は 5 つの選択肢の行だけ（指定の日付の欄は帯の外で流れる。#128 デザイン a5）
                if (key === 'custom') {
                  const bar = await tp.evaluate(() => {
                    const b = document.querySelector('.review__period-bar');
                    return {
                      h: b ? Math.round(b.getBoundingClientRect().height) : 0,
                      dates: b ? b.querySelectorAll('input[type="date"]').length : -1,
                      outside: document.querySelectorAll('.review__dates input[type="date"]')
                        .length,
                    };
                  });
                  expectEq(bar.dates, 0, 'RV1: 貼り付く帯の中の日付の欄');
                  expectEq(bar.outside, 2, 'RV1: 帯の外の日付の欄');
                  if (bar.h > 80)
                    throw new Error(`RV1: 貼り付く帯の高さ ${bar.h}px（期待 80 以下）`);
                }
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
              await waitReady(tp, '振り返り');
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
              // 「数で見る ›」→ 同じ期間の次の画面（表）→ 戻ると同じ期間の振り返り（#128）
              await tp.locator('.review__more a.rowlink', { hasText: '数で見る' }).click();
              await waitReady(tp, '数で見る');
              expectEq(
                await tp.evaluate(() => location.pathname + location.search),
                '/review/table?period=3m',
                'RV1: 数で見るの URL',
              );
              await tp.locator('.review__table table').waitFor({ timeout: 15000 });
              expectEq(
                await tp.locator('.review__meta').textContent(),
                meta,
                'RV1: 数で見るの範囲と件数',
              );
              expectEq(
                await tp.locator('.appbar__back').first().getAttribute('aria-label'),
                '振り返りへ戻る',
                'RV1: 上の帯の戻る',
              );
              await tp.locator('.appbar__back').first().click();
              await waitReady(tp, '振り返り');
              expectEq(
                await tp.evaluate(() => location.pathname + location.search),
                '/review?period=3m',
                'RV1: 戻った振り返りの期間',
              );
              console.log('RV1 期間の置き換え・フォーカス・再読み込み・数で見る ok');
            } catch (e) {
              const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
              console.log(`RV1 NG ${msg}`);
              problems.push(`RV1: ${msg}`);
            } finally {
              recApi.trades = saved;
            }
          }
          // ST1（幅 360・ダークで 1 回。Issue #35・#128）: ホームの直近の流れは点 10 個が 1 行に並び（同じ高さ・カードの中）、
          // 並びの名前が「直近 10 件の判定（古い順）」、見出しの文が出る。ホームの並びは 見出し → 直近の流れ → 今月の規律 →
          // 直近の取引（#128）。一覧の上には直近の流れを置かない（#128。設計書 9.2・9.3）
          if (w === 360 && theme === 'dark') {
            const tp = pageFor.get(false);
            try {
              await tp.goto(`${base}/`);
              await waitReady(tp, 'ホーム');
              await tp.locator('.streak__item').first().waitFor({ timeout: 15000 });
              const r = await tp.evaluate(() => {
                const card = document.querySelector('.streak');
                const items = [...document.querySelectorAll('.streak__item')];
                const cb = card?.getBoundingClientRect();
                const tops = new Set(items.map((li) => Math.round(li.getBoundingClientRect().top)));
                const outside = items.filter((li) => {
                  const b = li.getBoundingClientRect();
                  return !cb || b.left < cb.left || b.right > cb.right;
                }).length;
                const KINDS = [
                  'homehead',
                  'homedraft',
                  'streak',
                  'homemonth',
                  'homerecent',
                  'review',
                ];
                const order = [
                  ...document.querySelectorAll(KINDS.map((k) => `main .${k}`).join(', ')),
                ].map((e) => KINDS.find((k) => e.classList.contains(k)));
                return {
                  n: items.length,
                  rows: tops.size,
                  outside,
                  label: document.querySelector('.streak__dots')?.getAttribute('aria-label'),
                  headline: document.querySelector('.streak__headline')?.textContent ?? '',
                  order,
                };
              });
              const where = 'ST1 /';
              if (r.n !== 10) throw new Error(`${where}: 点の数 ${r.n}（期待 10）`);
              if (r.rows !== 1) throw new Error(`${where}: 点の行 ${r.rows}（期待 1）`);
              if (r.outside !== 0) throw new Error(`${where}: カードの外の点 ${r.outside}`);
              if (r.label !== '直近 10 件の判定（古い順）')
                throw new Error(`${where}: 並びの名前 ${r.label}`);
              if (!/続いています|直近の取引は/.test(r.headline))
                throw new Error(`${where}: 見出しの文 ${r.headline}`);
              if (r.order.join(',') !== 'homehead,streak,homemonth,homerecent')
                throw new Error(`${where}: 並び ${r.order.join(',')}`);
              await tp.goto(`${base}/trades`);
              await waitReady(tp, '取引');
              await tp.locator('.traderow').first().waitFor({ timeout: 15000 });
              const onList = await tp.locator('main .streak').count();
              if (onList !== 0) throw new Error(`ST1 /trades: 直近の流れ ${onList} 個（期待 0）`);
              console.log(
                'ST1 直近の流れ（点 10 個が 1 行・名前・見出し・ホームの並び・一覧に無い） ok',
              );
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
            // 「すべての欄」は次の画面（#131）
            after: async (pg) => {
              await openFieldsScreen(pg);
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
              await openFieldsScreen(pg);
              await pg.locator('.fields__row', { hasText: '50.00 USD' }).first().waitFor();
            },
          },
          // 心理のカード（#156）: タグが付いた詳細と、［変更］ で開いたシート
          {
            path: '/trades/x-emo',
            h1: '架空指数U · L',
            slug: 'trade-x-emotion',
            name: '心理のカード',
            trade: TX_EMO,
            after: async (pg) => {
              // 付いているタグは押せるチップ（#188。同じ心理の期間の取引へのリンク）
              await pg.locator('.emotioncard a.chip', { hasText: '調子に乗った' }).waitFor();
              await pg.locator('.emotioncard').scrollIntoViewIfNeeded();
            },
          },
          // 心理のチップから同じ心理の「期間の取引」へ（#188）: 取引のタブに積み、上の帯は「‹ 取引の詳細」、押した取引が一覧に入る
          {
            path: '/trades/x-emo',
            h1: '架空指数U · L',
            slug: 'trade-x-emotion-trail',
            name: '心理のチップ → 期間の取引',
            trade: TX_EMO,
            after: async (pg) => {
              await pg.locator('.emotioncard a.chip', { hasText: '取り戻したい' }).click();
              await waitReady(pg, '取り戻したい');
              await pg.locator('.traderow').first().waitFor({ timeout: 15000 });
              const back =
                (await pg.locator('main .appbar__backlabel').first().textContent()) ?? '';
              if (back.trim() !== '取引の詳細')
                throw new Error(`戻るの名前 ${back}（期待 取引の詳細）`);
              const mine = await pg.locator('.traderow[href="/trades/x-emo"]').count();
              if (mine !== 1) throw new Error(`押した取引の行 ${mine}（期待 1）`);
              const q = new URL(pg.url()).searchParams;
              if (
                q.get('emotion') !== 'recoup' ||
                q.get('via') !== 'trade' ||
                q.get('trade') !== 'x-emo'
              )
                throw new Error(`行き先 ${q.toString()}`);
              // 押して来た元の取引の行にだけ札「この取引」（#194）
              const badges = await pg.locator('main .traderow__badge').count();
              const mineBadge = await pg
                .locator('.traderow[href="/trades/x-emo"] .traderow__badge', {
                  hasText: 'この取引',
                })
                .count();
              if (badges !== 1 || mineBadge !== 1)
                throw new Error(`札 ${badges}・元の取引の行の札 ${mineBadge}（期待 1・1）`);
              // 期間が自動で決まったことを範囲の行で言い、期間の選択肢がある（#188 デザインレビュー 1・2）
              const meta = (await pg.locator('main .review__meta').first().textContent()) ?? '';
              if (!/^この取引(を含む|までの) 3 か月 · /.test(meta.trim()))
                throw new Error(`範囲の行 ${meta}`);
              await pg
                .locator('main .review__period-bar input[name="review-period"]')
                .first()
                .waitFor({
                  state: 'attached',
                });
            },
          },
          // 期間を選び直しても元の取引の ID は URL に残り、via は外れる（#194 の AC-4）。
          // 「1か月」= x-emo が範囲の外で札なし（E6）→「3か月」に戻す = 選び直した後も札が出る（E5。撮るのはこの形）
          {
            path: '/trades/x-emo',
            h1: '架空指数U · L',
            slug: 'trade-x-emotion-trail-period',
            name: '期間の取引で期間を選び直す',
            trade: TX_EMO,
            after: async (pg) => {
              await pg.locator('.emotioncard a.chip', { hasText: '取り戻したい' }).click();
              await waitReady(pg, '取り戻したい');
              await pg.locator('.traderow').first().waitFor({ timeout: 15000 });
              const pick = async (label, key) => {
                await pg
                  .locator('main .review__period-bar label', { hasText: label })
                  .first()
                  .click();
                await pg.waitForFunction(
                  (k) => new URLSearchParams(location.search).get('period') === k,
                  key,
                );
                const q = new URL(pg.url()).searchParams;
                if (
                  q.get('trade') !== 'x-emo' ||
                  q.get('via') !== null ||
                  q.get('emotion') !== 'recoup'
                )
                  throw new Error(`選び直した URL ${q.toString()}`);
              };
              await pick('1か月', '1m');
              await pg.locator('main .review__empty, main .traderow').first().waitFor();
              const outside = await pg.locator('main .traderow__badge').count();
              if (outside !== 0) throw new Error(`範囲の外の札 ${outside}（期待 0）`);
              await pick('3か月', '3m');
              await pg
                .locator('.traderow[href="/trades/x-emo"] .traderow__badge', {
                  hasText: 'この取引',
                })
                .waitFor({ timeout: 15000 });
              const badges = await pg.locator('main .traderow__badge').count();
              if (badges !== 1) throw new Error(`選び直した後の札 ${badges}（期待 1）`);
              // via が外れたので範囲の行は日付だけ
              const meta = (await pg.locator('main .review__meta').first().textContent()) ?? '';
              if (meta.includes('この取引')) throw new Error(`範囲の行 ${meta}`);
            },
          },
          {
            path: '/trades/x-emo',
            h1: '架空指数U · L',
            slug: 'trade-x-emotion-sheet',
            name: '心理のシート',
            trade: TX_EMO,
            after: async (pg) => {
              await pg.locator('.emotioncard').getByRole('button', { name: '心理を変更' }).click();
              const sheet = pg.locator('#detail-emotion-sheet[open]');
              await sheet.waitFor();
              await sheet.getByRole('button', { name: '値ごろ感', exact: true }).click();
              await sheet
                .locator('.chip--toggle[aria-pressed="true"]', { hasText: '値ごろ感' })
                .waitFor();
            },
          },
          {
            // #164 のレビュー: 編集の画面の要約も実際の桁で測る
            path: '/trades/x-real/edit',
            h1: '取引を編集',
            slug: 'trade-x-real-edit',
            name: '編集（実際の桁）',
            trade: TX_REAL,
            instrument: FAKE_REAL,
            after: async (pg) => {
              await expectRealSummary(pg, '#edit-summary');
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
          if (fx.instrument && !recApi.instruments.some((i) => i.id === fx.instrument.id))
            recApi.instruments.push(fx.instrument);
          recApi.trades.push(fx.trade);
          try {
            await tp.goto(base + fx.path);
            await waitReady(tp, fx.h1);
            // 編集の判定の枠は判定のシートの中（閉じていても木にある。#131）
            await tp.locator('.verdict').first().waitFor({ state: 'attached', timeout: 15000 });
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
            // 心理のタグの PUT（#156）は取引を置き換えるので、ID で探して外す
            const at = recApi.trades.findIndex((t) => t.id === fx.trade.id);
            if (at >= 0) recApi.trades.splice(at, 1);
            if (fx.instrument) {
              const ii = recApi.instruments.findIndex((i) => i.id === fx.instrument.id);
              if (ii >= 0) recApi.instruments.splice(ii, 1);
            }
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
              // ［保存］ は下の帯（チャートのシートを閉じてから。#131）
              await closeSheets(pg);
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
            // 編集のチャートの詳細はチャートのシート（#131。小さな 2 枠のチャートのある枠から開く）
            if (cs.path.endsWith('/edit')) await openEditChartSheet(tp);
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
      // + 3 = 振り返り（7 日）・数で見る・ホーム（今月の取引あり）（#128）
      const zoomStates = PAGES.length + recStates.length + setStates.length + 3;
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
            await zoomState(recPage, `${st.path}（${st.name}）`, st.slug, async () => {
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
              await openSettings(recPage, base, st.path);
              await st.fn(recPage, recApi);
            });
          }
          // 振り返りのタブの規律の振り返り（取引のある 7 日・数の段・曲線）と「数で見る」の画面の表（#128）
          {
            const saved = recApi.trades;
            recApi.trades = [...REVIEW_S1];
            await zoomState(recPage, '/review（7 日）', 'review-7d', async () => {
              await recPage.goto(`${base}/review?period=7d`);
              await waitReady(recPage, '振り返り');
              await recPage.locator('.curve').first().waitFor({ timeout: 15000 });
            });
            await zoomState(recPage, '/review/table（7 日）', 'review-table', async () => {
              await recPage.goto(`${base}/review/table?period=7d`);
              await waitReady(recPage, '数で見る');
              await recPage.locator('.review__table table').waitFor({ timeout: 15000 });
            });
            // ホーム（今月の取引あり。主役の数字・小さな曲線・詰めた行が縦に伸びる。横は 0）
            recApi.trades = [...homeMonthTrades(), ...TX_H1];
            await zoomState(recPage, '/（今月の取引あり）', 'home-month', async () => {
              await recPage.goto(`${base}/`);
              await waitReady(recPage, 'ホーム');
              await recPage.locator('.homemonth .num--xl').first().waitFor({ timeout: 15000 });
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
        '行き来 V1〜V7・安全域 SA1・スクロール S1 / テーマ T2〜T4 / ログイン L1〜L7・Google のボタン G1 / 使えないアカウント F1〜F2 / フォーカスの枠 FOC1 / 記録する R1〜R5 / 文言の撮影 W1 / 明細の読み取り R6〜R10 / 密度と階層 R11〜R14・決めていたかの問い LD1・読み取りの終わり RD1・記録する画面のシート RS1 / 設定 SET1〜SET5 / 口座 ACC1〜ACC2 / 数量の比 SZ1 / 為替 FX1 / 説明の「i」IT1〜IT3・下のシート SH1〜SH3・用語集 GL1〜GL2・書きかけ DR1〜DR2・詳細と編集の「i」DI1・置き換え RP1 / 取引 T-L4〜T-X2 / ホーム HM1〜HM2 / ページ分け TL-P1〜TL-P5 / 月の区切り TL-M1・口座の名前 TL-A1',
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

/** 読み取りの後に手で入れる 4 つ（打つ: LC・一言 / 選ぶ: そのまま・そのまま。決めていたかは LC の欄から = #202）。数を返す */
async function fillStatementTaps(page, lc = '99.0') {
  await closeSheets(page);
  await page.locator('#record-lc').fill(lc);
  await page.locator('#record-broken').fill('押し目の安値を割ったら');
  await seg(page, 'LC を動かしたか', 'そのまま').click();
  await seg(page, '時間足を変えたか', 'そのまま').click();
  return { typed: 2, chosen: 2 };
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
      // ホーム → 取引 → 行 → 設定 → 取引（詳細と位置が戻る）。詳細は #131 で 1 画面に詰めたので、スクロールの位置を測れる
      // 長さを作るため窓の高さだけ縮める（縦の形のまま。幅 390・高さ 600）
      await p.setViewportSize({ width: 390, height: 600 });
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
      await p.setViewportSize({ width: 390, height: 844 });
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
      await toReview(q);
      await q.locator('#record-lc').fill('100.5');
      await q.locator('nav a[href="/settings"]').click();
      await waitReady(q, '設定');
      await q.locator('.toast', { hasText: '記録の入力は残っています' }).waitFor({ timeout: 5000 });
      await q.locator('nav a[href="/trades"]').click();
      await waitReady(q, '取引');
      expectEq(new URL(q.url()).pathname, '/trades', '取引のタブに戻った先');
      await q.locator('nav a[href="/record"]').click();
      await waitReady(q, '記録する');
      await toReview(q);
      expectEq(await q.locator('#record-lc').inputValue(), '100.5', '残した書きかけ');
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
          ['/', 'ホーム', '.homerow'],
          ['/trades', '取引', '.traderow'],
          ['/trades/x-d1', 'US30 · L', 'canvas.chartview__canvas'],
          ['/record', '記録する', '#record-lc'],
          ['/review', '振り返り', '.review'],
          ['/settings', '設定', null],
        ]) {
          await p.goto(base + path);
          await waitReady(p, h1);
          // 記録するは 2 段目（下の帯がある段）で測る（2026-11-21）
          if (path === '/record') await toReview(p);
          else if (wait) await p.locator(wait).first().waitFor({ timeout: 15000 });
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
            // タブの根の大きな題（ホームは印と「損失ノート」の小さな見出し。#128）
            const big = document
              .querySelector('main .pagehead__title, main .homehead__title')
              ?.getBoundingClientRect();
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
      await toReview(p);
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
      // 1 段目には ［記録する］ が無い。タップと ［記録する］ は 2 段目（2026-11-21）
      expectEq(await p.locator('button[type="submit"]').count(), 0, '1 段目の [記録する]');
      await toReview(p);
      for (const g of ['L / S', 'LC を動かしたか', '時間足を変えたか']) {
        const n = await p.locator(`[role="radiogroup"][aria-label="${g}"] input:checked`).count();
        expectEq(n, 0, `${g} の選択`);
      }
      // LC を入る前に決めていたかは聞かない（LC の欄から決める。#202）
      expectEq(
        await p.locator('[role="radiogroup"][aria-label="LC を入る前に決めていたか"]').count(),
        0,
        '決めていたかの問い',
      );
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
      // タップの前でも R は出る（下の帯の判定の 1 行は判定が出るまで状態の文。判定のシートの中の R を見る。#130）
      await openVerdict(p);
      await p.locator('.verdict .num--xl', { hasText: '−1.6R' }).waitFor({ timeout: 5000 });
      await closeSheets(p);
      await fillRecord(p, EX_E1);
      await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor({ timeout: 5000 });
      await openVerdict(p);
      const reasons = await p.locator('.reasons__item').allInnerTexts();
      if (!reasons.includes('LC を広げた（99.5 → 99.2）'))
        throw new Error(`理由 ${reasons.join(' / ')}`);
      // 資金が未設定の説明は、理由の一覧から分けた注記の 1 行（Issue #33 AC-8）
      await p
        .locator('.verdict__aside', { hasText: '資金が未設定のため、過剰リスクは判定していません' })
        .waitFor();
      expectEq(await p.locator('button[type="submit"]').isDisabled(), false, '[記録する] が押せる');
      await closeSheets(p);
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
      await waitSaved(p, '記録しました');
      expectEq(fake.posts.length, 1, 'POST /api/trades の数');
      await p.getByRole('button', { name: '次の取引を記録' }).click();
      // 次の取引は 1 段目「スクショを入れる」から（2026-11-21）
      await p.locator('#record-manual').waitFor();
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
      await waitSaved(p, '記録しました');
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
          await measure(p, w, 'home-empty', '2 つの質問に答えると判定が表示されます');
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
          await deleteFromDetail(p);
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

  // LN1・LN2（#171）: LC の ［なし］ で止めた価格の欄。LN1 = 「なし」を選んだ後に読み取りが終わって LC へフォーカスが移っても
  // 「なし」のまま（フォーカスだけでは外さない）。LN2 = 止めた欄をタップすると「なし」が外れ、同じ欄にフォーカスして打てる
  const lcLockState = (p) =>
    p.evaluate(() => {
      const el = document.querySelector('#record-lc');
      return {
        readOnly: el.readOnly,
        disabled: el.disabled,
        value: el.value,
        focused: document.activeElement === el,
        none: document.querySelector('.lcnone')?.getAttribute('aria-pressed'),
      };
    });
  await check('LN1', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await openRecord(p, base);
      fake.read = { status: 200, rows: [READ_E1], holdMs: 2000 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('#record-lc').waitFor({ state: 'visible', timeout: 15000 });
      await p.locator('.lcnone').first().click();
      await p.locator(READ_DONE).first().waitFor({ timeout: 15000 });
      await p.waitForTimeout(300);
      const s = await lcLockState(p);
      expectEq(s.none, 'true', '読み取りの後の ［なし］');
      expectEq(s.readOnly, true, '読み取りの後の LC の欄（止めたまま）');
      expectEq(s.disabled, false, 'LC の欄の disabled');
      expectEq(s.value, '', 'LC の欄の値');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '［なし］ → 読み取りの完了 → 「なし」のまま（欄は止めたまま・値は空）';
  });
  await check('LN2', async () => {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      storageState: signedIn,
    });
    await installFakeApi(c, { trades: [] });
    const p = await c.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    try {
      await openRecord(p, base);
      await toReview(p);
      await p.locator('.lcnone').first().tap();
      const before = await lcLockState(p);
      expectEq(before.none, 'true', '［なし］ を押した後');
      expectEq(before.readOnly, true, '止めた LC の欄');
      const note = await p
        .locator('#record-lc-lock')
        .textContent()
        .catch(() => null);
      expectEq(note, 'なし を選んでいます。押すと価格を入れられます', '読み上げの説明');
      // 押す前の欄の要素を覚え、押した後も同じ要素か（作り直すとフォーカスが外れる。#207）
      await p.evaluate(() => {
        window.__ln2Lc = document.querySelector('#record-lc');
      });
      await p.locator('#record-lc').tap();
      await p.waitForTimeout(150);
      const after = await lcLockState(p);
      expectEq(
        await p.evaluate(() => document.querySelector('#record-lc') === window.__ln2Lc),
        true,
        '欄をタップした後の LC の欄（同じ要素のまま）',
      );
      expectEq(after.none, 'false', '欄をタップした後の ［なし］');
      expectEq(after.readOnly, false, '欄をタップした後の LC の欄');
      expectEq(after.focused, true, 'LC の欄のフォーカス');
      expectEq(after.value, '', 'LC の欄の値');
      await p.keyboard.type('99.5');
      expectEq(await p.locator('#record-lc').inputValue(), '99.5', '打った LC');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '［なし］ → 止めた欄をタップ → 「なし」が外れ、LC の欄にフォーカスして 99.5 を打てる';
  });

  await check('R6', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
      await openRecord(p, base);
      // 画像の貼り付け 1 回 → 1 件
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      expectEq(fake.reads.length, 1, '貼り付けの後の要求');
      // ファイル選択 1 回 → 1 件（合成の明細の画像）。明細を選ぶ入口は 1 段目だけ（2026-11-21）
      await toInput(p);
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
      // 銘柄の欄は取引の欄のシートの中（#130）
      await openFields(p);
      await p.locator('#record-instrument').focus();
      await p.keyboard.press('ControlOrMeta+V');
      await expectPoll(() => fake.reads.length === 3, '銘柄の欄に画像だけを貼った後の要求');
      await closeSheets(p);
      // E12: 画像として読めないファイル → 要求 0 件・決まった文言（選ぶ入口は 1 段目。2026-11-21）
      await toInput(p);
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
        await toInput(p);
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
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      await fillStatementTaps(p);
      await p.locator('button[type="submit"]').click();
      await waitSaved(p, '記録しました');
      await p.getByRole('button', { name: '次の取引を記録' }).click();
      fake.read = { status: 200, rows: READ_E10, holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('.appbar__meta', { hasText: '1 / 3 行目' }).waitFor({ timeout: 10000 });
      await p.locator('#record-tz-open').click();
      await p.getByRole('radio', { name: /日本時間（そのまま）/ }).check();
      // 選ぶと当てて閉じる（1 タップ。#130）
      await p.locator('#record-tz-sheet[open]').waitFor({ state: 'detached' });
      await fillStatementTaps(p);
      await p.locator('button[type="submit"]').click();
      await p.locator('.appbar__meta', { hasText: '2 / 3 行目' }).waitFor({ timeout: 10000 });
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id)) === 'record-statement-title',
        '次の行の明細の場所へのフォーカス（レビュー指摘 3。#130）',
      );
      // [この行をスキップ] は取引の欄のシートの中（#130）
      await openFields(p);
      await p.getByRole('button', { name: 'この行をスキップ' }).click();
      await p.locator('.appbar__meta', { hasText: '3 / 3 行目' }).waitFor();
      await p.getByRole('status').filter({ hasText: '次の行（3 / 3）' }).waitFor({ timeout: 5000 });
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'record-statement-row',
        '飛ばした後の行の番号へのフォーカス',
      );
      await fillStatementTaps(p, '49');
      await p.locator('button[type="submit"]').click();
      await waitSaved(p, '記録しました');
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
      await toReview(p);
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
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'record-lc',
        'やめた後のフォーカス（レビュー指摘 2。#130 で LC へ）',
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
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      expectEq(await p.locator('#record-instrument').inputValue(), '架空指数A', '銘柄');
      expectEq(await p.locator('#record-quantity').inputValue(), '2', '数量');
      // 読み取りの値は要約に流れ込む（取引の欄・ほかの欄はシートの中。#130）
      await p.locator('.rsum__l1', { hasText: '架空指数A' }).waitFor();
      expectEq(await p.locator('#record-fee').count(), 0, '手数料（ほかの欄はシートの段 2）');
      const typed = await fillStatementTaps(p);
      await p.locator('.vline .badge', { hasText: 'A' }).waitFor({ timeout: 5000 });
      await p.locator('.vline .num', { hasText: '−1.0R' }).waitFor({ timeout: 5000 });
      await p.locator('button[type="submit"]').click();
      await waitSaved(p, '記録しました');
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

  // ── 密度と階層（Issue #33・#130）。R11 = タップの直後に判定の 1 行が見える / R12 = 1 画面に収まる / R13 = 数字の書体と並び
  // R11（#130 で置き換え。ui-guidelines 9.11 の「判定の枠を寄せる」→「判定は下の帯に常に 1 行」）: 最後のタップを押した直後、
  // スクロールの操作をしないで、下の帯の判定の 1 行（バッジと R）が窓の中に見え、押したタップも見えていてフォーカスが残る
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
          const last = seg(p, '時間足を変えたか', 'そのまま');
          // 押すタップを下の帯の上に出してから押す（縦の短い窓では帯の裏に隠れることがある）
          await last.evaluate((el) => {
            const bar = document.querySelector('.record__submit')?.getBoundingClientRect();
            const r = el.getBoundingClientRect();
            if (bar && r.bottom > bar.top - 8) window.scrollBy(0, r.bottom - (bar.top - 8));
          });
          await p.waitForTimeout(100);
          const y0 = await p.evaluate(() => window.scrollY);
          const box = await last.boundingBox();
          if (!box) throw new Error(`${name}: 最後のタップが描かれていない`);
          await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await p.locator('.vline .badge', { hasText: label }).waitFor({ timeout: 5000 });
          await p.waitForTimeout(150);
          const ng = await p.evaluate(
            ({ withR }) => {
              const vh = window.innerHeight;
              const vw = window.innerWidth;
              const out = [];
              const parts = [['バッジ', '.vline .badge']];
              if (withR) parts.push(['R', '.vline .num']);
              for (const [nm, sel] of parts) {
                const r = document.querySelector(sel)?.getBoundingClientRect();
                if (!r || r.height === 0) out.push(`${nm} が無い`);
                else if (r.top < -0.5 || r.bottom > vh + 0.5 || r.left < -0.5 || r.right > vw + 0.5)
                  out.push(`${nm} ${Math.round(r.top)}〜${Math.round(r.bottom)}px が窓の外`);
              }
              return out;
            },
            { withR },
          );
          if ((await p.evaluate(() => window.scrollY)) !== y0)
            ng.push('押した後に画面がスクロールした（判定は下の帯にあるので寄せない）');
          const kept = await last.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const bar = document.querySelector('.record__submit')?.getBoundingClientRect();
            return {
              seen: r.top >= 0 && (!bar || r.bottom <= bar.top + 0.5),
              focus: el.contains(document.activeElement),
            };
          });
          if (!kept.seen) ng.push('押したタップが見えない（下の帯の裏）');
          if (!kept.focus) ng.push('フォーカスが押したタップから動いた');
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
    return `最後のタップを押した直後、スクロールせずに下の帯の判定の 1 行（バッジと R）が窓の中・押したタップも見えてフォーカスは動かない（${n} 件 = 4 場面 × 360 / 1440 × 両テーマ + 390（動きを減らす設定））`;
  });

  // R12（#130 で置き換え。2026-11-21 に 2 段へ。ui-guidelines 9.4・9.10 の「1 画面に収まる」）: 等倍の文字の 390×844 で、
  // 1 段目と 2 段目の 4 つの状態（読み取り中・読み取りの後・手入力・2 行の明細 + 口座 3 つ）とも縦のスクロール 0px（安全域 47 / 34
  // を入れても。#130 の「選ぶ前は 40px まで」は 1 段目が LC 以下を持たなくなったので 0px に締めた）。2 段目は LC・チャートの注意・
  // 判定の 1 行・[記録する]・3 つ目のタップ、1 段目は 2 つの注意・［スクショを選ぶ］・［明細なしで手入力］ が窓の中。
  // 読み取り中 → 読み取りの後で LC の欄の上端が動かない（流れ込むだけ）。送る前の注意は 1 段目に 3 行以下で畳まない。
  // 360×780 は縦のスクロール 120px 以下（全長の上限 R12 の置き換え）。口座 2・3 の形も 360×780 で 120px 以下。
  // 2 行の明細の 1 行目を記録した後（名前の上の 1 行の知らせが 2 行に折れる。#180）も 390×844 で 0px・360×780 で 120px 以下
  await check('R12', async () => {
    const out = [];
    // foot: 1 段目の下の端のボタン（要約が無ければ ［明細なしで手入力］、読めた後は ［振り返りへ進む］）
    const measureOne = (p, foot = '#record-manual') =>
      p.evaluate((foot) => {
        const vh = window.innerHeight;
        const se = document.scrollingElement;
        const seen = (sel) => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return !!r && r.height > 0 && r.top >= -0.5 && r.bottom <= vh + 0.5;
        };
        const notice = document.querySelector('.rin .statement__notice');
        const input = !!document.querySelector('form[data-stage="input"]');
        const cs = notice ? getComputedStyle(notice) : null;
        const lines = notice
          ? Math.round(notice.getBoundingClientRect().height / Number.parseFloat(cs.lineHeight))
          : 0;
        return {
          over: se.scrollHeight - vh,
          lc: document.getElementById('record-lc')?.getBoundingClientRect().top ?? null,
          input,
          seen: input
            ? {
                statementNotice: seen('.rin .statement__notice'),
                chartNotice: seen('.rin .charts__notice'),
                pick: seen('label[for="record-statement-file"]'),
                manual: seen(foot),
                // 明細の ［削除］ と削除の後の ［元に戻す］（あるときだけ。#184）
                remove: !document.querySelector('#record-statement-remove')
                  ? true
                  : seen('#record-statement-remove'),
                undo: !document.querySelector('#record-statement-undo')
                  ? true
                  : seen('#record-statement-undo'),
              }
            : {
                lc: seen('#record-lc'),
                chartNotice: seen('.rchartrow__notice'),
                line: seen('#record-verdict-line'),
                submit: seen('#record-submit'),
                taps: seen('[role="radiogroup"][aria-label="時間足を変えたか"]'),
              },
          noticeText: notice?.textContent ?? '',
          lines,
          hidden: !!notice?.closest('details, dialog'),
        };
      }, foot);
    const states = [
      ['1 段目', async () => {}],
      [
        // #184: 読めた後の 1 段目（［スクショを変更］・［削除］）と、削除の後（「明細を削除しました」・［元に戻す］）
        '1 段目（読み取りの後）',
        async (p, fake) => {
          fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
          await p.locator('#record-to-input').click();
          await p.locator('#record-statement-remove').waitFor();
        },
      ],
      [
        '1 段目（削除の後）',
        async (p, fake) => {
          fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
          await p.locator('#record-to-input').click();
          await p.locator('#record-statement-remove').click();
          await p.locator('#record-statement-undo').waitFor();
        },
      ],
      [
        '読み取り中',
        async (p, fake) => {
          fake.read = { status: 200, rows: [READ_E1], holdMs: 20000 };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          await p.getByRole('status').filter({ hasText: '読み取り中' }).waitFor();
        },
      ],
      [
        '読み取りの後',
        async (p, fake) => {
          fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
        },
      ],
      [
        // #164 のレビュー: 実際の桁（6 万台・小数 1 桁の価格、6 桁の損益、オーナーの例と同じ長さの名前）
        '実際の桁',
        async (p, fake) => {
          fake.read = { status: 200, rows: [READ_REAL], holdMs: 0 };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
        },
      ],
      [
        '手入力',
        async (p) => {
          await p.locator('#record-manual').click();
          await p
            .locator('#record-fields-sheet[open]')
            .waitFor({ state: 'visible', timeout: 5000 });
          await settleSheet(p);
          await seg(p, 'L / S', 'S ショート').click();
          await closeSheets(p);
          await p.locator('.rsum__chip').first().waitFor();
        },
      ],
      [
        '2 行の明細・口座 3 つ',
        async (p, fake) => {
          fake.read = {
            status: 200,
            rows: [READ_E1, { ...READ_E1, symbol: '架空指数C' }],
            holdMs: 0,
          };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          await p.locator('.rsum__accounts [role="radiogroup"]').waitFor({ timeout: 10000 });
        },
        ACCOUNTS_3_LONG,
      ],
      [
        // #180: 1 行目を記録した後の 2 行目（名前の上の 1 行の知らせが 2 行に折れる）
        '2 行の明細・口座 3 つ・次の行の後',
        async (p, fake) => {
          fake.read = {
            status: 200,
            rows: [READ_E1, { ...READ_E1, symbol: '架空指数C' }],
            holdMs: 0,
          };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          // 360×780 は口座 1・2・3 の形で流す（口座 1 は Segment が無いので、完了の文を待つ）
          await p.locator('.rsum__status--done').waitFor({ timeout: 10000 });
          await fillStatementTaps(p);
          await p.locator('#record-submit').click();
          await p
            .locator('.rsum__status--notice', { hasText: '1 / 2 行目を記録しました' })
            .waitFor({ timeout: 10000 });
          // 次の行は明細の見出しへフォーカスを移す。測りの前に窓の上の端へ戻す
          await p.evaluate(() => window.scrollTo(0, 0));
        },
        ACCOUNTS_3_LONG,
      ],
    ];
    // 安全域 0（Chromium の 390×844）と、ホーム画面に追加した iPhone の安全域（上 47・下 34。トークン --safe-* の差し替え）の
    // 両方で測る（どちらも 0px）
    for (const theme of THEMES)
      for (const safe of [false, true]) {
        const lcTops = {};
        for (const [name, fn, accounts] of states) {
          const c = await browser.newContext({
            viewport: { width: 390, height: 844 },
            storageState: signedIn,
            hasTouch: true,
          });
          try {
            await setupContext(c, theme);
            if (safe)
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
            const fake = await installFakeApi(c, accounts ? { accounts } : {});
            const p = await c.newPage();
            await openRecord(p, base);
            await fn(p, fake);
            await p.waitForTimeout(200);
            const m = await measureOne(
              p,
              name === '1 段目（読み取りの後）' ? '#record-proceed' : '#record-manual',
            );
            lcTops[name] = m.lc;
            const where = `390×844${safe ? '（安全域 47 / 34）' : ''} ${theme} ${name}`;
            if (m.input !== name.startsWith('1 段目')) throw new Error(`${where}: 段が違う`);
            if (m.over > 0) throw new Error(`${where}: 縦のスクロール ${m.over}px（0px まで）`);
            for (const [k, v] of Object.entries(m.seen)) {
              if (!v) throw new Error(`${where}: ${k} が窓の中に無い`);
            }
            if (name === '1 段目') {
              for (const t of ['AI の提供元（Anthropic）に送', '切り取って', '保存しません'])
                if (!m.noticeText.includes(t)) throw new Error(`${theme}: 注意に「${t}」が無い`);
              if (m.lines > 3) throw new Error(`${theme}: 注意が ${m.lines} 行（3 行まで）`);
              if (m.hidden) throw new Error(`${theme}: 注意が畳まれている`);
              if (!(await p.locator('label[for="record-statement-file"]').isVisible()))
                throw new Error(`${theme}: [スクショを選ぶ] が見えない`);
            }
            out.push(`${theme}${safe ? ' 安全域' : ''} ${name} ${m.over}px`);
          } finally {
            await c.close();
          }
        }
        for (const after of ['読み取りの後', '実際の桁']) {
          const moved = Math.abs((lcTops.読み取り中 ?? 0) - (lcTops[after] ?? 0));
          if (moved > 1)
            throw new Error(
              `${theme}: 読み取りの結果が流れ込むと LC の欄が ${moved}px 動いた（${after}）`,
            );
        }
      }
    // 360×780: 縦のスクロール 120px 以下（口座 1・2・3 の形）
    const shapes = [
      { label: '口座 1', accounts: undefined },
      { label: '口座 2', accounts: ACCOUNTS_2 },
      { label: '口座 3', accounts: ACCOUNTS_3_LONG },
    ];
    for (const shape of shapes)
      for (const [name, fn] of states) {
        if (
          !name.startsWith('1 段目') &&
          name !== '読み取りの後' &&
          name !== '実際の桁' &&
          name !== '2 行の明細・口座 3 つ・次の行の後'
        )
          continue;
        const c = await browser.newContext({
          viewport: { width: 360, height: 780 },
          storageState: signedIn,
          hasTouch: true,
        });
        try {
          await setupContext(c, 'dark');
          const fake = await installFakeApi(c, shape.accounts ? { accounts: shape.accounts } : {});
          const p = await c.newPage();
          await openRecord(p, base);
          await fn(p, fake);
          await p.waitForTimeout(200);
          const m = await measureOne(p);
          if (m.over > RECORD_OVER_360)
            throw new Error(
              `360×780 ${shape.label} ${name}: 縦のスクロール ${m.over}px（${RECORD_OVER_360}px まで）`,
            );
          out.push(`360 ${shape.label} ${name} ${m.over}px`);
        } finally {
          await c.close();
        }
      }
    return `1 画面に収まる: ${out.join(' / ')}`;
  });

  // LM1（#165・設計書 C56）: 2 段目で「LC を動かしたか」の 4 つ目「取消」と、LC の欄の行の切り替え「逆指値 未設定」を
  // シートを開かずに 1 タップずつ押せる。390×844: 取消で判定の 1 行が A → B、未設定を押すと取消が外れ（未選択）押された状態。
  // 360×780: LC の価格の欄の幅 150px 以上・LC の行と画面の横のはみ出し 0・4 択の項目の中の差は 1px 以下・当たり 44px 以上
  await check('LM1', async () => {
    const out = [];
    for (const [w, h] of [
      [390, 844],
      [360, 780],
    ]) {
      const c = await browser.newContext({
        viewport: { width: w, height: h },
        storageState: signedIn,
        hasTouch: true,
      });
      try {
        await setupContext(c, 'dark');
        const fake = await installFakeApi(c, {});
        const p = await c.newPage();
        await openRecord(p, base);
        fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
        await closeSheets(p);
        // イン 100・決済 99・LC 98.5 → −0.67R（架空）
        await p.locator('#record-lc').fill('98.5');
        await seg(p, 'LC を動かしたか', 'そのまま').click();
        await seg(p, '時間足を変えたか', 'そのまま').click();
        const line = async () => (await p.locator('#record-verdict-line').textContent()) ?? '';
        await expectPollAsync(
          async () => (await line()).includes('いい損失'),
          `${w}: そのままで A`,
        );
        await seg(p, 'LC を動かしたか', '取消').click();
        await expectPollAsync(async () => (await line()).includes('悪い損失'), `${w}: 取消で B`);
        // 次のレビューが撮影だけで見られるよう、取消・未設定の状態を撮る（#165 のデザインレビュー）
        if (opts.shots)
          await p.screenshot({ path: join(opts.shots, `${w}x${h}-dark-lm1-cancelled.png`) });
        const toggle = p.locator('#record-stop-not-placed');
        await toggle.click();
        expectEq(await toggle.getAttribute('aria-pressed'), 'true', `${w}: 未設定の押された状態`);
        const checked = await p
          .locator('[role="radiogroup"][aria-label="LC を動かしたか"] input:checked')
          .count();
        expectEq(checked, 0, `${w}: 未設定で取消が外れる`);
        // 黙って外さず、4 択の下に理由の 1 行。「取消」は選べない見た目（#165 のデザインレビュー 3）
        expectEq(
          ((await p.locator('#record-lc-move-stop-note').textContent()) ?? '').trim(),
          '逆指値が未設定のため「取消」は選べません',
          `${w}: 取消を選べない理由`,
        );
        expectEq(
          await p
            .locator('[role="radiogroup"][aria-label="LC を動かしたか"] .seg__item--off')
            .count(),
          1,
          `${w}: 選べない「取消」`,
        );
        if (opts.shots)
          await p.screenshot({ path: join(opts.shots, `${w}x${h}-dark-lm1-notplaced.png`) });
        const m = await p.evaluate(() => {
          const row = document.querySelector('.record__lc .lcrow');
          const t = document.getElementById('record-stop-not-placed')?.getBoundingClientRect();
          const items = [
            ...document.querySelectorAll(
              '[role="radiogroup"][aria-label="LC を動かしたか"] .seg__item',
            ),
          ];
          // 「逆指値 未設定」の「i」は欄の名前の行（#201）。名前の行の右端が LC の行の中に収まる
          const info = document.querySelector(
            '.record__lc .lcrow .field__head button[aria-label="「逆指値 未設定」の説明"]',
          );
          const rr = row?.getBoundingClientRect();
          const hint = document.getElementById('record-lc-hint')?.getBoundingClientRect();
          // LC の行の下の添え（#202）: 行の中に 1 行で収まる。行の数は文字の矩形の上端の数（line-height が normal でも数えられる）
          const lateEl = document.getElementById('record-lc-late');
          const late = lateEl?.getBoundingClientRect();
          const lineCount = (el) => {
            if (!el) return 0;
            const r = document.createRange();
            r.selectNodeContents(el);
            return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
          };
          const ir = info?.closest('.info-wrap')?.getBoundingClientRect();
          return {
            info: info ? 1 : 0,
            infoInRow: ir && rr ? ir.left >= rr.left - 12 && ir.right <= rr.right + 12 : false,
            hintOver: hint && rr ? Math.round(hint.right - rr.right) : 0,
            late: lateEl ? (lateEl.textContent ?? '') : null,
            lateOver: late && rr ? Math.round(late.right - rr.right) : 0,
            lateClip: lateEl ? lateEl.scrollWidth - lateEl.clientWidth : 0,
            lateLines: lineCount(lateEl),
            lateBelow: late && rr ? late.top >= rr.top : false,
            lcW: Math.round(
              document.getElementById('record-lc')?.getBoundingClientRect().width ?? 0,
            ),
            rowOver: row ? row.scrollWidth - row.clientWidth : -1,
            pageOverX: document.scrollingElement.scrollWidth - window.innerWidth,
            toggleH: t ? Math.round(t.height) : 0,
            toggleW: t ? Math.round(t.width) : 0,
            itemClip: Math.max(...items.map((e) => e.scrollWidth - e.clientWidth)),
            itemH: Math.min(...items.map((e) => Math.round(e.getBoundingClientRect().height))),
            items: items.length,
          };
        });
        expectEq(m.items, 4, `${w}: LC を動かしたかの選択肢の数`);
        expectEq(m.info, 1, `${w}: LC の欄の名前の行の「逆指値 未設定」の「i」`);
        if (!m.infoInRow) throw new Error(`${w}: 「i」が LC の行の外`);
        if (m.hintOver > 0) throw new Error(`${w}: 添え書きのはみ出し ${m.hintOver}px`);
        expectEq(
          m.late,
          'エントリー後に決めた価格は入れず「LC なし」へ',
          `${w}: LC の行の下の添え（#202）`,
        );
        if (m.lateOver > 0 || m.lateClip > 0)
          throw new Error(`${w}: LC の行の下の添えのはみ出し ${m.lateOver}px・中 ${m.lateClip}px`);
        if (m.lateLines !== 1)
          throw new Error(`${w}: LC の行の下の添えが ${m.lateLines} 行（1 行）`);
        if (!m.lateBelow) throw new Error(`${w}: LC の行の下の添えが LC の行の中にない`);
        // LC を入る前に決めていたかは聞かない（#202）
        expectEq(
          await p.locator('[role="radiogroup"][aria-label="LC を入る前に決めていたか"]').count(),
          0,
          `${w}: 決めていたかの問い`,
        );
        if (m.lcW < 150) throw new Error(`${w}: LC の価格の欄の幅 ${m.lcW}px（150px 以上）`);
        if (m.rowOver !== 0) throw new Error(`${w}: LC の行のはみ出し ${m.rowOver}px`);
        if (m.pageOverX > 0) throw new Error(`${w}: 横スクロール ${m.pageOverX}px`);
        if (m.toggleH < 44) throw new Error(`${w}: 切り替えの高さ ${m.toggleH}px（44px 以上）`);
        if (m.itemClip > 1) throw new Error(`${w}: 4 択の項目の中のはみ出し ${m.itemClip}px`);
        if (m.itemH < 44) throw new Error(`${w}: 4 択の項目の高さ ${m.itemH}px`);
        // 「LC なし」で切り替えが隠れている間は「i」も出さない・外すと戻る（#201 のレビュー N3）
        const stopInfo = p.locator('.record__lc button[aria-label="「逆指値 未設定」の説明"]');
        const lcNone = p.locator('.record__lc .lcrow > .lcnone');
        await lcNone.click();
        await expectPollAsync(
          async () => (await stopInfo.count()) === 0,
          `${w}: LC なしで「i」なし`,
        );
        expectEq(await toggle.count(), 0, `${w}: LC なしで切り替えなし`);
        // LC なしの間は、同じ行で押した結果を言う（#202 のデザインレビュー 3）。1 行のまま
        const noneNote = await p.evaluate(() => {
          const el = document.getElementById('record-lc-late');
          if (!el) return null;
          const r = document.createRange();
          r.selectNodeContents(el);
          const lines = new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
          return {
            text: (el.textContent ?? '').trim(),
            lines,
            clip: el.scrollWidth - el.clientWidth,
          };
        });
        expectEq(
          noneNote?.text,
          'LC を決めずに入った取引として記録します',
          `${w}: LC なしの間の添え`,
        );
        if (noneNote?.lines !== 1 || noneNote.clip > 0)
          throw new Error(
            `${w}: LC なしの間の添えが ${noneNote?.lines} 行・はみ出し ${noneNote?.clip}px`,
          );
        await lcNone.click();
        await expectPollAsync(
          async () => (await stopInfo.count()) === 1,
          `${w}: LC なしを外すと「i」`,
        );
        out.push(
          `${w}×${h} LC 欄 ${m.lcW}px・切り替え ${m.toggleW}×${m.toggleH}px・添え ${m.lateLines} 行`,
        );
      } finally {
        await c.close();
      }
    }
    return `取消と逆指値の未設定: ${out.join(' / ')}`;
  });

  // LD1（#202・設計書 C57）: 記録する画面の 2 段目は「LC を入る前に決めていたか」を聞かず、LC と 2 つのタップで判定まで届く
  // （帯の判定の 1 行が A）。編集の画面は、前からの「価格あり・決めていなかった」の取引だけ問いを出し、「決めていない」が選ばれた
  // 状態で開き、「決めていた」を選ぶと保存の帯が 危ない勝ち → 計画どおりの勝ち。390×844 と 1440×900 × ダーク / ライトで流し、
  // --shots で 2 つの画面を撮る
  await check('LD1', async () => {
    const out = [];
    for (const [w, h] of [
      [390, 844],
      [1440, 900],
    ]) {
      for (const theme of ['dark', 'light']) {
        const c = await browser.newContext({
          viewport: { width: w, height: h },
          storageState: signedIn,
          hasTouch: w < 720,
        });
        try {
          await setupContext(c, theme);
          const fake = await installFakeApi(c, { trades: [TX_LATE] });
          const p = await c.newPage();
          const errors = [];
          p.on('pageerror', (e) => errors.push(e.message));
          await openRecord(p, base);
          fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
          await makeImage(p, STATEMENT_SPEC, 'paste');
          await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
          await closeSheets(p);
          expectEq(
            await p.locator('[role="radiogroup"][aria-label="LC を入る前に決めていたか"]').count(),
            0,
            `${w} ${theme}: 記録する画面の決めていたかの問い`,
          );
          expectEq(
            (await p.locator('#record-lc-late').textContent())?.trim(),
            'エントリー後に決めた価格は入れず「LC なし」へ',
            `${w} ${theme}: LC の行の下の添え`,
          );
          // イン 100・決済 99・LC 98.5 → −0.67R（架空）。打つ 1・選ぶ 2 で判定
          await p.locator('#record-lc').fill('98.5');
          await seg(p, 'LC を動かしたか', 'そのまま').click();
          await seg(p, '時間足を変えたか', 'そのまま').click();
          await expectPollAsync(
            async () =>
              ((await p.locator('#record-verdict-line').textContent()) ?? '').includes('いい損失'),
            `${w} ${theme}: 2 つのタップで A`,
          );
          if (opts.shots)
            await p.screenshot({ path: join(opts.shots, `${w}x${h}-${theme}-ld1-record.png`) });
          // 編集の画面: 前からの「価格あり・決めていなかった」
          await p.goto(`${base}/trades/x-late/edit`);
          await waitReady(p, '取引を編集');
          await p.locator('#edit-submit').waitFor();
          const group = p.locator('[role="radiogroup"][aria-label="LC を入る前に決めていたか"]');
          expectEq(await group.count(), 1, `${w} ${theme}: 編集の決めていたかの問い`);
          expectEq(
            await group.locator('input:checked').getAttribute('value'),
            'no',
            `${w} ${theme}: 開いたときの答え`,
          );
          expectEq(
            await p.locator('#record-lc').inputValue(),
            '99.5',
            `${w} ${theme}: 編集の LC の欄`,
          );
          // 添えの代わりに問いと理由の 1 行（食い違わない。#202 のデザインレビュー 2）。問いは LC の行のすぐ下（一言の欄より上）
          expectEq(await p.locator('#record-lc-late').count(), 0, `${w} ${theme}: 編集の添え`);
          expectEq(
            (await p.locator('#record-lc-decided-hint').textContent())?.trim(),
            '後から書いた LC として保存した記録です',
            `${w} ${theme}: 問いの理由の 1 行`,
          );
          const order = await p.evaluate(() => {
            const y = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
            return {
              row: y('.record__lc .lcrow'),
              ask: y('.record__lc .lcdecided'),
              broken: y('#record-broken'),
            };
          });
          if (!(order.row < order.ask && order.ask < order.broken))
            throw new Error(`${w} ${theme}: 問いの位置 ${JSON.stringify(order)}`);
          if (opts.shots)
            await p.screenshot({ path: join(opts.shots, `${w}x${h}-${theme}-ld1-edit-late.png`) });
          await seg(p, 'LC を入る前に決めていたか', '決めていた').click();
          await expectPollAsync(
            async () =>
              ((await p.locator('#edit-change').textContent()) ?? '').includes('計画どおりの勝ち'),
            `${w} ${theme}: 決めていたで計画どおりの勝ち`,
          );
          const pageOverX = await p.evaluate(
            () => document.scrollingElement.scrollWidth - window.innerWidth,
          );
          if (pageOverX > 0) throw new Error(`${w} ${theme}: 横スクロール ${pageOverX}px`);
          expectEq(errors.length, 0, `${w} ${theme}: ページのエラー`);
          out.push(`${w}×${h} ${theme}`);
        } finally {
          await c.close();
        }
      }
    }
    return `記録は問い 2 つで A・編集の前からの記録だけ問い（決めていない → 決めていた で計画どおりの勝ち）: ${out.join(' / ')}`;
  });

  // RD1（#166。ui-guidelines 9.4 の状態 2・9.8「読み取りが終わった」）: 2 段目の明細の行に、読み取りの終わり方ごとの文
  // （#1「読み取りました」・#2「2 行を読み取りました」・#4「· 入力が必要な欄 2」・#9「読み取りをキャンセルしました」）を
  // 名前の上の 1 行に出し、読み上げの領域 #record-statement-status は読み取り中から同じ要素のまま中身だけが替わる（AC-2）。
  // 読めた・失敗したときだけ明細の行に 1 回の動き（200ms 以下・繰り返さない。キャンセルは動かない。AC-3）、動きを減らす設定で
  // 時間 0（AC-4）、読み取り中に開いたシートを閉じた後も文が見えて 2 回目の動きが無い（AC-5）、次の行へ進むと知らせ 1 つだけ
  // （AC-6）、幅 360 で #4 の文が切れず横 0（AC-7）。次の行の知らせ（#180）: 記録した・スキップした後の知らせは完了の文と同じ
  // 名前の上の 1 行に 1 つだけ（要約の下の段落なし）・同じ読み上げの領域の中身が替わる・動きは増えない・フォーカスは明細の
  // 見出し・印「読み取り」・シートの後も残る・3 行の明細の 2 行目の後も・幅 360 で切れず横 0
  await check('RD1', async () => {
    const out = [];
    const open = async (opts = {}) => {
      const c = await browser.newContext({
        viewport: opts.viewport ?? { width: 390, height: 844 },
        storageState: signedIn,
        hasTouch: true,
        ...(opts.reduce ? { reducedMotion: 'reduce' } : {}),
      });
      await setupContext(c, 'dark');
      const fake = await installFakeApi(c);
      const p = await c.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      await openRecord(p, base);
      // 明細の行に動きの印が付いた回数と、そのときのカードの動きの長さ・繰り返し（MutationObserver で印の付いた瞬間に読む）
      await p.evaluate(() => {
        const w = { adds: 0, on: false, dur: [], iter: [] };
        window.__rd1 = w;
        new MutationObserver(() => {
          const sec = document.querySelector('.rstmt');
          const on = !!sec?.classList.contains('rstmt--flash');
          if (on && !w.on) {
            w.adds++;
            const card = sec.querySelector(':scope > .rstmt__card');
            const cs = card ? getComputedStyle(card) : null;
            w.dur.push(cs ? Number.parseFloat(cs.animationDuration) * 1000 : -1);
            w.iter.push(cs?.animationIterationCount ?? '');
          }
          w.on = on;
        }).observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['class'],
        });
      });
      return { c, p, fake, errors };
    };
    const flash = (p) => p.evaluate(() => ({ ...window.__rd1 }));
    const statusText = (p) =>
      p.evaluate(() => document.getElementById('record-statement-status')?.textContent ?? null);
    const seen = (p) =>
      p.evaluate(() => {
        const el = document.querySelector('.rsum__status');
        return el ? el.textContent : null;
      });
    // 終わった後: 印が外れ、カードに続く動きが無い
    const settled = async (p, what) => {
      await p.waitForTimeout(800);
      const r = await p.evaluate(() => ({
        on: !!document.querySelector('.rstmt--flash'),
        anims: [...document.querySelectorAll('.rstmt__card')].flatMap((c) => c.getAnimations())
          .length,
      }));
      if (r.on || r.anims > 0) throw new Error(`${what}: 動きが続いている（${JSON.stringify(r)}）`);
    };
    const once = (f, what, max = 200) => {
      if (f.adds !== 1) throw new Error(`${what}: 動きの回数 ${f.adds}（1 回）`);
      if (!(f.dur[0] > 0 && f.dur[0] <= max))
        throw new Error(`${what}: 動きの長さ ${f.dur[0]}ms（${max}ms 以下）`);
      if (f.iter[0] !== '1') throw new Error(`${what}: 繰り返し ${f.iter[0]}`);
    };

    // #1 と AC-2・AC-3: 読み取り中の領域を握り、終わった後も同じ要素で中身が完了の文
    {
      const { c, p, fake, errors } = await open();
      try {
        fake.read = { status: 200, rows: [READ_E1], holdMs: 1500 };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator('#record-statement-status', { hasText: '読み取り中…' }).waitFor();
        const h = await p.$('#record-statement-status');
        await p.locator('.rsum__status--done').waitFor({ timeout: 10000 });
        const kept = await h.evaluate((el) => [el.isConnected, el.textContent]);
        if (!kept[0]) throw new Error('#1: 読み上げの領域が描き直された');
        mustEq(kept[1], '読み取りました', '#1 の読み上げ');
        mustEq(await seen(p), '読み取りました', '#1 の見える文');
        once(await flash(p), '#1');
        await settled(p, '#1');
        mustEq(errors.length, 0, 'ページのエラー');
        out.push('#1 同じ領域・1 回');
      } finally {
        await c.close();
      }
    }
    // #9 と AC-2: キャンセルは同じ領域の中身が替わり、動かない
    {
      const { c, p, fake } = await open();
      try {
        fake.read = { status: 200, rows: [READ_E1], holdMs: 5000 };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator('#record-statement-status', { hasText: '読み取り中…' }).waitFor();
        const h = await p.$('#record-statement-status');
        await p.getByRole('button', { name: '明細の読み取りをキャンセル' }).click();
        await p.locator('.rstmt__card--retry').waitFor();
        const kept = await h.evaluate((el) => [el.isConnected, el.textContent]);
        if (!kept[0]) throw new Error('#9: 読み上げの領域が描き直された');
        mustEq(kept[1], '読み取りをキャンセルしました', '#9 の読み上げ');
        mustEq(
          await p.locator('.rstmt__card--retry .rsum__l1').textContent(),
          '読み取りをキャンセルしました',
          '#9 の見える文',
        );
        mustEq((await flash(p)).adds, 0, '#9 の動き');
        out.push('#9 同じ領域・動きなし');
      } finally {
        await c.close();
      }
    }
    // #7 と AC-3: 失敗も 1 回だけ動く（文は今の警告のまま）
    {
      const { c, p, fake } = await open();
      try {
        fake.read = { status: 502, rows: [], holdMs: 300 };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p
          .getByRole('alert')
          .filter({ hasText: '読み取れませんでした。もう一度貼り付けるか、手入力してください。' })
          .waitFor({ timeout: 10000 });
        once(await flash(p), '#7');
        await settled(p, '#7');
        mustEq(await statusText(p), '', '#7 の読み上げの領域');
        out.push('#7 1 回');
      } finally {
        await c.close();
      }
    }
    // #13 と AC-4: 動きを減らす設定では時間 0・文は同じ
    {
      const { c, p, fake } = await open({ reduce: true });
      try {
        fake.read = { status: 200, rows: [READ_E1], holdMs: 300 };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator('.rsum__status--done').waitFor({ timeout: 10000 });
        const f = await flash(p);
        mustEq(f.adds, 1, '#13 の印の回数');
        mustEq(f.dur[0], 0, '#13 の動きの長さ（ms）');
        mustEq(await seen(p), '読み取りました', '#13 の見える文');
        mustEq(await statusText(p), '読み取りました', '#13 の読み上げ');
        out.push('#13 0ms');
      } finally {
        await c.close();
      }
    }
    // #11 と AC-5: 読み取り中にシートを開き、開いたまま終わる → 閉じた後に文が見え、2 回目の動きが無い
    {
      const { c, p, fake } = await open();
      try {
        fake.read = { status: 200, rows: [READ_E1], holdMs: 2500 };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator('#record-statement-status', { hasText: '読み取り中…' }).waitFor();
        await openVerdict(p);
        await p
          .locator('#record-statement-status', { hasText: '読み取りました' })
          .waitFor({ state: 'attached', timeout: 10000 });
        await p.waitForTimeout(400);
        await closeSheets(p);
        await p.locator('.rsum__status--done').waitFor();
        mustEq(await seen(p), '読み取りました', '#11 の見える文');
        await p.waitForTimeout(400);
        mustEq((await flash(p)).adds, 1, '#11 の動きの回数');
        out.push('#11 閉じた後に文・動き 1 回');
      } finally {
        await c.close();
      }
    }
    // #2・#14 と AC-6: 2 行を読み、1 行目を記録して次の行へ → 知らせ 1 つだけ
    {
      const { c, p, fake } = await open();
      try {
        fake.read = {
          status: 200,
          rows: [READ_E1, { ...READ_E1, symbol: '架空指数C' }],
          holdMs: 0,
        };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator('.rsum__status--done').waitFor({ timeout: 10000 });
        mustEq(await seen(p), '2 行を読み取りました', '#2 の見える文');
        mustEq(await statusText(p), '2 行を読み取りました', '#2 の読み上げ');
        // #180 の AC-2: 完了の文 → 次の行の知らせの間、読み上げの領域は同じ要素のまま中身だけが替わる
        const h = await p.$('#record-statement-status');
        await fillStatementTaps(p);
        await p.locator('#record-submit').click();
        const notice = '1 / 2 行目を記録しました。次の行（2 / 2）です';
        await p.locator('.rsum__status--notice', { hasText: notice }).waitFor({ timeout: 10000 });
        const kept = await h.evaluate((el) => [el.isConnected, el.textContent]);
        if (!kept[0]) throw new Error('#14: 読み上げの領域が描き直された');
        mustEq(kept[1], notice, '#14 の読み上げ（#180 の AC-2）');
        // 完了の文は出ず、知らせは名前の上の 1 行の 1 つだけ（要約の下の段落に出さない。#180 の AC-1）
        mustEq(await p.locator('.rsum__status--done').count(), 0, '#14 の完了の文');
        mustEq(await seen(p), notice, '#14 の名前の上の 1 行（#180 の AC-1）');
        mustEq(
          await p.evaluate(
            (t) =>
              [...document.querySelectorAll('.rstmt *:not(.sr-only)')].filter(
                (e) =>
                  e.textContent === t &&
                  ![...e.children].some((k) => k.textContent === t) &&
                  e.getClientRects().length > 0,
              ).length,
            notice,
          ),
          1,
          '#14 の見える知らせの数',
        );
        mustEq(await p.locator('.rstmt [role="status"]').count(), 1, '#14 の読み上げの領域の数');
        mustEq(await p.locator('.rsum__statusicon').count(), 0, '#14 の印（チェックを付けない）');
        // #180 の AC-3: 動きは増えず、フォーカスは明細の見出し、名前の右に印「読み取り」
        mustEq((await flash(p)).adds, 1, '#14 の動きの回数（次の行で動かない）');
        await expectPollAsync(
          async () =>
            (await p.evaluate(() => document.activeElement?.id)) === 'record-statement-title',
          '#14 の次の行のフォーカス',
        );
        mustEq(
          await p.locator('.rsum__mark', { hasText: '読み取り' }).count(),
          1,
          '#14 の印「読み取り」',
        );
        // #180 の AC-5: シートを開いて閉じても残る
        await openFields(p);
        await closeSheets(p);
        mustEq(await seen(p), notice, '#14 のシートの後（#180 の AC-5）');
        out.push('#2・#14 知らせ 1 つ・同じ領域');
      } finally {
        await c.close();
      }
    }
    // #180 の例 #2・#3: 3 行の明細で 1 行目を記録・2 行目を記録、別の明細で 1 行目をスキップ。幅 360 で切れない（AC-4）
    {
      const { c, p, fake } = await open({ viewport: { width: 360, height: 780 } });
      try {
        fake.read = {
          status: 200,
          rows: [READ_E1, { ...READ_E1, symbol: '架空指数C' }, { ...READ_E1, symbol: '架空指数D' }],
          holdMs: 0,
        };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator('.rsum__status--done').waitFor({ timeout: 10000 });
        for (const [i, want] of [
          [0, '1 / 3 行目を記録しました。次の行（2 / 3）です'],
          [1, '2 / 3 行目を記録しました。次の行（3 / 3）です'],
        ]) {
          await fillStatementTaps(p);
          await p.locator('#record-submit').click();
          await p.locator('.rsum__status--notice', { hasText: want }).waitFor({ timeout: 10000 });
          mustEq(await seen(p), want, `#2 の ${i + 1} 行目の後`);
          mustEq(await statusText(p), want, `#2 の ${i + 1} 行目の後の読み上げ`);
          const m = await p.evaluate(() => {
            const el = document.querySelector('.rsum__status--notice');
            const span = el?.querySelector('span');
            const r = el.getBoundingClientRect();
            const card = el.closest('.rstmt__card').getBoundingClientRect();
            return {
              cut:
                [el, span].some(
                  (x) =>
                    x &&
                    (x.scrollWidth > x.clientWidth + 1 ||
                      getComputedStyle(x).textOverflow === 'ellipsis'),
                ) || r.right > card.right + 0.5,
              h: document.documentElement.scrollWidth - window.innerWidth,
            };
          });
          if (m.cut) throw new Error(`#2 の ${i + 1} 行目の後: 知らせが切れている`);
          mustEq(m.h, 0, `#2 の ${i + 1} 行目の後の横スクロール（#180 の AC-4）`);
        }
        out.push('#180 の #2 幅 360 で切れない');
      } finally {
        await c.close();
      }
    }
    {
      const { c, p, fake } = await open();
      try {
        fake.read = {
          status: 200,
          rows: [READ_E1, { ...READ_E1, symbol: '架空指数C' }],
          holdMs: 0,
        };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator('.rsum__status--done').waitFor({ timeout: 10000 });
        await openFields(p);
        await p.getByRole('button', { name: 'この行をスキップ' }).click();
        const want = '1 / 2 行目をスキップしました。次の行（2 / 2）です';
        await p.locator('.rsum__status--notice', { hasText: want }).waitFor({ timeout: 10000 });
        mustEq(await statusText(p), want, '#3 の読み上げ');
        mustEq(await p.locator('.rstmt .statement__text').count(), 0, '#3 の要約の下の段落');
        out.push('#180 の #3 スキップ');
      } finally {
        await c.close();
      }
    }
    // #4 と AC-7: 幅 360 で「読み取りました · 入力が必要な欄 2」が切れず、横 0
    {
      const { c, p, fake } = await open({ viewport: { width: 360, height: 780 } });
      try {
        fake.read = {
          status: 200,
          rows: [{ ...READ_REAL, quantity: null, exitTime: null }],
          holdMs: 0,
        };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator('.rsum__status--done').waitFor({ timeout: 10000 });
        mustEq(await seen(p), '読み取りました · 入力が必要な欄 2', '#4 の見える文');
        const m = await p.evaluate(() => {
          const el = document.querySelector('.rsum__status');
          const span = el?.querySelector('span');
          const r = el.getBoundingClientRect();
          const card = el.closest('.rstmt__card').getBoundingClientRect();
          return {
            cut:
              [el, span].some(
                (x) =>
                  x &&
                  (x.scrollWidth > x.clientWidth + 1 ||
                    getComputedStyle(x).textOverflow === 'ellipsis'),
              ) || r.right > card.right + 0.5,
            h: document.documentElement.scrollWidth - window.innerWidth,
          };
        });
        if (m.cut) throw new Error('#4: 完了の文が切れている');
        mustEq(m.h, 0, '#4 の横スクロール');
        mustEq(await p.locator('.rsum__chip').count(), 2, '#4 のチップ');
        mustEq(await p.locator('.rsum__statusicon--need').count(), 1, '#4 の印（中立の「!」）');
        // 欄を埋めると見える文の数は減るが、読み上げは終わった時点の文のまま（読み上げ直さない。コードレビュー 2）
        await openFields(p);
        await p.locator('#record-quantity').fill('1');
        await closeSheets(p);
        await p.locator('.rsum__status', { hasText: '入力が必要な欄 1' }).waitFor();
        mustEq(
          await statusText(p),
          '読み取りました · 入力が必要な欄 2',
          '#4 の欄を埋めた後の読み上げ',
        );
        out.push('#4 幅 360 で切れない・埋めても読み上げ直さない');
      } finally {
        await c.close();
      }
    }
    return out.join(' / ');
  });

  // KB1（#172。ui-guidelines 9.6）: キーボードで入力の欄が隠れない。390×844 で、明細を読み取った後・口座 2 つ・「広げた」で
  // 広げた後の LC の欄まで出した 2 段目（1 画面より長い。オーナーの実機の形）。LC・一言・広げた後の LC にフォーカスして、
  // Android の形（窓が 844 → 420 に縮む = resizes-content）と、iOS の形（窓はそのまま visualViewport だけが 844 → 420。
  // visualViewport を偽物に替えて resize を送る）で、欄が上の帯の下・見えている領域の中に上下 16px 以上の余白で入る。
  // キーボードの間は下の帯（判定の 1 行・［記録する］）を貼り付けず、本文の最後に置く（#183。［記録する］ は 1 つのまま・欄より
  // 後ろ）。閉じたら印が外れ、帯が下の端に戻る。LC の決定キー（次へ）で一言へ、一言の決定キー（完了）でフォーカスが外れて帯が
  // 戻る。閉じた後はスクロール 0・中身の高さが前と同じ。あわせて書きかけの案内が隠れ、編集の画面の ［保存］ の帯・設定のシートの
  // ［保存］ の帯が本文の最後に移って、閉じると戻る（#172 のレビュー N7）。段階的に縮める（844 → 600 → 420）各段でも一言・
  // 広げた後の LC が窓の中。キーボードを出したまま一言に打ち、下へスクロールして本文の最後の ［記録する］ を押すと、打った値で
  // 保存される（Android / iOS の形。#183）。編集の画面の ［保存］ も同じ（Android の形）
  const kbdShim = () => {
    const vv = new EventTarget();
    window.__kbdH = null;
    Object.defineProperties(vv, {
      height: { get: () => window.__kbdH ?? document.documentElement.clientHeight },
      width: { get: () => document.documentElement.clientWidth },
      offsetTop: { get: () => 0 },
      offsetLeft: { get: () => 0 },
      pageTop: { get: () => window.scrollY },
      pageLeft: { get: () => window.scrollX },
      scale: { get: () => 1 },
    });
    Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true });
    window.__kbdSet = (h) => {
      window.__kbdH = h;
      vv.dispatchEvent(new Event('resize'));
    };
  };
  /** キーボードを出す / 閉じる（android = 窓が縮む、ios = visualViewport だけが縮む） */
  const kbdUp = async (p, form, h = 420) => {
    if (form === 'android') await p.setViewportSize({ width: 390, height: h });
    else await p.evaluate((v) => window.__kbdSet(v), h);
  };
  const kbdDown = async (p, form) => {
    if (form === 'android') await p.setViewportSize({ width: 390, height: 844 });
    else await p.evaluate(() => window.__kbdSet(null));
  };
  /**
   * キーボードの間の本文の最後の送るボタン（#183）: 1 つだけ・貼り付いていない・最後の欄より後ろ。下へスクロールして（見える
   * 高さ vh の下から 16px に送るボタンの下の端を合わせる）、落ち着いた後も引き戻されず、判定の 1 行と送るボタンが見える範囲に
   * あり、フォーカスは欄に残り押せることを確かめる
   */
  const bodyEndSubmit = async (p, where, { submit, bar, line, field, vh }) => {
    const g = await p.evaluate(
      ([submit, bar, field]) => {
        const r = (q) => document.querySelector(q)?.getBoundingClientRect() ?? null;
        const shownButtons = Array.from(document.querySelectorAll('button[type="submit"]')).filter(
          (b) => b.getBoundingClientRect().height > 0,
        ).length;
        const barEl = document.querySelector(bar);
        return {
          shownButtons,
          pos: barEl ? getComputedStyle(barEl).position : null,
          bar: r(bar),
          field: r(field),
          kb: document.documentElement.getAttribute('data-keyboard'),
          disabled: document.querySelector(submit)?.disabled ?? null,
        };
      },
      [submit, bar, field],
    );
    if (!g.kb) throw new Error(`${where}: キーボードの印が無い`);
    if (g.shownButtons !== 1) throw new Error(`${where}: 送るボタンが ${g.shownButtons} 個`);
    if (g.pos !== 'static')
      throw new Error(`${where}: キーボードの間に帯が貼り付いている（${g.pos}）`);
    if (!g.bar || !g.field || g.bar.top < g.field.bottom)
      throw new Error(`${where}: 本文の最後の帯が欄より前にある`);
    if (g.disabled !== false) throw new Error(`${where}: 送るボタンが押せない`);
    // キーボードが上がりきって落ち着いた後（落ち着く間は欄へ寄せ直し続ける。ui-guidelines 10.1 の「作り」）にスクロールする
    await p.waitForTimeout(1200);
    await p.evaluate(
      ([submit, vh]) => {
        const r = document.querySelector(submit).getBoundingClientRect();
        window.scrollBy(0, r.bottom - (vh - 16));
      },
      [submit, vh],
    );
    await p.waitForTimeout(1200);
    const after = await p.evaluate(
      ([submit, line, field]) => {
        const r = (q) => document.querySelector(q)?.getBoundingClientRect() ?? null;
        return {
          submit: r(submit),
          line: r(line),
          app: r('.appbar'),
          focus: document.activeElement?.id ?? '',
          field: field.slice(1),
          kb: document.documentElement.getAttribute('data-keyboard'),
        };
      },
      [submit, line, field],
    );
    const top = after.app?.bottom ?? 0;
    if (after.submit.top < top - 0.5 || after.submit.bottom > vh + 0.5)
      throw new Error(
        `${where}: スクロールしても送るボタンが見える所に無い（${Math.round(after.submit.top)}〜${Math.round(after.submit.bottom)}・窓 ${vh}）`,
      );
    if (after.line.top < top - 0.5 || after.line.bottom > after.submit.top + 0.5)
      throw new Error(`${where}: 判定の 1 行が送るボタンのすぐ上に見えない`);
    if (after.focus !== after.field || !after.kb)
      throw new Error(
        `${where}: スクロールでフォーカス・印が替わった（${after.focus}・${after.kb}）`,
      );
    return Math.round(vh - after.submit.bottom);
  };
  await check('KB1', async () => {
    const out = [];
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: signedIn,
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    try {
      await c.addInitScript(kbdShim);
      await setupContext(c, 'dark');
      const fake = await installFakeApi(c, { accounts: ACCOUNTS_2 });
      const p = await c.newPage();
      await openRecord(p, base);
      fake.read = { status: 200, rows: [READ_REAL], holdMs: 0 };
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      await seg(p, 'LC を動かしたか', '広げた').click();
      await p.locator('#record-lc-after').waitFor({ state: 'visible', timeout: 5000 });
      const geo = (sel, viewH) =>
        p.evaluate(
          ([s, vh]) => {
            const r = (q) => {
              const e = document.querySelector(q);
              if (!e) return null;
              const b = e.getBoundingClientRect();
              return { top: b.top, bottom: b.bottom, h: b.height };
            };
            const barEl = document.querySelector('.record__submit--bar');
            return {
              f: r(s),
              app: r('.appbar'),
              bar: r('.record__submit--bar'),
              barPos: barEl ? getComputedStyle(barEl).position : null,
              submits: document.querySelectorAll('#record-submit').length,
              line: r('#record-verdict-line'),
              submit: r('#record-submit'),
              vh: vh ?? window.innerHeight,
              kb: document.documentElement.getAttribute('data-keyboard'),
              focus: document.activeElement?.id ?? '',
              y: window.scrollY,
              sh: document.documentElement.scrollHeight,
            };
          },
          [sel, viewH],
        );
      const fields = ['#record-lc', '#record-broken', '#record-lc-after'];
      for (const form of ['android', 'ios']) {
        for (const sel of fields) {
          await p.evaluate(() => window.scrollTo(0, 0));
          const before = await geo(sel, null);
          await p.locator(sel).focus();
          if (form === 'android') await p.setViewportSize({ width: 390, height: 420 });
          else await p.evaluate(() => window.__kbdSet(420));
          await p.waitForTimeout(500);
          const g = await geo(sel, form === 'ios' ? 420 : null);
          const where = `${form} ${sel}`;
          const want = form === 'android' ? 'resize' : 'overlay';
          if (g.kb !== want) throw new Error(`${where}: 印が ${g.kb}（${want}）`);
          if (g.focus !== sel.slice(1)) throw new Error(`${where}: フォーカスが ${g.focus}`);
          // 帯は貼り付かず本文の最後（欄より後ろ）にあるので、見える範囲の下の端は窓（iOS は visualViewport）の下の端（#183）
          const above = g.f.top - g.app.bottom;
          const below = g.vh - g.f.bottom;
          if (above < 16 - 0.5 || below < 16 - 0.5)
            throw new Error(
              `${where}: 欄が見える所に無い（上の余白 ${above.toFixed(1)}px・下の余白 ${below.toFixed(1)}px）`,
            );
          if (g.barPos !== 'static')
            throw new Error(`${where}: キーボードの間に下の帯が貼り付いている（${g.barPos}）`);
          if (!g.bar || g.bar.top < g.f.bottom)
            throw new Error(`${where}: キーボードの間の帯が欄より前にある`);
          if (g.submits !== 1) throw new Error(`${where}: ［記録する］ が ${g.submits} 個`);
          if (opts.shots && sel === '#record-lc')
            await p.screenshot({ path: join(opts.shots, `kb1-${form}.png`) });
          out.push(`${form} ${sel.slice(8)} 上 ${Math.round(above)} / 下 ${Math.round(below)}`);
          await p.locator(sel).blur();
          if (form === 'android') await p.setViewportSize({ width: 390, height: 844 });
          else await p.evaluate(() => window.__kbdSet(null));
          await p.waitForTimeout(400);
          const back = await geo(sel, null);
          if (back.kb !== null) throw new Error(`${where}: 閉じた後も印 ${back.kb}`);
          if (!(back.submit && back.submit.h > 0) || back.barPos !== 'sticky')
            throw new Error(
              `${where}: 閉じた後に ［記録する］ の帯が下の端に戻らない（${back.barPos}）`,
            );
          // 元の位置・形に戻る（スクロール 0・中身の高さがキーボードの前と同じ。iOS の余白 --kbd-room が残らない）
          if (back.y !== 0 || back.sh !== before.sh)
            throw new Error(
              `${where}: 閉じた後に元に戻らない（scrollY ${back.y}・中身の高さ ${back.sh} / 前 ${before.sh}）`,
            );
        }
      }
      // キーボードが段階的に上がる（窓 / visualViewport が 844 → 600 → 420）: 各段で欄が窓の中（上の帯の下・下に 16px 以上）。
      // 寄せはフォーカスした瞬間の 1 回で終わらず、resize のたびに寄せ直す（オーナー「ソフトキーがズルっと上がってきたら…」）
      for (const form of ['android', 'ios']) {
        for (const sel of ['#record-broken', '#record-lc-after']) {
          await p.evaluate(() => window.scrollTo(0, 0));
          await p.locator(sel).focus();
          const steps = [];
          for (const h of [600, 420]) {
            if (form === 'android') await p.setViewportSize({ width: 390, height: h });
            else await p.evaluate((v) => window.__kbdSet(v), h);
            await p.waitForTimeout(250);
            const g = await geo(sel, form === 'ios' ? h : null);
            const above = g.f.top - g.app.bottom;
            const below = g.vh - g.f.bottom;
            if (above < -0.5 || below < 16 - 0.5)
              throw new Error(
                `段階 ${form} ${sel} ${h}: 欄が窓の中に無い（上 ${above.toFixed(1)}px・下 ${below.toFixed(1)}px）`,
              );
            steps.push(`${h}:${Math.round(below)}`);
          }
          out.push(`段階 ${form} ${sel.slice(8)} 下 ${steps.join(' → ')}`);
          await p.locator(sel).blur();
          if (form === 'android') await p.setViewportSize({ width: 390, height: 844 });
          else await p.evaluate(() => window.__kbdSet(null));
          await p.waitForTimeout(300);
        }
      }
      // 決定キー: LC（次へ）→ 一言、一言（完了）→ フォーカスが外れて帯が戻る（Android の形）
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.locator('#record-lc').focus();
      await p.setViewportSize({ width: 390, height: 420 });
      await p.waitForTimeout(400);
      const hints = await p.evaluate(() => [
        document.getElementById('record-lc')?.getAttribute('enterkeyhint'),
        document.getElementById('record-broken')?.getAttribute('enterkeyhint'),
      ]);
      if (hints[0] !== 'next' || hints[1] !== 'done')
        throw new Error(`enterkeyhint が ${hints.join(' / ')}（next / done）`);
      await p.keyboard.press('Enter');
      await p.waitForTimeout(400);
      const g1 = await geo('#record-broken', null);
      if (g1.focus !== 'record-broken')
        throw new Error(`LC の決定キーの後のフォーカスが ${g1.focus}`);
      if (g1.f.top - g1.app.bottom < 15.5 || g1.vh - g1.f.bottom < 15.5)
        throw new Error('LC の決定キーの後、一言の欄が見える所に無い');
      await p.keyboard.press('Enter');
      await p.waitForTimeout(400);
      await p.setViewportSize({ width: 390, height: 844 });
      await p.waitForTimeout(400);
      const g2 = await geo('#record-broken', null);
      if (g2.focus === 'record-broken') throw new Error('一言の決定キーでフォーカスが外れない');
      if (g2.kb !== null || !(g2.bar && g2.bar.h > 0) || g2.barPos !== 'sticky')
        throw new Error('一言の決定キーの後に帯が戻らない');
      out.push('決定キー LC → 一言 → 閉じる');
    } finally {
      await c.close();
    }
    // キーボードを出したまま、本文の最後の ［記録する］ を押して保存する（#183。Android / iOS の形）。一言に打った値が本文に入る
    for (const form of ['android', 'ios']) {
      const c3 = await browser.newContext({
        viewport: { width: 390, height: 844 },
        storageState: signedIn,
        hasTouch: true,
        reducedMotion: 'reduce',
      });
      try {
        await c3.addInitScript(kbdShim);
        await setupContext(c3, 'dark');
        const fake = await installFakeApi(c3, { accounts: ACCOUNTS_2 });
        const p = await c3.newPage();
        await openRecord(p, base);
        fake.read = { status: 200, rows: [READ_REAL], holdMs: 0 };
        await makeImage(p, STATEMENT_SPEC, 'paste');
        await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
        await fillStatementTaps(p);
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.locator('#record-broken').focus();
        await kbdUp(p, form);
        await p.waitForTimeout(500);
        await p.locator('#record-broken').press('End');
        await p.keyboard.type('（KB1 追記）');
        const left = await bodyEndSubmit(p, `本文の最後 ${form}`, {
          submit: '#record-submit',
          bar: '.record__submit--bar',
          line: '#record-verdict-line',
          field: '#record-broken',
          vh: 420,
        });
        await p.locator('#record-submit').tap();
        await waitSaved(p, '記録しました');
        expectEq(fake.posts.length, 1, `本文の最後 ${form}: 保存の要求`);
        if (!JSON.stringify(fake.posts[0]).includes('押し目の安値を割ったら（KB1 追記）'))
          throw new Error(`本文の最後 ${form}: 押したときの一言の値が保存の本文に無い`);
        await kbdDown(p, form);
        out.push(`本文の最後の ［記録する］ で保存 ${form}（下の余白 ${left}）`);
      } finally {
        await c3.close();
      }
    }
    // 書きかけの案内・編集の画面の ［保存］ の帯・設定のシートの ［保存］ の帯（Android の形。#172 のレビュー N7）
    const c2 = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: signedIn,
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    try {
      await setupContext(c2, 'dark');
      const api = await installFakeApi(c2);
      seedSettings(api);
      setAccounts(api, [{ ...ACC_ONE, capitalHistory: api.settings.capitalHistory }, ACC_B]);
      const p = await c2.newPage();
      const shown = (sel) =>
        p.evaluate((s) => {
          const e = document.querySelector(s);
          return !!e && e.getBoundingClientRect().height > 0;
        }, sel);
      /** 帯の position（キーボードの間は static = 本文の最後、閉じたら sticky。#183） */
      const pos = (sel) =>
        p.evaluate((s) => {
          const e = document.querySelector(s);
          return e && e.getBoundingClientRect().height > 0 ? getComputedStyle(e).position : null;
        }, sel);
      const inView = (sel) =>
        p.evaluate((s) => {
          const r = document.querySelector(s)?.getBoundingClientRect();
          return !!r && r.top >= 16 - 0.5 && r.bottom <= window.innerHeight - 16 + 0.5;
        }, sel);
      const open = async (field) => {
        await p.locator(field).focus();
        await p.setViewportSize({ width: 390, height: 420 });
        await p.waitForTimeout(500);
      };
      const close = async (field) => {
        await p.locator(field).blur();
        await p.setViewportSize({ width: 390, height: 844 });
        await p.waitForTimeout(400);
      };
      // 書きかけの案内（記録する画面を離れて戻る）
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('.appnav a[href="/record"]').click();
      await waitReady(p, '記録する');
      await toReview(p);
      await p.locator('#record-lc').fill('100.5');
      await p.goBack();
      await waitReady(p, '取引');
      await p.locator('.appnav a[href="/record"]').click();
      await waitReady(p, '記録する');
      await p
        .locator('#record-resumed', { hasText: '前の入力の続きです' })
        .waitFor({ timeout: 5000 });
      await open('#record-lc');
      if (await shown('#record-resumed'))
        throw new Error('キーボードの間に書きかけの案内が出ている');
      if (!(await inView('#record-lc'))) throw new Error('書きかけの案内の形で LC の欄が見えない');
      await close('#record-lc');
      if (!(await shown('#record-resumed'))) throw new Error('閉じた後に書きかけの案内が戻らない');
      out.push('書きかけの案内を隠して戻す');
      // シートの欄の並びの決定キー（#174。ui-guidelines 10.1）: 取引の欄のシートを Enter だけで 銘柄 → 数量 → イン → 決済 と
      // 進み、決済の Enter（完了）でフォーカスが外れる。どの Enter でも記録の要求は送らない（PC の形 = 印なしの暗黙の送信も止まる）
      const active = () => p.evaluate(() => document.activeElement?.id ?? '');
      const postsBefore = api.posts.length;
      await openFields(p);
      await p.locator('#record-instrument').fill('US30');
      for (const [from, to] of [
        ['#record-instrument', 'record-quantity'],
        ['#record-quantity', 'record-entry'],
        ['#record-entry', 'record-exit'],
      ]) {
        await p.locator(from).press('Enter');
        expectEq(await active(), to, `決定キー: ${from} の次`);
      }
      expectEq(
        await p.locator('#record-exit').getAttribute('enterkeyhint'),
        'done',
        '決済の決定キー',
      );
      await p.locator('#record-exit').press('Enter');
      if ((await active()) === 'record-exit')
        throw new Error('決済の「完了」でフォーカスが外れない');
      await p.waitForTimeout(300);
      expectEq(api.posts.length, postsBefore, '取引の欄の決定キーで送った記録の要求');
      await closeSheets(p);
      out.push('取引の欄のシートの決定キー（銘柄 → 数量 → イン → 決済 → 完了・送らない）');
      // 編集の画面の ［保存］ の帯
      await p.goto(`${base}/trades/x-e1/edit`);
      await p.locator('#edit-submit').waitFor({ timeout: 15000 });
      await open('#record-lc');
      if ((await pos('.edit__submit')) !== 'static')
        throw new Error('キーボードの間に編集の画面の帯が貼り付いている');
      if (!(await inView('#record-lc'))) throw new Error('編集の画面で LC の欄が見えない');
      await close('#record-lc');
      if ((await pos('.edit__submit')) !== 'sticky')
        throw new Error('閉じた後に編集の画面の帯が下の端に戻らない');
      out.push('編集の ［保存］ の帯を本文の最後へ移して戻す');
      // キーボードを出したまま一言に打ち、本文の最後の ［保存］ を押して保存する（#183）
      await p.locator('#record-broken').fill('架空の条件（KB1 編集）');
      await open('#record-broken');
      const left = await bodyEndSubmit(p, '編集の本文の最後', {
        submit: '#edit-submit',
        bar: '.edit__submit',
        line: '#edit-verdict-line',
        field: '#record-broken',
        vh: 420,
      });
      const putsBefore = api.puts.length;
      await p.locator('#edit-submit').tap();
      await expectPollAsync(async () => api.puts.length > putsBefore, '編集の ［保存］ の要求');
      if (!JSON.stringify(api.puts.at(-1).body).includes('架空の条件（KB1 編集）'))
        throw new Error('編集の本文の最後: 押したときの一言の値が保存の本文に無い');
      await p.setViewportSize({ width: 390, height: 844 });
      await p.waitForTimeout(300);
      out.push(`編集の本文の最後の ［保存］ で保存（下の余白 ${left}）`);
      // 設定のシートの ［保存］ の帯
      await p.goto(`${base}/settings/accounts`);
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      await open('#settings-account-name');
      if ((await pos('#settings-account-sheet .setform__actions')) !== 'static')
        throw new Error('キーボードの間にシートの ［保存］ の帯が貼り付いている');
      if (!(await inView('#settings-account-name'))) throw new Error('シートの欄が見えない');
      await close('#settings-account-name');
      if ((await pos('#settings-account-sheet .setform__actions')) !== 'sticky')
        throw new Error('閉じた後にシートの ［保存］ の帯が下の端に戻らない');
      out.push('シートの ［保存］ の帯を本文の最後へ移して戻す');
      // 設定の口座のシートの決定キー（#174）: 資金 → 許容リスク、許容リスクの「完了」で外れる。保存は送らない
      const writesBefore = api.writes.length;
      await p.locator('#settings-account-capital').press('Enter');
      expectEq(
        await p.evaluate(() => document.activeElement?.id ?? ''),
        'settings-account-risk',
        '決定キー: 資金の次',
      );
      await p.locator('#settings-account-risk').press('Enter');
      if ((await p.evaluate(() => document.activeElement?.id ?? '')) === 'settings-account-risk')
        throw new Error('許容リスクの「完了」でフォーカスが外れない');
      await p.waitForTimeout(300);
      expectEq(api.writes.length, writesBefore, '口座のシートの決定キーで送った保存の要求');
      out.push('口座のシートの決定キー（資金 → 許容リスク → 完了・送らない）');
    } finally {
      await c2.close();
    }
    return `キーボードで欄が隠れない（390×844 → 420）: ${out.join(' / ')}`;
  });

  // R14（#130 AC-11。ui-guidelines 9.5「形が替わっても View を包む DOM を同じに保つ」）: 記録する画面で LC に入力中に向きを
  // 変える（844×390 ⇄ 390×844）と、同じ LC の要素のまま値とフォーカスが残り、横スクロール 0。取引の欄のシートで銘柄に入力中に
  // 向きを変えても同じ
  await check('R14', async () => {
    const { c, p, errors } = await recordContext();
    const out = [];
    const keep = (id) =>
      p.evaluate((id) => {
        const el = document.getElementById(id);
        return {
          same: el?.getAttribute('data-ui-check-same') === '1',
          value: el instanceof HTMLInputElement ? el.value : null,
          focus: document.activeElement === el,
          h: document.documentElement.scrollWidth - window.innerWidth,
          form: document.documentElement.getAttribute('data-form') ?? '',
        };
      }, id);
    const mark = (id) =>
      p.evaluate((id) => document.getElementById(id)?.setAttribute('data-ui-check-same', '1'), id);
    try {
      for (const [from, to] of [
        [
          [844, 390],
          [390, 844],
        ],
        [
          [390, 844],
          [844, 390],
        ],
      ]) {
        await p.setViewportSize({ width: from[0], height: from[1] });
        await openRecord(p, base);
        await toReview(p);
        await p.locator('#record-lc').fill('99.5');
        await p.locator('#record-lc').focus();
        await mark('record-lc');
        await p.setViewportSize({ width: to[0], height: to[1] });
        await p.waitForTimeout(300);
        const k = await keep('record-lc');
        const what = `${from.join('×')} → ${to.join('×')}`;
        if (!k.same) throw new Error(`${what}: LC の欄が作り直された`);
        expectEq(k.value, '99.5', `${what}: LC の値`);
        expectEq(k.focus, true, `${what}: LC のフォーカス`);
        expectEq(k.h, 0, `${what}: 横スクロール`);
        // 取引の欄のシート（銘柄）
        await openFields(p);
        await p.locator('#record-instrument').fill('架空指数B');
        await p.locator('#record-instrument').focus();
        await mark('record-instrument');
        await p.setViewportSize({ width: from[0], height: from[1] });
        await p.waitForTimeout(300);
        const s = await keep('record-instrument');
        if (!s.same) throw new Error(`${what}（シート）: 銘柄の欄が作り直された`);
        expectEq(s.value, '架空指数B', `${what}（シート）: 銘柄の値`);
        expectEq(s.focus, true, `${what}（シート）: 銘柄のフォーカス`);
        expectEq(s.h, 0, `${what}（シート）: 横スクロール`);
        await closeSheets(p);
        out.push(`${what}（形 ${k.form}）`);
      }
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return `向きを変えても LC・取引の欄のシートの銘柄の要素・値・フォーカスが残る、横スクロール 0（${out.join(' / ')}）`;
  });

  // RS1（#130 のレビュー N2。ui-guidelines 9.3・9.7）: 記録する画面の 4 つのシート（取引の欄・タイムゾーン・判定・チャート）も、
  // 説明のシートと同じ規則で開いて閉じる。下から出て窓の中・最大 86%・開くと見出しへフォーカス・✕ で閉じると開いたボタンへ
  // フォーカスが戻る。取引の欄のシートは 段 1 → 段 2（ほかの欄）→ 戻る（段 1）→ 戻る（閉じる・［編集］ へフォーカス）
  await check('RS1', async () => {
    const out = [];
    const { c, p, fake, errors } = await recordContext();
    const openId = async () =>
      p.evaluate(() => [...document.querySelectorAll('dialog.sheet[open]')].map((d) => d.id));
    const box = async (id) =>
      p.evaluate((id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, h: r.height, vh: window.innerHeight };
      }, id);
    const expectSheet = async (id, title, what) => {
      await p.locator(`#${id}[open]`).waitFor({ state: 'visible', timeout: 5000 });
      await settleSheet(p);
      const b = await box(id);
      if (b.top < -0.5 || b.bottom > b.vh + 0.5) throw new Error(`${what}: シートが窓の外`);
      if (b.h > b.vh * 0.86 + 1)
        throw new Error(`${what}: シートの高さ ${Math.round(b.h)}px が 86% を超える`);
      expectEq(
        (await p.locator(`#${id} .sheet__title`).textContent())?.trim(),
        title,
        `${what}: 見出し`,
      );
      expectEq(
        await p.evaluate(() => document.activeElement?.classList.contains('sheet__title')),
        true,
        `${what}: 開いたら見出しへフォーカス`,
      );
      out.push(`${what} ${Math.round((b.h / b.vh) * 100)}%`);
    };
    const focusId = () => p.evaluate(() => document.activeElement?.id ?? '');
    try {
      await p.setViewportSize({ width: 390, height: 844 });
      fake.read = { status: 200, rows: READ_E10, holdMs: 0 };
      fake.chartTimeframes = ['4h'];
      await openRecord(p, base);
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      // 取引の欄: 段 1 → 段 2 → 戻る → 戻る
      await p.locator('#record-edit-fields').click();
      await expectSheet('record-fields-sheet', '取引の欄', '取引の欄');
      await p.locator('#record-more').click();
      await expectPollAsync(
        async () =>
          (await p.locator('#record-fields-sheet .sheet__title').textContent())?.trim() ===
          'ほかの欄（任意）',
        '段 2 へ',
      );
      await p.goBack();
      await expectPollAsync(
        async () =>
          (await p.locator('#record-fields-sheet .sheet__title').textContent())?.trim() ===
          '取引の欄',
        '戻るで段 1',
      );
      expectEq(new URL(p.url()).pathname, '/record', '段 1 へ戻った後の URL');
      await p.goBack();
      await expectPollAsync(async () => (await openId()).length === 0, '戻るで閉じる');
      expectEq(new URL(p.url()).pathname, '/record', '閉じた後の URL');
      await expectPollAsync(
        async () => (await focusId()) === 'record-edit-fields',
        '閉じたら ［編集］ へフォーカス',
      );
      // Esc で段 2 → 段 1 → 閉じる
      await p.locator('#record-edit-fields').click();
      await expectSheet('record-fields-sheet', '取引の欄', '取引の欄（2 回目）');
      await p.locator('#record-more').click();
      await p.locator('#record-fields-sheet #record-pnl').waitFor();
      await p.keyboard.press('Escape');
      await p.locator('#record-fields-sheet #record-instrument').waitFor();
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await openId()).length === 0, 'Esc で閉じる');
      // タイムゾーン・判定: ✕ で閉じると開いたボタンへ
      for (const [opener, id, title] of [
        ['#record-tz-open', 'record-tz-sheet', '明細の時刻のタイムゾーン'],
        ['#record-verdict-line', 'record-verdict-sheet', '判定'],
      ]) {
        await p.locator(opener).click();
        await expectSheet(id, title, title);
        await p.locator(`#${id} .sheet__close`).click();
        await expectPollAsync(async () => (await openId()).length === 0, `${title}: ✕ で閉じる`);
        await expectPollAsync(
          async () => (await focusId()) === opener.slice(1),
          `${title}: 閉じたら開いたボタンへ`,
        );
      }
      // チャート: チャートのある小さな枠から
      await pasteChart(p, 'entry');
      await p.locator('#record-mini-entry').click();
      await expectSheet('record-chart-sheet', 'チャート', 'チャート');
      await p.keyboard.press('Escape');
      await expectPollAsync(async () => (await openId()).length === 0, 'チャート: Esc で閉じる');
      await expectPollAsync(
        async () => (await focusId()) === 'record-mini-entry',
        'チャート: 閉じたら小さな枠へ',
      );
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return `記録する画面の 4 つのシートが下から窓の中・86% 以下・見出しへフォーカス・閉じたら開いたボタンへ。取引の欄は 段 2 → 戻るで段 1 → 戻るで閉じる・Esc も 1 段ずつ（${out.join(' / ')}）`;
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
      // 損益（円）を入れて R・リスク・損益の 3 つのラベルを並べる（架空の値）。判定のシートで測る（#130）
      await openMore(p);
      await p.locator('#record-pnl').fill('-8,000');
      await openVerdict(p);
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
      // 判定の枠の R は主役の数字 44px（#131 で判定の枠を組み直した。#130 のデザインレビュー b6・ui-guidelines 9.9。それまでは 36px）
      expectEq(m.size, '44px', '大きな R の文字の大きさ');
      if (/mono/i.test(m.family)) throw new Error(`大きな R の書体が等幅 ${m.family}`);
      expectEq(m.text, '−1.6R', 'R の文字（負の符号は U+2212）');
      expectEq(m.tops.length, 3, 'ラベルの数');
      const spread = Math.max(...m.tops) - Math.min(...m.tops);
      if (spread > 1) throw new Error(`ラベルの上端の差 ${spread.toFixed(1)}px`);
      return `判定 B の R は 44px・本文の書体（${m.family.split(',')[0]}）、R・リスク・損益のラベルの上端の差 ${spread.toFixed(1)}px`;
    } finally {
      await c.close();
    }
  });

  // ── チャートの時間足の読み取り（CR1。Issue #27）。偽の記録の API が 4 時間足・日足を返す
  await check('CR1', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await openRecord(p, base);
      // チャートの注意は 1 段目のチャートの枠の下（2026-11-21）
      await p.locator('.rin .charts__notice', { hasText: 'AI（Anthropic）に送ります' }).waitFor();
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
      await openVerdict(p);
      await p
        .locator('.reasons__item', { hasText: '時間足を変えた（4 時間足 → 日足・チャートから）' })
        .waitFor();
      // 利用者が直すと印が消える（時間足の欄はチャートのシートの中。#130）
      await openChartSheet(p);
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
      // 1 画面の小さな枠（空 = ファイルの欄）に貼る → 枠に入り、明細の読み取りの要求は 0（#130）
      await pasteChart(p, 'entry');
      expectEq(fake.reads.length, 0, '小さな枠に貼った後の明細の読み取りの要求');
      // チャートのシート: エントリー時の枠を選んで貼る → 枠に入り（差し替え）、明細の読み取りの要求は 0
      await openChartSheet(p);
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
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
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
      await waitSaved(p, '記録しました');
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
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      const typed = await fillStatementTaps(p);
      await p.locator('.vline .badge', { hasText: 'A' }).waitFor({ timeout: 5000 });
      await p.locator('button[type="submit"]').click();
      await waitSaved(p, '記録しました');
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
      await openSettings(p, base, '/settings/accounts');
      await p.locator('.setrow', { hasText: '資金 未設定 · 許容 1%' }).waitFor();
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
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
      await openSettings(p, base, '/settings/accounts');
      await p.locator('.setrow', { hasText: '1,000,000円 · 許容 1%' }).waitFor();
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      await p.locator('.sethistory__title', { hasText: '資金の履歴（1 件）' }).waitFor();
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
        move: 'そのまま',
      });
      await p.locator('.vline .num', { hasText: '0.5%' }).waitFor({ timeout: 5000 });
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
      await openSettings(p, base, '/settings/instruments');
      // E9: 行を押す → 編集のシート → 株価指数・usd・刻み 0.1 → 保存。
      // #133: 開いた後のフォーカスは名前の欄からシートの見出しへ（下のシートの規則。ui-guidelines 9.3・部品 Sheet）
      await p.getByRole('button', { name: 'US30 を編集' }).click();
      await waitSettingsSheet(p, 'settings-inst-sheet');
      await p.locator('#settings-inst-name').waitFor();
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id)) === 'settings-inst-sheet-title',
        '開いた後のフォーカス（シートの見出し）',
      );
      await p.locator('#settings-inst-kind').selectOption('index');
      await p.locator('#settings-inst-currency').fill('usd');
      await p.locator('#settings-inst-step').fill('0.1');
      await p.locator('form.setform button[type="submit"]').click();
      await p.getByRole('status').filter({ hasText: 'US30 を保存しました' }).waitFor();
      // 行の添えは 2 行（#133 デザインレビュー a-4）
      await p
        .locator('.setrow', { hasText: '株価指数 · 現物・CFD · USD 建て' })
        .filter({ hasText: '乗数 1 · 刻み 0.1' })
        .waitFor();
      expectEq(await p.locator('dialog[open]').count(), 0, '保存の後のシート');
      // フォーカスは描き直しの後の effect で移る（待つ）
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id)) === 'settings-edit-inst-us30',
        '閉じた後のフォーカス',
      );
      await p.reload();
      await openSettings(p, base, '/settings/instruments');
      await p
        .locator('.setrow', { hasText: '株価指数 · 現物・CFD · USD 建て' })
        .filter({ hasText: '乗数 1 · 刻み 0.1' })
        .waitFor();
      // E10・E11: 重複の名前・乗数 0 → 送らずに欄の誤り
      const before = fake.writes.length;
      await p.getByRole('button', { name: 'XAU を編集' }).click();
      await waitSettingsSheet(p, 'settings-inst-sheet');
      await p.locator('#settings-inst-name').fill('日経２２５ ');
      await p.locator('#settings-inst-multiplier').fill('0');
      await p.locator('form.setform button[type="submit"]').click();
      await p
        .locator('#settings-inst-name-error', { hasText: '同じ名前の銘柄があります' })
        .waitFor();
      await p.locator('#settings-inst-multiplier-error').waitFor();
      expectEq(fake.writes.length, before, '誤りのときの書き込み');
      // #133: やめるはシートの ✕・Esc・外・戻る（［キャンセル］ は置かない）。Esc で閉じる → 押した行へフォーカス
      await p.keyboard.press('Escape');
      await expectPollAsync(
        async () => (await p.locator('dialog[open]').count()) === 0,
        'Esc で閉じる',
      );
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id)) === 'settings-edit-inst-xau',
        'やめた後のフォーカス',
      );
      // 戻るで閉じる: シートだけが閉じ、画面は銘柄のまま。もう 1 回の戻るで設定の根へ（9.7）
      await p.getByRole('button', { name: 'XAU を編集' }).click();
      await waitSettingsSheet(p, 'settings-inst-sheet');
      await p.goBack();
      await expectPollAsync(
        async () => (await p.locator('dialog[open]').count()) === 0,
        '戻るで閉じる',
      );
      expectEq(new URL(p.url()).pathname, '/settings/instruments', '戻るで閉じた後の画面');
      // 開き直した下書きは保存した値から（閉じたら捨てる）
      await p.getByRole('button', { name: 'XAU を編集' }).click();
      await waitSettingsSheet(p, 'settings-inst-sheet');
      expectEq(await p.locator('#settings-inst-name').inputValue(), 'XAU', '開き直した名前');
      // ✕（読み上げ「閉じる」）で閉じる
      await p.locator('dialog#settings-inst-sheet').getByRole('button', { name: '閉じる' }).click();
      await expectPollAsync(
        async () => (await p.locator('dialog[open]').count()) === 0,
        '✕ で閉じる',
      );
      expectEq(fake.writes.length, before, '閉じただけの書き込み');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'E9 を直して保存 → シートが閉じ一覧・開き直しても同じ、E10・E11 は送らない、Esc・戻る・✕ で閉じる（下書きは捨てる）、フォーカスはシートの見出し ⇄ 行';
  });

  await check('SET3', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      seedSettings(fake);
      await openSettings(p, base, '/settings/instruments');
      // #133: 追加の欄は押すまで無い（［＋ 銘柄を追加］ で追加のシート）
      expectEq(await p.locator('#settings-new-name').count(), 0, '押す前の追加の欄');
      // E13: 名前だけで足す
      await p.locator('#settings-inst-add').click();
      await waitSettingsSheet(p, 'settings-inst-add-sheet');
      await p.locator('#settings-new-name').fill('GOLD');
      await p.getByRole('button', { name: '追加', exact: true }).click();
      await p.getByRole('status').filter({ hasText: 'GOLD を追加しました' }).waitFor();
      expectEq(await p.locator('dialog[open]').count(), 0, '足した後のシート');
      const row = p.locator('.setrow', { hasText: 'GOLD' });
      await row.filter({ hasText: '初期値のまま' }).waitFor();
      await row
        .filter({ hasText: 'その他 · 現物・CFD · 価格の通貨 未設定' })
        .filter({ hasText: '乗数 1 · 刻み 1' })
        .waitFor();
      const post = fake.writes.find((x) => x.key === 'POST /api/instruments');
      expectEq(JSON.stringify(post?.body), JSON.stringify({ name: 'GOLD' }), '足す本文');
      // E7（A7）: 口座 1 の許容リスク 2.5 → 警告を出して保存できる
      await openSettings(p, base, '/settings/accounts');
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
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
      await waitSettingsSheet(p, 'settings-account-sheet');
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
        await openSettings(p, base, '/settings/accounts');
        await p.getByRole('button', { name: '口座 1 を編集' }).click();
        await waitSettingsSheet(p, 'settings-account-sheet');
        await p.locator('#settings-account-risk').fill('3.1');
        await p.locator('#settings-account-capital').fill('0');
        await p.locator('#settings-account-save').click();
        await p.locator('form.setform .field--error').nth(1).waitFor();
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
        // やめる（#133: シートを Esc で閉じる）と口座の行へ戻る
        await p.keyboard.press('Escape');
        await expectPollAsync(
          async () => (await focused(p)) === 'settings-account-edit-default',
          'やめた後のフォーカス',
        );
        // 銘柄: 誤りのまま [保存] → 最初の誤りの欄（価格の通貨）。シートの戻るの段を戻し終えてから移る
        await expectPollAsync(
          async () => p.evaluate(() => !history.state?.back),
          'シートの戻るの段を戻し終える',
        );
        await openSettings(p, base, '/settings/instruments');
        await p.getByRole('button', { name: 'US30 を編集' }).click();
        await waitSettingsSheet(p, 'settings-inst-sheet');
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
    const { c, p, fake, errors } = await recordContext();
    const TF = '「時間足を変えたか」の説明';
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await openRecord(p, base);
      // 3 つのタップは 2 段目（2026-11-21）
      await toReviewByPaste(p, fake);
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
    const { c, p, fake, errors } = await recordContext();
    const TF = '「時間足を変えたか」の説明';
    // 3 つ目の問いの「i」（#202 で LC を入る前に決めていたかを聞かなくなったので、LC を動かしたかで見る）
    const DEC = '「LC を動かしたか」の説明';
    try {
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/`);
      await waitReady(p, 'ホーム');
      await p.locator('.appnav a[href="/record"]').click();
      await waitReady(p, '記録する');
      // 2 段目へは明細を貼って移る（シートを開くと履歴の段の出入りが混ざる。2026-11-21）
      await toReviewByPaste(p, fake);
      // 書きかけは 1 画面の LC で作る（取引の欄のシートを開くと履歴の段の出入りが混ざる。#130）
      await p.locator('#record-lc').fill('99.50');
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
      expectEq(await p.locator('#record-lc').inputValue(), '99.50', '下書き');
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
        await toReview(p);
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
        await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor();
        await openVerdict(p);
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
      await deleteFromDetail(p);
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
      await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor();
      await openVerdict(p);
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
      await toReview(p);
      await fillRecord(p, EX_E1);
      await p.locator('.vline .badge', { hasText: 'B 悪い損失' }).waitFor();
      // 「判定」の説明は判定のシートの中（#130）。シートを開いてから履歴の段を数える
      await openVerdict(p);
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
      await closeSheets(p);
      await p.waitForTimeout(300);
      await p.goBack();
      await waitReady(p, 'ホーム');
      await p.goForward();
      await waitReady(p, '記録する');
      await toReview(p);
      // [‹ 前の説明] と Esc でも 1 つずつ
      await openVerdict(p);
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
      await closeSheets(p);
      await p.waitForTimeout(250);
      await p.goBack();
      await waitReady(p, 'ホーム');
      await p.goForward();
      await waitReady(p, '記録する');
      await toReview(p);
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
      await waitSaved(p, '記録しました');
      await p.goto(`${base}/trades`);
      await waitReady(p, '取引');
      await p.locator('main a[href^="/trades/"]').first().click();
      await waitDetail(p);
      // 詳細の答えの札には「i」を置かない（#131 のデザインレビュー a1）。詳細の「i」は判定・R・物差しなので、物差しの説明から
      const RULER = '「LC の物差し」の説明';
      await openInfo(p, RULER);
      await p.locator(`${OPEN_SHEET} .info__glossary`).click();
      await waitReady(p, '用語集');
      expectEq(new URL(p.url()).hash, '#glossary-ruler', '用語集の項目');
      await p.waitForTimeout(300);
      const seen = await p.evaluate(() => {
        const r = document.getElementById('glossary-ruler')?.getBoundingClientRect();
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
      await openInfo(p, RULER);
      await p.locator(`${OPEN_SHEET} .info__glossary`).click();
      await waitReady(p, '用語集');
      let at = '#glossary-ruler';
      for (const step of ['1 回目', '2 回目']) {
        const from = at;
        await p.locator(`${from} a.glink`).first().click();
        await expectPollAsync(async () => {
          const h = new URL(p.url()).hash;
          return h.startsWith('#glossary-') && h !== from;
        }, `用語集の中で ${step}たどる`);
        at = new URL(p.url()).hash;
      }
      // シートの閉じる動きが終わり、移った先の窓にシートが残っていない（#129 のデザインレビュー a-1）
      await expectNoSheetShown(p, '用語集へ移った後');
      if (opts.shots)
        await p.screenshot({ path: join(opts.shots, '360x780-dark-glossary-from.png') });
      await p.locator('button.appbar__back', { hasText: '取引の詳細' }).click();
      await waitDetail(p);
      expectEq(new URL(p.url()).pathname.startsWith('/trades/'), true, '‹ 取引の詳細 の行き先');
      // 説明のシートから用語集へ移った後に下のタブを替えて戻る → ホーム（層の段を巻き戻してから積む。#129 のレビュー N6）
      await openInfo(p, RULER);
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
      await toReview(p);
      await p.locator('#record-lc').fill('100.5');
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
      await toReview(p);
      expectEq(await p.locator('#record-lc').inputValue(), '100.5', '戻った後の下書き');
      // 記録している間は下のタブを隠す（下の帯は 1 段。#127・A2。今いる画面のナビを押す #75 B1 は routes.test.ts）
      expectEq(await p.locator('nav.appnav').isVisible(), false, '記録している間の下のタブ');
      expectEq(await p.locator('#record-lc').inputValue(), '100.5', '戻った後の下書き（2）');
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
      await toReview(p);
      expectEq(await p.locator('#record-lc').inputValue(), '100.5', '[元に戻す] の後の下書き');
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
      await toReview(p);
      expectEq(await p.locator('#record-lc').inputValue(), '', '再読み込みの後');
      await cancel.click();
      await waitReady(p, '取引');
      expectEq(await p.locator('.toast').count(), 0, '入力が無いキャンセルのトースト');
      // URL を直接開いた記録する画面（アプリの中の前の画面が無い）の [キャンセル] はホームへ置き換える
      await p.goto(`${base}/record`);
      await waitReady(p, '記録する');
      await toReview(p);
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
          await toReview(p);
          await p.locator('#record-lc').fill('100.5');
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
            await toReview(p);
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
          expectEq(await p.locator('#record-lc').inputValue(), '100.5', '戻った後の下書き');
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
          await toReview(p);
          expectEq(await p.locator('#record-resumed').count(), 0, '捨てた後は続きの 1 行なし');
          await p.locator('.appbar--sheet button[aria-label="キャンセル"]').click();
          await waitReady(p, '取引');
          await p.waitForTimeout(200);
          expectEq(await p.locator('.toast').count(), 0, '入力の無い [キャンセル] のトースト');
          await shot('empty-cancel');
          // 編集
          await p.goto(`${base}/trades/x-e1`);
          await waitDetail(p);
          await p.locator('a[href="/trades/x-e1/edit"]').click();
          await waitReady(p, '取引を編集');
          await p.locator('#edit-submit').waitFor({ state: 'visible', timeout: 15000 });
          // 決済の欄は取引の欄のシートの中（#131）。打ったらシートを閉じてから離れる（戻るは先にシートを閉じるため）
          await openEditFields(p);
          const ex = await p.locator('#record-exit').inputValue();
          await p.locator('#record-exit').fill(`${ex}1`);
          await closeSheets(p);
          // 離れる: 幅 720 未満は戻る（詳細へ）、それ以上は取引のタブ（根の一覧へ）→ 行を押して詳細へ（#127）
          if (w >= 720) {
            await p.locator('.appnav a[href="/trades"]').click();
            await waitReady(p, '取引');
          } else {
            await p.goBack();
            await waitDetail(p);
          }
          await toast('の編集の変更は残っています').waitFor({ timeout: 5000 });
          await shot('edit-kept');
          if (w >= 720) {
            await p.locator('a.traderow[href="/trades/x-e1"]').click();
            await waitDetail(p);
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
          await waitDetail(p);
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
      await toReview(p);
      // 押して入れる（利用者の操作で履歴の組み直しが書かれる。#127）
      await p.locator('#record-lc').click();
      await p.locator('#record-lc').fill('100.5');
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
      await toReview(p);
      expectEq(await p.locator('#record-lc').inputValue(), '', 'ログインの後の下書き');
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
          await p.locator('#settings-link-glossary').click();
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
        await waitSaved(p, '記録しました');
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
        if (how === 'key') {
          await p.keyboard.press('Escape');
          await expectPollAsync(async () => (await popCount(p)) === 0, 'Esc で閉じる');
          await deleteFromDetail(p, 'key');
        } else {
          await closeSheet(p);
          await deleteFromDetail(p);
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
          await waitSaved(p, '記録しました');
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
          // 詳細の答えの札には「i」を置かない（#131 のデザインレビュー a1）。問いの説明は編集の画面の同じ問いの「i」で見る
          expectEq(
            await p.locator('.verdict ul.taps button.info').count(),
            0,
            `${theme} ${w}: 詳細の札の「i」`,
          );
          await p.locator('main a[href$="/edit"]').first().click();
          await waitReady(p, '取引を編集');
          await openInfo(p, '「時間足を変えたか」の説明');
          if (opts.shots && w !== 320)
            await p.screenshot({
              path: join(opts.shots, `${w}x${h}-${theme}-edit-info-tap.png`),
            });
          await p.keyboard.press('Escape');
          if (w !== 320) {
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
    return `詳細の物差し・編集の画面の 3 つのタップの「i」が窓に収まる・詳細の札に「i」なし（${out.join(' / ')}）`;
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
      await openVerdict(p);
      await p
        .locator('.verdict__account', { hasText: '口座 1 の資金 1,000,000円 に対して' })
        .waitFor();
      const riskOf = () =>
        p.locator('.verdict__stat', { hasText: 'リスク' }).locator('.num').textContent();
      expectEq(await riskOf(), '0.5%', '口座 1 のリスク');
      // 1 タップで口座 B へ（要約の下の Segment。#130）→ リスク・1 行がその場で変わる（1R 5,000 ÷ 200,000 = 2.5%）
      await closeSheets(p);
      await seg(p, '口座', '口座 B').click();
      await p.locator('.vline__risk', { hasText: '2.5%' }).waitFor();
      await openVerdict(p);
      await p
        .locator('.verdict__account', { hasText: '口座 B の資金 200,000円 に対して' })
        .waitFor();
      expectEq(await riskOf(), '2.5%', '口座 B のリスク');
      await p.locator('.reasons__item', { hasText: '過剰リスク（2.5%）' }).waitFor();
      const h = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expectEq(h, 0, '横スクロール');
      await closeSheets(p);
      await p.locator('#record-submit').click();
      await waitSaved(p, '口座 B に記録しました');
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
      await closeSheets(p);
      await p.locator('#record-submit').click();
      await waitSaved(p, '記録しました');
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
      // 口座 1 つ: 口座の欄は無く、[＋ 口座を追加] だけ（取引の欄のシートの中。#130）
      expectEq(await p.locator('[role="radiogroup"][aria-label="口座"]').count(), 0, '口座の欄');
      await openFields(p);
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
    /** 記録する画面では判定は判定のシートの中（#130） */
    // 判定の枠が判定のシートの中にある画面（記録する・編集。#130・#131）
    const onRecord = () => {
      const path = new URL(p.url()).pathname;
      return path === '/record' || path.endsWith('/edit');
    };
    const shoot = async (slug) => {
      if (!opts.shots) return;
      if (onRecord() && (await p.locator('.sheet[open] .verdict').count()) === 0)
        await openVerdict(p);
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
      if (onRecord()) await openVerdict(p);
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
      await openFields(p);
      await p.locator('#record-quantity').fill(quantity);
      await closeSheets(p);
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
      await closeSheets(p);
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
        await openVerdict(p);
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
      await openFields(p);
      await p.locator('#record-quantity').fill('12');
      await closeSheets(p);
      await expectLine(
        '数量 12（許容リスクの 48.0 倍） · 最小の数量でも許容リスクを超えます',
        '2 桁',
        'record-48x',
      );
      await closeSheets(p);
      await seg(p, '口座', '口座 B').click();
      await expectLine(
        '数量 12（許容リスクの 240.0 倍） · 最小の数量でも許容リスクを超えます',
        '3 桁',
        'record-240x',
      );
      // 1R が出ない: 価格の通貨が未設定（為替が要る）で明細の損益も無い → 行を出さない
      await fresh({});
      await fillAt(EX_E1, '10000');
      await p.locator('.vline .badge').first().waitFor();
      expectEq(await p.locator('.verdict__sizing').count(), 0, '1R が出ないときの行');
      seen.push('1R なし 0 行');
      await shoot('record-no-1r');
      // 詳細（x-d1: 1R = 8,000 × 0.50 ÷ 0.80 = 5,000、資金 1,000,000・1%）と「すべての欄」の 2 行
      await p.goto(`${base}/trades/x-d1`);
      await waitReady(p, 'US30 · L');
      await expectLine('数量 10,000 · 適正の数量 20,000（実際は 0.5 倍）', '詳細', 'detail');
      // 「すべての欄」は次の画面（#131）
      await openFieldsScreen(p);
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
          .locator('.notes')
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
      await closeSheets(p);
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
      await openSettings(p, base, '/settings/accounts');
      await p.locator('#settings-account-add').click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      await p.locator('#settings-account-name').fill('口座 C');
      await p.locator('#settings-account-save').click();
      await p.getByRole('status').filter({ hasText: '口座 C を追加しました' }).waitFor();
      expectEq(await p.locator('dialog[open]').count(), 0, '足した後のシート');
      const names = await p.locator('.setrow__name').allTextContents();
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

  // SET6（#133 の AC-1・AC-2・AC-7）: 設定の根のまとめた一覧（題の下に説明の文なし・区切り 4 つ・数の添え）→ 次の画面（口座・銘柄・
  // AI の利用状況・用語集）→ 戻るで根。直接開くと下に根を敷く（[/, /settings, /settings/accounts]）。AI の利用状況が読めなくても、
  // 根の行と口座の編集の [保存] は使える（#62 AC-7。別の画面になったので状態の検査から移した）
  await check('SET6', async () => {
    const { c, p, fake, errors } = await recordContext();
    const at = () => new URL(p.url()).pathname;
    try {
      await p.setViewportSize({ width: 390, height: 844 });
      seedSettings(fake);
      fake.aiUsage = { status: 503, body: { error: 'read_unavailable' } };
      const usageAnswered = p.waitForResponse((r) => r.url().includes('/api/ai-usage'));
      await openSettings(p, base);
      expectEq(await p.locator('main .pagehead__desc').count(), 0, '題の下の説明の文');
      expectEq(
        (await p.locator('.setgroup__title').allTextContents()).join(' / '),
        '口座 / 記録 / 表示 / アカウント',
        '区切り',
      );
      expectEq(
        (await p.locator('#settings-link-instruments .rowlink__meta').textContent())?.trim(),
        '3 件',
        '銘柄の添え',
      );
      // 口座の添えは中身（口座が 1 つ = 資金 · 許容。#133 デザインレビュー a-3）
      expectEq(
        (await p.locator('#settings-link-accounts .rowlink__meta').textContent())?.trim(),
        '1,000,000円 · 許容 1%',
        '口座の添え',
      );
      // AI が読めない: 添えは出さず、行は出す（応答が届いて描き直した後に数える）
      await usageAnswered;
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
      expectEq(
        await p.locator('#settings-link-aiUsage .rowlink__meta').count(),
        0,
        'AI の添え（読めない）',
      );
      const visited = [];
      for (const [id, path, h1] of [
        ['accounts', '/settings/accounts', '口座'],
        ['instruments', '/settings/instruments', '銘柄'],
        ['aiUsage', '/settings/ai-usage', 'AI の利用状況'],
        ['glossary', '/glossary', '用語集'],
      ]) {
        await p.locator(`#settings-link-${id}`).click();
        await waitReady(p, h1);
        expectEq(at(), path, `${h1} の URL`);
        expectEq(
          (await p.locator('main .appbar__backlabel').first().textContent())?.trim(),
          '設定',
          `${h1} の「‹ 設定」`,
        );
        expectEq(
          await p.locator('.appnav a[aria-current="page"]').getAttribute('href'),
          '/settings',
          `${h1} のタブ`,
        );
        await p.goBack();
        await waitReady(p, '設定');
        visited.push(h1);
      }
      // 直接開く → 触った後の戻るで根、もう 1 回でホーム（9.7 の 5）
      await p.goto(`${base}/settings/accounts`);
      await waitReady(p, '口座');
      await p.getByRole('button', { name: '口座 1 を編集' }).click();
      await waitSettingsSheet(p, 'settings-account-sheet');
      if (!(await p.locator('#settings-account-save').isEnabled())) {
        throw new Error('利用状況が読めないときに口座の [保存] が押せない（#62 AC-7）');
      }
      await p.keyboard.press('Escape');
      await expectPollAsync(
        async () => (await p.locator('dialog[open]').count()) === 0,
        'Esc で閉じる',
      );
      await expectPollAsync(
        async () => p.evaluate(() => !history.state?.back),
        'シートの戻るの段を戻し終える',
      );
      await p.goBack();
      await waitReady(p, '設定');
      expectEq(at(), '/settings', '直接開いた口座の画面の戻る');
      await p.goBack();
      await waitReady(p, 'ホーム');
      expectEq(at(), '/', '根の戻る');
      // ［保存］ はシートの下に貼り付き、開いた直後（スクロールなし）から全部見える。資金の履歴の端まで
      // スクロールしても見えたまま（#133 デザインレビュー a-1）。口座（資金の履歴 3 件）・銘柄（7 欄）× 幅 360 / 390
      const inView = (sel) =>
        p.locator(sel).evaluate((el) => {
          const r = el.getBoundingClientRect();
          const body = el.closest('.sheet__body')?.getBoundingClientRect();
          return (
            r.top >= 0 &&
            r.bottom <= window.innerHeight &&
            (!body || (r.top >= body.top - 0.5 && r.bottom <= body.bottom + 0.5))
          );
        });
      const shown = [];
      for (const [w, h] of [
        [360, 780],
        [390, 844],
      ]) {
        await p.setViewportSize({ width: w, height: h });
        for (const [path, button, sheetId, save] of [
          [
            '/settings/accounts',
            '口座 1 を編集',
            'settings-account-sheet',
            '#settings-account-save',
          ],
          ['/settings/instruments', 'US30 を編集', 'settings-inst-sheet', '#settings-inst-save'],
        ]) {
          await openSettings(p, base, path);
          await p.getByRole('button', { name: button }).click();
          await waitSettingsSheet(p, sheetId);
          await p.waitForFunction((id) => document.activeElement?.id === `${id}-title`, sheetId);
          // 出てくる動き（下から）が終わってから測る
          await p
            .locator(`#${sheetId}`)
            .evaluate((d) =>
              Promise.all(d.getAnimations({ subtree: true }).map((a) => a.finished)),
            );
          expectEq(
            await p.locator(`#${sheetId} .sheet__body`).evaluate((b) => b.scrollTop),
            0,
            `${w} ${button} の開いた直後のスクロール`,
          );
          expectEq(await inView(save), true, `${w} ${button} の開いた直後の [保存]`);
          await p.locator(`#${sheetId} .sheet__body`).evaluate((b) => {
            b.scrollTop = b.scrollHeight;
          });
          expectEq(await inView(save), true, `${w} ${button} の下までスクロールした [保存]`);
          await p.keyboard.press('Escape');
          await expectPollAsync(
            async () => p.evaluate(() => !history.state?.back),
            'シートの戻るの段を戻し終える',
          );
          shown.push(`${w}:${button}`);
        }
      }
      expectEq(errors.length, 0, 'ページのエラー');
      return `根（説明の文なし・区切り 4 つ・添え）→ ${visited.join('・')} → 戻るで根、直接開いた口座 → 戻るで根 → ホーム、AI が読めなくても [保存] は押せる、[保存] は開いた直後も下まで送っても見える（${shown.length} 件）`;
    } finally {
      await c.close();
    }
  });

  // ── 取引の一覧・詳細・直す・消す（Issue #9 の例の表 L4・H1・D1・D2・E1・E2・X1・X2）。偽の記録の API で流す
  // #132: 一覧の行の判定の名前は 2 行目の .traderow__grade、判定の段は左の記号の札 .traderow__mark の class
  const rowsOf = (p) =>
    p.locator('a.traderow').evaluateAll((as) =>
      as.map((a) => ({
        href: a.getAttribute('href'),
        badge: a.querySelector('.traderow__grade')?.textContent ?? '',
        badgeClass: a.querySelector('.traderow__mark')?.className ?? '',
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
  // 詳細のチャートは押せる枠（#131）。名前は枠のボタンの読み上げの名前
  const drawn = (p) =>
    p.locator('canvas.chartview__canvas').evaluateAll((cs) =>
      cs.map((c) => {
        const d = c.getContext('2d')?.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
        return {
          label: c.closest('button')?.getAttribute('aria-label') ?? c.getAttribute('aria-label'),
          alpha: d ? d[3] : 0,
        };
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
      // #132 で期待を変えた: 行はホームの詰めた行と同じ規則（R が出ない行は「—」を 1 つだけ、リスクだけ出ない行はリスクの段を
      // 出さない）。「—」の理由は一覧の下の脚注をやめ、題の行の「i」（説明のシート）に 1 回（設計書 9.3）。理由の文と件数は同じ
      if (!rows[0].text.includes('+2.0R') || rows[0].text.includes('リスク'))
        throw new Error(`L2 の行: ${rows[0].text}`);
      expectEq(rows[1].badge, '危ない勝ち', 'L3 の判定');
      if (!rows[1].badgeClass.includes('traderow__mark--break'))
        throw new Error('L3 の段が崩れでない');
      if ((rows[1].text.match(/—/g) ?? []).length !== 1)
        throw new Error(`L3 の行: ${rows[1].text}`);
      expectEq(await p.locator('.tradelist__notes').count(), 0, '一覧の下の脚注');
      await openInfo(p, '「表示されない値」の説明');
      const notes = (await p.locator(OPEN_SHEET).textContent()) ?? '';
      for (const want of [
        'リスクの「—」: 資金を設定すると表示されます（1 件）',
        'R・リスクの「—」: LC が無いため表示されません（1 件）',
      ]) {
        if (!notes.includes(want)) throw new Error(`「—」の理由のシートに「${want}」が無い`);
      }
      await closeSheet(p);
      expectEq(rows[2].badge, 'A いい損失', 'L1 の判定');
      if (!rows[2].text.includes('−1.0R') || !rows[2].text.includes('リスク 0.5%'))
        throw new Error(`L1 の行: ${rows[2].text}`);
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '並び L2 → L3 → L1、各行の判定・R・リスク（出ない値は「—」を 1 つ、理由は題の行の「i」のシートに 1 回）が例どおり';
  });

  // T-H1（#128 で直近 3 件の詰めた行に）: 新しい順の 3 件、2 件目の危ない勝ちは B と同じ崩れの段。［記録する］ は下のタブだけ
  await check('T-H1', async () => {
    const { c, p, errors } = await recordContext({ trades: [...TX_H1].reverse() });
    try {
      await p.goto(`${base}/`);
      await waitReady(p, 'ホーム');
      await p.locator('a.homerow').first().waitFor();
      const rows = await p.locator('a.homerow').evaluateAll((as) =>
        as.map((a) => ({
          href: a.getAttribute('href'),
          mark: a.querySelector('.homerow__mark')?.className ?? '',
          sub: a.querySelector('.homerow__sub')?.textContent ?? '',
        })),
      );
      expectEq(
        rows.map((r) => r.href).join(' '),
        '/trades/x-h0 /trades/x-h1 /trades/x-h2',
        '直近 3 件の並び',
      );
      if (!rows[1].sub.startsWith('危ない勝ち · ')) throw new Error(`2 件目: ${rows[1].sub}`);
      if (!rows[1].mark.includes('homerow__mark--break')) throw new Error('2 件目の段が崩れでない');
      // ホームの中に [記録する] を置かない（下のタブの ［＋ 記録］ の 1 か所。#127）。「すべての取引」の押せる行
      expectEq(await p.locator('main a[href="/record"]').count(), 0, 'ホームの中の [記録する]');
      await p.locator('main a.rowlink[href="/trades"]', { hasText: 'すべての取引' }).waitFor();
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'ホームに新しい順の 3 件（詰めた行）、2 件目の危ない勝ちは B と同じ崩れの段。[記録する] は下のタブだけ・「すべての取引」は押せる行';
  });

  // HM1（#128 AC-1・AC-2・AC-3・AC-5。ui-guidelines 9.4・9.10「1 画面に収まる」）: 等倍の文字のホームの縦のスクロール量
  // （scrollHeight − innerHeight）を 390×844 と 360×780 × ダーク / ライト × 取引 0 件・取引あり（今月の取引あり）・書きかけあり
  // で測る。期待はすべて 0px（低い窓は直近の取引を下の行から隠す。最低 1 行・書きかけの行があれば 2 件目から）。あわせて見える
  // 直近の行の数（390×844 = 3・360×780 = 2・360×780 の書きかけあり = 1）・主役の数字の大きさ（44px）・
  // 横スクロール 0。文字の拡大 200%（トークン 2 倍）では縦に伸びてよく（切らない = 直近の行の下端まで送れる）、横は 0
  await check('HM1', async () => {
    const homeTrades = [...homeMonthTrades(), ...TX_H1];
    const out = [];
    const fails = [];
    for (const theme of ['dark', 'light']) {
      for (const [w, h] of [
        [390, 844],
        [360, 780],
      ]) {
        const c = await browser.newContext({
          viewport: { width: w, height: h },
          storageState: signedIn,
          hasTouch: true,
        });
        try {
          await setupContext(c, theme);
          const api = await installFakeApi(c, { trades: homeTrades });
          const p = await c.newPage();
          const measureHome = () =>
            p.evaluate(() => {
              const se = document.scrollingElement;
              const last = document.querySelector('main .home')?.lastElementChild;
              return {
                v: se.scrollHeight - window.innerHeight,
                x: document.documentElement.scrollWidth - window.innerWidth,
                rows: [...document.querySelectorAll('.homerow')].filter((r) => r.offsetParent)
                  .length,
                xl: [...document.querySelectorAll('.homemonth .num--xl')].map(
                  (e) => getComputedStyle(e).fontSize,
                ),
                bottom: Math.round(last ? last.getBoundingClientRect().bottom : 0),
              };
            });
          const tag = `${w}x${h}-${theme}`;
          const expectZero = (m, state) => {
            if (m.x > 0) fails.push(`${tag} ${state}: 横スクロール ${m.x}px`);
            if (m.v > 0) fails.push(`${tag} ${state}: 縦スクロール ${m.v}px`);
          };
          // 取引あり
          await p.goto(`${base}/`);
          await waitReady(p, 'ホーム');
          await p.locator('.homemonth .num--xl').first().waitFor({ timeout: 15000 });
          let m = await measureHome();
          expectZero(m, '取引あり');
          const wantRows = h >= 820 ? 3 : 2;
          if (m.rows !== wantRows)
            fails.push(`${tag}: 見える直近の行 ${m.rows}（期待 ${wantRows}）`);
          if (m.xl.join(',') !== '44px,44px') fails.push(`${tag}: 主役の数字 ${m.xl.join(',')}`);
          out.push(`${tag} 取引あり 縦 ${m.v}px・中身の下端 ${m.bottom}px・行 ${m.rows}`);
          if (opts.shots)
            await p.screenshot({ path: join(opts.shots, `${tag}-hm1-home.png`), fullPage: true });
          // 書きかけあり（記録する画面で LC を入れて戻る → 「記録の書きかけがあります ›」）
          await p.locator('#appnav-record').click();
          await toReview(p);
          await p.locator('#record-lc').fill('99.5');
          await p.goBack();
          await p.locator('.homedraft a.rowlink[href="/record"]').waitFor({ timeout: 15000 });
          await p.locator('.homemonth .num--xl').first().waitFor({ timeout: 15000 });
          m = await measureHome();
          expectZero(m, '書きかけ');
          // 低い窓（360×780）は書きかけの行があると 2 件目から隠す（最低 1 行。#128 デザイン AC-2）
          const wantDraftRows = h >= 820 ? 3 : 1;
          if (m.rows !== wantDraftRows)
            fails.push(`${tag} 書きかけ: 見える直近の行 ${m.rows}（期待 ${wantDraftRows}）`);
          out.push(`${tag} 書きかけ 縦 ${m.v}px・行 ${m.rows}`);
          if (opts.shots)
            await p.screenshot({ path: join(opts.shots, `${tag}-hm1-draft.png`), fullPage: true });
          // 取引 0 件（書きかけは新しい文脈で無し）
          api.trades = [];
          const p2 = await c.newPage();
          await p2.goto(`${base}/`);
          await waitReady(p2, 'ホーム');
          await p2.getByText('最初の取引を記録しましょう').waitFor({ timeout: 15000 });
          m = await p2.evaluate(() => ({
            v: document.scrollingElement.scrollHeight - window.innerHeight,
            x: document.documentElement.scrollWidth - window.innerWidth,
          }));
          expectZero(m, '0 件');
          out.push(`${tag} 0 件 縦 ${m.v}px`);
          if (opts.shots)
            await p2.screenshot({ path: join(opts.shots, `${tag}-hm1-empty.png`), fullPage: true });
        } finally {
          await c.close();
        }
      }
    }
    // 文字の拡大 200%: 縦に伸びる（切らない）・横 0
    for (const [w, h] of [
      [360, 780],
      [390, 844],
    ]) {
      const c = await browser.newContext({
        viewport: { width: w, height: h },
        storageState: signedIn,
      });
      try {
        await setupContext(c, 'dark', true);
        await installFakeApi(c, { trades: homeTrades });
        const p = await c.newPage();
        await p.goto(`${base}/`);
        await waitReady(p, 'ホーム');
        await p.locator('.homemonth .num--xl').first().waitFor({ timeout: 15000 });
        const z = await p.evaluate(() => {
          const se = document.scrollingElement;
          const last = [...document.querySelectorAll('.homerecent .rowlink')].at(-1);
          const b = last ? last.getBoundingClientRect().bottom + window.scrollY : 0;
          return {
            v: se.scrollHeight - window.innerHeight,
            x: document.documentElement.scrollWidth - window.innerWidth,
            reach: se.scrollHeight >= b,
          };
        });
        if (z.x > 0) fails.push(`拡大 ${w}x${h}: 横スクロール ${z.x}px`);
        if (!z.reach) fails.push(`拡大 ${w}x${h}: 「すべての取引」まで送れない（切れている）`);
        out.push(`拡大 ${w}x${h} 縦 ${z.v}px（伸びてよい）・横 ${z.x}px`);
      } finally {
        await c.close();
      }
    }
    if (fails.length > 0) throw new Error(fails.join(' / '));
    return out.join(' / ');
  });

  // HM2（#128 AC-6）: ホームの押せるカード。直近の流れ（点の上を押す）→ 取引のタブ、今月の規律（数字の上を押す）→ 振り返りの
  // タブを今月で（`/review?period=custom&from=<1 日>&to=<今日>`。タブは振り返り・戻るとホーム）、直近の行 → 詳細。
  // 見出しの行のリンクの当たりは 44px 以上
  await check('HM2', async () => {
    const { c, p, errors } = await recordContext({ trades: [...homeMonthTrades(), ...TX_H1] });
    try {
      await setupContext(c, 'dark');
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/`);
      await waitReady(p, 'ホーム');
      await p.locator('.homemonth .num--xl').first().waitFor({ timeout: 15000 });
      const hits = await p
        .locator('.homecard__link')
        .evaluateAll((as) =>
          as.map((a) => a.getBoundingClientRect()).map((r) => [r.width, r.height]),
        );
      for (const [wd, ht] of hits)
        if (wd < 44 || ht < 44) throw new Error(`カードのリンクの当たり ${wd}×${ht}`);
      // 直近の流れ: 点の並びの上を押す（カードの全面が当たり）
      // カードの全面に広げたリンク（::before）が点の上に重なるので、点の真ん中の座標を押す
      const dots = await p.locator('.streak__dots').boundingBox();
      await p.mouse.click(dots.x + dots.width / 2, dots.y + dots.height / 2);
      await waitReady(p, '取引');
      expectEq(path(p), '/trades', '直近の流れ → 取引のタブ');
      expectEq(
        await p.locator('#appnav-trades').getAttribute('aria-current'),
        'page',
        '取引のタブ',
      );
      await p.goBack();
      await waitReady(p, 'ホーム');
      await p.locator('.homemonth .num--xl').first().waitFor({ timeout: 15000 });
      // 今月の規律: 数字の上を押す
      const num = await p.locator('.homemonth .num--xl').first().boundingBox();
      await p.mouse.click(num.x + num.width / 2, num.y + num.height / 2);
      await waitReady(p, '振り返り');
      const now = new Date();
      const ymd = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      expectEq(
        new URL(p.url()).search,
        `?period=custom&from=${ymd(first)}&to=${ymd(now)}`,
        '今月の規律 → 振り返りの期間',
      );
      expectEq(
        await p.locator('#appnav-review').getAttribute('aria-current'),
        'page',
        '振り返りのタブ',
      );
      await p.locator('.review__meta').waitFor();
      await p.goBack();
      await waitReady(p, 'ホーム');
      await p.locator('a.homerow').first().click();
      await p.locator('main h1', { hasText: '·' }).first().waitFor({ timeout: 15000 });
      if (!path(p).startsWith('/trades/')) throw new Error(`直近の行 → ${path(p)}`);
      // 幅 720 以上は上の帯に印と名前があるので、ホームの見出しの印と名前は見せない（2 回出さない。デザイン a6）
      await p.setViewportSize({ width: 1440, height: 900 });
      await p.goto(`${base}/`);
      await waitReady(p, 'ホーム');
      const brand = await p.evaluate(
        () =>
          [...document.querySelectorAll('.homehead__mark, .homehead__name')].filter(
            (e) => e.getBoundingClientRect().width > 0,
          ).length,
      );
      if (brand > 0) throw new Error(`1440 のホームの見出しの印と名前が見える（${brand} 個）`);
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '1440 は見出しの印と名前を隠す。直近の流れ（点の上）→ 取引のタブ、今月の規律（数字の上）→ 振り返りのタブを今月で・戻るとホーム、直近の行 → 詳細。カードのリンクの当たり 44 以上';
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
  // 件数の文は題「取引」の右（#132 で一覧の面の先頭から移した。文は同じ）
  const countText = (p) => p.locator('.tradeshead__count').textContent();

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

  // TL-M1（#132 AC-2・AC-3）: 月の区切り。合成の取引 60 件（決済は 1.5 日おきで 3 か月余り。3 件に 1 件は LC を広げた取引）を
  // 390×844 × ダーク / ライトで開き、(1) 月の見出しの数が行と合う（そろった月は「N 件 · 計画どおり M」、続きがある間の
  // いちばん古い月は「N 件を表示中 · 続きあり」）、(2) 見出しはスクロールしても上の帯のすぐ下に残り、次の月の見出しで押し出される
  // （貼り付く見出しは常に 1 つ）、(3) 最後まで読むとどの月もそろい、数の合計 = 60。--shots なら先頭・月の境・続きの読み込み中を撮る
  const monthTrades = (n) =>
    Array.from({ length: n }, (_, i) => {
      const t = fakeTrade(`m${String(i).padStart(3, '0')}`, FAKE_US30.id, 1, 1600000000000 + i);
      return {
        ...t,
        record: {
          ...t.record,
          // 3 件に 1 件は LC を広げた負け（B）、5 件に 1 件は LC を広げた勝ち（危ない勝ち = 崩れの段。計画どおりに数えない）
          ...(i % 3 === 2 || i % 5 === 4 ? { lcMove: { kind: 'widened', after: 99.2 } } : {}),
          exit: {
            ...t.record.exit,
            time: T_1110 - Math.round(i * 1.5 * DAY_MS),
            ...(i % 5 === 4 ? { price: 101 } : {}),
          },
        },
      };
    });
  /** 月の見出しと、その月の行（見出しの文・行の数・計画どおりの札の数・行の月の鍵） */
  const monthsOf = (p) =>
    p.locator('.tradelist-month').evaluateAll((ss) =>
      ss.map((s) => {
        const rows = [...s.querySelectorAll('a.traderow')];
        return {
          title: s.querySelector('.tradelist-month__title')?.textContent ?? '',
          sum: s.querySelector('.tradelist-month__sum')?.textContent ?? '',
          rows: rows.length,
          plan: rows.filter((a) => a.querySelector('.traderow__mark--plan')).length,
          keys: [
            ...new Set(
              rows.map((a) => a.querySelector('time')?.getAttribute('datetime')?.slice(0, 7)),
            ),
          ],
        };
      }),
    );
  const checkMonths = (ms, done, where) => {
    ms.forEach((m, i) => {
      if (m.keys.length !== 1)
        throw new Error(`${where}: ${m.title} の行の月が ${m.keys.join(',')}`);
      const [y, mo] = (m.keys[0] ?? '').split('-');
      expectEq(m.title, `${Number(y)}年${Number(mo)}月`, `${where}: 見出し`);
      const complete = done || i < ms.length - 1;
      expectEq(
        m.sum,
        complete ? `${m.rows} 件 · 計画どおり ${m.plan}` : `${m.rows} 件を表示中 · 続きあり`,
        `${where}: ${m.title} の数`,
      );
    });
  };
  /** 貼り付いた見出し（上端が貼り付く位置 ±1px にあるもの）の見出しの文と、貼り付く位置 */
  const stuckOf = (p) =>
    p.evaluate(() => {
      const heads = [...document.querySelectorAll('.tradelist-month__head')];
      const top = Number.parseFloat(getComputedStyle(heads[0]).top);
      const at = heads
        .map((h) => ({ h, r: h.getBoundingClientRect() }))
        .filter(({ r }) => Math.abs(r.top - top) <= 1)
        .map(({ h }) => h.querySelector('.tradelist-month__title')?.textContent ?? '');
      const bar = document.querySelector('.rootbar');
      return { top, at, barBottom: bar ? bar.getBoundingClientRect().bottom : null };
    });
  /** 月の束 i の上端（文書の座標） */
  const monthY = (p, i) =>
    p.evaluate(
      (k) =>
        document.querySelectorAll('.tradelist-month')[k].getBoundingClientRect().top +
        window.scrollY,
      i,
    );

  await check('TL-M1', async () => {
    const out = [];
    for (const theme of THEMES) {
      // 月の境は端末の時間帯で決まるので、期待の数を固定するため日本時間で開く
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        storageState: signedIn,
        hasTouch: true,
        timezoneId: 'Asia/Tokyo',
      });
      await setupContext(ctx, theme);
      const fake = await installFakeApi(ctx, { trades: monthTrades(60) });
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      const shot = async (slug) => {
        if (opts.shots) {
          await p.screenshot({ path: join(opts.shots, `390x844-${theme}-trades-${slug}.png`) });
        }
      };
      try {
        await p.goto(`${base}/trades`);
        await waitReady(p, '取引');
        await p.locator('a.traderow').nth(49).waitFor();
        await p.waitForTimeout(200);
        await shot('list');
        const first = await monthsOf(p);
        if (first.length < 2) throw new Error(`最初のページの月 ${first.length}`);
        checkMonths(first, false, `${theme} 最初の 50 件`);
        // 期待の数（手で数えた値。i = 0〜59 のうち i % 3 = 2 か i % 5 = 4 は計画どおりでない。日本時間の月）
        expectEq(
          first.map((m) => `${m.title} ${m.sum}`).join(' / '),
          '2026年11月 7 件 · 計画どおり 4 / 2026年10月 20 件 · 計画どおり 10 / 2026年9月 20 件 · 計画どおり 12 / 2026年8月 3 件を表示中 · 続きあり',
          `${theme}: 最初の 50 件の月の数`,
        );
        // (2) 1 つ目の月の途中まで送る → 1 つ目の見出しだけが貼り付く（上の帯の下端と同じ位置）
        await p.evaluate((y) => window.scrollTo(0, y), (await monthY(p, 0)) + 240);
        await p.waitForTimeout(250);
        const s1 = await stuckOf(p);
        expectEq(s1.at.join(','), first[0].title, `${theme}: 1 つ目の月で貼り付く見出し`);
        if (s1.barBottom === null) throw new Error(`${theme}: 上の帯（.rootbar）が無い`);
        if (Math.abs(s1.barBottom - s1.top) > 1)
          throw new Error(`${theme}: 貼り付く位置 ${s1.top}px と上の帯の下端 ${s1.barBottom}px`);
        // 2 つ目の月の頭を少し過ぎるまで送る → 2 つ目の見出しが貼り付き、1 つ目は押し出されている
        await p.evaluate((y) => window.scrollTo(0, y), (await monthY(p, 1)) - s1.top + 120);
        await p.waitForTimeout(250);
        const s2 = await stuckOf(p);
        expectEq(s2.at.join(','), first[1].title, `${theme}: 2 つ目の月で貼り付く見出し`);
        // 月の境の手前（2 つ目の見出しが 1 つ目を押し出している途中）を撮る
        await p.evaluate((y) => window.scrollTo(0, y), (await monthY(p, 1)) - s1.top - 20);
        await p.waitForTimeout(250);
        await shot('month-boundary');
        // (3) 最後まで読む
        for (let k = 0; k < 5 && (await p.locator('.tradelist-more').count()) > 0; k++) {
          await scrollToBottom(p);
          await p.waitForTimeout(400);
        }
        await p.getByText('全 60 件（決済の新しい順）').waitFor({ timeout: 5000 });
        const all = await monthsOf(p);
        checkMonths(all, true, `${theme} 最後まで`);
        expectEq(
          all.map((m) => m.sum).join(' / '),
          '7 件 · 計画どおり 4 / 20 件 · 計画どおり 10 / 20 件 · 計画どおり 12 / 13 件 · 計画どおり 6',
          `${theme}: 最後まで読んだ月の数`,
        );
        expectEq(
          all.reduce((a, m) => a + m.rows, 0),
          60,
          `${theme}: 月の数の合計`,
        );
        // 続きの読み込み中（開き直して 2 ページ目の応答を待たせる）
        await p.goto(`${base}/trades`);
        await waitReady(p, '取引');
        await p.locator('a.traderow').nth(49).waitFor();
        fake.tradesPageDelayMs = 3000;
        await scrollToBottom(p);
        await p.locator('#trades-more[aria-busy="true"]').waitFor({ timeout: 3000 });
        // 末尾まで送る（下のタブの上に読み込み中のボタンが見える位置）
        await scrollToBottom(p);
        await p.waitForTimeout(150);
        await shot('more-loading');
        const busy = await stuckOf(p);
        expectEq(busy.at.length, 1, `${theme}: 読み込み中に貼り付く見出しの数`);
        fake.tradesPageDelayMs = 0;
        const overflow = await p.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expectEq(overflow, 0, `${theme}: 横スクロール`);
        if (errors.length > 0) throw new Error(`${theme}: ページのエラー ${errors.length}`);
        out.push(`${theme} ${all.map((m) => m.sum).join(' / ')}`);
      } finally {
        await ctx.close();
      }
    }
    return `月の見出しの数が行と合い（続きの間は古い月だけ「続きあり」）、貼り付く見出しは上の帯の下に 1 つ: ${out.join('｜')}`;
  });

  // TL-A1（#132 デザイン a1）: 口座 2 つ（1 つは 10 字以上の長い名前）の一覧を 360×780・390×844 × ダーク / ライトで開き、
  // 口座の名前は 1 行目の「銘柄 · L / S」の後ろにだけあり、見えている口座は 4 字ぶん以上の幅（「…」だけの口座が 0）、
  // 見えない行は区切りごと次の行へ落ちている（1 行目の高さは 1 行のまま）、行の文字に「· ·」の並びが 0。--shots なら撮る
  await check('TL-A1', async () => {
    const out = [];
    const trades = EXAMPLE_TRADES.map((t, i) =>
      i % 2 === 0 ? { ...t, record: { ...t.record, accountId: ACC_LONG.id } } : t,
    );
    for (const [w, hgt] of [
      [360, 780],
      [390, 844],
    ]) {
      for (const theme of THEMES) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: hgt },
          storageState: signedIn,
          hasTouch: true,
        });
        await setupContext(ctx, theme);
        await installFakeApi(ctx, { trades, accounts: [ACC_ONE, ACC_LONG] });
        const p = await ctx.newPage();
        const errors = [];
        p.on('pageerror', (e) => errors.push(e.message));
        try {
          await p.goto(`${base}/trades`);
          await waitReady(p, '取引');
          await p.locator('a.traderow .traderow__account').first().waitFor();
          const rows = await p.locator('a.traderow').evaluateAll((as) =>
            as.map((a) => {
              const title = a.querySelector('.traderow__title').getBoundingClientRect();
              const head = a.querySelector('.traderow__head').getBoundingClientRect();
              const acc = a.querySelector('.traderow__account');
              const r = acc?.getBoundingClientRect();
              const fs = acc ? Number.parseFloat(getComputedStyle(acc).fontSize) : 0;
              return {
                text: a.textContent ?? '',
                sub: a.querySelector('.traderow__sub')?.textContent ?? '',
                lineH: title.height,
                headH: head.height,
                acc: acc
                  ? {
                      shown: r.top < title.bottom - 1 && r.bottom > title.top + 1,
                      inside: r.top >= title.top - 1,
                      width: r.width,
                      fs,
                    }
                  : null,
              };
            }),
          );
          const withAcc = rows.filter((r) => r.acc !== null);
          if (withAcc.length !== rows.length) throw new Error('口座の名前の無い行がある');
          let shown = 0;
          for (const r of rows) {
            if (r.text.includes('· ·') || r.text.includes('··'))
              throw new Error(`「· ·」: ${r.text}`);
            if (r.sub.includes('口座')) throw new Error(`2 行目に口座: ${r.sub}`);
            if (r.lineH > r.headH * 1.6) throw new Error(`1 行目が 2 行になった: ${r.text}`);
            if (r.acc?.shown) {
              shown++;
              if (r.acc.width < 4 * r.acc.fs - 0.5)
                throw new Error(
                  `口座の幅 ${r.acc.width}px（4 字 ${4 * r.acc.fs}px 未満）: ${r.text}`,
                );
            }
          }
          if (shown === 0) throw new Error('見えている口座が 0');
          const overflow = await p.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expectEq(overflow, 0, `${w} ${theme}: 横スクロール`);
          if (opts.shots) {
            await p.screenshot({
              path: join(opts.shots, `${w}x${hgt}-${theme}-trades-accounts-long.png`),
              fullPage: true,
            });
          }
          if (errors.length > 0) throw new Error(`${w} ${theme}: ページのエラー ${errors.length}`);
          out.push(`${w}-${theme} ${shown}/${rows.length}`);
        } finally {
          await ctx.close();
        }
      }
    }
    return `口座は 1 行目だけ・見えるものは 4 字以上・「· ·」0（見えた口座/行: ${out.join('・')}）`;
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
        'エントリー時のチャート（4 時間足）を大きく見る / 決済時のチャート（日足）を大きく見る',
        'チャートの名前',
      );
      const tfs = await p.locator('.dchart__cap').allTextContents();
      expectEq(tfs.join(' / '), 'エントリー時 · 4 時間足 / 決済時 · 日足', '時間足');
      // 2 枠は横に並ぶ（#131 AC-5。上端が揃い、左右に分かれる）
      const boxes = await p.locator('.dchart').evaluateAll((es) =>
        es.map((e) => {
          const r = e.getBoundingClientRect();
          return { top: Math.round(r.top), left: Math.round(r.left) };
        }),
      );
      if (boxes.length !== 2 || boxes[0].top !== boxes[1].top || boxes[0].left >= boxes[1].left)
        throw new Error(`2 枠が横に並ばない: ${JSON.stringify(boxes)}`);
      // 押すと全画面で見る層（黒い面・✕）。窓いっぱい・canvas が描ける・Esc で閉じて枠へフォーカスが戻る
      await p.locator('#detail-chart-exit').click();
      const viewer = p.locator('#detail-chart-viewer[open]');
      await viewer.waitFor({ state: 'visible', timeout: 5000 });
      await p.waitForTimeout(250);
      const vr = await viewer.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const c = e.querySelector('canvas');
        const px = c?.getContext('2d')?.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          vw: window.innerWidth,
          vh: window.innerHeight,
          title: e.querySelector('h2')?.textContent ?? '',
          label: c?.getAttribute('aria-label') ?? '',
          alpha: px ? px[3] : 0,
        };
      });
      if (vr.w !== vr.vw || vr.h !== vr.vh)
        throw new Error(`層が窓いっぱいでない: ${JSON.stringify(vr)}`);
      expectEq(vr.title, '決済時 · 日足', '層の題');
      expectEq(vr.label, '決済時のチャート（日足）', '層の画像の名前');
      if (vr.alpha === 0) throw new Error('層の canvas が描けていない');
      await p.keyboard.press('Escape');
      await expectPollAsync(
        async () => (await p.locator('#detail-chart-viewer[open]').count()) === 0,
        'Esc で層を閉じる',
      );
      await expectPollAsync(
        async () => (await p.evaluate(() => document.activeElement?.id)) === 'detail-chart-exit',
        '閉じたら枠へフォーカス',
      );
      expectEq(new URL(p.url()).pathname, '/trades/x-d1', '層を閉じても詳細のまま');
      expectEq(fake.chartGets.join(' '), 'x-d1-entry x-d1-exit', 'チャートの GET');
      expectEq(await p.locator('img').count(), 0, 'img の数');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'B・−1.6R・0.5%・2 つの理由、2 枚のチャート（API のバイト列を canvas に描く）を横に並べ名前 · 時間足、押すと窓いっぱいの層（Esc で閉じて枠へ）';
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
      // 取引の欄は取引の欄のシートの中（#130）
      await openFields(p);
      const m = await p.evaluate(() => {
        const sec = document.querySelector('#record-fields-sheet');
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
      const figs = await p.locator('.dchart').allTextContents();
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
      // 札は短い問い（見える文字）、読み上げは問いの全文（#131 のデザインレビュー a1）
      const off = await p
        .locator('.verdict ul.taps li.taps__item--off .taps__text')
        .allTextContents();
      expectEq(off.join(' / '), 'LC: 広げた（99.2） / 時間足: 4 時間足 → 日足', '外れた答え');
      const offSpoken = await p
        .locator('.verdict ul.taps li.taps__item--off')
        .evaluateAll((es) =>
          es.map((e) => [...e.querySelectorAll('.sr-only')].map((x) => x.textContent).join('')),
        );
      expectEq(
        offSpoken.join(' / '),
        'LC を動かしたか: 広げた（99.2）計画から外れた / 時間足を変えたか: 4 時間足 → 日足計画から外れた',
        '外れた答えの読み上げ',
      );
      const note = await p.locator('.verdict').textContent();
      // 食い違いの 1 行はあなたの答えだけ（チャートの足は札が言う。#131 のデザインレビュー a2）
      if (!note?.includes('あなたの答え: そのまま') || note.includes('／ チャート:'))
        throw new Error('時間足の食い違いの 1 行が「あなたの答え: そのまま」でない');
      // 「すべての欄」は次の画面（#131 AC-6。その場で開かない）。上の帯は「‹ 取引の詳細」、戻ると詳細
      expectEq(await p.locator('main details').count(), 0, '詳細の折りたたみ');
      await openFieldsScreen(p);
      expectEq(new URL(p.url()).pathname, '/trades/x-d1/fields', '「すべての欄」の URL');
      expectEq(
        (await p.locator('.appbar__back').getAttribute('aria-label')) ?? '',
        '取引の詳細へ戻る',
        '次の画面の戻る',
      );
      const labels = await p.locator('.fields__label').allTextContents();
      // 先頭は口座の 3 行（口座の数によらない。#47 U18）、その後に記録する画面の欄の順
      if (
        labels.slice(0, 4).join(' / ') !==
          '口座 / 口座の資金（記録したとき） / 許容リスク（記録したとき） / 銘柄' ||
        !labels.includes('時間足を変えたか')
      )
        throw new Error(`すべての欄: ${labels.join(' / ')}`);
      await p.goBack();
      await waitDetail(p);
      expectEq(errors.length, 0, 'ページのエラー');
      return `物差しの一覧 5 行・図は読み上げから外す・数の段 → 物差し → 理由 → 札、広げた区間・越えた区間・目盛り、札の外れは 2 つ、「すべての欄」は次の画面（物差しの段の高さ ${Math.round(rulerH)}px @360）`;
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

  /** 編集の比較のシートを開く（#131: 「今の値と比べる」の行 → 比較のシート） */
  const openCompare = async (p) => {
    await closeSheets(p);
    await p.locator('#edit-compare').click();
    await p.locator('#edit-compare-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
    await settleSheet(p);
  };

  await check('T-E3', async () => {
    const { c, p, fake, errors } = await recordContext({ accounts: OWNER_ACCOUNTS() });
    try {
      fake.trades.push(resnapTrade('x-e3', 1700000000008, null, 30));
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades/x-e3/edit`);
      await waitReady(p, '取引を編集');
      await p.locator('#edit-submit').waitFor();
      // 比較は 1 行「今の値と比べる」（#131。カード・折りたたみは置かない）
      expectEq(await p.locator('main details, main section.resnap').count(), 0, '画面の中の枠');
      expectEq(
        ((await p.locator('#edit-compare').textContent()) ?? '').trim(),
        '今の値と比べる1 か所違います',
        '比較の行',
      );
      await openCompare(p);
      const panel = p.locator('#edit-compare-sheet .resnap');
      const ptext = (await panel.textContent()) ?? '';
      if (
        !ptext.includes('この取引には資金が保存されていないため、過剰リスクを判定していません。') ||
        !ptext.includes('200,000円') ||
        !ptext.includes('2.5%') ||
        !ptext.includes('「A いい損失」から「B 悪い損失」に変わります') ||
        ptext.includes('写')
      )
        throw new Error(`比較のシート: ${ptext}`);
      expectEq(
        await p.locator('input[name="edit-resnapshot"][value="recorded"]').isChecked(),
        true,
        '2 択の既定',
      );
      await shootPair(p, '#edit-compare-sheet .resnap', 'edit-resnapshot-owner-compare');
      // 判定のシートの注記のそばの ［今の値で再計算］（押すと比較のシートを開いて「今の値」へ）
      await openVerdict(p);
      const v0 = await verdictOf(p);
      expectEq(v0.badge, 'A いい損失', '開いたとき');
      if (!v0.text.includes('資金が未設定のため、過剰リスクは判定していません'))
        throw new Error(`注記: ${v0.text}`);
      const near = p.locator('#edit-verdict-sheet .verdict__action button');
      expectEq((await near.textContent())?.trim(), '今の値で再計算', '注記のそばのボタン');
      expectEq(await overflowX(p), 0, '360px の横スクロール（選ぶ前）');
      await shootPair(p, '#edit-verdict-sheet .verdict__action', 'edit-resnapshot-owner-before');
      await near.focus();
      await p.keyboard.press('Enter');
      await p.locator('#edit-compare-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
      // N-3: 押したボタンは消えるので、フォーカスは比較のシートの「今の値」へ
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
      await expectPollAsync(
        async () => (await verdictOf(p)).badge === 'B 悪い損失',
        '選んだ後のプレビュー',
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
      await shootPair(p, '#edit-compare-sheet .resnap', 'edit-resnapshot-owner-after');
      await closeSheets(p);
      expectEq(
        ((await p.locator('#edit-compare').textContent()) ?? '').trim(),
        '今の値と比べる今の値で計算中',
        '選んだ後の比較の行',
      );
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
    return '口座 2 つ・資金が空の取引: 行「今の値と比べる」→ 比較のシート（未設定 → 200,000円・— → 2.5%・A → B の 1 文）、判定のシートの [今の値で再計算] → Enter で比較のシートの「今の値」へ・B・帯「今の値で再計算 · 判定: A → B」→ 保存で ?snapshot=current・保存した資金 200,000 円・詳細 2.5%（360px 横スクロール 0）';
  });

  await check('T-E4', async () => {
    const { c, p, fake, errors } = await recordContext({ accounts: OWNER_ACCOUNTS() });
    try {
      // 記録したとき 1,000,000 円（0.5% = A）、今 200,000 円（2.5% = B）。勧めない（文で勧めない・ボタンも無い）
      fake.trades.push(resnapTrade('x-e4', 1700000000009, 1000000, 31));
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${base}/trades/x-e4/edit`);
      await waitReady(p, '取引を編集');
      await p.locator('#edit-submit').waitFor();
      expectEq(await p.locator('main details, main section.resnap').count(), 0, '画面の中の枠');
      expectEq(await p.locator('.verdict .verdict__action').count(), 0, '注記のそばのボタン');
      await openCompare(p);
      const ftext = (await p.locator('#edit-compare-sheet .resnap').textContent()) ?? '';
      if (
        !ftext.includes('1,000,000円') ||
        !ftext.includes('「A いい損失」から「B 悪い損失」に変わります')
      )
        throw new Error(`中身: ${ftext}`);
      await p.locator('input[name="edit-resnapshot"][value="current"]').check();
      expectEq((await verdictOf(p)).badge, 'B 悪い損失', '今の値のプレビュー');
      expectEq(await overflowX(p), 0, '360px の横スクロール');
      await shootPair(p, '#edit-compare-sheet .resnap', 'edit-resnapshot-fold-open');
      await p.locator('input[name="edit-resnapshot"][value="recorded"]').check();
      expectEq((await verdictOf(p)).badge, 'A いい損失', '戻した後');
      await closeSheets(p);
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
    return '資金が入っていた取引: 行「今の値と比べる」→ 比較のシート（A → B の 1 文）・注記のそばのボタンなし →「今の値」で B →「記録したとき」で戻して保存はクエリなし・資金はそのまま';
  });

  // #131 AC-2・AC-3: 詳細の「…」→ 操作のシート →「今の値と比べる」→ 比較のシート（見るだけ・2 択なし）→ ［編集で今の値にする］ で
  // 編集が「今の値」を選んだ状態で開く。詳細で比べている間は保存の要求 0（#31 の P4）。保存で ?snapshot=current
  await check('T-E5', async () => {
    const { c, p, fake, errors } = await recordContext({ accounts: OWNER_ACCOUNTS() });
    const out = [];
    try {
      fake.trades.push(resnapTrade('x-e5', 1700000000010, 1000000, 32));
      for (const [w, h] of [
        [390, 844],
        [1440, 900],
      ]) {
        await p.setViewportSize({ width: w, height: h });
        await p.goto(`${base}/trades/x-e5`);
        await waitDetail(p);
        await p.locator('#detail-more').click();
        const actions = p.locator('#detail-actions-sheet[open]');
        await actions.waitFor({ state: 'visible', timeout: 5000 });
        await settleSheet(p);
        expectEq(
          (await actions.locator('.rowlink .rowlink__text').allTextContents()).join(' / '),
          '今の値と比べる / 削除',
          '操作のシートの行',
        );
        expectSheetInWindow(await sheetBox(p), `${w} 操作のシート`);
        await p.locator('#detail-action-compare').click();
        const compare = p.locator('#detail-compare-sheet[open]');
        await compare.waitFor({ state: 'visible', timeout: 5000 });
        await settleSheet(p);
        expectSheetInWindow(await sheetBox(p), `${w} 比較のシート`);
        expectEq(await compare.locator('input[type="radio"]').count(), 0, '詳細の比較の 2 択');
        const t = (await compare.textContent()) ?? '';
        if (!t.includes('1,000,000円') || !t.includes('200,000円'))
          throw new Error(`比較のシート: ${t}`);
        expectEq(fake.puts.length, 0, '詳細で比べている間の PUT');
        await compare.getByRole('link', { name: '編集で今の値にする' }).click();
        await waitReady(p, '取引を編集');
        expectEq(`${path(p)}${new URL(p.url()).search}`, '/trades/x-e5/edit?values=current', 'URL');
        await expectPollAsync(
          async () =>
            ((await p.locator('#edit-compare').textContent()) ?? '').includes('今の値で計算中'),
          '「今の値」を選んで開く',
        );
        expectEq((await verdictOf(p)).badge, 'B 悪い損失', '今の値のプレビュー');
        expectEq(fake.puts.length, 0, '開いただけでは PUT しない');
        if (w === 1440) {
          await p.locator('#edit-submit').click();
          await waitDetail(p);
          expectEq(fake.puts.length, 1, 'PUT の数');
          expectEq(fake.puts[0].query, '?snapshot=current', 'PUT のクエリ');
        } else {
          await p.locator('.appbar--sheet button[aria-label="キャンセル"]').click();
          await waitDetail(p);
        }
        out.push(`${w}: 操作 → 比較 → 編集（今の値）`);
      }
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return `詳細の比較は見るだけ（2 択なし・PUT 0）、［編集で今の値にする］ で「今の値」を選んだ編集・保存で ?snapshot=current（${out.join(' / ')}）`;
  });

  // #131 AC-4・AC-7（ui-guidelines 9.2・設計書 9.2）: 等倍の文字の 390×844 × ダーク / ライトで、詳細の 1 画面目に判定のカードと
  // チャートの 2 枠（下端が下のタブより上）。測る取引はモックと同じ形の x-m1（決めた LC で決済した A・理由 2 つ・答えは計画どおり・
  // チャート 2 枚）。理由・外れた答え・食い違いの 1 行が多い取引（x-d1 = B・理由 2 つ・外れ 2 つ・食い違い）は中身を畳まないので
  // 1 画面を越えてよいが、チャートの枠が下のタブの上に 60px 以上のぞく（#131 のデザインレビュー）。R は主役の数字 44px。撮るのはレビューに要る状態だけ（詳細・…のシート・比較・編集・
  // 編集の比較）
  await check('D131', async () => {
    const out = [];
    for (const theme of THEMES) {
      const { c, p, fake, errors } = await recordContext({ accounts: OWNER_ACCOUNTS() });
      try {
        await setupContext(c, theme);
        fake.trades.push(resnapTrade('x-e6', 1700000000011, 1000000, 33));
        fake.trades.push(
          exampleTrade(
            'x-m1',
            1700000000012,
            { entryChartTimeframe: '4h', exitChartTimeframe: '4h' },
            {
              charts: {
                entry: { contentType: 'image/png', size: 1 },
                exit: { contentType: 'image/png', size: 1 },
              },
            },
          ),
        );
        await p.setViewportSize({ width: 390, height: 844 });
        const shot = async (slug) => {
          if (!opts.shots) return;
          await p.mouse.move(0, 0);
          await p.screenshot({ path: join(opts.shots, `390x844-${theme}-${slug}.png`) });
        };
        const chartsBottom = () =>
          p.evaluate(() =>
            Math.round(
              document.querySelector('.dcharts__grid')?.getBoundingClientRect().bottom ?? 0,
            ),
          );
        await p.goto(`${base}/trades/x-d1`);
        await waitDetail(p);
        await p.locator('canvas.chartview__canvas').nth(1).waitFor({ timeout: 15000 });
        const d1Bottom = await chartsBottom();
        // 理由・外れた札の多い取引は丸ごと入らなくてよいが、チャートの枠が下のタブの上に 60px 以上のぞく（続きがあると分かる。
        // #131 のデザインレビュー: 悪い損失ほどチャートを見返す）
        const d1 = await p.evaluate(() => ({
          top: Math.round(
            document.querySelector('.dcharts__grid')?.getBoundingClientRect().top ?? 1e9,
          ),
          nav: Math.round(document.querySelector('.appnav')?.getBoundingClientRect().top ?? 0),
        }));
        if (d1.top > d1.nav - 60)
          throw new Error(
            `${theme}: x-d1 のチャートの上端 ${d1.top}px が下のタブ（${d1.nav}px）の 60px 上より下`,
          );
        await shot('detail-d1');
        await p.goto(`${base}/trades/x-m1`);
        await waitDetail(p);
        await p.locator('canvas.chartview__canvas').nth(1).waitFor({ timeout: 15000 });
        const m = await p.evaluate(() => {
          const grid = document.querySelector('.dcharts__grid')?.getBoundingClientRect();
          const nav = document.querySelector('.appnav')?.getBoundingClientRect();
          const r = document.querySelector('.verdict__stats .num--xl');
          return {
            chartsBottom: grid ? Math.round(grid.bottom) : null,
            navTop: nav ? Math.round(nav.top) : window.innerHeight,
            rSize: r ? getComputedStyle(r).fontSize : '',
            statsRows: (() => {
              const tops = [...document.querySelectorAll('.verdict__stats .verdict__stat')].map(
                (e) => Math.round(e.getBoundingClientRect().top),
              );
              return new Set(tops).size;
            })(),
            details: document.querySelectorAll('main details').length,
            overflow: Math.max(document.documentElement.scrollWidth - window.innerWidth, 0),
          };
        });
        if (m.chartsBottom === null || m.chartsBottom > m.navTop)
          throw new Error(
            `${theme}: チャートの 2 枠の下端 ${m.chartsBottom}px が下のタブ（${m.navTop}px）より下`,
          );
        expectEq(m.rSize, '44px', `${theme}: 判定の R の大きさ`);
        expectEq(m.statsRows, 1, `${theme}: R・リスク・損益の行の数`);
        expectEq(m.details, 0, `${theme}: 詳細の折りたたみ`);
        expectEq(m.overflow, 0, `${theme}: 横スクロール`);
        await shot('detail');
        // 操作のシート・比較のシート（違う値のある取引）
        await p.goto(`${base}/trades/x-e6`);
        await waitDetail(p);
        await p.locator('#detail-more').click();
        await p.locator('#detail-actions-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
        await settleSheet(p);
        expectSheetInWindow(await sheetBox(p), `${theme} 操作のシート`);
        await shot('detail-actions');
        await p.locator('#detail-action-compare').click();
        await p.locator('#detail-compare-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
        await settleSheet(p);
        expectSheetInWindow(await sheetBox(p), `${theme} 比較のシート`);
        await shot('detail-compare');
        await closeSheets(p);
        // 編集（全画面のシート。下のタブを隠す）と比較のシート
        await p.locator('a[href="/trades/x-e6/edit"]').click();
        await waitReady(p, '取引を編集');
        await p.locator('#edit-submit').waitFor();
        expectEq(await p.locator('.appnav').isVisible(), false, `${theme}: 編集の下のタブ`);
        expectEq(await p.locator('main details').count(), 0, `${theme}: 編集の折りたたみ`);
        await shot('edit');
        await p.locator('#edit-compare').click();
        await p.locator('#edit-compare-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
        await settleSheet(p);
        expectSheetInWindow(await sheetBox(p), `${theme} 編集の比較のシート`);
        await shot('edit-compare');
        expectEq(errors.length, 0, 'ページのエラー');
        out.push(
          `${theme} チャートの下端 ${m.chartsBottom}px / 下のタブ ${m.navTop}px（x-d1 はチャートの上端 ${d1.top}px・下端 ${d1Bottom}px）`,
        );
      } finally {
        await c.close();
      }
    }
    return `詳細の 1 画面目に判定とチャート 2 枠・R 44px・R / リスク / 損益が 1 行・折りたたみ 0、操作・比較のシートが窓の中（${out.join(' / ')}）`;
  });

  // OPT117（#117）: オプションのポジションのレッグ。架空の銘柄（商品の形 = オプション）と、合成の fixture（option-legs.json の P1）の
  // 取引で、記録する画面の 2 段目の取引の欄のシートの段 leg（［＋ レッグ］）・詳細のレッグの表・編集の段 leg を開き、シートが窓の中・
  // 横のスクロール 0 を見る。編集は何も変えずに保存し、PUT の本文にレッグが載る（#116 の 409 legsMissing を避ける）。
  // --shots なら 3 つ（記録の段 leg・詳細・編集の段 leg）だけ撮る（ダーク）
  await check('OPT117', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await setupContext(c, 'dark');
      const fx = JSON.parse(
        readFileSync(join(ROOT, 'tests/fixtures/records/option-legs.json'), 'utf8'),
      ).items.find((x) => x.name === 'P1');
      const inst = {
        id: 'inst-xyzopt',
        ...fx.instrument,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      };
      delete inst.underlying;
      fake.instruments.push(inst);
      // 10 本（架空。P1 の 3 本を写して行使価格をずらす）
      const ten = Array.from({ length: 10 }, (_, i) => {
        const b = fx.record.legs[i % fx.record.legs.length];
        return { ...b, id: `l${i + 1}`, strike: b.strike + 100 * i };
      });
      fake.trades.push({
        id: 'x-opt10',
        schemaVersion: 2,
        createdAt: 1700000000021,
        updatedAt: 1700000000021,
        record: { ...fx.record, instrumentId: inst.id, legs: ten },
        snapshot: fx.snapshot,
      });
      fake.trades.push({
        id: 'x-opt1',
        schemaVersion: 2,
        createdAt: 1700000000020,
        updatedAt: 1700000000020,
        record: { ...fx.record, instrumentId: inst.id },
        snapshot: fx.snapshot,
      });
      const shot = async (slug) => {
        if (!opts.shots) return;
        await p.mouse.move(0, 0);
        await p.screenshot({ path: join(opts.shots, `390x844-dark-${slug}.png`) });
      };
      // 記録する・編集の取引の欄のシート（OPEN_SHEET は record-*-sheet を除くので、id で見る）
      const titleOf = async (id) =>
        ((await p.locator(`#${id}[open] .sheet__title`).textContent()) ?? '').trim();
      const hscroll = () =>
        p.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
      // 記録する画面: ［明細なしで手入力］ → 銘柄をオプションに → レッグの一覧 → ［＋ レッグ］ で段 leg
      await openRecord(p, base);
      await openFields(p);
      await p.locator('#record-instrument').fill(inst.name);
      await p.locator('#record-legs-add').waitFor({ state: 'visible', timeout: 5000 });
      expectEq(
        await p.locator('#record-fields-sheet[open] #record-quantity').count(),
        0,
        '数量の欄',
      );
      await p.locator('#record-legs-add').click();
      await expectPollAsync(
        async () => (await titleOf('record-fields-sheet')) === 'レッグ 1',
        '段 leg の題',
      );
      await settleSheet(p);
      expectSheetInWindow(await sheetBox(p, '#record-fields-sheet[open]'), '記録の段 leg');
      expectEq(await hscroll(), 0, '記録の横のスクロール');
      // 1 本の欄は幅 390 でも 2 列で、決済と ［満期で消滅］ まで 1 画面に入る（デザインレビュー N1）
      const below = await p.evaluate(() =>
        ['leg-0-expired', 'leg-0-exit']
          .map((id) => document.getElementById(id)?.getBoundingClientRect())
          .filter((r) => !r || r.bottom > window.innerHeight)
          .map((r) => (r ? Math.round(r.bottom) : 'なし')),
      );
      expectEq(below.length, 0, `決済・満期で消滅が窓の下（${below.join(' / ')}）`);
      await shot('opt-record-leg');
      const toMain = async () => {
        await p.keyboard.press('Escape');
        await expectPollAsync(
          async () => (await titleOf('record-fields-sheet')) === '取引の欄',
          '段 1 へ戻る',
        );
      };
      await toMain();
      // 10 本まで足す（AC-13: 10 本でも横にスクロールしない。11 本目は押せない）
      for (let i = 1; i < 10; i++) {
        await p.locator('#record-legs-add').click();
        await expectPollAsync(
          async () => (await titleOf('record-fields-sheet')) === `レッグ ${i + 1}`,
          `レッグ ${i + 1} の段`,
        );
        await toMain();
      }
      expectEq(await p.locator('#record-legs .legs__item').count(), 10, 'レッグの行');
      expectEq(await p.locator('#record-legs-add').isDisabled(), true, '11 本目の ［＋ レッグ］');
      expectEq(await hscroll(), 0, '10 本の横のスクロール');
      // 消して ［元に戻す］（P4。デザインレビュー B1）
      await p.locator('#record-legs-9').click();
      await expectPollAsync(
        async () => (await titleOf('record-fields-sheet')) === 'レッグ 10',
        'レッグ 10 の段',
      );
      await p.locator('#leg-9-remove').click();
      await expectPollAsync(
        async () => (await titleOf('record-fields-sheet')) === '取引の欄',
        '消した後は段 1',
      );
      await p.locator('#record-legs-undo').waitFor({ state: 'visible', timeout: 5000 });
      expectEq(await p.locator('#record-legs .legs__item').count(), 9, '消した後の行');
      await p.locator('#record-legs-undo').scrollIntoViewIfNeeded();
      await settleSheet(p);
      await shot('opt-record-undo');
      await p.locator('#record-legs-undo').click();
      expectEq(await p.locator('#record-legs .legs__item').count(), 10, '戻した後の行');
      // 再レビュー B2: 消してから ［＋ レッグ］ で 10 本に戻すと、［元に戻す］ は押せず理由を出す（11 本目を作らない）
      await p.locator('#record-legs-9').click();
      await expectPollAsync(
        async () => (await titleOf('record-fields-sheet')) === 'レッグ 10',
        'レッグ 10 の段（2 回目）',
      );
      await p.locator('#leg-9-remove').click();
      await p.locator('#record-legs-undo').waitFor({ state: 'visible', timeout: 5000 });
      await p.locator('#record-legs-add').click();
      await toMain();
      expectEq(await p.locator('#record-legs .legs__item').count(), 10, '足し直した後の行');
      expectEq(await p.locator('#record-legs-undo').isDisabled(), true, '10 本の ［元に戻す］');
      await p.locator('#record-legs-undo').scrollIntoViewIfNeeded();
      await settleSheet(p);
      await shot('opt-record-undo-full');
      await closeSheets(p);
      // 10 本の取引の詳細: 幅 390 はカード、1440 は表。どちらも横 0
      await p.goto(`${base}/trades/x-opt10`);
      await waitDetail(p);
      await p.locator('.legtable').waitFor({ state: 'visible', timeout: 10000 });
      expectEq(await p.locator('.legtable__card').count(), 10, '10 本のカード');
      expectEq(await hscroll(), 0, '10 本の詳細の横（390）');
      await p.setViewportSize({ width: 1440, height: 900 });
      await expectPollAsync(
        async () => await p.locator('.legtable__table').isVisible(),
        '1440 は表',
      );
      expectEq(await hscroll(), 0, '10 本の詳細の横（1440）');
      await p.locator('.legtable').scrollIntoViewIfNeeded();
      if (opts.shots) {
        await p.mouse.move(0, 0);
        await p.screenshot({ path: join(opts.shots, '1440x900-dark-opt-detail-10.png') });
      }
      await p.setViewportSize({ width: 390, height: 844 });
      // 詳細: 判定のカードの下にレッグの表
      await p.goto(`${base}/trades/x-opt1`);
      await waitDetail(p);
      await p.locator('.legtable').waitFor({ state: 'visible', timeout: 10000 });
      expectEq(await hscroll(), 0, '詳細の横のスクロール');
      await p.locator('.legtable').scrollIntoViewIfNeeded();
      await shot('opt-detail');
      // 編集: 取引の欄のシートのレッグの行 → 段 leg。閉じて何も変えずに保存 → PUT にレッグ
      await p.goto(`${base}/trades/x-opt1/edit`);
      await waitReady(p, '取引を編集');
      await p.locator('#edit-submit').waitFor();
      await openEditFields(p);
      await p.locator('#record-legs-1').click();
      await expectPollAsync(
        async () => (await titleOf('edit-fields-sheet')) === 'レッグ 2',
        '編集の段 leg の題',
      );
      await settleSheet(p);
      expectSheetInWindow(await sheetBox(p, '#edit-fields-sheet[open]'), '編集の段 leg');
      expectEq(await hscroll(), 0, '編集の横のスクロール');
      await shot('opt-edit-leg');
      await closeSheets(p);
      await p.locator('#edit-submit').click();
      await expectPollAsync(async () => fake.puts.length === 1, 'PUT が届く');
      const legs = fake.puts[0].body?.legs;
      expectEq(Array.isArray(legs) ? legs.length : -1, fx.record.legs.length, 'PUT のレッグの数');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '記録の段 leg（2 列で決済・満期で消滅まで窓の中）・10 本で横 0 と 11 本目は押せない・消して ［元に戻す］、詳細のレッグの表（390 カード / 1440 表・10 本で横 0）・編集の段 leg が窓の中で横 0、編集の保存の PUT にレッグ 3 本';
  });

  // OPT118（#118）: 明細のオプションの行 → ポジションの下書き。偽の読み取りが架空のオプションの行 3 本（同じ日の 2 本 = 1 件、
  // 別の日の 1 本 = 次の件。1 本目は年を補った限月）を返し、2 段目の要約・取引の欄のシートのレッグの一覧（印「読み取り ·
  // 年を補った」・「明細の次のポジション ［このポジションに入れる］」）を見る。［別のポジションにする］ → ［このポジションに入れる］
  // で 1 件に戻る。シートが窓の中・横 0。--shots なら 2 つ（2 段目・取引の欄のシート。ダーク）だけ撮る
  await check('OPT118', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await setupContext(c, 'dark');
      fake.instruments.push({
        id: 'inst-xyzop',
        name: '架空指数XYZOP',
        underlyingKind: 'index',
        productForm: 'option',
        priceCurrency: 'JPY',
        multiplier: 1000,
        quantityStep: 1,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      });
      const opt = (o) => ({
        symbol: `架空指数XYZOP ${o.pc === 'put' ? 'P' : 'C'} ${o.strike}`,
        side: o.side === 'sell' ? 'S' : 'L',
        entryPrice: o.entry,
        exitPrice: o.exit,
        quantity: o.qty,
        pnl: o.pnl,
        pnlCurrency: 'JPY',
        entryTime: o.opened,
        exitTime: o.closed,
        timeZoneNeedsCheck: false,
        fees: [o.fee],
        feesTotal: o.fee,
        exitOrderType: o.order ?? 'unknown',
        option: {
          underlying: '架空指数XYZOP',
          expiry: '2027-01',
          expiryYearInferred: o.inferred ?? false,
          putCall: o.pc,
          strike: o.strike,
          side: o.side,
          position: o.position,
        },
      });
      fake.read = {
        status: 200,
        holdMs: 0,
        rows: [
          opt({
            pc: 'put',
            strike: 36000,
            side: 'sell',
            qty: 2,
            entry: 240,
            exit: 110,
            pnl: 259000,
            fee: 1000,
            opened: jstTime(2026, 12, 8, 9, 40),
            closed: jstTime(2026, 12, 22, 13, 15),
            position: 0,
            inferred: true,
          }),
          opt({
            pc: 'put',
            strike: 35500,
            side: 'buy',
            qty: 2,
            entry: 150,
            exit: 70,
            pnl: -161000,
            fee: 1000,
            opened: jstTime(2026, 12, 8, 9, 41),
            closed: jstTime(2026, 12, 22, 13, 16),
            position: 0,
            order: 'stop',
          }),
          opt({
            pc: 'call',
            strike: 41000,
            side: 'buy',
            qty: 1,
            entry: 60,
            exit: 35,
            pnl: -25300,
            fee: 300,
            opened: jstTime(2026, 12, 9, 10, 20),
            closed: jstTime(2026, 12, 18, 14, 5),
            position: 1,
          }),
        ],
      };
      const shot = async (slug) => {
        if (!opts.shots) return;
        await p.mouse.move(0, 0);
        await p.screenshot({ path: join(opts.shots, `390x844-dark-${slug}.png`) });
      };
      const hscroll = () =>
        p.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
      await openRecord(p, base);
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('#record-lc').waitFor({ state: 'visible', timeout: 15000 });
      await p.locator(READ_DONE).first().waitFor({ timeout: 10000 });
      // 2 段目: 上の帯に「1 / 2 件目」（取引とポジションを合わせて数える）、要約に「レッグ 2」
      await p.getByText('1 / 2 件目').first().waitFor({ timeout: 5000 });
      expectEq(
        ((await p.locator('#record-summary').textContent()) ?? '').includes('レッグ 2'),
        true,
        '要約のレッグ',
      );
      expectEq(await hscroll(), 0, '2 段目の横のスクロール');
      // 年を補った限月の札（注意の色）が要約に出る。要約の名前・「L · レッグ 2」は切れない（デザインレビュー 1・5・#164）
      await p.locator('#record-summary .field__mark--warn').waitFor({ timeout: 5000 });
      expectEq((await summaryCuts(p)).join('、'), '', '要約の切れた文字');
      await shot('opt118-review');
      // 取引の欄のシート: レッグ 2 本の印・次のポジションの行
      await openFields(p);
      await p.locator('#record-legs-merge').scrollIntoViewIfNeeded();
      await settleSheet(p);
      const metas = await p.locator('#record-legs .rowlink__meta').allTextContents();
      expectEq(metas.join(' | '), '読み取り | 読み取り', 'レッグの印');
      expectEq(await p.locator('#record-legs .field__mark--warn').count(), 1, '年の札');
      const nextText = (await p.locator('#record-legs .legs__next').textContent()) ?? '';
      expectEq(
        nextText.includes('エントリー 12/9') && nextText.includes('買い 1 · C 41,000 · 2027-01'),
        true,
        `次のポジションの見出し（${nextText}）`,
      );
      expectSheetInWindow(await sheetBox(p, '#record-fields-sheet[open]'), '取引の欄のシート');
      expectEq(await hscroll(), 0, 'シートの横のスクロール');
      await shot('opt118-legs');
      // ［別のポジションにする］（レッグ 2 の段）→ 1 本に。［このポジションに入れる］ で 2 本に戻る（7.6）
      await p.locator('#record-legs-1').click();
      await p.locator('#leg-1-split').waitFor({ state: 'visible', timeout: 5000 });
      await settleSheet(p);
      expectSheetInWindow(await sheetBox(p, '#record-fields-sheet[open]'), 'レッグ 1 本の段');
      expectEq(await hscroll(), 0, 'レッグの段の横のスクロール');
      await shot('opt118-leg');
      await p.locator('#leg-1-split').click();
      await expectPollAsync(
        async () => (await p.locator('#record-legs .legs__item').count()) === 1,
        '分けた後のレッグ',
      );
      await p.getByText('1 / 3 件目').first().waitFor({ timeout: 5000 });
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id ?? '')) === 'record-legs-merge',
        '分けた後のフォーカス',
      );
      await p.locator('.legs__notice').waitFor({ timeout: 5000 });
      await p.locator('#record-legs-merge').click();
      await expectPollAsync(
        async () => (await p.locator('#record-legs .legs__item').count()) === 2,
        '入れた後のレッグ',
      );
      // 2 件目（別の日のポジション 1 本）: 1 件目をスキップして移る
      await p.getByRole('button', { name: 'このポジションをスキップ' }).click();
      await p.getByText('2 / 2 件目').first().waitFor({ timeout: 5000 });
      await closeSheets(p);
      expectEq(
        ((await p.locator('#record-summary').textContent()) ?? '').includes('レッグ 1'),
        true,
        '2 件目の要約',
      );
      expectEq(await hscroll(), 0, '2 件目の横のスクロール');
      await shot('opt118-second');
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return '明細のオプションの行 3 本 → 2 件（ポジション 2 本 + 1 本）・「1 / 2 件目」・要約「レッグ 2」（切れない）と年の札・次のポジションの見出し（エントリーの日・レッグの 1 行）、レッグの段、［別のポジションにする］ → 3 件・知らせ → ［このポジションに入れる］ で 2 本に戻る、2 件目、シートが窓の中・横 0';
  });

  // OPT118N（#118 の見直し）: オプションの銘柄が一覧に無い明細のポジション。2 段目の要約に「未入力 乗数」、押すと取引の欄の
  // シートの乗数の欄へ（placeholder の例・価格の通貨の 1 行は全幅）。--shots なら 1 枚（シートの乗数の欄。ダーク）
  await check('OPT118N', async () => {
    const { c, p, fake, errors } = await recordContext();
    try {
      await setupContext(c, 'dark');
      const leg = (o) => ({
        symbol: `架空225 ${o.pc === 'put' ? 'P' : 'C'} ${o.strike}`,
        side: o.side === 'sell' ? 'S' : 'L',
        entryPrice: o.entry,
        exitPrice: o.exit,
        quantity: 1,
        pnl: o.pnl,
        pnlCurrency: 'JPY',
        entryTime: jstTime(2026, 12, 8, 9, 40),
        exitTime: jstTime(2026, 12, 22, 13, 15),
        timeZoneNeedsCheck: false,
        fees: [500],
        feesTotal: 500,
        exitOrderType: 'unknown',
        option: {
          underlying: '架空225',
          expiry: '2027-01',
          expiryYearInferred: false,
          putCall: o.pc,
          strike: o.strike,
          side: o.side,
          position: 0,
        },
      });
      fake.read = {
        status: 200,
        holdMs: 0,
        rows: [
          leg({ pc: 'put', strike: 36000, side: 'sell', entry: 240, exit: 110, pnl: 129500 }),
          leg({ pc: 'put', strike: 35500, side: 'buy', entry: 150, exit: 70, pnl: -80500 }),
        ],
      };
      await openRecord(p, base);
      await makeImage(p, STATEMENT_SPEC, 'paste');
      await p.locator('#record-lc').waitFor({ state: 'visible', timeout: 15000 });
      const chip = p.locator('.rsum__named button', { hasText: '乗数' });
      await chip.waitFor({ state: 'visible', timeout: 5000 });
      expectEq(((await chip.textContent()) ?? '').includes('未入力'), true, '「未入力 乗数」');
      await chip.click();
      await p.locator('#record-fields-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
      await settleSheet(p);
      await expectPollAsync(
        async () =>
          (await p.evaluate(() => document.activeElement?.id ?? '')) === 'record-new-multiplier',
        '乗数の欄へフォーカス',
      );
      expectEq(
        await p.locator('#record-new-multiplier').getAttribute('placeholder'),
        '例: 1000',
        '乗数の例',
      );
      const hint = (await p.locator('#record-new-multiplier-what').textContent()) ?? '';
      expectEq(hint.includes('価格の通貨 JPY'), true, `価格の通貨の 1 行（${hint}）`);
      const wide = await p.evaluate(() => {
        const h = document.getElementById('record-new-multiplier-what')?.getBoundingClientRect();
        const b = document
          .querySelector('#record-fields-sheet[open] .record__sheetbody')
          ?.getBoundingClientRect();
        return h && b ? h.width / b.width : 0;
      });
      expectEq(wide > 0.8, true, `案内の 1 行が全幅（${wide.toFixed(2)}）`);
      expectSheetInWindow(await sheetBox(p, '#record-fields-sheet[open]'), '取引の欄のシート');
      expectEq(
        await p.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        0,
        '横のスクロール',
      );
      if (opts.shots) {
        await p.mouse.move(0, 0);
        await p.screenshot({ path: join(opts.shots, '390x844-dark-opt118-new-instrument.png') });
      }
      expectEq(errors.length, 0, 'ページのエラー');
    } finally {
      await c.close();
    }
    return 'オプションの銘柄が無い明細のポジション: 要約の「未入力 乗数」→ 乗数の欄へフォーカス・例「1000」・「価格の通貨 JPY」の 1 行が全幅、シートが窓の中・横 0';
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
      await deleteFromDetail(p);
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
      await deleteFromDetail(p);
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
