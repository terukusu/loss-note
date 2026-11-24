// 画面の検査の 1 つの単位（screens/*.mjs）を流す仕組み: 幅 × テーマ・文字の拡大の文脈を用意し、測った数を数え、
// 手順の結果を集める。worker.mjs が単位ごとに使う
import { join } from 'node:path';
import {
  measure,
  measureZoom,
  opts,
  pad,
  SIZES,
  setupContext,
  TAP,
  THEMES,
  ZOOM,
  ZOOM_KNOWN,
  ZOOM_MIN_FONT,
  ZOOM_SIZES,
  ZOOM_THEMES,
} from './base.mjs';
import { installFakeApi } from './fixtures.mjs';
import { makeKit } from './kit.mjs';

/** worker.mjs の出力の最後の行（結果の JSON）の頭 */
export const RESULT_PREFIX = '@@ui-check-result ';

/** 単位の中で数えるもの（全体の要約は scripts/ui-check.mjs が単位ごとの数を足す） */
export function newTally() {
  return {
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
    problems: [],
  };
}

/** 枠の入れ子 3 段以上（Issue #33 AC-5。部品の見本 /dev/parts は見本を並べる画面なので数えない） */
function makeCheckNest(T) {
  return (label, m) => {
    if (label.includes('/dev/parts')) return;
    T.nestTotal += m.nest.length;
    for (const x of m.nest.slice(0, 5)) {
      console.log(`    入れ子 3 段: ${x}`);
    }
    if (m.nest.length > 0)
      T.problems.push(`${label}: 入れ子 3 段以上 ${m.nest.length} 件（${m.nest[0]}）`);
  };
}

/**
 * 画面 × 幅 × テーマ（C1〜C3）: 幅 4 つ × テーマ 2 つごとに、ログイン済み（偽の記録の API）とログインしていない文脈を
 * 1 つずつ開いて fn(vp) を呼ぶ。vp.pageFor.get(false) がログイン済みのページ、get(true) がログインの画面のページ
 */
export async function forEachViewport({ browser, base, signedIn, T }, fn) {
  const checkNest = makeCheckNest(T);
  for (const theme of THEMES) {
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
      try {
        await fn({ w, hgt, theme, pageFor, errors, recApi, base, T, checkNest });
      } finally {
        for (const c of contexts) await c.close();
      }
    }
  }
}

/**
 * 文字の拡大 200%（Issue #79・WCAG 1.4.4）: 幅 360 / 1440（文字の拡大）と 720×450（1440 のページの拡大）× ダークごとに
 * 文脈を開き、1 状態を測って記す zoomState を vp に入れて fn(vp) を呼ぶ
 */
export async function forEachZoomViewport({ browser, base, signedIn, T }, fn) {
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
          T.states++;
          T.zoomTotal++;
          T.worstH = Math.max(T.worstH, m.h);
          T.clippedTotal += m.clipped.length;
          T.zoomUnscaled += z.unscaled.length;
          T.zoomOverlap += z.overlap.length;
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
        for (const x of found.slice(0, 10)) console.log(`    ${isKnown(x) ? '既知: ' : ''}${x}`);
        if (found.length > 10) console.log(`    ほか ${found.length - 10} 件`);
        for (const x of bad) T.problems.push(`${label}: ${x}`);
        if (known && knownHits.length === 0)
          T.problems.push(`${label}: 既知（ZOOM_KNOWN）の外れが無い。ZOOM_KNOWN から消す`);
        if (knownHits.length > 0) {
          T.zoomKnown++;
          console.log(`    既知の理由: ${known.why}`);
        }
      };
      try {
        await fn({ w, hgt, theme, pageFor, errors, recApi, base, T, zoomState });
      } finally {
        for (const c of contexts) await c.close();
      }
    }
  }
}

/**
 * 1 つの単位を流す。順は元の 1 本の検査と同じ: 画面 × 幅 × テーマの状態 → 文字の拡大の状態 → 手順。
 * --zoom は文字の拡大だけ、--inject-wide / --inject-clip は手順を流さない（画面の崩れの確かめだけ）。
 * 手順の結果 [ID, ok, 詳細] の列を返す
 */
export async function runUnit(unit, env) {
  const flows = [];
  if (!opts.zoom && unit.states) await forEachViewport(env, unit.states);
  if (unit.zoom) await forEachZoomViewport(env, unit.zoom);
  if (unit.flows && !opts.injectWide && !opts.injectClip && !opts.zoom) {
    const kit = makeKit(env);
    await unit.flows(kit);
    for (const [id, ok, detail] of kit.out) {
      console.log(`  ${pad(id, 4)} ${ok ? 'ok' : 'NG'}${detail ? `  ${detail}` : ''}`);
      if (!ok) env.T.problems.push(`${id}: ${detail}`);
      flows.push([id, ok]);
    }
  }
  return flows;
}
