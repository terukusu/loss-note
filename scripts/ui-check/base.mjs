// 画面の検査（npm run ui:check）の土台: 引数・画面と幅の一覧・ログイン・文脈の用意・測り（measure・measureZoom）・待ち。
// 入口は scripts/ui-check.mjs（全体の説明もそこ）
import { readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** 引数（scripts/ui-check.mjs が読み、worker へ渡す）。worker は Object.assign で上書きする */
export const opts = { injectWide: 0, injectClip: false, zoom: false, shots: '' };

/**
 * 検査する画面（ログイン・ホーム・記録する・一覧・詳細・直す・設定 + 部品の見本）。詳細は無い取引の ID（V4 の画面）と
 * チャート 2 枚の取引（Issue #9）。wait = 中身が出るまで待つ要素（ホーム・一覧は取引の行、詳細はチャートの canvas）
 */
export const PAGES = [
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
  // 設定の次の画面「心理のタグ」（#163）
  { path: '/settings/emotions', h1: '心理のタグ', wait: '.emotionchoices__card' },
  // データの書き出し（#167）
  { path: '/settings/export', h1: 'データの書き出し', wait: '#settings-export-csv' },
  { path: '/dev/parts', h1: '部品の見本' },
];
export const SIZES = [
  [360, 780],
  [390, 844],
  [768, 1024],
  [1440, 900],
];
export const THEMES = ['dark', 'light'];
export const TAP = 44;
/**
 * 記録する画面の下の帯の高さの上限（幅 360）。Issue #33 AC-1 の 64px（状態の文 1 行 + [記録する] を横に 1 段）は、#130 で
 * 「判定の 1 行（押すと判定のシート）+ [記録する]」を縦に積む 1 つの帯（ui-guidelines 9.4・9.11）に替えたので、2 つの当たり
 * （44px × 2）と段の間・上下の余白（4 + 8 × 2）と線 1px の 109px に、端数の余白を足した 112px にした。状態の文が 1 行で切れない
 * ことは同じに見る
 */
export const BAR_MAX = 112;
/**
 * 記録する画面の 360×780 の縦のスクロールの上限（#130。ui-guidelines 9.10: 全長の上限 R12 の 2,550px を「390×844 で 0px」と
 * 「360×780 で 120px 以下」に置き換えた）
 */
export const RECORD_OVER_360 = 120;
/** 直す画面の貼り付きの帯の高さの上限（幅 360。Issue #33 KEEP-7: 変える前に測った値 161.1px） */
export const EDIT_BAR_MAX = 161.1;
export const THEME_KEY = 'loss-note.theme';
/** 文字の拡大（Issue #79）の倍率・幅・テーマ・拡大の漏れとみなす文字の大きさ（いちばん小さいトークン 12px の 2 倍から 1 割ほど下） */
export const ZOOM = 2;
/**
 * 拡大の窓。text = 文字の拡大（トークン 2 倍・窓の幅はそのまま）。text が false の 720×450（DPR 2）は 1440×900 の窓を
 * ブラウザのページの拡大で 200% にしたもの（窓がちょうど PC の並びの境 720px になる。文字は等倍のトークン）
 */
export const ZOOM_SIZES = [
  { w: 360, h: 780, text: true },
  { w: 1440, h: 900, text: true },
  { w: 720, h: 450, text: false, dpr: 2 },
];
export const ZOOM_THEMES = ['dark'];
export const ZOOM_MIN_FONT = 20;
/** 文字の拡大で測る記録する画面・設定の画面の状態（RECORD_STATES・SETTINGS_STATES の slug） */
export const ZOOM_RECORD = [
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
export const ZOOM_SETTINGS = [
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
export const ZOOM_KNOWN = {};
/** 下のタブ 4 つと真ん中の ［＋ 記録］（V6。ui-guidelines 9.2・#127） */
export const NAV_HREFS = ['/', '/trades', '/record', '/review', '/settings'];
/** 全画面のシートの画面（下のタブを隠す。9.2・A2） */
export const SHEET_PATHS = (path) => path === '/record' || path.endsWith('/edit');
export const AUTH_EMULATOR = 'http://127.0.0.1:9099';

/** エミュレーターのログインの画面（ポップアップ）で、架空のアカウントを自動生成してログインする */
export async function loginViaPopup(page) {
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
export async function setupContext(context, theme, zoom = false) {
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

export async function emulatorUp() {
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
export function zoomCss() {
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
export function darkBg() {
  const css = readFileSync(join(ROOT, 'ui/src/styles/tokens.css'), 'utf8');
  const block = /:root,\s*:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  // 役割は原色の参照（#229・設計書 C61）。--bg: var(--c-…) を原色の層の値まで解く
  const ref = /--bg:\s*var\((--c-[\w-]+)\)/.exec(block)?.[1] ?? '';
  const value = ref
    ? new RegExp(`${ref}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(css)?.[1]
    : /--bg:\s*(#[0-9a-fA-F]{6})/.exec(block)?.[1];
  return value?.toLowerCase() ?? '';
}

export function freePort() {
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
export async function measure(page, withTargets, tap, slack = 1) {
  await fontsReady(page);
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
export const LINKISH = new Set();
/** ［記録する］ が 2 か所以上の状態（縦の形。#127） */
export const RECORD_DUP = new Set();

/**
 * 文字の拡大（Issue #79）の測り。拡大の漏れ = 描かれた文字を持つ要素の文字の大きさが minFont 未満（トークンを通らない
 * px の大きさ）。行の重なり = 行の高さ（px）が文字の大きさより小さい（折り返すと行が重なる）か、別の要素の文字と文字の
 * 箱が重なる（列の幅が足りず隣の列に入る）。文字の箱は切る祖先（overflow が visible でない）の箱で切ってから比べ、
 * 位置を固定した帯（fixed・sticky）の中と外は比べない（スクロールで重なるのは正しい）。開いた説明のシートの文字は
 * 比べ合いにだけ入れない（拡大の漏れ・行の高さ・切れは見る）。
 * 文字が切る祖先の左右の外に出る（「…」で省く作りを除く）のも、文字の切れとして重なりに数える
 */
export async function measureZoom(page, minFont) {
  await fontsReady(page);
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

export async function waitReady(page, h1) {
  // 「取引」（取引のタブの根の題）は「取引の詳細」「取引を編集」に部分一致しないよう、題の全体で比べる（#127）
  const text = h1 === '取引' ? /^\s*取引\s*$/ : h1;
  await page
    .locator('main h1', { hasText: text })
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });
}

/**
 * シートを UI で閉じた後、アプリが積んだ履歴の段（history.state.back）を history.go で戻し終わるまで待つ（back-layers.ts）。
 * 戻し終わる前に page.goBack() を重ねると 2 つの戻るが 1 つにまとまって画面を離れない（KB1）。page.goto を重ねると、新しい文書に
 * 着いた後で前へ戻される（DI1）・移動が取り消される（GL1）
 */
export async function settleLayers(page) {
  await page
    .waitForFunction(
      () => {
        const b = history.state?.back;
        return (
          !(typeof b === 'number' && b > 0) &&
          document.querySelectorAll('dialog.sheet[open]').length === 0
        );
      },
      null,
      { timeout: 3000 },
    )
    .catch(() => {});
}

/**
 * 開いた層（下のシート）の段が履歴に積まれるのを待つ（history.state.back が 1 以上）。シートの `<dialog>` は開いた描画で
 * open になり、段の pushState は後の effect で走る（数十 ms）。その間に page.goBack すると、層ではなく画面を戻ってしまう
 * （利用者の指では起きない速さ。SET2）。戻るで閉じる検査は、開いた後にこれを待ってから戻る
 */
export async function waitLayerPushed(page) {
  await page.waitForFunction(
    () => {
      const b = history.state?.back;
      return typeof b === 'number' && b > 0;
    },
    null,
    { timeout: 5000 },
  );
}

/**
 * page.goto の代わり。状態を続けて測るときに、前の状態の残りで goto が net::ERR_ABORTED になるのを、検査の期待を変えずに越える。
 * 速い機械（4 vCPU）で出る 2 つの競合:
 * - 書きかけが残っている: 移る確認（beforeunload。worker が受ける）を受けて移動は続くのに、元の goto が ERR_ABORTED で返る
 *   ことがある。古い文書が捨てられて url の文書が読み込まれたら成功とみなす
 * - 直前に画面の中のボタン（［あとで］・［取引の欄へ戻る］ など）でシートを閉じた: アプリが積んだ履歴の段を戻す history.go
 *   （back-layers.ts）が、goto の直後に走って移動を取り消す。古い文書のままなら、落ち着くのを待って 1 回だけ goto し直す
 * どちらでもなければ（2 回目も取り消された・別の URL に着いた）元の誤りを投げる
 */
export async function gotoAcrossUnload(page, url) {
  for (let attempt = 0; ; attempt++) {
    // 移る前の文書に印を付ける（about:blank や読み込み中で付けられなくても、そのまま移る）
    await page.evaluate(() => (window.__uiCheckOldDoc = true)).catch(() => {});
    try {
      await page.goto(url);
      return;
    } catch (e) {
      if (!String(e).includes('net::ERR_ABORTED')) throw e;
      const moved = await page
        .waitForFunction(() => window.__uiCheckOldDoc !== true, null, { timeout: 5000 })
        .then(() => page.waitForLoadState('load'))
        .then(
          () => true,
          () => false,
        );
      if (moved) {
        if (page.url() !== url) throw e;
        return;
      }
      if (attempt >= 1) throw e;
      await page.waitForTimeout(300);
    }
  }
}

/**
 * 取引の詳細に着いた（見出しは取引の名前で、「取引の詳細」は読み込み中だけ。一覧から開くと読み込み済みの取引ですぐ名前になるので、
 * URL と判定の枠で見る。RP1 と同じ）
 */
export async function waitDetail(page) {
  await expectPollAsync(
    async () => /^\/trades\/[^/]+$/.test(new URL(page.url()).pathname),
    '詳細の URL',
  );
  await page.locator('main .verdict').first().waitFor({ state: 'visible', timeout: 15000 });
}

export function pad(s, n) {
  return s + ' '.repeat(Math.max(0, n - [...s].length));
}

/** 非同期の条件が成り立つまで待つ（5 秒で外れ） */
export async function expectPollAsync(cond, what) {
  for (let i = 0; i < 50; i++) {
    if (await cond()) return;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error(`${what}: 待っても成り立たない`);
}

/** 条件が成り立つまで待つ（10 秒で外れ） */
export async function expectPoll(cond, what) {
  for (let i = 0; i < 100; i++) {
    if (cond()) return;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error(`${what}: 待っても成り立たない`);
}

/** 例の表の V1〜V6・S1・T2〜T4・L1〜L7 を実ブラウザで流す。[ID, ok, 詳細] の列を返す */

/**
 * 書体の読み込みが終わるまで待つ（同梱の数字の書体は swap なので、読み込みの前後で数字の幅・行の高さが変わりうる。
 * 測る前に待って、検査を読み込みの揺れで不安定にしない。#237）。上限 limit ms を過ぎたらそのまま返す
 */
export async function fontsReady(page, limit = 5000) {
  await page.evaluate(
    (max) =>
      Promise.race([
        document.fonts.ready.then(() => undefined),
        new Promise((ok) => setTimeout(ok, max)),
      ]),
    limit,
  );
}

/**
 * 動きとスクロールが落ち着くまで待つ（決まった時間の待ちの代わり。#226）。走っている有限の動き（CSS の transition・
 * animation・Web Animations。繰り返し続ける読み込み中の印は除く）が無く、スクロールの位置・窓と見える範囲の大きさが
 * 3 フレーム続けて同じになったら返す。上限 limit ms を過ぎたらそのまま返す（ここでは外れにしない。続く確かめが外れを出す）。
 * 窓のスクロールだけを見る（シートの中など要素の中のスクロールは見ない）。
 * 何かが起きないことを見る待ち（要求が増えない・取り消しの時間）や、アプリが時計で動く所（キーボードの寄せ直し）には使わない
 */
export async function settle(page, limit = 2000) {
  await fontsReady(page);
  await page.evaluate(async (max) => {
    const t0 = performance.now();
    let last = '';
    let same = 0;
    while (performance.now() - t0 < max) {
      await new Promise((ok) => requestAnimationFrame(() => ok(undefined)));
      const moving = document
        .getAnimations()
        .filter(
          (a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity,
        ).length;
      const v = window.visualViewport;
      const key = [
        window.scrollX,
        window.scrollY,
        window.innerWidth,
        window.innerHeight,
        v?.width,
        v?.height,
        v?.offsetTop,
      ].join(',');
      if (moving === 0 && key === last) {
        same++;
        if (same >= 3) return;
      } else {
        same = 0;
      }
      last = key;
    }
  }, limit);
}
