// 今の値で写し直す（Issue #31。AC-1〜AC-4・AC-6・AC-7・KEEP-1・例 E1〜E8）。値はすべて架空。
// 場面: L、円建て（価格の通貨 JPY）、乗数 100、イン 38,000、LC 37,800、決済 37,800、数量 1、明細の損益 −20,000 円、
// 3 つのタップは計画どおり。R = (37,800 − 38,000) / (38,000 − 37,800) = −1.0、
// 1R = |−20,000| × |38,000 − 37,800| / |37,800 − 38,000| = 20,000 円、
// リスク（%）= 20,000 / 資金 × 100（1,000,000 円 → 2.0%、500,000 円 → 4.0% = 過剰リスクの B）
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { InstrumentRecord, StoredTrade, TradeSnapshot } from '../../core/record';
import { createEditController, EDIT_VALUES_CHANGED } from '../../ui/src/lib/edit-controller';
import { type Summary, summarize } from '../../ui/src/lib/record-form';
import {
  CHOICE_NAME,
  compareRowMeta,
  detailOffer,
  editCurrentHref,
  gradeChangeText,
  NO_OUTCOME_CHANGE,
  outcomeRows,
  RESNAPSHOT_LABEL,
  resnapshotOffer,
  snapshotDiffs,
  wantsCurrentValues,
  withoutStaleFx,
} from '../../ui/src/lib/resnapshot';
import { Link } from '../../ui/src/lib/router';
import { createTradeDetailController } from '../../ui/src/lib/trade-detail-controller';
import { notFoundState, TradeDetailView } from '../../ui/src/pages/TradeDetail';
import { TradeEditView } from '../../ui/src/pages/TradeEdit';
import { account } from './helpers/accounts';
import { createFakeApi } from './helpers/fake-api';
import { closedInfoTip } from './helpers/info-tip';
import { blobOf, fakePreview, pngBytes, preparedImage } from './helpers/statement-rows';
import { stored } from './helpers/trade-examples';

const IDX: InstrumentRecord = {
  id: 'inst-idx',
  name: '架空指数A',
  underlyingKind: 'index',
  productForm: 'spotCfd',
  priceCurrency: 'JPY',
  multiplier: 100,
  quantityStep: 1,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const SNAP: TradeSnapshot = {
  instrument: {
    multiplier: 100,
    quantityStep: 1,
    priceCurrency: 'JPY',
    underlyingKind: 'index',
    productForm: 'spotCfd',
  },
  capitalYen: null,
  riskTolerancePct: 1,
};

const RECORD: Parameters<typeof stored>[1] = {
  instrumentId: IDX.id,
  lc: 37_800,
  entries: [{ price: 38_000, quantity: 1 }],
  exit: {
    time: Date.UTC(2026, 10, 10, 0, 0),
    price: 37_800,
    orderType: 'unknown' as const,
    reason: 'lc' as const,
    gapSlip: 'unanswered' as const,
  },
  statementPnlYen: -20_000,
};

/** E1: 資金が未設定のときに記録した取引 */
const X1 = stored('x1', RECORD, { snapshot: SNAP });
/** E6・E7: 資金 1,000,000 円で記録した取引（E7 は明細の損益なし = 1R は価格から） */
const X6 = stored('x6', RECORD, { snapshot: { ...SNAP, capitalYen: 1_000_000 } });
const X7 = stored(
  'x7',
  { ...RECORD, statementPnlYen: undefined },
  { snapshot: { ...SNAP, capitalYen: 1_000_000 } },
);

const put = (fake: ReturnType<typeof createFakeApi>) =>
  fake.calls.filter((x) => x.method === 'PUT');

async function open(
  t: StoredTrade,
  capitalYen: number | null,
  instruments: readonly InstrumentRecord[] = [IDX],
) {
  const fake = createFakeApi({ trades: [t], instruments: [...instruments], capitalYen });
  const c = createEditController({ api: fake.api, id: t.id });
  await c.load();
  expect(c.getState().phase).toBe('editing');
  return { fake, c };
}

describe('純関数: snapshotDiffs・resnapshotOffer・outcomeRows', () => {
  it('E1: 資金 未設定 → 1,000,000円、capitalFromEmpty、リスク — → 2.0%（判定は A のまま）', () => {
    const now = { ...SNAP, capitalYen: 1_000_000 };
    const offer = resnapshotOffer(SNAP, now, X1.record);
    expect(offer?.diffs).toEqual([{ label: '資金', from: '未設定', to: '1,000,000円' }]);
    expect(offer?.capitalFromEmpty).toBe(true);
    const rows = outcomeRows(offer?.before as Summary, offer?.after as Summary);
    // 変わる行が先（デザイン 5）
    expect(rows.map((r) => [r.label, r.from, r.to, r.changed])).toEqual([
      ['リスク', '—', '2.0%', true],
      ['判定', 'A いい損失', 'A いい損失', false],
      ['R', '−1.0R', '−1.0R', false],
    ]);
    expect(offer?.prominent).toBe(true);
    expect(offer?.nearVerdict).toBe(true);
    expect(gradeChangeText(offer?.before as Summary, offer?.after as Summary)).toBeNull();
    expect(offer?.before?.judgment?.reasons.some((r) => r.kind === 'riskNotChecked')).toBe(true);
    expect(offer?.after?.judgment?.reasons.some((r) => r.kind === 'riskNotChecked')).toBe(false);
  });

  it('E3: 今の資金 500,000 円なら B（過剰リスク 4.0%）', () => {
    const offer = resnapshotOffer(SNAP, { ...SNAP, capitalYen: 500_000 }, X1.record);
    expect(offer?.after?.judgment?.grade).toBe('B');
    expect(offer?.after?.riskPct).toBeCloseTo(4, 9);
    expect(offer?.after?.judgment?.reasons.some((r) => r.kind === 'overRisk')).toBe(true);
    expect(gradeChangeText(offer?.before as Summary, offer?.after as Summary)).toBe(
      '判定が「A いい損失」から「B 悪い損失」に変わります。',
    );
  });

  it('N-5: 資金が入っていた取引は勧めない（折りたたみ）。良い方へ変わるときも 1 文ではっきり書く', () => {
    // 記録したとき 500,000 円（4.0% = B）→ 今 2,000,000 円（1.0% = A）
    const was = { ...SNAP, capitalYen: 500_000 };
    const offer = resnapshotOffer(was, { ...SNAP, capitalYen: 2_000_000 }, X1.record);
    expect(offer?.prominent).toBe(false);
    expect(offer?.nearVerdict).toBe(false);
    expect(offer?.before?.judgment?.grade).toBe('B');
    expect(offer?.after?.judgment?.grade).toBe('A');
    expect(gradeChangeText(offer?.before as Summary, offer?.after as Summary)).toBe(
      '判定が「B 悪い損失」から「A いい損失」に変わります。',
    );
  });

  it('価格の通貨が空 → 今の値ありは目立つ枠（資金の注記のそばのボタンは出さない）', () => {
    const now = { ...X6.snapshot, instrument: { ...X6.snapshot.instrument, priceCurrency: 'JPY' } };
    const was = { ...X6.snapshot, instrument: { ...X6.snapshot.instrument, priceCurrency: null } };
    const offer = resnapshotOffer(was, now, X6.record);
    expect(offer?.prominent).toBe(true);
    expect(offer?.nearVerdict).toBe(false);
  });

  it('N-7: LC なしの取引は、資金が空でも注記のそばのボタンを出さない（再計算してもリスク（%）が出ない）', () => {
    const noLc = { ...X1.record, lcDecidedBeforeEntry: false } as typeof X1.record;
    const { lc: _lc, ...rest } = noLc;
    const offer = resnapshotOffer(
      SNAP,
      { ...SNAP, capitalYen: 1_000_000 },
      rest as typeof X1.record,
    );
    expect(offer?.capitalFromEmpty).toBe(true);
    expect(offer?.after?.riskPct).toBeUndefined();
    expect(offer?.nearVerdict).toBe(false);
  });

  it('E6: 同じ値なら null（枠も操作も出さない）', () => {
    expect(resnapshotOffer(X6.snapshot, X6.snapshot, X6.record)).toBeNull();
  });

  it('E7: 乗数 100 → 10（明細の損益なし）で 1R 20,000 → 2,000 円、リスク 2.0% → 0.2%', () => {
    const now = { ...X7.snapshot, instrument: { ...X7.snapshot.instrument, multiplier: 10 } };
    const offer = resnapshotOffer(X7.snapshot, now, X7.record);
    expect(offer?.diffs).toEqual([{ label: '乗数', from: '100', to: '10' }]);
    expect(offer?.before?.oneRYen).toBeCloseTo(20_000, 6);
    expect(offer?.after?.oneRYen).toBeCloseTo(2_000, 6);
    expect(outcomeRows(offer?.before as Summary, offer?.after as Summary)[0]).toEqual({
      label: 'リスク',
      from: '2.0%',
      to: '0.2%',
      changed: true,
    });
  });

  it('E8: 資金 1,000,000 円 → 未設定は出すが、capitalFromEmpty ではない', () => {
    const offer = resnapshotOffer(X6.snapshot, SNAP, X6.record);
    expect(offer?.diffs).toEqual([{ label: '資金', from: '1,000,000円', to: '未設定' }]);
    expect(offer?.capitalFromEmpty).toBe(false);
  });

  it('保存する記録がそろっていなければ、違う値だけ（判定の前 → 後は出さない）', () => {
    const offer = resnapshotOffer(SNAP, { ...SNAP, capitalYen: 1 }, undefined);
    expect(offer?.diffs).toHaveLength(1);
    expect(offer?.before).toBeUndefined();
    expect(offer?.after).toBeUndefined();
  });

  it('許容リスク・銘柄の値の行は決まった順で、言葉は利用者の言葉', () => {
    const now: TradeSnapshot = {
      capitalYen: 2_000_000,
      riskTolerancePct: 1.5,
      instrument: {
        multiplier: 10,
        quantityStep: 0.1,
        priceCurrency: 'USD',
        underlyingKind: 'fx',
        productForm: 'future',
      },
    };
    expect(snapshotDiffs({ ...SNAP, capitalYen: 1_000_000 }, now)).toEqual([
      { label: '資金', from: '1,000,000円', to: '2,000,000円' },
      { label: '許容リスク', from: '1%', to: '1.5%' },
      { label: '乗数', from: '100', to: '10' },
      { label: '数量の刻み', from: '1', to: '0.1' },
      { label: '価格の通貨', from: 'JPY', to: 'USD' },
      { label: '原資産の種類', from: '株価指数', to: 'FX' },
      { label: '取引の形態', from: '現物・CFD', to: '先物' },
    ]);
  });

  it('性質: 同じ snapshot なら差 0、行の数 = 違う値の数（種つき乱数 300 件）', () => {
    let seed = 31;
    const rnd = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
    const make = (): TradeSnapshot => ({
      capitalYen: pick([null, 500_000, 1_000_000]),
      riskTolerancePct: pick([0.5, 1, 2]),
      instrument: {
        multiplier: pick([1, 10, 100]),
        quantityStep: pick([0.01, 1]),
        priceCurrency: pick([null, 'JPY', 'USD']),
        underlyingKind: pick(['index', 'fx'] as const),
        productForm: pick(['spotCfd', 'future'] as const),
      },
    });
    for (let i = 0; i < 300; i++) {
      const a = make();
      const b = make();
      expect(snapshotDiffs(a, a)).toEqual([]);
      const n =
        Number(a.capitalYen !== b.capitalYen) +
        Number(a.riskTolerancePct !== b.riskTolerancePct) +
        (Object.keys(a.instrument) as (keyof TradeSnapshot['instrument'])[]).filter(
          (k) => a.instrument[k] !== b.instrument[k],
        ).length;
      expect(snapshotDiffs(a, b)).toHaveLength(n);
      expect(resnapshotOffer(a, b, X1.record) === null).toBe(n === 0);
    }
  });
});

describe('controller: 選んだときだけ今の値で計算し、保存に ?snapshot=current を付ける', () => {
  it('E1 → E2: 開いただけでは写した値（リスクなし・注記あり）。選ぶ → 保存で写した資金 1,000,000 円', async () => {
    const { fake, c } = await open(X1, 1_000_000);
    let s = c.getState();
    expect(s.offer?.capitalFromEmpty).toBe(true);
    expect(s.refresh).toBe(false);
    expect(s.preview.riskPct).toBeUndefined();
    expect(s.preview.judgment?.reasons.some((r) => r.kind === 'riskNotChecked')).toBe(true);
    c.setRefresh(true);
    s = c.getState();
    expect(s.refresh).toBe(true);
    expect(s.preview.riskPct).toBeCloseTo(2, 9);
    expect(s.preview.judgment?.grade).toBe('A');
    expect(s.preview.judgment?.reasons.some((r) => r.kind === 'riskNotChecked')).toBe(false);
    await c.save();
    expect(c.getState().phase).toBe('saved');
    expect(put(fake).map((x) => x.path)).toEqual(['/api/trades/x1?snapshot=current']);
    const saved = c.getState().trade as StoredTrade;
    expect(saved.snapshot.capitalYen).toBe(1_000_000);
    expect(saved.snapshot.instrument).toEqual(SNAP.instrument);
    expect(summarize(saved).riskPct).toBeCloseTo(2, 9);
  });

  it('E3: 選ぶとプレビュー B・過剰リスク 4.0%、直す前の判定は A のまま', async () => {
    const { c } = await open(X1, 500_000);
    c.setRefresh(true);
    const s = c.getState();
    expect(s.before.judgment?.grade).toBe('A');
    expect(s.preview.judgment?.grade).toBe('B');
    expect(s.preview.riskPct).toBeCloseTo(4, 9);
  });

  it('E4: 選ばずに保存 → クエリなし・写した資金は空のまま（KEEP-1）', async () => {
    const { fake, c } = await open(X1, 500_000);
    await c.save();
    expect(put(fake).map((x) => x.path)).toEqual(['/api/trades/x1']);
    expect((c.getState().trade as StoredTrade).snapshot).toEqual(SNAP);
  });

  it('E5: 選ぶ → 戻す → 保存 → クエリなし。戻すとプレビューも元の計算', async () => {
    const { fake, c } = await open(X1, 500_000);
    const first = c.getState().preview;
    c.setRefresh(true);
    c.setRefresh(false);
    expect(c.getState().refresh).toBe(false);
    expect(c.getState().preview).toEqual(first);
    await c.save();
    expect(put(fake).map((x) => x.path)).toEqual(['/api/trades/x1']);
    expect((c.getState().trade as StoredTrade).snapshot.capitalYen).toBeNull();
  });

  it('E6: 違いが無ければ offer は null。選んでも保存にクエリを付けない', async () => {
    const { fake, c } = await open(X6, 1_000_000);
    expect(c.getState().offer).toBeNull();
    c.setRefresh(true);
    await c.save();
    expect(put(fake).map((x) => x.path)).toEqual(['/api/trades/x6']);
  });

  it('E7: 銘柄の乗数を 10 に直した後、選んで保存で写した乗数 10（1R 2,000 円・0.2%）', async () => {
    const { fake, c } = await open(X7, 1_000_000, [{ ...IDX, multiplier: 10 }]);
    expect(c.getState().offer?.diffs.map((d) => d.label)).toEqual(['乗数']);
    c.setRefresh(true);
    expect(c.getState().preview.riskPct).toBeCloseTo(0.2, 9);
    await c.save();
    expect(put(fake)[0]?.path).toBe('/api/trades/x7?snapshot=current');
    const saved = c.getState().trade as StoredTrade;
    expect(saved.snapshot.instrument.multiplier).toBe(10);
    expect(summarize(saved).oneRYen).toBeCloseTo(2_000, 6);
  });

  it('N-6: 開いてから口座の資金が変わったら、保存せずに知らせて表示を今の値にする', async () => {
    const { fake, c } = await open(X1, 1_000_000);
    c.setRefresh(true);
    // 別の画面で口座 1 の資金を 500,000 円に
    const res = await fake.api('/api/accounts/default', {
      method: 'PUT',
      body: JSON.stringify({ name: '口座 1', capitalYen: 500_000, riskTolerancePct: 1 }),
    });
    expect(res.status).toBe(200);
    await c.save();
    const s = c.getState();
    expect(s.phase).toBe('editing');
    expect(s.error).toBe(EDIT_VALUES_CHANGED);
    expect(put(fake).filter((x) => x.path.startsWith('/api/trades/'))).toHaveLength(0);
    expect(s.offer?.snapshot.capitalYen).toBe(500_000);
    expect(s.preview.judgment?.grade).toBe('B');
    // 確かめてもう一度押すと、その値で保存する
    await c.save();
    expect(c.getState().phase).toBe('saved');
    expect((c.getState().trade as StoredTrade).snapshot.capitalYen).toBe(500_000);
  });

  it('#89 R3: 今の値が変わって保存を止めたときも、止めたチャートの時間足の読み取りを並べ直す', async () => {
    const fake = createFakeApi({ trades: [X1], instruments: [IDX], capitalYen: 1_000_000 });
    const c = createEditController({
      api: fake.api,
      id: X1.id,
      prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
    });
    await c.load();
    c.setRefresh(true);
    fake.holdChartReads();
    void c.setChart('x1', blobOf(pngBytes(1200, 800, 2048)));
    await new Promise((r) => setTimeout(r, 0));
    expect(c.getState().charts?.x1?.read).toBe('reading');
    await fake.api('/api/accounts/default', {
      method: 'PUT',
      body: JSON.stringify({ name: '口座 1', capitalYen: 500_000, riskTolerancePct: 1 }),
    });
    await c.save();
    expect(c.getState().error).toBe(EDIT_VALUES_CHANGED);
    // 止めた読み取りは「読み取り中」に戻って、もう一度送られる
    expect(c.getState().charts?.x1?.read).toBe('reading');
    fake.releaseChartReads();
    for (let i = 0; i < 20 && c.getState().charts?.x1?.read !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(c.getState().charts?.x1?.read).toBe('done');
    c.dispose();
  });

  it('N-8:選んだ後に口座を付け替えて違いが無くなったら、選択も戻す（元に戻しても「記録したとき」）', async () => {
    const fake = createFakeApi({
      trades: [X1],
      instruments: [IDX],
      capitalYen: 1_000_000,
      accounts: [account('b', '口座 B', 300_000)],
    });
    const c = createEditController({ api: fake.api, id: 'x1' });
    await c.load();
    c.setRefresh(true);
    expect(c.getState().refresh).toBe(true);
    c.update({ type: 'set', field: 'accountId', value: 'b' });
    expect(c.getState().offer).toBeNull();
    expect(c.getState().refresh).toBe(false);
    c.update({ type: 'set', field: 'accountId', value: 'default' });
    expect(c.getState().offer).not.toBeNull();
    expect(c.getState().refresh).toBe(false);
  });

  it('選んだ後に欄を直しても、今の値で計算し続ける', async () => {
    const { c } = await open(X1, 1_000_000);
    c.setRefresh(true);
    c.update({ type: 'set', field: 'lcMove', value: 'widened' });
    const s = c.getState();
    expect(s.refresh).toBe(true);
    expect(s.preview.judgment?.grade).toBe('B');
    expect(s.preview.riskPct).toBeCloseTo(2, 9);
  });
});

// ── 画面（hook を持たない View を、部品を呼んで要素の木にして見る） ──
interface El {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: Node[];
}
type Node = El | string;

function expand(v: unknown): Node[] {
  if (v === null || v === undefined || typeof v === 'boolean') return [];
  if (typeof v === 'string' || typeof v === 'number') return [String(v)];
  if (Array.isArray(v)) return v.flatMap(expand);
  const vn = v as VNode<Record<string, unknown>>;
  const tip = closedInfoTip(vn);
  if (tip) return expand(tip);
  if (vn.type === (Link as unknown)) {
    const { children, ...props } = vn.props ?? {};
    return [{ type: 'a', props, children: expand(children) }];
  }
  if (typeof vn.type === 'function') {
    return expand((vn.type as (p: unknown) => unknown)(vn.props));
  }
  const { children, ...props } = vn.props ?? {};
  return [{ type: String(vn.type), props, children: expand(children) }];
}

function all(nodes: Node[], pred: (e: El) => boolean, out: El[] = []): El[] {
  for (const n of nodes) {
    if (typeof n === 'string') continue;
    if (pred(n)) out.push(n);
    all(n.children, pred, out);
  }
  return out;
}

const text = (n: Node | Node[]): string =>
  Array.isArray(n) ? n.map(text).join('') : typeof n === 'string' ? n : text(n.children);
const hasClass = (c: string) => (e: El) =>
  String(e.props.class ?? '')
    .split(' ')
    .includes(c);
const noop = () => {};
const nearButtons = (tree: Node[]) =>
  all(tree, (e) => e.type === 'button' && text(e).includes(RESNAPSHOT_LABEL));
const choices = (tree: Node[]) =>
  all(tree, (e) => e.type === 'input' && e.props.name === CHOICE_NAME).map((e) => ({
    value: e.props.value,
    checked: e.props.checked,
    onChange: e.props.onChange as () => void,
  }));

function view(c: ReturnType<typeof createEditController>, id: string) {
  return expand(
    <TradeEditView
      id={id}
      state={c.getState()}
      hidden={new Set()}
      notFound={notFoundState()}
      onUpdate={c.update}
      onSetRefresh={c.setRefresh}
      onRecalcNow={() => c.setRefresh(true)}
      onSave={noop}
      onReload={noop}
      onRelogin={noop}
    />,
  );
}

describe('画面: 枠と、判定の枠の注記のそばのボタン', () => {
  it('AC-1・AC-6: E1 は「今の値と比べる」の行 → 比較のシート（未設定 → 1,000,000円・— → 2.0%）と、判定の注記のすぐ後のボタン（#131）', async () => {
    const { c } = await open(X1, 1_000_000);
    const tree = view(c, 'x1');
    const row = all(tree, (e) => e.props.id === 'edit-compare')[0] as El;
    expect(text(row)).toBe('今の値と比べる1 か所違います');
    const sheet = all(tree, (e) => e.props['data-sheet'] === 'edit-compare-sheet')[0] as El;
    const panel = all([sheet], hasClass('resnap'))[0] as El;
    expect(panel.type).toBe('div');
    const t = text(panel);
    expect(t).toContain('この取引には資金が保存されていないため、過剰リスクを判定していません。');
    expect(t).toContain('未設定');
    expect(t).toContain('1,000,000円');
    expect(t).toContain('2.0%');
    expect(t).toContain('−1.0R（変わらず）');
    expect(t).not.toMatch(/写/);
    const verdict = all(tree, hasClass('verdict'))[0] as El;
    const action = all(verdict.children, hasClass('verdict__action'))[0] as El;
    const kids = verdict.children.filter((n): n is El => typeof n !== 'string');
    expect(text(kids[kids.indexOf(action) - 1] as El)).toContain(
      '資金が未設定のため、過剰リスクは判定していません',
    );
    expect(nearButtons(tree)).toHaveLength(1);
    // 2 択は「記録したとき」が選ばれている
    expect(choices(tree).map((x) => [x.value, x.checked])).toEqual([
      ['recorded', true],
      ['current', false],
    ]);
    // 注記のそばのボタンを押す → 「今の値」が選ばれ、注記もボタンも消える（AC-3）
    const recalc = nearButtons(tree)[0]?.props.onClick as () => void;
    recalc();
    const after = view(c, 'x1');
    expect(text(all(after, hasClass('verdict'))[0] as El)).not.toContain('資金が未設定');
    expect(nearButtons(after)).toEqual([]);
    expect(choices(after).map((x) => [x.value, x.checked])).toEqual([
      ['recorded', false],
      ['current', true],
    ]);
    expect(text(all(after, (e) => e.props.id === 'edit-resnapshot-status')[0] as El)).toContain(
      '戻すには「記録したとき」を選びます',
    );
    expect(text(all(after, (e) => e.props.id === 'edit-change')[0] as El)).toBe(
      '今の値で再計算 · 判定は変わりません: A いい損失 −1.0R',
    );
    // 「記録したとき」を選ぶと戻る
    choices(after)[0]?.onChange();
    expect(c.getState().refresh).toBe(false);
  });

  it('E3: 選ぶと保存の帯に A → B、枠に判定が変わる 1 文', async () => {
    const { c } = await open(X1, 500_000);
    expect(text(view(c, 'x1'))).toContain('判定が「A いい損失」から「B 悪い損失」に変わります');
    c.setRefresh(true);
    const tree = view(c, 'x1');
    expect(text(all(tree, (e) => e.props.id === 'edit-change')[0] as El)).toBe(
      '今の値で再計算 · 判定: A いい損失 −1.0R → B 悪い損失 −1.0R',
    );
  });

  it('AC-2: E6 は枠もボタンも無い', async () => {
    const { c } = await open(X6, 1_000_000);
    const tree = view(c, 'x6');
    expect(all(tree, hasClass('resnap'))).toEqual([]);
    expect(nearButtons(tree)).toEqual([]);
    expect(choices(tree)).toEqual([]);
  });

  it('E8・N-5: 資金が入っていた取引も行「今の値と比べる」→ 比較のシート（勧めない文）。注記のそばのボタンは無い（#131: 折りたたみをやめた）', async () => {
    const { c } = await open(X6, null);
    const tree = view(c, 'x6');
    expect(all(tree, (e) => e.type === 'details')).toEqual([]);
    expect(text(all(tree, (e) => e.props.id === 'edit-compare')[0] as El)).toBe(
      '今の値と比べる1 か所違います',
    );
    const fold = all(tree, hasClass('resnap'))[0] as El;
    expect(text(fold)).toContain('記録したときの口座・銘柄の値と、今の値が違います。');
    // 開けば違いと判定・R・リスクの 前 → 後 が必ずある
    expect(text(fold)).toContain('1,000,000円');
    expect(text(fold)).toContain('2.0%');
    expect(all(tree, hasClass('verdict__action'))).toEqual([]);
    expect(choices(tree)).toHaveLength(2);
  });

  it('デザイン 3: 判定・R・リスクが変わらないときは 1 行に畳む', async () => {
    const { c } = await open(X7, 1_000_000, [{ ...IDX, underlyingKind: 'other' }]);
    const tree = view(c, 'x7');
    const fold = all(tree, hasClass('resnap'))[0] as El;
    expect(text(fold)).toContain(NO_OUTCOME_CHANGE);
    expect(all([fold], (e) => e.props.id === 'edit-resnapshot-outcomes')).toEqual([]);
  });
});

describe('今の値で写し直すと口座の通貨・為替（#47 PR-2 との合わせ直し）', () => {
  it('資金の行は各々の口座の通貨で書き、口座の通貨が違えば行を足す。無い = JPY は JPY と同じ', () => {
    const from: TradeSnapshot = { ...SNAP, capitalYen: 10_000, accountCurrency: 'USD' };
    const to: TradeSnapshot = { ...SNAP, capitalYen: 20_000, accountCurrency: 'USD' };
    expect(snapshotDiffs(from, to)).toEqual([
      { label: '資金', from: '10,000.00 USD', to: '20,000.00 USD' },
    ]);
    // 移す前の取引（口座の通貨なし）と今の JPY の口座: 通貨の行は出ない
    expect(
      snapshotDiffs({ ...SNAP, capitalYen: 1 }, { ...SNAP, capitalYen: 1, accountCurrency: 'JPY' }),
    ).toEqual([]);
  });

  it('withoutStaleFx: 通貨の組（価格の通貨 / 口座の通貨）が変わるなら為替を外し、同じなら残す', () => {
    const usd: TradeSnapshot = {
      ...SNAP,
      instrument: { ...SNAP.instrument, priceCurrency: 'USD' },
      accountCurrency: 'JPY',
    };
    const rec = { ...X1.record, exit: { ...X1.record.exit, fxRate: 150 } };
    expect(withoutStaleFx(rec, usd, usd).exit.fxRate).toBe(150);
    expect('fxRate' in withoutStaleFx(rec, usd, SNAP).exit).toBe(false);
    expect('fxRate' in withoutStaleFx(rec, usd, { ...usd, accountCurrency: 'EUR' }).exit).toBe(
      false,
    );
  });

  it('記録したとき USD 建て（為替 150）→ 今は銘柄が円建て: 今の値の計算は為替を使わず、保存の本文に為替なし・?snapshot=current', async () => {
    // L・イン 38,000・LC 37,800・決済 37,800・数量 1・乗数 100・明細の損益なし。
    // 記録したとき: 1R = 200 × 1 × 100 × 150 = 3,000,000。今（円建て）: 1R = 200 × 1 × 100 = 20,000
    const t = stored(
      'xfx',
      {
        ...RECORD,
        statementPnlYen: undefined,
        exit: { ...RECORD.exit, fxRate: 150 },
      } as Parameters<typeof stored>[1],
      {
        snapshot: {
          ...SNAP,
          capitalYen: 100_000_000,
          instrument: { ...SNAP.instrument, priceCurrency: 'USD' },
        },
      },
    );
    const { fake, c } = await open(t, 100_000_000);
    expect(c.getState().preview.oneRYen).toBeCloseTo(3_000_000, 6);
    expect(c.getState().offer?.diffs.map((d) => d.label)).toContain('価格の通貨');
    c.setRefresh(true);
    expect(c.getState().preview.oneRYen).toBeCloseTo(20_000, 6);
    await c.save();
    const call = put(fake)[0];
    if (call === undefined) throw new Error('PUT が無い');
    expect(call.path.endsWith('?snapshot=current')).toBe(true);
    expect('fxRate' in (call.body as { exit: object }).exit).toBe(false);
  });
});

describe('再計算で為替を外すのは意味を失う移りだけ（#47 PR-2 の再レビュー block）', () => {
  const withPrice = (price: string | null, account?: string): TradeSnapshot => ({
    ...SNAP,
    capitalYen: 300_000_000,
    instrument: { ...SNAP.instrument, priceCurrency: price },
    ...(account === undefined ? {} : { accountCurrency: account }),
  });
  const rec = { ...X1.record, exit: { ...X1.record.exit, fxRate: 150 } };

  it('未設定 → USD（口座は JPY のまま）: 為替 150 を保つ', () => {
    expect(withoutStaleFx(rec, withPrice(null), withPrice('USD')).exit.fxRate).toBe(150);
    expect(withoutStaleFx(rec, withPrice(null), withPrice('USD', 'JPY')).exit.fxRate).toBe(150);
  });

  it('USD → EUR（決まった通貨どうし）・口座の通貨が変わる（未設定 → USD でも）: 外す', () => {
    expect('fxRate' in withoutStaleFx(rec, withPrice('USD'), withPrice('EUR')).exit).toBe(false);
    expect('fxRate' in withoutStaleFx(rec, withPrice(null), withPrice('USD', 'EUR')).exit).toBe(
      false,
    );
  });

  it('取り込んだ取引の形（価格の通貨が未設定・為替 150・決済 = イン で明細から 1R を逆算できない）→ 銘柄に USD を入れて再計算しても 1R は 3,000,000 円のまま・本文に為替 150', async () => {
    // L・イン 38,000・LC 37,800・決済 38,000（= イン）・数量 1・乗数 100・明細の損益 −200。
    // 決済 = イン なので明細から逆算せず、1R = 200 × 1 × 100 × 150 = 3,000,000 円、リスク = 3,000,000 ÷ 300,000,000 = 1.0%
    const imported = stored(
      'ximp',
      {
        ...RECORD,
        statementPnlYen: -200,
        exit: { ...RECORD.exit, price: 38_000, fxRate: 150 },
      } as Parameters<typeof stored>[1],
      { snapshot: withPrice(null) },
    );
    const usdNow = { ...IDX, priceCurrency: 'USD' };
    const { fake, c } = await open(imported, 300_000_000, [usdNow]);
    expect(c.getState().preview.oneRYen).toBeCloseTo(3_000_000, 6);
    expect(c.getState().offer?.diffs.map((d) => [d.label, d.from, d.to])).toContainEqual([
      '価格の通貨',
      '未設定',
      'USD',
    ]);
    expect(c.getState().offer?.after?.oneRYen).toBeCloseTo(3_000_000, 6);
    c.setRefresh(true);
    expect(c.getState().preview.oneRYen).toBeCloseTo(3_000_000, 6);
    expect(c.getState().preview.riskPct).toBeCloseTo(1, 9);
    await c.save();
    const call = put(fake)[0];
    if (call === undefined) throw new Error('PUT が無い');
    expect(call.path.endsWith('?snapshot=current')).toBe(true);
    expect((call.body as { exit: { fxRate?: number } }).exit.fxRate).toBe(150);
  });
});

// ---- 詳細の比較のシート（#131 AC-3。#31 の P4: 見るだけ・写し直すのは編集の保存のときだけ）。値は架空 ----

describe('詳細の比較（#131）: detailOffer・?values=current', () => {
  it('detailOffer は開いた編集の画面の提案と同じ（違う値・前 → 後）。違わなければ null', async () => {
    for (const [t, capital] of [
      [X1, 1_000_000],
      [X6, 500_000],
      [X6, 1_000_000],
    ] as const) {
      const { fake, c } = await open(t, capital);
      const d = createTradeDetailController({
        api: fake.api,
        id: t.id,
        preview: async () => fakePreview(),
      });
      await d.load();
      const s = d.getState();
      if (s.phase !== 'ready') throw new Error('読めない');
      const offer = detailOffer(s.trade, s.instruments, s.accounts);
      expect(offer).toEqual(c.getState().offer);
      // 詳細を開いて比べても、要求は GET だけ（保存しない）
      expect(fake.calls.filter((x) => x.method !== 'GET')).toEqual([]);
    }
  });

  it('直せない取引（建てが 2 つ）は比べない', () => {
    const multi: StoredTrade = {
      ...X1,
      record: { ...X1.record, entries: [X1.record.entries[0], X1.record.entries[0]] },
    };
    expect(detailOffer(multi, [IDX], [account('default', '口座 1', 1_000_000)])).toBeNull();
  });

  it('レッグを持つ取引は比べない（下書きがレッグを写さず、前 → 後 がレッグ抜きの値になるため。#131 のレビュー N3）', () => {
    const withLegs = {
      ...X1,
      record: { ...X1.record, legs: [{}] },
    } as unknown as StoredTrade;
    const accounts = [account('default', '口座 1', 1_000_000)];
    expect(detailOffer(X1, [IDX], accounts)).not.toBeNull();
    expect(detailOffer(withLegs, [IDX], accounts)).toBeNull();
  });

  it('［編集で今の値にする］ の URL と印の読み取り', () => {
    expect(editCurrentHref('x1')).toBe('/trades/x1/edit?values=current');
    expect(wantsCurrentValues('?values=current')).toBe(true);
    expect(wantsCurrentValues('values=current')).toBe(true);
    expect(wantsCurrentValues('')).toBe(false);
    expect(wantsCurrentValues('?values=recorded')).toBe(false);
    expect(wantsCurrentValues('?other=current')).toBe(false);
  });

  it('「今の値と比べる」の行の添え: 違う値の数、今の値を選んでいればそのこと', () => {
    const offer = resnapshotOffer(SNAP, { ...SNAP, capitalYen: 1_000_000 }, X1.record);
    if (!offer) throw new Error('提案なし');
    expect(compareRowMeta(offer)).toBe('1 か所違います');
    expect(compareRowMeta(offer, true)).toBe('今の値で計算中');
  });

  it('詳細の比較のシートは 2 択を持たず、［編集で今の値にする］ は編集の URL（?values=current）', async () => {
    const { fake } = await open(X1, 1_000_000);
    const d = createTradeDetailController({
      api: fake.api,
      id: 'x1',
      preview: async () => fakePreview(),
    });
    await d.load();
    const tree = expand(
      <TradeDetailView
        id="x1"
        state={d.getState()}
        hidden={new Set()}
        notFound={notFoundState()}
        onDelete={noop}
        onReloadChart={noop}
        onReload={noop}
        onRelogin={noop}
        sheet={{ kind: 'compare' }}
      />,
    );
    const sheet = all(tree, (e) => e.props['data-sheet'] === 'detail-compare-sheet')[0] as El;
    expect(sheet.props['data-open']).toBe('true');
    expect(choices([sheet])).toEqual([]);
    expect(text(sheet)).toContain('1,000,000円');
    const link = all([sheet], (e) => e.type === 'a')[0] as El;
    expect(link.props.href).toBe('/trades/x1/edit?values=current');
    expect(text(link)).toBe('編集で今の値にする');
  });
});
