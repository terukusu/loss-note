// アプリのアイコンを作る（Issue #52）。元は手で書いた ui/public/favicon.svg（ログインの画面の印と同じ線・藍の地）。
//   node scripts/make-icons.mjs
// 既存の依存の Playwright（Chromium）で SVG を PNG に描き、次を ui/public/ に書き出す（新しい依存を足さない）:
//   favicon.ico          … 16・32・48px の PNG を入れた ICO（古いブラウザ向け。本番は /favicon.ico で配る。
//                          16px だけは線を太く・折れ線を単純にした版から描く）
//   apple-touch-icon.png … 180×180（iPhone のホーム画面。iOS が角を丸めるので、角丸を外した不透明な四角）
// SVG を直したら流し直して、3 つのファイルを一緒にコミットする
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'public');
const svg = readFileSync(join(pub, 'favicon.svg'), 'utf8');
// ホーム画面のアイコンは角丸を外す（地の rect の rx だけを 0 に）
const square = svg.replace(
  '<rect width="64" height="64" rx="14"',
  '<rect width="64" height="64" rx="0"',
);
if (square === svg) throw new Error('favicon.svg の地の rect が見つかりません');
// 16px の版は線を太くし、折れ線を 1 回の谷（下がって戻る）に単純にする（小さいと谷が潰れて文字に見えるため。#52）
const POLYLINE = '<path d="M3.5 6.5 9 13l3.5-3 3 3.5 5-6"/>';
const small = svg
  .replace(POLYLINE, '<path d="M4 7l7.5 7.5L20 7"/>')
  .replace('stroke-width="2.6"', 'stroke-width="3.4"');
if (!svg.includes(POLYLINE) || !small.includes('stroke-width="3.4"'))
  throw new Error('favicon.svg の印の線が見つかりません');

/** ICO（PNG を入れる形。Windows Vista 以降・各ブラウザが読む）を組み立てる */
export function buildIco(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2);
    head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((x) => x.png)]);
}

async function render(page, source, size, transparent) {
  const sized = source.replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`,
  );
  return page.screenshot({
    clip: { x: 0, y: 0, width: size, height: size },
    omitBackground: transparent,
  });
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const icons = [];
  for (const size of [16, 32, 48])
    icons.push({ size, png: await render(page, size === 16 ? small : svg, size, true) });
  writeFileSync(join(pub, 'favicon.ico'), buildIco(icons));
  writeFileSync(join(pub, 'apple-touch-icon.png'), await render(page, square, 180, false));
  console.log('ui/public/favicon.ico・apple-touch-icon.png を書き出しました');
} finally {
  await browser.close();
}
