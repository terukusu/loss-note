// 両建てのまとまりの画面の純関数（#267。Issue のルールと例 R1〜R13。値は架空・設計書 5.8 の例と同じ）
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import { detailActions, groupActionOf } from '../../ui/src/lib/detail-view';
import {
  asksGapSlip,
  cleanExit,
  defaultMainSide,
  fixLineParts,
  gapSlipReason,
  groupBody,
  groupIndexOf,
  groupNoteText,
  groupRowInfo,
  groupStateOf,
  groupSummary,
  groupTitle,
  groupWhy,
  linkBlock,
  mainsOf,
  memberLineText,
  memberRows,
  parseGroupList,
  pickerSections,
  pickRange,
  pnlListText,
  previewLine,
  readExitDraft,
  rolesOf,
  volumeLine,
} from '../../ui/src/lib/position-group';
import { parseRoute } from '../../ui/src/lib/routes';
import { bootStack } from '../../ui/src/lib/tab-nav';
import { monthGroups } from '../../ui/src/lib/trade-list';
import { tradeRow } from '../../ui/src/lib/trade-view';
import {
  ABC_CFD,
  cfd,
  ENTRY,
  FIX,
  future,
  GOLD,
  groupOf,
  h1,
  h2,
  INSTRUMENTS,
  MIN,
  MON,
  stored,
  XYZ_CFD,
  XYZ_MINI,
} from './helpers/group-examples';

const byId = (...ts: StoredTrade[]) => new Map(ts.map((t) => [t.id, t]));
const DAY = 86_400_000;

describe('R1: 相手を選ぶシートの候補の段（7.7）', () => {
  const base = future('f', { exitPrice: 38_600 });
  const hedge = cfd('c', { price: 38_450, exitPrice: 38_620 });
  const mini = stored(
    'mini',
    {
      multiplier: 100,
      quantity: 5,
      price: 38_100,
      lc: 37_800,
      entryTime: FIX - DAY,
      exitPrice: 38_400,
    },
    { instrumentId: XYZ_MINI.id },
  );
  const abc = cfd('abc', { price: 5_000, exitPrice: 5_010 }, undefined, ABC_CFD.id);
  const goldRaw = cfd('gold', { price: 2_000, exitPrice: 2_010 }, undefined, GOLD.id);
  // 商品（原資産の種類が違う）: 記録したときの snapshot の種類で見る
  const gold: StoredTrade = {
    ...goldRaw,
    snapshot: {
      ...goldRaw.snapshot,
      instrument: { ...goldRaw.snapshot.instrument, underlyingKind: 'commodity' },
    },
  };
  const late = cfd('late', {
    price: 38_450,
    exitPrice: 38_620,
    entryTime: MON + DAY,
    exitTime: MON + 2 * DAY,
  });
  const legs = cfd('legs', { price: 38_450, exitPrice: 38_620, legs: true });
  const other = cfd('other', { price: 38_450, exitPrice: 38_620 }, 'gX');
  const pool = [base, hedge, mini, abc, gold, late, legs, other];

  it('逆の向き・期間が重なる・原資産の名前が同じ → 決済の代わり。同じ向き → 本玉に加える。名前が違い種類が同じ → ほかの銘柄', () => {
    const s = pickerSections(base, pool, INSTRUMENTS);
    expect(s.opposite.map((t) => t.id)).toEqual(['c']);
    expect(s.same.map((t) => t.id)).toEqual(['mini']);
    expect(s.other.map((t) => t.id)).toEqual(['abc']);
  });

  it('期間が重ならない・足を持つ・ほかのまとまりにいる・種類が違う取引はどの段にも出ない', () => {
    const s = pickerSections(base, pool, INSTRUMENTS);
    const all = [...s.opposite, ...s.same, ...s.other].map((t) => t.id);
    for (const id of ['late', 'legs', 'other', 'gold', 'f']) expect(all).not.toContain(id);
  });

  it('並びはエントリーの時刻が近い順', () => {
    const near = cfd('near', { price: 38_400, exitPrice: 38_620, entryTime: ENTRY + 60 * MIN });
    const s = pickerSections(base, [hedge, near], INSTRUMENTS);
    expect(s.opposite.map((t) => t.id)).toEqual(['near', 'c']);
  });

  it('読む範囲はこの取引のエントリーの 7 日前〜決済の 7 日後（決済の時刻の範囲）', () => {
    expect(pickRange(base)).toEqual({ exitFrom: ENTRY - 7 * DAY, exitTo: MON + 7 * DAY + 1 });
  });
});

describe('R2・R3: 役割の既定・入れ替え・量の比べ', () => {
  const f = future('f', { exitPrice: 38_600 });
  const c = cfd('c', { price: 38_450, exitPrice: 38_620 });

  it('最初にエントリーした取引の側が本玉（どちらの詳細から結んでも同じ）', () => {
    expect(defaultMainSide(f, [c])).toBe('L');
    expect(defaultMainSide(c, [f])).toBe('L');
    expect(rolesOf(c, [f], 'L').map((m) => [m.trade.id, m.role])).toEqual([
      ['c', 'hedge'],
      ['f', 'main'],
    ]);
    // 入れ替えると逆
    expect(rolesOf(f, [c], 'S').map((m) => m.role)).toEqual(['hedge', 'main']);
  });

  it('量の比べ: 揃っている / 一部を固定 / 決済の代わりが多い', () => {
    expect(volumeLine(rolesOf(f, [c], 'L'))).toBe(
      '決済の代わり 量 1,000 / 本玉 量 1,000 · 揃っています',
    );
    const half = cfd('h', { price: 37_690, quantity: 50, exitPrice: 37_420 });
    expect(volumeLine(rolesOf(f, [half], 'L'))).toBe(
      '決済の代わり 量 500 / 本玉 量 1,000 · 量 500 を固定（50%）',
    );
    const over = cfd('o', { price: 38_450, quantity: 150, exitPrice: 38_620 });
    expect(volumeLine(rolesOf(f, [over], 'L'))).toBe(
      '決済の代わり 量 1,500 / 本玉 量 1,000 · 決済の代わりが量 500 多い',
    );
  });

  it('結べない組の理由（相手なし・決済の代わりなし）', () => {
    expect(linkBlock(rolesOf(f, [], 'L'))).toBe('相手を選んでください');
    const mini = stored(
      'm',
      { multiplier: 100, quantity: 5, exitPrice: 38_400 },
      { instrumentId: XYZ_MINI.id },
    );
    expect(linkBlock(rolesOf(f, [mini], 'L'))).toBe(
      '決済の代わり（逆の向きの取引）を選んでください',
    );
    expect(linkBlock(rolesOf(f, [c], 'L'))).toBeNull();
  });
});

describe('R4: 下の帯の判定の 1 行', () => {
  it('H1 は計画どおりの勝ち・+1.5R、H2 は B（崩れの文）、選ぶ前は押せない理由', () => {
    const a = h1();
    expect(previewLine(rolesOf(a.f, [a.c], 'L'))).toMatchObject({
      kind: 'judged',
      grade: 'safeWin',
    });
    const line = previewLine(rolesOf(a.f, [a.c], 'L'));
    expect(line.kind === 'judged' ? line.r : undefined).toBeCloseTo(1.5, 9);
    const b = h2();
    expect(previewLine(rolesOf(b.f, [b.c], 'L'))).toMatchObject({ kind: 'judged', grade: 'B' });
    expect(previewLine(rolesOf(a.f, [], 'L'))).toEqual({
      kind: 'none',
      text: '相手を選んでください',
    });
  });
});

describe('R5・R6・R7: まとまりの画面の判定のカードと固定の 1 行', () => {
  it('H1: 題「両建て · XYZ 先物 L」・+1.5R・計画どおりの勝ち・固定の 1 行（固定 時刻 · XYZ CFD S 100 · 38,450）', () => {
    const { f, c, g } = h1();
    const st = groupStateOf(g, byId(f, c));
    expect(st.kind).toBe('ok');
    if (st.kind !== 'ok') return;
    expect(groupTitle(mainsOf(st.members), INSTRUMENTS)).toBe('両建て · XYZ 先物 L');
    const s = groupSummary(st.ev, st.members);
    expect(s.judgment?.grade).toBe('safeWin');
    expect(s.r).toBeCloseTo(1.5, 9);
    // 損益の合計 = (38,600 − 38,000) × 1,000 + (38,450 − 38,620) × 100 × 10 = +430,000 円
    expect(s.pnlYen).toBe(430_000);
    expect(s.ruler).toBeDefined();
    const d = new Date(FIX);
    const at = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    expect(fixLineParts(st.ev, st.members, INSTRUMENTS)).toEqual([
      `固定 ${at}`,
      'XYZ CFD S 100',
      '38,450',
    ]);
  });

  it('R6（H8）: 通貨が違えば損益は通貨ごとに並べる（換算しない）', () => {
    const gid = 'g8';
    const f = future(
      'f8',
      {
        multiplier: 5,
        quantity: 2,
        price: 5_000,
        lc: 4_950,
        exitPrice: 5_060,
        priceCurrency: 'USD',
        fxRate: 150,
      },
      gid,
    );
    const c = cfd(
      'c8',
      {
        multiplier: 1,
        quantity: 10,
        price: 5_040,
        exitPrice: 5_065,
        accountCurrency: 'USD',
        priceCurrency: 'USD',
      },
      gid,
    );
    const g = groupOf(gid, [
      { trade: f, role: 'main' },
      { trade: c, role: 'hedge' },
    ]);
    const st = groupStateOf(g, byId(f, c));
    if (st.kind !== 'ok') throw new Error('broken');
    expect(pnlListText(st.ev)).toBe('+90,000円 · −250.00 USD');
    expect(groupSummary(st.ev, st.members).pnlYen).toBeUndefined();
    expect(groupSummary(st.ev, st.members).r).toBeCloseTo(0.8, 9);
  });

  it('R7: 固定の価格を 38,440 に直すと「38,440（修正済み）」・+1.47R。空にすると上書きを送らない', () => {
    const { f, c, g } = h1();
    const read = readExitDraft({ price: '38,440', orderType: '', reason: '' });
    expect(read).toEqual({ exit: { price: 38_440 } });
    const st = groupStateOf({ ...g, ...(read.exit ? { exit: read.exit } : {}) }, byId(f, c));
    if (st.kind !== 'ok') throw new Error('broken');
    expect(fixLineParts(st.ev, st.members, INSTRUMENTS)[2]).toBe('38,440（修正済み）');
    expect(st.ev.ok && st.ev.r).toBeCloseTo(440 / 300, 9);
    expect(readExitDraft({ price: '', orderType: '', reason: '' })).toEqual({});
    expect(readExitDraft({ price: '0', orderType: '', reason: '' }).error).toBeDefined();
    expect(readExitDraft({ price: '', orderType: 'stop', reason: 'gapSlip' })).toEqual({
      exit: { orderType: 'stop', reason: 'gapSlip' },
    });
    expect(groupBody(g.members, undefined)).toEqual({
      members: [
        { tradeId: 'f1', role: 'main' },
        { tradeId: 'c1', role: 'hedge' },
      ],
    });
    expect(cleanExit({})).toBeUndefined();
  });

  it('一部だけの固定は「量 500 / 1,000 を固定」を添える。固定をやめた注記の文', () => {
    const gid = 'g4';
    const f = future('f4', { exitPrice: 37_400, orderType: 'market', gapSlip: 'no' }, gid);
    const c = cfd('c4', { price: 37_690, quantity: 50, exitPrice: 37_420 }, gid);
    const g = groupOf(gid, [
      { trade: f, role: 'main' },
      { trade: c, role: 'hedge' },
    ]);
    const st = groupStateOf(g, byId(f, c));
    if (st.kind !== 'ok') throw new Error('broken');
    expect(fixLineParts(st.ev, st.members, INSTRUMENTS).at(-1)).toBe('量 500 / 1,000 を固定');
    expect(groupNoteText({ kind: 'overHedged', excess: 500 }, byId(f, c), INSTRUMENTS)).toBe(
      '決済の代わりが量 500 多い（判定に使わない）',
    );
    expect(
      groupNoteText({ kind: 'unfixed', tradeId: 'c4', time: FIX }, byId(f, c), INSTRUMENTS),
    ).toContain('固定をやめた（XYZ CFD を ');
  });

  it('「窓・滑りでしたか」は持ち続けたが当たり、決済の理由を上書きしていないときだけ聞く。答え → 決済の理由', () => {
    const b = h2();
    const st = groupStateOf(b.g, byId(b.f, b.c));
    if (st.kind !== 'ok') throw new Error('broken');
    expect(asksGapSlip(st.ev, b.g)).toBe(true);
    expect(asksGapSlip(st.ev, { ...b.g, exit: { reason: 'other' } })).toBe(false);
    const a = h1();
    const sa = groupStateOf(a.g, byId(a.f, a.c));
    expect(sa.kind === 'ok' && asksGapSlip(sa.ev, a.g)).toBe(false);
    expect(gapSlipReason(true, b.f)).toBe('gapSlip');
    expect(gapSlipReason(false, b.f)).toBe('other');
    expect(gapSlipReason(false, future('x', { exitPrice: 1, reason: 'lc' }))).toBe('lc');
  });

  it('メンバーの行は本玉 → 決済の代わり（役割・銘柄・量・建て → 決済・損益）', () => {
    const { f, c, g } = h1();
    const st = groupStateOf(g, byId(f, c));
    if (st.kind !== 'ok') throw new Error('broken');
    const rows = memberRows([...st.members].reverse(), INSTRUMENTS, () => undefined);
    expect(rows.map((r) => [r.role, r.title, r.volume, r.pnl, r.href])).toEqual([
      ['本玉', 'XYZ 先物 L 1', '量 1,000', '+600,000円', '/trades/f1'],
      ['決済の代わり', 'XYZ CFD S 100', '量 1,000', '−170,000円', '/trades/c1'],
    ]);
  });
});

describe('R8・R9: メンバーの詳細の 1 行と崩れたまとまり', () => {
  it('R8: 「両建て（本玉）· まとまりの判定 B 悪い損失」', () => {
    const b = h2();
    const st = groupStateOf(b.g, byId(b.f, b.c));
    if (st.kind !== 'ok' || !st.ev.ok) throw new Error('broken');
    expect(memberLineText('main', st.ev.judgment)).toBe(
      '両建て（本玉）· まとまりの判定 B 悪い損失',
    );
    expect(memberLineText('hedge', st.ev.judgment)).toBe(
      '両建て（決済の代わり）· まとまりの判定 B 悪い損失',
    );
  });

  it('R9: メンバーの取引が無い・逆参照が外れている・役割の組が崩れたまとまりは broken', () => {
    const { f, c, g } = h1();
    expect(groupStateOf(g, byId(f)).kind).toBe('broken');
    const { positionGroupId: _x, ...loose } = c;
    expect(groupStateOf(g, byId(f, loose as StoredTrade)).kind).toBe('broken');
    expect(
      groupStateOf(
        { ...g, members: g.members.map((m) => ({ ...m, role: 'main' as const })) },
        byId(f, c),
      ).kind,
    ).toBe('broken');
  });

  it('操作のシートの両建ての行: 結ぶ / まとまりを見る / 足を持つ取引・崩れた・読み込み中は出さない', () => {
    const { f, c, g } = h1();
    expect(groupActionOf(f, { phase: 'none' })).toBe('link');
    expect(groupActionOf(f, { phase: 'ready', state: groupStateOf(g, byId(f, c)) })).toBe('open');
    expect(groupActionOf(f, { phase: 'ready', state: groupStateOf(g, byId(f)) })).toBeNull();
    expect(groupActionOf(f, { phase: 'loading' })).toBeNull();
    expect(
      groupActionOf(cfd('l', { price: 1, exitPrice: 1, legs: true }), { phase: 'none' }),
    ).toBeNull();
    expect(detailActions(false, 'link')).toEqual(['link', 'delete']);
    expect(detailActions(true, 'open')).toEqual(['compare', 'openGroup', 'delete']);
  });
});

describe('R11: 一覧の行（6.5）', () => {
  it('最初の本玉の行はまとまりの判定と R と「両建て」、決済の代わりの行は役割の文字で R を出さない。計画どおりは 1 回', () => {
    const b = h2();
    const a = h1();
    const index = groupIndexOf([a.g, b.g], byId(a.f, a.c, b.f, b.c));
    const rows = [a.f, a.c, b.f, b.c].map((t) =>
      tradeRow(t, INSTRUMENTS, [], groupRowInfo(t, index)),
    );
    const [af, ac, bf, bc] = rows;
    expect(bf?.badge.label).toBe('B 悪い損失');
    expect(bf?.rText).toBe('−1.5R');
    expect(bf?.groupMark).toBe('両建て');
    expect(bc?.badge.label).toBe('決済の代わり');
    expect(bc?.noNums).toBe(true);
    expect(bc?.rText).toBe('');
    expect(bc?.label).toContain('両建て');
    expect(af?.badge.label).toBe('計画どおりの勝ち');
    expect(ac?.badge.tier).toBe('neutral');
    // 月の見出しの「計画どおり」は最初の本玉の行で 1 回（決済の代わりの行は数えない）
    const months = monthGroups(rows, true);
    expect(months.reduce((n, m) => n + m.plan, 0)).toBe(1);
    expect(months.reduce((n, m) => n + m.count, 0)).toBe(4);
  });

  it('索引を読めていないメンバーは「両建て」だけ（単独の判定を出さない）。逆参照の指す先が無ければ単独の取引', () => {
    const { c } = h1();
    const row = tradeRow(c, INSTRUMENTS, [], groupRowInfo(c, undefined));
    expect(row.badge.label).toBe('両建て');
    expect(row.noNums).toBe(true);
    const dangling = groupIndexOf([], new Map(), ['g1']);
    expect(groupRowInfo(c, dangling)).toBeUndefined();
    // まとまりにいない取引は今の行のまま
    const plain = future('p', { exitPrice: 38_600 });
    expect(groupRowInfo(plain, dangling)).toBeUndefined();
    expect(tradeRow(plain, INSTRUMENTS, []).groupMark).toBeUndefined();
  });
});

describe('R13: なぜのカードはメンバーの和', () => {
  it('恐れ + 平常心 → 恐れ（平常心はほかと同時に持たない）', () => {
    const f = future('f', { exitPrice: 38_600, emotionTags: ['fear'] });
    const c = cfd('c', { price: 38_450, exitPrice: 38_620, emotionTags: ['calm'] });
    const why = groupWhy([{ trade: f }, { trade: c }]);
    expect(why.emotions).toEqual(['fear']);
  });
});

describe('応答の検査と経路', () => {
  it('GET /api/position-groups の形を検査する', () => {
    const { g } = h1();
    expect(parseGroupList({ items: [g], truncated: false })).toEqual([g]);
    expect(
      parseGroupList({ items: [{ ...g, members: [{ tradeId: 'x', role: 'boss', exitTime: 1 }] }] }),
    ).toBeNull();
    expect(parseGroupList({})).toBeNull();
  });

  it('/trades/groups/<id> はまとまりの画面（取引の詳細と取り違えない）。印の無い起動は取引のタブの根の上に積む', () => {
    const opts = { dev: false };
    expect(parseRoute('/trades/groups/g1', opts)).toEqual({ name: 'tradeGroup', id: 'g1' });
    expect(parseRoute('/trades/groups/bad.id', opts)).toBeNull();
    expect(parseRoute('/trades/g1', opts)).toEqual({ name: 'trade', id: 'g1' });
    expect(bootStack('/trades/groups/g1', opts)).toEqual(['/', '/trades', '/trades/groups/g1']);
  });

  it('XYZ CFD は原資産の名前が XYZ（銘柄の名前と違っても同じ原資産）', () => {
    expect(XYZ_CFD.underlying).toBe('XYZ');
  });
});
