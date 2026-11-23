// オプションのポジションの部品の描画（#117。設計書 7.6・5.7）。DOM のライブラリを使わず、部品の関数を呼んで要素の木に展開して見る
// （部品は hook を持たない。Link は a として止める）。値・名前はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { InstrumentRecord, StoredTrade } from '../../core/record';
import { LegEditor } from '../../ui/src/components/LegEditor';
import { LEG_LIST_ID, LEG_MERGE_ID, LEG_UNDO_ID, LegList } from '../../ui/src/components/LegList';
import { LEG_TABLE_TITLE_ID, LegTable } from '../../ui/src/components/LegTable';
import {
  LcFields,
  LOSS_PLAN_HINT,
  MAX_LOSS_LABEL,
  NEW_MULTIPLIER_ID,
  newInstrumentText,
  TapFields,
  TradeCoreFields,
  type TradeFieldsProps,
  TradeMoreBody,
} from '../../ui/src/components/TradeFields';
import { TradeRow } from '../../ui/src/components/TradeRow';
import { Verdict } from '../../ui/src/components/Verdict';
import { createEditController } from '../../ui/src/lib/edit-controller';
import { EDIT_SHEET_ID, type EditSheet } from '../../ui/src/lib/edit-screen';
import {
  EMPTY_LEG,
  type LegDraft,
  type LegUndo,
  YEAR_INFERRED_HINT,
} from '../../ui/src/lib/legs-form';
import { legRows, SIDE_MISMATCH } from '../../ui/src/lib/option-view';
import { createRecordController } from '../../ui/src/lib/record-controller';
import { type Draft, EMPTY_DRAFT, readDraft, summarize } from '../../ui/src/lib/record-form';
import type { RecordSheet } from '../../ui/src/lib/record-screen';
import { Link } from '../../ui/src/lib/router';
import { fillFromRow, parseReadResponse } from '../../ui/src/lib/statement-fill';
import { recordFields, tapAnswers, tradeRow } from '../../ui/src/lib/trade-view';
import { NEXT_POSITION_NOTE, RecordView } from '../../ui/src/pages/Record';
import { notFoundState, TradeDetailView } from '../../ui/src/pages/TradeDetail';
import { TradeEditView } from '../../ui/src/pages/TradeEdit';
import { createFakeApi } from './helpers/fake-api';
import { closedInfoTip } from './helpers/info-tip';
import {
  blobOf,
  fakePreview,
  OPT_A1,
  OPT_A2,
  OPT_B1,
  optionRowJson,
  pngBytes,
  preparedImage,
  statementBody,
} from './helpers/statement-rows';

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
    const fn = vn.type as (p: unknown) => unknown;
    return expand(fn(vn.props));
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

function text(n: Node | Node[]): string {
  if (Array.isArray(n)) return n.map(text).join('');
  return typeof n === 'string' ? n : text(n.children);
}

const byId = (tree: Node[], id: string) => all(tree, (e) => e.props.id === id)[0];
const labels = (tree: Node[]) => all(tree, (e) => e.type === 'label').map((e) => text(e));
const noop = () => {};

const XYZ: InstrumentRecord = {
  id: 'i-xyz',
  name: '架空指数XYZオプション',
  underlyingKind: 'index',
  productForm: 'option',
  priceCurrency: 'JPY',
  multiplier: 1_000,
  quantityStep: 1,
  createdAt: 1,
  updatedAt: 1,
};
const ctx = {
  instruments: [XYZ],
  accounts: [
    {
      id: 'default',
      name: '口座 1',
      currency: 'JPY',
      capitalYen: 20_000_000,
      riskTolerancePct: 1,
      capitalHistory: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ],
};
const leg = (o: Partial<LegDraft>): LegDraft => ({ ...EMPTY_LEG, contractMonth: '2027-01', ...o });
const spread: Draft = {
  ...EMPTY_DRAFT,
  instrumentName: XYZ.name,
  entryPrice: '38200',
  exitPrice: '38100',
  exitTime: '2027-01-06T13:30',
  lcMaxLoss: true,
  lcDecided: true,
  timeframeChange: 'none',
  pnlYen: '-130000',
  legs: [
    leg({
      optionType: 'P',
      strike: '38000',
      side: 'buy',
      quantity: '1',
      entryPrice: '400',
      exitPrice: '300',
    }),
    leg({
      optionType: 'P',
      strike: '37000',
      side: 'sell',
      quantity: '1',
      entryPrice: '150',
      exitPrice: '180',
    }),
  ],
};
const naked: Draft = {
  ...spread,
  lcMaxLoss: false,
  lc: '37500',
  lcMove: 'none',
  entryPrice: '38500',
  exitPrice: '38900',
  pnlYen: '',
  legs: [
    leg({
      optionType: 'P',
      strike: '36000',
      side: 'sell',
      quantity: '1',
      entryPrice: '150',
      exitPrice: '50',
    }),
  ],
};

function props(d: Draft): TradeFieldsProps {
  const read = readDraft(d, ctx);
  if (!read.option) throw new Error('オプションの形でない');
  return {
    draft: d,
    errors: read.errors,
    instruments: [XYZ],
    marks: {},
    onUpdate: noop,
    option: { reading: read.option, onOpenLeg: noop, onAddLeg: noop },
  };
}

describe('取引の欄（オプションの形。AC-1・AC-5・AC-8）', () => {
  it('数量と L / S を出さず、原資産の言葉の欄とレッグの一覧（2 行のカード）と [＋ レッグ]', () => {
    const tree = expand(<TradeCoreFields {...props(spread)} />);
    expect(byId(tree, 'record-quantity')).toBeUndefined();
    expect(byId(tree, 'record-side')).toBeUndefined();
    expect(labels(tree)).toEqual(
      expect.arrayContaining(['エントリー時の原資産', '決済時の原資産']),
    );
    const rows = all(tree, (e) => String(e.props.class ?? '').includes('legs__item'));
    expect(rows.map((r) => text(r))).toEqual([
      '買い 1 · P 38,000 · 2027-01400 → 300',
      '売り 1 · P 37,000 · 2027-01150 → 180',
    ]);
    expect(text(byId(tree, 'record-legs-add') as El)).toContain('レッグ');
  });
  it('「最大損失まで」は定まるときだけ。選ぶと LC の欄は使えず、LC を動かしたかを聞かない', () => {
    const lc = expand(<LcFields {...props(spread)} />);
    const toggle = byId(lc, 'record-lc-maxloss') as El;
    expect(text(toggle)).toBe(MAX_LOSS_LABEL);
    expect(toggle.props['aria-pressed']).toBe('true');
    expect(text(expand(<TapFields {...props(spread)} />))).not.toContain('LC を動かしたか');
    expect(byId(expand(<LcFields {...props(naked)} />), 'record-lc-maxloss')).toBeUndefined();
    expect(text(expand(<TapFields {...props(naked)} />))).toContain('LC を動かしたか');
    // #165 AC-9: 「最大損失まで」では逆指値の未設定の切り替えを出さない（LC の価格の形では出す）
    expect(byId(lc, 'record-stop-not-placed')).toBeUndefined();
    expect(byId(expand(<LcFields {...props(naked)} />), 'record-stop-not-placed')).toBeDefined();
  });
  it('#202 例 #5・AC-1・AC-2: 「最大損失まで」は LC を入る前に決めていたかを聞かず、本文は決めていた（true）。前からの記録の編集だけ聞く', () => {
    const fresh: Draft = { ...spread, lcDecided: null };
    const taps = text(expand(<TapFields {...props(fresh)} />));
    expect(taps).not.toContain('LC を入る前に決めていたか');
    const body = readDraft(fresh, ctx).body;
    expect(body?.lcDecidedBeforeEntry).toBe(true);
    expect(body?.riskPlan).toBe('maxLoss');
    const lc = expand(<LcFields {...props(fresh)} />);
    expect(text(lc)).not.toContain('LC を入る前に決めていたか');
    expect(text(byId(lc, 'record-lc-late') as El)).toBe(
      'エントリー後に決めた価格は入れず「LC なし」へ',
    );
    // 前からの記録の編集（askLcDecided）: 添えの代わりに LC の行の下で問い、理由の 1 行を添える
    const asked = expand(<LcFields {...props(fresh)} askLcDecided />);
    expect(text(asked)).toContain('LC を入る前に決めていたか');
    expect(byId(asked, 'record-lc-late')).toBeUndefined();
    expect(text(byId(asked, 'record-lc-decided-hint') as El)).toBe(
      '後から書いた LC として保存した記録です',
    );
    expect(text(expand(<TapFields {...props(fresh)} askLcDecided />))).not.toContain(
      'LC を入る前に決めていたか',
    );
  });
  it('#171: 「最大損失まで」で止まった LC の欄を押すと「最大損失まで」を外す（トグルを押し直したのと同じ）', () => {
    const got: unknown[] = [];
    const tree = expand(<LcFields {...props(spread)} onUpdate={(a) => got.push(a)} />);
    const lc = byId(tree, 'record-lc') as El;
    expect(lc.props.readOnly).toBe(true);
    expect(lc.props.disabled).toBeFalsy();
    expect(lc.props.placeholder).toBe(MAX_LOSS_LABEL);
    expect(text(byId(tree, 'record-lc-lock') as El)).toBe(
      '最大損失まで を選んでいます。押すと価格を入れられます',
    );
    const el = { readOnly: true, blur: noop, focus: noop };
    (lc.props.onClick as (e: unknown) => void)({ currentTarget: el });
    const toggle = byId(tree, 'record-lc-maxloss') as El;
    (toggle.props.onClick as () => void)();
    expect(got).toEqual([
      { type: 'set', field: 'lcMaxLoss', value: false },
      { type: 'set', field: 'lcMaxLoss', value: false },
    ]);
    // 外した形は止めない
    const opened = expand(<LcFields {...props({ ...spread, lcMaxLoss: false })} />);
    expect((byId(opened, 'record-lc') as El).props.readOnly).toBeUndefined();
  });
  it('売りの裸で 1R が出ないときは見込みの欄を LC の枠に、ほかは「ほかの欄」', () => {
    const lcNaked = expand(<LcFields {...props(naked)} />);
    expect(byId(lcNaked, 'record-loss-plan')).toBeDefined();
    expect(text(lcNaked)).toContain(LOSS_PLAN_HINT);
    expect(byId(expand(<TradeMoreBody {...props(naked)} />), 'record-loss-plan')).toBeUndefined();
    // 「最大損失まで」の買いのスプレッドは見込みを持たない（どちらにも出さない）
    expect(byId(expand(<LcFields {...props(spread)} />), 'record-loss-plan')).toBeUndefined();
    expect(byId(expand(<TradeMoreBody {...props(spread)} />), 'record-loss-plan')).toBeUndefined();
    const spreadLc = { ...spread, lcMaxLoss: false, lc: '37500', lcMove: 'none' as const };
    expect(byId(expand(<TradeMoreBody {...props(spreadLc)} />), 'record-loss-plan')).toBeDefined();
  });
  it('先物の欄は今のまま（数量・L / S・イン・決済）', () => {
    const tree = expand(
      <TradeCoreFields
        draft={EMPTY_DRAFT}
        errors={{}}
        instruments={[]}
        marks={{}}
        onUpdate={noop}
      />,
    );
    expect(byId(tree, 'record-quantity')).toBeDefined();
    expect(text(tree)).toContain('L ロング');
    expect(byId(tree, 'record-legs')).toBeUndefined();
    expect(labels(tree)).toEqual(expect.arrayContaining(['イン', '決済']));
  });
});

describe('レッグの部品', () => {
  it('一覧: 誤り・未入力は右の添え、10 本で [＋ レッグ] を押せない', () => {
    const legs = Array.from({ length: 10 }, (_, i) => leg({ strike: String(36_000 + i * 100) }));
    const tree = expand(
      <LegList legs={legs} errors={[{ strike: 'x' }]} onOpen={noop} onAdd={noop} />,
    );
    const metas = all(tree, (e) => e.props.class === 'rowlink__meta').map((e) => text(e));
    expect(metas[0]).toBe('誤りあり');
    expect(metas[1]).toBe('未入力あり');
    expect((byId(tree, 'record-legs-add') as El).props.disabled).toBe(true);
  });
  it('1 本の欄: [満期で消滅] は押す形（aria-pressed）、[このレッグを削除]', () => {
    const tree = expand(
      <LegEditor leg={leg({ expired: true })} index={1} onChange={noop} onRemove={noop} />,
    );
    expect((byId(tree, 'leg-1-expired') as El).props['aria-pressed']).toBe('true');
    expect(text(byId(tree, 'leg-1-remove') as El)).toContain('このレッグを削除');
    expect(labels(tree)).toEqual(
      expect.arrayContaining(['P', '買い', '売り', '限月', '行使価格', '枚数', 'イン', '決済']),
    );
  });
});

describe('判定の枠・詳細・一覧（AC-6・AC-7・AC-10・AC-11）', () => {
  const stored = (d: Draft): StoredTrade => {
    const r = readDraft(d, ctx);
    if (!r.body) throw new Error('本文が無い');
    return {
      id: 'T9',
      schemaVersion: 2,
      createdAt: 1,
      updatedAt: 1,
      record: { ...r.body, instrumentId: XYZ.id },
      snapshot: {
        instrument: {
          multiplier: 1_000,
          quantityStep: 1,
          priceCurrency: 'JPY',
          underlyingKind: 'index',
          productForm: 'option',
        },
        capitalYen: 20_000_000,
        riskTolerancePct: 1,
        accountCurrency: 'JPY',
      },
    };
  };
  it('判定の枠に 1R の出どころと最大損失の 1 行、「最大損失まで」の A の注記', () => {
    const t = stored(spread);
    const tree = expand(<Verdict summary={summarize(t)} side={t.record.side} />);
    const s = text(tree);
    expect(s).toContain('1R は最大損失から');
    expect(s).toContain('最大損失 250,000円');
    expect(s).toContain('最大損失までの計画どおり');
    expect(s).not.toContain('決めた LC で切れた');
  });
  it('売りの裸は「最大損失は定まらない（売りの裸）」。向きの食い違いは警告の 1 行', () => {
    const s = text(expand(<Verdict summary={summarize(stored(naked))} side="L" />));
    expect(s).toContain('最大損失は定まらない（売りの裸）');
    const call = {
      ...naked,
      legs: [
        leg({
          optionType: 'C',
          strike: '40000',
          side: 'sell',
          quantity: '1',
          entryPrice: '100',
          exitPrice: '20',
        }),
      ],
    };
    expect(text(expand(<Verdict summary={summarize(stored(call))} side="L" />))).toContain(
      SIDE_MISMATCH,
    );
  });
  it('詳細のレッグの表: 狭い列のカードと広い列の表に同じ行（損益は無色）', () => {
    const tree = expand(<LegTable rows={legRows(stored(spread))} />);
    expect(all(tree, (e) => e.props.class === 'legtable__card').map((e) => text(e))).toEqual([
      '買い 1 · P 38,000 · 2027-01400 → 300−100,000円',
      '売り 1 · P 37,000 · 2027-01150 → 180−30,000円',
    ]);
    const cells = all(tree, (e) => e.type === 'tr').map((r) =>
      all(r.children, (e) => e.type === 'td' || e.type === 'th').map((c) => text(c)),
    );
    expect(cells[0]).toEqual(['限月', 'P / C', '行使価格', '売買', '枚数', 'イン', '決済', '損益']);
    expect(cells[1]).toEqual(['2027-01', 'P', '38,000', '買い', '1', '400', '300', '−100,000円']);
  });
  it('一覧の行: 「銘柄 · S · レッグ 2」', () => {
    const row = tradeRow(stored(spread), [XYZ]);
    expect(row.legsText).toBe('レッグ 2');
    const tree = expand(<TradeRow row={row} />);
    expect(text(all(tree, (e) => e.props.class === 'traderow__head')[0] as El)).toBe(
      '架空指数XYZオプションSレッグ 2',
    );
    expect(row.label).toContain('レッグ 2');
  });

  it('詳細の画面: レッグを持つ取引だけ判定のカードの下にレッグの表（#131 の 1 画面の形）', () => {
    const detail = (t: StoredTrade) =>
      expand(
        <TradeDetailView
          id={t.id}
          state={{
            phase: 'ready',
            trade: t,
            instruments: [XYZ],
            accounts: [],
            instrumentName: XYZ.name,
            summary: summarize(t),
            charts: { entry: { phase: 'none' }, exit: { phase: 'none' } },
          }}
          hidden={new Set()}
          notFound={notFoundState()}
          onDelete={noop}
          onReloadChart={noop}
          onReload={noop}
          onRelogin={noop}
        />,
      );
    const t = stored(spread);
    const tree = detail(t);
    expect(byId(tree, LEG_TABLE_TITLE_ID)).toBeDefined();
    expect(all(tree, (e) => e.props.class === 'legtable__card')).toHaveLength(2);
    const { legs: _legs, ...plain } = t.record;
    expect(byId(detail({ ...t, record: plain }), LEG_TABLE_TITLE_ID)).toBeUndefined();
  });

  it('レビュー B1: 「最大損失まで」の取引も「LC を入る前に決めていたか」を札と「すべての欄」に出し（C の原因が見える）、LC を動かしたかは出さない', () => {
    const t = stored({ ...spread, lcDecided: false });
    expect(t.record.riskPlan).toBe('maxLoss');
    const taps = tapAnswers(t, summarize(t).judgment);
    expect(taps.map((x) => x.label)).toEqual(['LC を入る前に決めていたか', '時間足を変えたか']);
    expect(taps[0]).toMatchObject({ value: '決めていない', offPlan: true });
    const rows = new Map(recordFields(t, XYZ.name).map((r) => [r.label, r.value]));
    expect(rows.get('LC（原資産）')).toBe('最大損失まで');
    expect(rows.get('LC を入る前に決めていたか')).toBe('決めていない');
    expect(rows.has('LC を動かしたか')).toBe(false);
    // イン / 決済は原資産、数量（使わない 1）の代わりにレッグの本数、1R の決め方
    expect(rows.get('エントリー時の原資産')).toBe('38,200');
    expect(rows.get('決済時の原資産')).toBe('38,100');
    expect(rows.has('イン')).toBe(false);
    expect(rows.has('数量')).toBe(false);
    expect(rows.get('レッグ')).toBe('2 本');
    expect(rows.get('1R の決め方')).toBe('最大損失');
  });
  it('見込みを入れた取引は「LC での損失の見込み」の行と 1R の決め方', () => {
    const rows = new Map(
      recordFields(stored({ ...naked, lcLossPlan: '150000' }), XYZ.name).map((r) => [
        r.label,
        r.value,
      ]),
    );
    expect(rows.get('LC での損失の見込み')).toBe('150,000円');
    expect(rows.get('1R の決め方')).toBe('LC での損失の見込み');
    expect(rows.get('LC（原資産）')).toBe('37,500');
    expect(rows.has('LC を動かしたか')).toBe(true);
  });
  it('レビュー 5: 明細のオプションの行はプレミアムの価格・向き・枚数を取引の欄へ入れない', () => {
    const res = parseReadResponse({
      kind: 'statement',
      rows: [
        {
          symbol: '架空指数XYZ',
          side: 'S',
          entryPrice: 150,
          exitPrice: 50,
          quantity: 1,
          pnl: 100000,
          pnlCurrency: 'JPY',
          option: { underlying: 'XYZ', expiry: '2027-01', putCall: 'P', strike: 36000 },
        },
      ],
    });
    const row = res?.rows[0];
    if (!row) throw new Error('行が無い');
    // option は検査した形で写す（API の putCall は put / call。'P' は形の外なので null。#118）
    expect(row.option).toMatchObject({ underlying: 'XYZ', expiry: '2027-01', putCall: null });
    const f = fillFromRow(EMPTY_DRAFT, row, new Set());
    expect(f.draft).toMatchObject({ side: null, entryPrice: '', exitPrice: '', quantity: '' });
    expect(f.draft.pnlYen).toBe('100000');
  });

  describe('編集の画面（取引の欄のシートの段 leg。保存の本文にレッグを載せる = #116 の 409 legsMissing を避ける）', () => {
    async function open() {
      const t = stored(spread);
      const fake = createFakeApi({ trades: [t], instruments: [XYZ], capitalYen: 20_000_000 });
      const c = createEditController({ api: fake.api, id: t.id });
      await c.load();
      const opened: unknown[] = [];
      const removed: LegUndo[] = [];
      let undone = 0;
      const tree = (sheet: EditSheet | null, legUndo: LegUndo | null = null) =>
        expand(
          <TradeEditView
            id={t.id}
            state={c.getState()}
            hidden={new Set()}
            notFound={notFoundState()}
            onUpdate={c.update}
            onSave={noop}
            onReload={noop}
            onRelogin={noop}
            sheet={sheet}
            onSheet={(x) => opened.push(x)}
            legUndo={legUndo}
            onLegRemoved={(u) => removed.push(u)}
            onLegUndo={() => undone++}
          />,
        );
      return { t, fake, c, tree, opened, removed, undone: () => undone };
    }
    const fieldsSheet = (tree: Node[]) =>
      all(tree, (e) => e.props['data-sheet'] === EDIT_SHEET_ID.fields)[0] as El;

    it('要約は「レッグ 2」、取引の欄はレッグの一覧。行を押すとそのレッグの段、[＋ レッグ] は写した行を足して開く', async () => {
      const { c, tree, opened } = await open();
      const main = tree({ kind: 'fields', step: 'main' });
      expect(text(byId(main, 'edit-summary') as El)).toContain('レッグ 2');
      const sheet = fieldsSheet(main);
      expect(labels([sheet])).not.toContain('数量');
      const row = byId([sheet], `${LEG_LIST_ID}-1`) as El;
      (row.props.onClick as () => void)();
      expect(opened.at(-1)).toEqual({ kind: 'fields', step: 'leg', leg: 1 });
      const add = byId([sheet], `${LEG_LIST_ID}-add`) as El;
      (add.props.onClick as () => void)();
      expect(c.getState().draft.legs).toHaveLength(3);
      expect(opened.at(-1)).toEqual({ kind: 'fields', step: 'leg', leg: 2 });
    });

    it('デザインレビュー B1: ［このレッグを削除］ は消したレッグを覚えさせ、一覧に「レッグ 2 を削除しました ［元に戻す］」', async () => {
      const { c, tree, opened, removed, undone } = await open();
      const leg2 = fieldsSheet(tree({ kind: 'fields', step: 'leg', leg: 1 }));
      const before = c.getState().draft.legs[1];
      ((byId([leg2], 'leg-1-remove') as El).props.onClick as () => void)();
      expect(removed).toEqual([{ leg: before, index: 1 }]);
      expect(c.getState().draft.legs).toHaveLength(1);
      expect(opened.at(-1)).toEqual({ kind: 'fields', step: 'main' });
      const main = fieldsSheet(tree({ kind: 'fields', step: 'main' }, removed[0] ?? null));
      const status = all([main], (e) => e.props.class === 'legs__removed')[0] as El;
      expect(status.props.role).toBe('status');
      expect(text(status)).toContain('レッグ 2 を削除しました');
      ((byId([main], LEG_UNDO_ID) as El).props.onClick as () => void)();
      expect(undone()).toBe(1);
      // 再レビュー B2: 10 本のときの ［元に戻す］ は押せず、理由を出す
      const tenLegs = Array.from({ length: 10 }, () => c.getState().draft.legs[0] as LegDraft);
      c.update({ type: 'set', field: 'legs', value: tenLegs });
      const full = fieldsSheet(tree({ kind: 'fields', step: 'main' }, removed[0] ?? null));
      expect((byId([full], LEG_UNDO_ID) as El).props.disabled).toBe(true);
      expect(text(all([full], (e) => e.props.class === 'legs__removed')[0] as El)).toContain(
        'レッグが 10 本あるため戻せません',
      );
      c.update({ type: 'set', field: 'legs', value: [...tenLegs, tenLegs[0] as LegDraft] });
      expect(c.getState().read.errors.legs).toBe('レッグは 10 本までです。1 本を削除してください');
      expect(c.getState().read.canSave).toBe(false);
      // ［＋ レッグ］ の読み上げの名前（レビュー 3）
      expect((byId([main], `${LEG_LIST_ID}-add`) as El).props['aria-label']).toBe('レッグを追加');
    });

    it('段 leg: 題「レッグ N」・戻るの印・1 本の欄。直した値は下書きのレッグへ', async () => {
      const { c, tree } = await open();
      const leg2 = fieldsSheet(tree({ kind: 'fields', step: 'leg', leg: 1 }));
      expect(text(leg2)).toContain('レッグ 2');
      expect(text(leg2)).toContain('取引の欄');
      expect(labels([leg2])).toEqual(expect.arrayContaining(['行使価格', '枚数']));
      // 無い番号の段は取引の欄（レッグを消した後など）
      const gone = fieldsSheet(tree({ kind: 'fields', step: 'leg', leg: 9 }));
      expect(all([gone], (e) => e.props.id === 'record-entry')).toHaveLength(1);
      expect(c.getState().draft.legs).toHaveLength(2);
    });

    it('何も変えずに保存した PUT の本文にレッグがそのまま載り、明細の損益も残る', async () => {
      const { t, fake, c } = await open();
      await c.save();
      const put = fake.calls.find((x) => x.method === 'PUT' && x.path === `/api/trades/${t.id}`);
      const body = put?.body as { legs?: unknown[]; statementPnlYen?: number; riskPlan?: string };
      expect(body.legs).toEqual(t.record.legs);
      expect(body.riskPlan).toBe('maxLoss');
      expect(body.statementPnlYen).toBe(t.record.statementPnlYen);
    });
  });
});

describe('記録する画面の 2 段目（振り返る段。取引の欄のシートの段 leg）', () => {
  const record = (d: Draft, sheet: RecordSheet | null, opened: unknown[] = []) =>
    expand(
      RecordView({
        state: {
          phase: 'editing',
          draft: d,
          instruments: [XYZ],
          accounts: ctx.accounts,
          read: readDraft(d, ctx),
          error: null,
          stage: 'review',
        },
        sheet,
        onSheet: (x) => opened.push(x),
        onUpdate: noop,
        onSave: noop,
        onNext: noop,
        onReload: noop,
        onRelogin: noop,
      }),
    );
  const sheetOf = (tree: Node[]) =>
    all(tree, (e) => e.props['data-sheet'] === 'record-fields-sheet')[0] as El;

  it('オプションの銘柄: 要約は「レッグ 2」、取引の欄にレッグの一覧。行を押すと段 leg', () => {
    const opened: unknown[] = [];
    const tree = record(spread, { kind: 'fields', step: 'main' }, opened);
    expect(text(byId(tree, 'record-summary') as El)).toContain('レッグ 2');
    const sheet = sheetOf(tree);
    expect(labels([sheet])).not.toContain('数量');
    ((byId([sheet], `${LEG_LIST_ID}-0`) as El).props.onClick as () => void)();
    expect(opened).toEqual([{ kind: 'fields', step: 'leg', leg: 0 }]);
  });

  it('段 leg: 題「レッグ N」と 1 本の欄', () => {
    const sheet = sheetOf(record(spread, { kind: 'fields', step: 'leg', leg: 1 }));
    expect(text(sheet)).toContain('レッグ 2');
    expect(labels([sheet])).toEqual(expect.arrayContaining(['行使価格', '枚数']));
  });

  it('オプションでない銘柄: レッグの一覧を出さず、数量の欄', () => {
    const fut: Draft = { ...EMPTY_DRAFT, instrumentName: '架空の先物' };
    const sheet = sheetOf(record(fut, { kind: 'fields', step: 'main' }));
    expect(byId([sheet], LEG_LIST_ID)).toBeUndefined();
    expect(labels([sheet])).toContain('数量');
  });
});

describe('明細から読んだポジション（#118。取引の欄のシートの印・まとめ直し）', () => {
  const XYZOP: InstrumentRecord = { ...XYZ, id: 'i-xyzop', name: '架空指数XYZOP' };
  async function read(instruments: readonly InstrumentRecord[] = [XYZOP]) {
    const fake = createFakeApi({
      instruments,
      capitalYen: 20_000_000,
      reads: [
        {
          status: 200,
          body: statementBody([
            optionRowJson({ ...OPT_A1, inferred: true }),
            optionRowJson(OPT_A2),
            optionRowJson(OPT_B1),
          ]),
        },
      ],
    });
    const c = createRecordController({
      api: fake.api,
      now: () => new Date(2026, 11, 24, 10, 0).getTime(),
      prepare: async () => ({ ok: true, image: preparedImage(fakePreview()) }),
    });
    await c.load();
    await c.readImage(blobOf(pngBytes(1200, 800, 2048)));
    return c;
  }
  const view = (
    c: Awaited<ReturnType<typeof read>>,
    sheet: RecordSheet,
    calls: { split: number[]; merged: number },
  ) =>
    expand(
      RecordView({
        state: c.getState(),
        sheet,
        onSheet: noop,
        onUpdate: noop,
        onSave: noop,
        onNext: noop,
        onReload: noop,
        onRelogin: noop,
        onSplitLeg: (i) => calls.split.push(i),
        onMergeNext: () => {
          calls.merged++;
        },
      }),
    );

  it('レッグの行に「読み取り」と年の札、一覧の下に区切り + 次のポジションの見出し ［このポジションに入れる］', async () => {
    const c = await read();
    const calls = { split: [] as number[], merged: 0 };
    const tree = view(c, { kind: 'fields', step: 'main' }, calls);
    const metas = all(
      [byId(tree, LEG_LIST_ID) as El],
      (e) => e.props.class === 'rowlink__meta',
    ).map((e) => text(e));
    expect(metas).toEqual(['読み取り', '読み取り']);
    // 年を補った限月は注意の札（一覧の 1 本目と 2 段目の要約）
    const warns = all(tree, (e) => String(e.props.class ?? '').includes('field__mark--warn'));
    expect(warns.map((e) => text(e))).toEqual(['限月の年は推定', '限月の年は推定']);
    // 次のポジションの見出し: エントリーの日と 1 本目のレッグの 1 行（区切りの下）
    const next = all(tree, (e) => e.props.class === 'legs__next')[0] as El;
    expect(text(next)).toContain('明細の次のポジション · エントリー 12/9');
    expect(text(next)).toContain('買い 1 · C 41,000 · 2027-01');
    expect((byId(tree, LEG_MERGE_ID) as El).props.disabled).toBe(false);
    // 2 段目の 1 行「次の件も同じ原資産のポジション」
    expect(text(tree)).toContain(NEXT_POSITION_NOTE);
    ((byId(tree, LEG_MERGE_ID) as El).props.onClick as () => void)();
    expect(calls.merged).toBe(1);
    // 明細の行の進み具合は「件目」、スキップは「このポジションをスキップ」
    expect(text(tree)).toContain('1 / 2 件目');
    expect(text(tree)).toContain('このポジションをスキップ');
  });

  it('オプションの銘柄が無ければ、取引の欄に乗数の欄と足す銘柄の 1 行（B1）', async () => {
    const c = await read([]);
    const calls = { split: [] as number[], merged: 0 };
    const tree = view(c, { kind: 'fields', step: 'main' }, calls);
    expect(byId(tree, NEW_MULTIPLIER_ID)).toBeDefined();
    expect(text(tree)).toContain(newInstrumentText('架空指数XYZOPオプション', 'JPY'));
    expect(
      byId(view(await read(), { kind: 'fields', step: 'main' }, calls), NEW_MULTIPLIER_ID),
    ).toBeUndefined();
  });

  it('レッグの段: 年を補った限月の 1 行と ［別のポジションにする］', async () => {
    const c = await read();
    const calls = { split: [] as number[], merged: 0 };
    const tree = view(c, { kind: 'fields', step: 'leg', leg: 0 }, calls);
    expect(text(tree)).toContain(YEAR_INFERRED_HINT);
    ((byId(tree, 'leg-0-split') as El).props.onClick as () => void)();
    expect(calls.split).toEqual([0]);
    // 1 本のポジションでは出さない
    c.splitLeg(1);
    const one = view(c, { kind: 'fields', step: 'leg', leg: 0 }, calls);
    expect(byId(one, 'leg-0-split')).toBeUndefined();
  });
});

describe('レッグの一覧の部品（#118 のデザインレビュー 3・4）', () => {
  const next = { legs: 2, head: '売り 1 · P 34,000 · 2027-01', opened: '12/9' };
  it('入れると 10 本を超えるときは押せず、理由の 1 行', () => {
    const legs = Array.from({ length: 9 }, () => leg({}));
    const tree = expand(
      <LegList legs={legs} onOpen={noop} onAdd={noop} nextPosition={next} onMergeNext={noop} />,
    );
    expect((byId(tree, LEG_MERGE_ID) as El).props.disabled).toBe(true);
    expect(text(tree)).toContain('レッグは 10 本までです');
    expect(text(tree)).toContain('売り 1 · P 34,000 · 2027-01（ほか 1 本）');
  });
  it('［別のポジションにする］ は区切りの上の tonal、削除は区切りの下。分けた後の知らせ', () => {
    const tree = expand(
      <LegEditor leg={leg({})} index={0} onChange={noop} onRemove={noop} onSplit={noop} />,
    );
    const btns = all(tree, (e) => e.type === 'button' || e.type === 'hr').map((e) =>
      e.type === 'hr' ? 'hr' : String(e.props.id),
    );
    expect(btns.slice(-3)).toEqual(['leg-0-split', 'hr', 'leg-0-remove']);
    expect(String((byId(tree, 'leg-0-split') as El).props.class)).toContain('tonal');
    const list = expand(
      <LegList
        legs={[leg({})]}
        onOpen={noop}
        onAdd={noop}
        notice="レッグ 2 を別のポジションにしました"
      />,
    );
    expect(text(list)).toContain('レッグ 2 を別のポジションにしました');
  });
});
