// 記録する画面の下書きで見る通貨と為替の例（#47 PR-2 の F1〜F12。AC-13〜AC-16）。値・名前はすべて架空。
// 画面の道（readDraft → 本文 → toTradeInput → evaluateTrade）と表示の整形（formatPct・formatMoney・formatAmount）で確かめる
import { describe, expect, it } from 'vitest';
import { fxLine } from '../../ui/src/lib/currency';
import { formatAmount, formatMoney, formatPct, formatR } from '../../ui/src/lib/format';
import { MSG, RISK_NOTE, readDraft } from '../../ui/src/lib/record-form';
import {
  CTX_A,
  CTX_D,
  INST_EUR,
  INST_JPY,
  INST_NONE,
  INST_USD,
  pDraft,
} from './helpers/currency-examples';

const MINUS = '−';

describe('AC-13: 損益・1R・リスク（%）・R・判定（表示）', () => {
  it('F1: JPY の口座・USD 建て・為替 150 → −7,500円・1R 7,500円・0.8%・−1.0R・A。本文の為替は 150', () => {
    const r = readDraft(pDraft({ fxRate: '150' }), CTX_A);
    expect(r.canSave).toBe(true);
    expect(r.body?.exit.fxRate).toBe(150);
    const p = r.preview;
    expect(formatMoney(p.pnlYen as number, 'JPY')).toBe(`${MINUS}7,500円`);
    expect(formatAmount(p.oneRYen as number, 'JPY')).toBe('7,500円');
    expect(formatPct(p.riskPct as number)).toBe('0.8%');
    expect(formatR(p.r)).toBe(`${MINUS}1.0R`);
    expect(p.judgment?.grade).toBe('A');
    expect(p.currency).toBe('JPY');
  });

  it('F2: 為替も明細の損益も空 → −1.0R は出る。損益・1R・リスクは無し、注記は「為替か損益を入力すると表示されます」・A', () => {
    const r = readDraft(pDraft({}), CTX_A);
    expect(r.canSave).toBe(true);
    expect(r.body?.exit.fxRate).toBeUndefined();
    const p = r.preview;
    expect(formatR(p.r)).toBe(`${MINUS}1.0R`);
    expect(p.pnlYen).toBeUndefined();
    expect(p.oneRYen).toBeUndefined();
    expect(p.riskPct).toBeUndefined();
    expect(p.riskNote).toBe(RISK_NOTE.noOneRFx);
    expect(RISK_NOTE.noOneRFx).toBe('為替か損益を入力すると表示されます');
    expect(p.judgment?.reasons).toContainEqual({ kind: 'riskNotChecked', cause: 'noOneR' });
    expect(p.judgment?.grade).toBe('A');
  });

  it('F7: 為替 150 と明細 −9,000（手数料 0）→ 損益 −9,000円・1R 9,000円・0.9%', () => {
    const p = readDraft(pDraft({ fxRate: '150', pnlYen: '-9000' }), CTX_A).preview;
    expect(formatMoney(p.pnlYen as number, 'JPY')).toBe(`${MINUS}9,000円`);
    expect(formatAmount(p.oneRYen as number, 'JPY')).toBe('9,000円');
    expect(formatPct(p.riskPct as number)).toBe('0.9%');
  });

  it('F9: USD の口座・USD 建て → 為替の欄なし。−50.00 USD・1R 50.00 USD・0.5%', () => {
    const r = readDraft(pDraft({}), CTX_D);
    expect(r.currency?.fxShown).toBe(false);
    const p = r.preview;
    expect(p.currency).toBe('USD');
    expect(formatMoney(p.pnlYen as number, 'USD')).toBe(`${MINUS}50.00 USD`);
    expect(formatAmount(p.oneRYen as number, 'USD')).toBe('50.00 USD');
    expect(formatPct(p.riskPct as number)).toBe('0.5%');
    expect(p.judgment?.grade).toBe('A');
  });

  it('F10: USD の口座・EUR 建て・為替 1.10 → 1R 55.00 USD・0.6%', () => {
    const r = readDraft(pDraft({ instrumentName: INST_EUR.name, fxRate: '1.10' }), CTX_D);
    expect(r.currency?.fxShown).toBe(true);
    const p = r.preview;
    expect(formatAmount(p.oneRYen as number, 'USD')).toBe('55.00 USD');
    expect(formatPct(p.riskPct as number)).toBe('0.6%');
  });

  it('F8: JPY の口座・円建て → A1 と同じ（為替の欄なし・本文に為替なし）', () => {
    const r = readDraft(
      pDraft({ instrumentName: INST_JPY.name, quantity: '10000', fxRate: '150' }),
      CTX_A,
    );
    expect(r.currency?.fxShown).toBe(false);
    expect(r.body?.exit.fxRate).toBeUndefined();
    expect(formatAmount(r.preview.oneRYen as number, 'JPY')).toBe('5,000円');
    expect(formatPct(r.preview.riskPct as number)).toBe('0.5%');
  });

  it('F11: 価格の通貨 未設定 → 為替の欄なし・「損益を入力すると表示されます」（同じ・未設定の注記）', () => {
    const r = readDraft(pDraft({ instrumentName: INST_NONE.name, fxRate: '150' }), CTX_A);
    expect(r.currency?.fxShown).toBe(false);
    expect(r.body?.exit.fxRate).toBeUndefined();
    expect(r.preview.riskNote).toBe(RISK_NOTE.noOneR);
    expect(RISK_NOTE.noOneR).toBe('損益を入力すると表示されます');
  });
});

describe('AC-14: 明細から逆算した為替（見せるだけ・本文に入れない）', () => {
  const F3 = { exitPrice: '99.40', pnlYen: '-9100', feeYen: '100' } as const;

  it('F3: 明細 −9,100・手数料 100 → 「明細から 1 USD = 150.00円」、1R 7,500円・0.8%・−1.2R、本文に為替なし', () => {
    const r = readDraft(pDraft(F3), CTX_A);
    const p = r.preview;
    expect(p.derivedFx).toBeCloseTo(150, 9);
    expect(fxLine({ price: 'USD', account: 'JPY', derived: p.derivedFx as number })).toBe(
      '明細から 1 USD = 150.00円',
    );
    expect(formatAmount(p.oneRYen as number, 'JPY')).toBe('7,500円');
    expect(formatPct(p.riskPct as number)).toBe('0.8%');
    expect(formatR(p.r)).toBe(`${MINUS}1.2R`);
    expect(r.body?.exit.fxRate).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain('fxRate');
  });

  it('F4: 決済 = イン・明細 −100 → 見せない（行は「1 USD = ?円」）', () => {
    const r = readDraft(pDraft({ ...F3, exitPrice: '100.00', pnlYen: '-100' }), CTX_A);
    expect(r.preview.derivedFx).toBeUndefined();
    expect(fxLine({ price: 'USD', account: 'JPY' })).toBe('1 USD = ?円（空でも記録できます）');
    expect(JSON.stringify(r.body)).not.toContain('fxRate');
  });

  it('F5: 明細 +400・手数料 100（net +500・値動き −0.60）→ 見せない', () => {
    const r = readDraft(pDraft({ ...F3, pnlYen: '400' }), CTX_A);
    expect(r.preview.derivedFx).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain('fxRate');
  });

  it('F6: S・イン 100.00・LC 100.50・決済 100.60 → 150。1R 7,500円・−1.2R', () => {
    const r = readDraft(pDraft({ ...F3, side: 'S', lc: '100.50', exitPrice: '100.60' }), CTX_A);
    expect(r.preview.derivedFx).toBeCloseTo(150, 9);
    expect(formatAmount(r.preview.oneRYen as number, 'JPY')).toBe('7,500円');
    expect(formatR(r.preview.r)).toBe(`${MINUS}1.2R`);
    expect(JSON.stringify(r.body)).not.toContain('fxRate');
  });

  it('逆算があって為替も入れた: 本文は入れた値だけ（逆算の値は入らない）', () => {
    const r = readDraft(pDraft({ ...F3, fxRate: '149' }), CTX_A);
    expect(r.body?.exit.fxRate).toBe(149);
    expect(r.preview.derivedFx).toBeCloseTo(150, 9);
  });
});

describe('AC-15: 為替の欄の出る / 出ない（読み取りの currency）', () => {
  it.each([
    ['F1', INST_USD.name, CTX_A, true],
    ['F8', INST_JPY.name, CTX_A, false],
    ['F9', INST_USD.name, CTX_D, false],
    ['F11', INST_NONE.name, CTX_A, false],
    ['一覧に無い名前', '架空指数Z', CTX_A, false],
  ] as const)('%s → %s', (_n, name, ctx, shown) => {
    const r = readDraft(pDraft({ instrumentName: name }), ctx);
    expect(r.currency?.fxShown).toBe(shown);
  });
});

describe('AC-16（F12）: 為替 0 / −1 / 文字は保存できない', () => {
  it.each([
    ['0', MSG.notPositive],
    ['-1', MSG.notPositive],
    ['abc', MSG.notNumber],
  ])('%s → 欄の誤り「%s」・保存できない', (raw, msg) => {
    const r = readDraft(pDraft({ fxRate: raw }), CTX_A);
    expect(r.errors.fxRate).toBe(msg);
    expect(r.canSave).toBe(false);
    expect(r.body).toBeUndefined();
  });

  it('欄が出ていなければ、為替の文字は読まない（誤りにも本文にもならない）', () => {
    const r = readDraft(pDraft({ instrumentName: INST_JPY.name, fxRate: 'abc' }), CTX_A);
    expect(r.errors.fxRate).toBeUndefined();
    expect(r.canSave).toBe(true);
  });
});
