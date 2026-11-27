// 画面の検査の操作の道具（記録する画面・シート・詳細を開く・入れる）
import { expectPollAsync, gotoAcrossUnload, settleLayers, waitReady } from './base.mjs';
import { FAKE_USD_IDX, READ_DONE, READ_E1 } from './fixtures.mjs';

export async function openRecord(page, base) {
  // 状態を続けて測るときは前の状態の書きかけが残っている（移る確認が出る）
  await gotoAcrossUnload(page, `${base}/record`);
  await waitReady(page, '記録する');
  // 2 段（2026-11-21）: 開いた直後は 1 段目「スクショを入れる」（［明細なしで手入力］ が見える）
  await page.locator('#record-manual').waitFor({ state: 'visible', timeout: 15000 });
}

/**
 * 明細を貼って 2 段目「振り返る」へ移る（シートを開かない = 履歴の段が混ざらない。2026-11-21）。fake は偽の API
 */
export async function toReviewByPaste(page, fake) {
  fake.read = { status: 200, rows: [READ_E1], holdMs: 0 };
  // 読み込みが終わる前（「読み込んでいます…」）の貼り付けは「記録の準備ができてから…」で断られる。1 段目が出てから貼る
  await page.locator('#record-manual').waitFor({ state: 'visible', timeout: 15000 });
  await makeImage(page, STATEMENT_SPEC, 'paste');
  await page.locator('#record-lc').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator(READ_DONE).first().waitFor({ timeout: 10000 });
}

/**
 * 要約のカード（#record-summary・#edit-summary）の中で切れている文字の数（#164: 名前・数・時刻を「…」で省略しない）。
 * 名前と塊（.rsum__part）・札が自分の箱にも要約の箱にも収まっているかを見る
 */
export async function summaryCuts(page, sel = '#record-summary') {
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
export async function expectRealSummary(page, sel) {
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
export async function toInput(page) {
  const back = page.locator('#record-to-input');
  if (await back.isVisible()) await back.click();
  await page.locator('#record-statement-file').waitFor({ state: 'attached', timeout: 5000 });
}

/**
 * 記録する画面の 2 段目「振り返る」へ移り、LC の欄が出るまで待つ（2026-11-21）。LC が見えていればそのまま（書きかけに戻った
 * ときなど）。1 段目なら、要約があれば ［振り返りへ進む］、無ければ ［明細なしで手入力］（取引の欄のシートが開くので閉じる）
 */
export async function toReview(page) {
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
export async function openFields(page) {
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
export async function openMore(page) {
  await openFields(page);
  if ((await page.locator('#record-fields-sheet[open] #record-pnl').count()) > 0) return;
  await page.locator('#record-more').click();
  await page.locator('#record-fields-sheet[open] #record-pnl').waitFor({ timeout: 5000 });
  await settleSheet(page);
}

/** 判定のシート（下の帯の判定の 1 行を押す。#130） */
export async function openVerdict(page) {
  // 編集の全画面のシートも同じ形（#131。id の頭が edit）
  const pre = new URL(page.url()).pathname.endsWith('/edit') ? 'edit' : 'record';
  await closeSheets(page);
  await page.locator(`#${pre}-verdict-line`).click();
  await page.locator(`#${pre}-verdict-sheet[open]`).waitFor({ state: 'visible', timeout: 5000 });
  await settleSheet(page);
}

/** チャートのシート（2 段目のチャートの行・1 段目のチャートのある小さな枠を押す。#130・2026-11-21） */
export async function openChartSheet(page) {
  if ((await page.locator('#record-chart-sheet[open]').count()) > 0) return;
  await closeSheets(page);
  await page.locator('.rchart--full, .rchartrow--full').first().click();
  await page.locator('#record-chart-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
  await settleSheet(page);
}

/** 編集の全画面のシートのチャートのシートを開く（#131。チャートのある小さな枠が読み戻せてから） */
export async function openEditChartSheet(page) {
  if ((await page.locator('#edit-chart-sheet[open]').count()) > 0) return;
  const mini = page.locator('#edit-mini-entry.rchart--full, #edit-mini-exit.rchart--full').first();
  await mini.locator('canvas').waitFor({ timeout: 15000 });
  await mini.click();
  await page.locator('#edit-chart-sheet[open]').waitFor({ state: 'visible', timeout: 5000 });
  await settleSheet(page);
}

/** 編集の取引の欄のシートを開く（#131。要約の ［編集］）。step = 'more' ならほかの欄まで */
export async function openEditFields(page, step = 'main') {
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
export async function openFieldsScreen(page) {
  await page.locator('a.rowlink', { hasText: 'すべての欄' }).click();
  await page.locator('h1', { hasText: 'すべての欄' }).waitFor({ timeout: 5000 });
  await page.locator('.fields__row').first().waitFor({ timeout: 15000 });
}

/** 開いているシートを上から全部閉じる（右上の ✕） */
export async function closeSheets(page) {
  let closed = false;
  for (let i = 0; i < 4; i++) {
    const open = page.locator('dialog.sheet[open]');
    if ((await open.count()) === 0) break;
    await open.last().locator('.sheet__close').click();
    closed = true;
    await settleSheet(page);
  }
  if (closed) await settleLayers(page);
}

export const seg = (page, group, text) =>
  page.locator(`[role="radiogroup"][aria-label="${group}"] label.seg__item`, { hasText: text });

/**
 * 記録する画面の例（Issue #13 の例の表。値は架空）。taps = false ならタップの前で止める。LC を入る前に決めていたかは聞かず、
 * LC の欄から決める（価格 = 決めていた・LC なし = 決めていなかった。#202）
 */
export async function fillRecord(page, ex, taps = true, lastTap = true) {
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

export const EX_E1 = {
  side: 'L',
  entry: '100.00',
  exit: '99.20',
  lc: '99.50',
  move: '広げた',
  after: '99.20',
};
/** 危ない勝ち: LC を広げて耐え、+0.75 で決済（5.6 #13 の形。#202 で「決めていなかった」は記録する画面で選べないので広げたに替えた） */
export const EX_E3 = {
  side: 'L',
  entry: '100.00',
  exit: '100.75',
  lc: '99.50',
  move: '広げた',
  after: '99.20',
};
export const EX_E16 = { side: 'L', entry: '100.00', exit: '99.20', lc: 'none' };
/** 計画どおりの勝ち（そのまま・そのまま。+2.0R）。値は架空 */
export const EX_SAFE = {
  side: 'L',
  entry: '100.00',
  exit: '101.00',
  lc: '99.50',
  move: 'そのまま',
};
/** Issue #33 例 8: S ショートで LC を広げた（広げた後の LC の欄が出る）。値は架空 */
export const EX_S8 = {
  side: 'S',
  entry: '150.00',
  exit: '151.00',
  lc: '150.50',
  move: '広げた',
  after: '151.00',
};

/** --inject-clip の帯の見本: 状態の文を長くして改行を入れ、帯に背の高い要素を足す（高さ・行数・切れが 1 件ずつ外れる） */
export async function injectBarSample(page) {
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
export async function makeImage(page, spec, to) {
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

export const STATEMENT_SPEC = { w: 1200, h: 600, type: 'image/png' };

/** チャートの画像に付ける架空のファイル名（端末の保存先・URL に出ていないかを探す印） */
export const CHART_MARKER = 'CHARTMARK-9d3f';

/**
 * ページの中の canvas で架空のローソク足のチャートを作る。to = 'paste' なら target（CSS selector。無ければ今フォーカスの
 * ある要素）に画像の貼り付けを送り、'bytes' ならバイト列を返す。ブラウザはフォーカスのある要素に paste を送る（枠を選んで貼る）
 */
export async function makeChart(page, to, target = null) {
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
export async function pasteChart(page, slot) {
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
export function imageInfoOf(b) {
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

/** USD 建ての銘柄で場面 P（L・100.00 / 99.50 / 99.50 or 99.40・数量 100）を入れる */
export async function fillFx(page, exit = '99.50', keepOpen = true) {
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

export async function deleteFromDetail(page, how = 'click') {
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

export async function expectRestore(page, what) {
  // 記録する画面は戻ると読み込み直す（中身が描けるまで背が低い）ので、ブラウザの位置の復元そのものは S1（部品の見本）で測る。
  // ここでは元の項目に manual が残っていないこと（B2）だけを見る
  await toReview(page);
  await page.waitForTimeout(300);
  const mode = await page.evaluate(() => history.scrollRestoration);
  if (mode !== 'auto') throw new Error(`${what}: scrollRestoration = ${mode}`);
}

/** 「i」のボタン（シートを開いている間、後ろは inert なので役割ではなく名前の属性で探す） */
export const infoButton = (page, name) => page.locator(`button.info[aria-label="${name}"]`).first();
/**
 * 開いている説明のシート（#129）。記録する画面のシート（取引の欄・判定など。#130。id は record-…-sheet）の上に重なることがあるので、
 * それらは除く。明細の送り方の説明（id record-statement-info）は説明のシートなので除かない（#131 で見つけた: 前は record- の頭で
 * 全部を除いていて「説明（明細）」の状態が「シートが無い」になっていた）
 */
export const OPEN_SHEET = 'dialog.sheet[open]:not([id^="record-"][id$="-sheet"])';
export const sheetCount = (page) => page.locator(OPEN_SHEET).count();
/** 開いているシートの見出し（無ければ null）。重なっているときは一番上（記録する画面の判定のシートの上の説明。#130） */
export async function sheetTitle(page) {
  const t = page.locator(`${OPEN_SHEET} .sheet__title`);
  return (await t.count()) === 0 ? null : ((await t.last().textContent())?.trim() ?? '');
}

/** シートの出入りの動き（320ms）が終わるのを待つ */
export async function settleSheet(page) {
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
export async function sheetBox(page, sel = OPEN_SHEET) {
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
export function expectSheetInWindow(r, what) {
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
export async function expectNoSheetShown(page, what) {
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
export async function followLink(page, linkText, title) {
  await page
    .locator(`${OPEN_SHEET}`)
    .last()
    .locator('a.glink', { hasText: linkText })
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
export async function openInfo(page, name, _reopen = false) {
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
export const focusLabel = (page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
/** 後ろの暗い面（シートの上・窓の上端の近く）を押す（#129） */
export async function pressBackdrop(page) {
  const r = await sheetBox(page);
  if (!r) throw new Error('シートが無い');
  await page.mouse.click(Math.round(r.vw / 2), Math.max(4, Math.round(r.top / 2)));
}
/** シートの右上の ✕ で閉じる（#129） */
export const closeSheet = (page) => page.locator(`${OPEN_SHEET} .sheet__close`).last().click();

/** 読み取りの後に手で入れる 4 つ（打つ: LC・一言 / 選ぶ: そのまま・そのまま。決めていたかは LC の欄から = #202）。数を返す */
export async function fillStatementTaps(page, lc = '99.0') {
  await closeSheets(page);
  await page.locator('#record-lc').fill(lc);
  await page.locator('#record-broken').fill('押し目の安値を割ったら');
  await seg(page, 'LC を動かしたか', 'そのまま').click();
  await seg(page, '時間足を変えたか', 'そのまま').click();
  return { typed: 2, chosen: 2 };
}
