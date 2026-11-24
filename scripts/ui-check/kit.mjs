// 手順（V1 などの ID つきの確かめ）の共有の道具
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { opts, ROOT } from './base.mjs';
import {
  ACC_B,
  acct,
  DAY_MS,
  exampleTrade,
  FAKE_US30,
  fakeTrade,
  installFakeApi,
  SNAP,
  SYNTHETIC_STATEMENT,
  T_1110,
  TX_L1,
} from './fixtures.mjs';
import { closeSheets, infoButton, settleSheet, sheetCount } from './helpers.mjs';

/**
 * 手順（runFlows の中の共有の道具）。元は runFlows の中の宣言で、どの画面の手順からも使う
 */
export function makeKit({ browser, base, signedIn }) {
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
  // ── 言葉の説明の「i」（Issue #57。#129 で説明のシート）。幅 360 で、偽の記録の API で流す
  // IT1: 押して開く → ✕ で閉じる・Esc で閉じてフォーカスが「i」へ・外（後ろの暗い面）を押して閉じる（押した所の欄には届かない）・
  //      同時に 1 つ（開いている間、後ろの「i」は押せない）
  // IT2: 未選択のまま「i」を押し・Enter で開いても、選択・帯の文・下書きが変わらず、保存の要求 0（AC-5）
  // IT3: 開いて戻る → シートだけが閉じ、URL・画面・下書きはそのまま・履歴の長さは開く前と同じ。✕・Esc・外で閉じた後も
  //      履歴の長さは開く前に戻り、その後の戻るは前の画面へ（H1）
  const infoState = (p, name) => infoButton(p, name).getAttribute('aria-expanded');
  const popCount = sheetCount;

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

  return {
    browser,
    base,
    signedIn,
    out,
    check,
    expectEq,
    path,
    recordContext,
    synthetic,
    lcLockState,
    kbdShim,
    kbdUp,
    kbdDown,
    bodyEndSubmit,
    infoState,
    popCount,
    rowsOf,
    verdictOf,
    drawn,
    noDialogs,
    manyTrades,
    scrollToBottom,
    countText,
    monthTrades,
    monthsOf,
    checkMonths,
    stuckOf,
    monthY,
    OWNER_ACCOUNTS,
    resnapTrade,
    overflowX,
    shootPair,
    openCompare,
  };
}
