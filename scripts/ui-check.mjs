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
// いちばん長い値（Issue #176・ui-guidelines 10.3）は手順 LV1（360×780 のダークの一覧・ホーム・詳細で、省略してよい所の外の「…」0・値の切れ 0）。
// 記録する・編集のいちばん長い値（Issue #212）は手順 LV2（360×780・390×844 のダークの 2 段目・1 段目・編集で「…」0・値の切れ 0・時間足の塊が 1 行・縦は R12 の上限。文字の拡大 2 倍も）。
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
// 書きかけありで縦のスクロール量 0px・見える直近の行の数・今月の規律の数字 title 28px + 単位 14px、文字の拡大 200% では縦に伸びて切れず横 0）・HM2（押せる
// カードの行き先 = 取引のタブ・振り返りのタブを今月で・詳細）を流す。規律の振り返りの状態は振り返りのタブ `/review` と次の画面
// 「数で見る」（`/review/table`）で測る（RV1 は期間の置き換えと「数で見る ›」の往復）。
// ホーム画面に追加（Issue #77）: 手順 PWA1（/ に manifest-src 'self' の CSP を付けて開き、CDP の Page.getAppManifest のエラー 0 件・
// manifest の CSP の違反 0 件・manifest のアイコンが 200）を流す。
// ログイン済みの文脈の /api は、このスクリプトの中の偽の記録の API（記憶の中だけ・架空の値）に置き換える
// （Flask と Firestore のエミュレーターを立てなくてよい。本物の API の経路は Issue #13 の手での確かめで見る）。
//
// 作り（#226）: 検査は画面ごとの単位（scripts/ui-check/screens/<単位>.mjs）に分けてある。このファイルは入口で、
// 開発サーバーとログインを 1 回だけ用意し、単位ごとに子のプロセス（scripts/ui-check/worker.mjs。Chromium を 1 つ）を立てて
// 流し、数を足して要約を出す。共有の道具は scripts/ui-check/ の base.mjs（引数・画面と幅の一覧・測り・待ち）・fixtures.mjs
// （偽の記録の API と例の値）・helpers.mjs（操作の道具）・record-states.mjs・settings-states.mjs（状態の一覧）・groups.mjs
// （幅 × テーマで測る状態の塊）・kit.mjs（手順の共有の道具）・harness.mjs（文脈と数え）。状態・画面の単位への振り分けと、
// 変えたファイルから単位を選ぶ規則は units.mjs（振り分けの無い状態は終了コード 2）。単位の一覧は `-- --list`。
//
// 前提: `npm ci` の後に一度 `npx playwright install chromium`（ブラウザは手元のキャッシュに入る。リポジトリには入らない）。
// Auth のエミュレーター（127.0.0.1:9099。`npm run emulators`）が動いていること（無ければ終了コード 2）。
// 架空の利用者はエミュレーターのログインの画面で自動生成する（実在のメールを使わない）。ログインの画面は
// Google の gapi の script（apis.google.com）を読むので、ネットに出られない環境ではログインできない。
// Vite の開発サーバーはこのスクリプトが空きポートに立てて、終わりに閉じる（手で `npm run dev` を立てなくてよい）。
//
//   npm run ui:check                       既定の検査（全部の単位）
//   npm run ui:check -- --only review,record   選んだ単位だけを流す（単位の ID は --list）
//   npm run ui:check -- --changed [<ref>]  <ref>（既定 origin/main）からの差分と作業ツリーの変更のファイルから単位を選んで流す
//                                          （規則は scripts/ui-check/units.mjs の CHANGE_RULES。共有の部品・トークン・殻・検査の
//                                          共有のファイルは全部の単位）
//   npm run ui:check -- --workers <n>      単位を n 個ずつ並べて流す（既定は CPU の数の半分・1〜4。2 vCPU では 1）
//   npm run ui:check -- --list             単位の一覧を出して終わる（エミュレーターは要らない）
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
// 終了コード: 0 = すべて ok / 1 = 外れあり / 2 = 引数の誤り・起動できない（途中で止まった単位があるときも）
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  AUTH_EMULATOR,
  emulatorUp,
  freePort,
  loginViaPopup,
  opts,
  pad,
  ROOT,
  SIZES,
  THEMES,
  waitReady,
  zoomCss,
} from './ui-check/base.mjs';
import { RESULT_PREFIX } from './ui-check/harness.mjs';
import { coverageErrors, UNIT_IDS, UNITS, unitsForChanges } from './ui-check/units.mjs';

const USAGE = `使い方: npm run ui:check [-- --only <単位,…>] [-- --changed [<ref>]] [-- --workers <n>] [-- --list] [-- --inject-wide <px>] [-- --inject-clip] [-- --zoom] [-- --shots <dir>]`;

/** 既定の並列の数: CPU の数の半分（Chromium と開発サーバーが CPU を取り合うので半分）を 1〜4 に収める */
const DEFAULT_WORKERS = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));

/** 引数を読む。誤りは終了コード 2 */
function parseArgs(argv) {
  const o = { injectWide: 0, injectClip: false, zoom: false, shots: '' };
  const run = { only: null, changed: null, workers: DEFAULT_WORKERS, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--inject-clip') {
      o.injectClip = true;
    } else if (a === '--zoom') {
      o.zoom = true;
    } else if (a === '--inject-wide') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v <= 0)
        usageError('--inject-wide には正の整数（px）を渡してください');
      o.injectWide = v;
    } else if (a === '--shots') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) usageError('--shots には出力先のディレクトリを渡してください');
      o.shots = resolve(v);
    } else if (a === '--only') {
      const v = argv[++i];
      if (!v || v.startsWith('--'))
        usageError('--only には単位の ID をカンマ区切りで渡してください');
      const ids = v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const unknown = ids.filter((x) => !UNIT_IDS.includes(x));
      if (ids.length === 0 || unknown.length > 0)
        usageError(`知らない単位: ${unknown.join(', ') || v}（単位: ${UNIT_IDS.join(', ')}）`);
      run.only = ids;
    } else if (a === '--changed') {
      const v = argv[i + 1];
      if (v && !v.startsWith('--')) {
        if (!/^[\w.~^@/][\w./~^@-]*$/.test(v)) usageError(`--changed の ref の形が違います: ${v}`);
        run.changed = v;
        i++;
      } else {
        run.changed = 'origin/main';
      }
    } else if (a === '--workers') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v <= 0 || v > 16)
        usageError('--workers には 1〜16 の整数を渡してください');
      run.workers = v;
    } else if (a === '--list') {
      run.list = true;
    } else if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else {
      usageError(`知らない引数: ${a}`);
    }
  }
  if (run.only && run.changed) usageError('--only と --changed は一緒に使えません');
  return { o, run };
}

function usageError(msg) {
  console.error(msg);
  console.error(USAGE);
  process.exit(2);
}

/** git の差分（ref からの変更・作業ツリーの変更・追跡していないファイル）のファイルの一覧 */
function changedFiles(ref) {
  const git = (args) =>
    execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  try {
    return [
      ...new Set([
        ...git(['diff', '--name-only', '--end-of-options', `${ref}...HEAD`]),
        ...git(['diff', '--name-only', 'HEAD']),
        ...git(['ls-files', '--others', '--exclude-standard']),
      ]),
    ];
  } catch (e) {
    console.error(
      `git の差分を取れません（${ref}）: ${e instanceof Error ? e.message.split('\n')[0] : e}`,
    );
    process.exit(2);
  }
}

/** 単位を 1 つ子のプロセスで流す。live なら出力をそのまま流し、そうでなければ終わってからまとめて出す */
function runWorker(id, base, statePath, live) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(
      process.execPath,
      [join(ROOT, 'scripts/ui-check/worker.mjs'), id, base, statePath, JSON.stringify(opts)],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const lines = [];
    let result = null;
    let rest = '';
    const onLine = (line) => {
      if (line.startsWith(RESULT_PREFIX)) {
        result = JSON.parse(line.slice(RESULT_PREFIX.length));
        return;
      }
      if (live) console.log(line);
      else lines.push(line);
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const parts = (rest + chunk).split('\n');
      rest = parts.pop() ?? '';
      for (const l of parts) onLine(l);
    });
    const err = [];
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('close', (code) => {
      if (rest) onLine(rest);
      const stderr = err.join('').trim();
      if (stderr) (live ? console.log : (l) => lines.push(l))(stderr);
      done({ id, code, result, lines, ms: Date.now() - started });
    });
  });
}

async function main() {
  const { o, run } = parseArgs(process.argv.slice(2));
  Object.assign(opts, o);
  process.chdir(ROOT);
  try {
    zoomCss();
  } catch (e) {
    console.error(`文字の拡大の CSS を作れません: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  const cover = coverageErrors();
  if (cover.length > 0) {
    console.error('単位への振り分けの誤り（scripts/ui-check/units.mjs）:');
    for (const x of cover) console.error(`  ${x}`);
    process.exit(2);
  }

  let selected = UNIT_IDS;
  if (run.only) selected = UNIT_IDS.filter((u) => run.only.includes(u));
  if (run.changed) {
    const files = changedFiles(run.changed);
    const { units, allBy } = unitsForChanges(files);
    console.log(`変えたファイル（${run.changed} から）: ${files.length} 件`);
    if (allBy.length > 0)
      console.log(
        `  全部の単位を流す（共有のファイル: ${allBy.slice(0, 5).join('、')}${allBy.length > 5 ? ' ほか' : ''}）`,
      );
    selected = units;
  }
  if (run.list) {
    for (const u of UNITS) {
      const m = await import(`./ui-check/screens/${u.id}.mjs`);
      const parts = [m.states && '状態', m.zoom && '文字の拡大', m.flows && '手順'].filter(Boolean);
      console.log(
        `${pad(u.id, 18)} ${m.title}（${parts.join('・')}）${selected.includes(u.id) ? '' : '  （選んでいない）'}`,
      );
    }
    process.exit(0);
  }
  if (selected.length === 0) {
    console.log('流す単位がありません（変えたファイルに画面の検査の単位が当たらない）');
    console.log('ok');
    process.exit(0);
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

  const started = Date.now();
  const port = await freePort();
  const server = await createServer({
    configFile: join(ROOT, 'vite.config.ts'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
  });
  await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const tmp = mkdtempSync(join(tmpdir(), 'loss-note-ui-check-'));
  const statePath = join(tmp, 'signed-in.json');
  // 途中で止めても、ログインした状態（エミュレーターの架空の利用者）の一時ファイルを残さない
  process.once('SIGINT', () => {
    rmSync(tmp, { recursive: true, force: true });
    process.exit(130);
  });

  const results = [];
  try {
    // ログインした状態（IndexedDB の中のログインの記録）を 1 回作り、各単位の文脈で使い回す（架空のアカウント）
    let browser;
    try {
      browser = await chromium.launch();
    } catch (e) {
      console.error(
        `Chromium を起動できません。一度 \`npx playwright install chromium\` を流してください。\n${e instanceof Error ? e.message.split('\n')[0] : e}`,
      );
      process.exitCode = 2;
      return;
    }
    try {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p = await c.newPage();
      await p.goto(`${base}/login`);
      await waitReady(p, 'ログイン');
      await loginViaPopup(p);
      await waitReady(p, 'ホーム');
      writeFileSync(statePath, JSON.stringify(await c.storageState({ indexedDB: true })));
      await c.close();
    } catch (e) {
      console.error(
        `エミュレーターでログインできません（ログインの画面は apis.google.com を読みます。ネットに出られるか確かめてください）: ${e instanceof Error ? e.message.split('\n')[0] : e}`,
      );
      process.exitCode = 2;
      return;
    } finally {
      await browser.close();
    }

    if (opts.shots) mkdirSync(opts.shots, { recursive: true });
    const workers = Math.min(run.workers, selected.length);
    console.log(
      `画面の検査: 単位 ${selected.length} つ（${selected.join('・')}）× ${SIZES.length} 幅 × ${THEMES.length} テーマ、並列 ${workers}${opts.injectWide ? `（幅 ${opts.injectWide}px の要素を足す）` : ''}`,
    );
    // 重い単位から始める（並列のときに最後の 1 つだけが長く残らないように）。1 本なら一覧の順
    const queue =
      workers > 1
        ? [...selected].sort(
            (a, b) =>
              (UNITS.find((u) => u.id === b)?.weight ?? 0) -
              (UNITS.find((u) => u.id === a)?.weight ?? 0),
          )
        : [...selected];
    const live = workers === 1;
    const lane = async () => {
      while (queue.length > 0) {
        const id = queue.shift();
        if (live) console.log(`\n── ${id}`);
        const r = await runWorker(id, base, statePath, live);
        if (!live) {
          console.log(`\n── ${id}（${Math.round(r.ms / 1000)} 秒）`);
          for (const l of r.lines) console.log(l);
        }
        results.push(r);
      }
    };
    await Promise.all(Array.from({ length: workers }, lane));
  } finally {
    await server.close();
    rmSync(tmp, { recursive: true, force: true });
  }
  if (process.exitCode === 2) return;

  // 単位ごとの数を足す
  const problems = [];
  const sum = {
    states: 0,
    worstH: 0,
    smallTotal: 0,
    clippedTotal: 0,
    nestTotal: 0,
    barTotal: 0,
    zoomTotal: 0,
    zoomUnscaled: 0,
    zoomOverlap: 0,
    zoomKnown: 0,
  };
  const linkish = new Set();
  const recordDup = new Set();
  let flowCount = 0;
  let flowNg = 0;
  const byUnit = [];
  // 子が起動できない・途中で例外（子の終了コード 2）は、元の 1 本の検査と同じく全体も 2（起動できない）にする
  let crashed = false;
  for (const id of selected) {
    const r = results.find((x) => x.id === id);
    if (!r?.result || r.code !== 0) {
      crashed = true;
      problems.push(`${id}: 検査が途中で止まった（終了コード ${r?.code}）`);
      byUnit.push(`${pad(id, 18)} 止まった（終了コード ${r?.code}）`);
      continue;
    }
    const x = r.result;
    for (const k of Object.keys(sum))
      sum[k] = k === 'worstH' ? Math.max(sum[k], x[k]) : sum[k] + x[k];
    for (const d of x.linkish) linkish.add(d);
    for (const d of x.recordDup) recordDup.add(d);
    problems.push(...x.problems);
    const ng = x.flows.filter(([, ok]) => !ok).length;
    flowCount += x.flows.length;
    flowNg += ng;
    byUnit.push(
      `${pad(id, 18)} 状態 ${String(x.states).padStart(4)}（拡大 ${x.zoomTotal}）・手順 ${String(x.flows.length).padStart(3)}${ng ? `（NG ${ng}）` : ''}・外れ ${x.problems.length}・${Math.round(r.ms / 1000)} 秒`,
    );
  }

  console.log('');
  console.log(`文字のリンクの見た目の操作（9.12）: ${linkish.size} 件`);
  for (const d of linkish) {
    console.log(`  ${d}`);
    problems.push(`文字のリンクの見た目の操作: ${d}`);
  }
  console.log(`［記録する］ が 2 か所以上の状態（縦の形）: ${recordDup.size} 件`);
  for (const d of recordDup) {
    console.log(`  ${d}`);
    problems.push(`［記録する］ の重複: ${d}`);
  }
  console.log('単位ごと:');
  for (const l of byUnit) console.log(`  ${l}`);
  if (problems.length > 0) {
    console.log('外れ:');
    for (const p of problems) console.log(`  ${p}`);
  }
  console.log(
    `要約: ${sum.states} 状態、横スクロールの最大 ${sum.worstH}px、幅 360 の当たり<44 ${sum.smallTotal} 件、部品のはみ出し ${sum.clippedTotal} 件、入れ子 3 段以上 ${sum.nestTotal} 件、帯の外れ ${sum.barTotal} 件、文字の拡大 ${sum.zoomTotal} 状態（拡大の漏れ ${sum.zoomUnscaled} 件・行の重なり ${sum.zoomOverlap} 件・既知 ${sum.zoomKnown} 状態）、手順 ${flowCount} 件（NG ${flowNg} 件）、外れ ${problems.length} 件、所要 ${Math.round((Date.now() - started) / 1000)} 秒`,
  );
  if (opts.shots) console.log(`撮影: ${opts.shots}（コミットしない）`);
  if (crashed) {
    console.log('NG（流し終えていない単位がある）');
    process.exit(2);
  }
  if (problems.length > 0) {
    console.log('NG');
    process.exit(1);
  }
  console.log('ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
