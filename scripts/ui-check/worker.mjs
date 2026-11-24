// 画面の検査の 1 つの単位を流す子のプロセス。scripts/ui-check.mjs が単位ごとに立てる（手で起動しない）。
// 引数: <単位の ID> <開発サーバーの URL> <ログインした状態の JSON のファイル> <引数の JSON>
// 出力の最後の 1 行が結果（RESULT_PREFIX + JSON）。終了コード 0 = 流し終えた（外れの有無は結果の中）/ 2 = 流せない
import { readFileSync } from 'node:fs';
import { LINKISH, opts, RECORD_DUP } from './base.mjs';
import { dialogsSeen } from './fixtures.mjs';
import { newTally, RESULT_PREFIX, runUnit } from './harness.mjs';
import { UNIT_IDS } from './units.mjs';

async function main() {
  const [unitId, base, statePath, optsJson] = process.argv.slice(2);
  if (!UNIT_IDS.includes(unitId)) {
    console.error(`知らない単位: ${unitId}`);
    process.exit(2);
  }
  Object.assign(opts, JSON.parse(optsJson));
  const signedIn = JSON.parse(readFileSync(statePath, 'utf8'));
  const unit = await import(`./screens/${unitId}.mjs`);
  const { chromium } = await import('playwright');
  const started = Date.now();
  const browser = await chromium.launch();
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
  const T = newTally();
  let flows = [];
  try {
    flows = await runUnit(unit, { browser, base, signedIn, T });
  } finally {
    await browser.close();
  }
  const result = {
    unit: unitId,
    ...T,
    linkish: [...LINKISH],
    recordDup: [...RECORD_DUP],
    flows,
    ms: Date.now() - started,
  };
  console.log(`${RESULT_PREFIX}${JSON.stringify(result)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
