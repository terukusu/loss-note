// 両建てのまとまりの描画（#267。Issue の AC-1・AC-3・AC-5・AC-8・AC-9）。DOM のライブラリを使わず、部品の関数を呼んで要素の木に
// 展開して見る（View と部品は hook を持たない。Link は a として止める）。値はすべて架空（設計書 5.8 の例と同じ）
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import type { StoredTrade } from '../../core/record';
import { GroupPickerBody } from '../../ui/src/components/GroupParts';
import { TradeRow } from '../../ui/src/components/TradeRow';
import type { GroupScreenState, PickerState } from '../../ui/src/lib/group-controller';
import {
  groupIndexOf,
  groupRowInfo,
  groupStateOf,
  pickerSections,
  previewLine,
  rolesOf,
  volumeLine,
} from '../../ui/src/lib/position-group';
import { summarize } from '../../ui/src/lib/record-form';
import { Link } from '../../ui/src/lib/router';
import type { DetailState, GroupDetail } from '../../ui/src/lib/trade-detail-controller';
import { tradeRow } from '../../ui/src/lib/trade-view';
import { notFoundState, TradeDetailView } from '../../ui/src/pages/TradeDetail';
import { TradeGroupView } from '../../ui/src/pages/TradeGroup';
import { cfd, future, groupOf, h1, h2, INSTRUMENTS } from './helpers/group-examples';
import { closedInfoTip } from './helpers/info-tip';

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
  if (typeof vn.type === 'function') return expand((vn.type as (p: unknown) => unknown)(vn.props));
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
  typeof e.props.class === 'string' && (e.props.class as string).split(' ').includes(c);
const noop = () => {};
const EMPTY: ReadonlySet<string> = new Set();
const byId = (...ts: StoredTrade[]) => new Map(ts.map((t) => [t.id, t]));

function detailState(t: StoredTrade, group?: GroupDetail): DetailState {
  return {
    phase: 'ready',
    trade: t,
    instruments: INSTRUMENTS,
    accounts: [],
    instrumentName: 'XYZ 先物',
    summary: summarize(t),
    charts: { entry: { phase: 'none' }, exit: { phase: 'none' } },
    ...(group ? { group } : {}),
  };
}
function detailTree(t: StoredTrade, over: Partial<Parameters<typeof TradeDetailView>[0]> = {}) {
  return expand(
    <TradeDetailView
      id={t.id}
      state={detailState(t)}
      hidden={EMPTY}
      notFound={notFoundState()}
      onDelete={noop}
      onReloadChart={noop}
      onReload={noop}
      onRelogin={noop}
      {...over}
    />,
  );
}

describe('取引の詳細（AC-1・AC-8）', () => {
  it('メンバーの取引は判定のカードを出さず「両建て（本玉）· まとまりの判定 B 悪い損失」の 1 行（押すとまとまりの画面）', () => {
    const { f, c, g } = h2();
    const group: GroupDetail = {
      phase: 'ready',
      state: groupStateOf(g, byId(f, c)),
      byId: byId(f, c),
    };
    const tree = detailTree(f, { state: detailState(f, group) });
    expect(all(tree, hasClass('verdict'))).toEqual([]);
    const line = all(tree, (e) => e.type === 'a' && e.props.id === 'detail-group-line')[0] as El;
    expect(text(line)).toBe('両建て（本玉）· まとまりの判定 B 悪い損失');
    expect(line.props.href).toBe(`/trades/groups/${g.id}`);
    // 決済の代わりの CFD（LC なし）も単独の判定（C）を出さない
    const ct = detailTree(c, { state: detailState(c, group) });
    expect(all(ct, hasClass('verdict'))).toEqual([]);
    expect(text(ct)).toContain('両建て（決済の代わり）· まとまりの判定 B 悪い損失');
  });

  it('操作のシート: メンバーは ［まとまりを見る］ と削除の添え「両建てのまとまりから外れます」、メンバーでなければ ［両建てに結ぶ］', () => {
    const { f, c, g } = h1();
    const group: GroupDetail = {
      phase: 'ready',
      state: groupStateOf(g, byId(f, c)),
      byId: byId(f, c),
    };
    const tree = detailTree(f, { state: detailState(f, group), sheet: { kind: 'actions' } });
    const sheet = all(tree, (e) => e.props['data-sheet'] === 'detail-actions-sheet')[0] as El;
    expect(all([sheet], (e) => e.props.id === 'detail-action-group')[0]?.props.href).toBe(
      `/trades/groups/${g.id}`,
    );
    expect(text(all([sheet], (e) => e.props.id === 'detail-action-delete')[0] as El)).toContain(
      '両建てのまとまりから外れます',
    );
    const plain = future('p', { exitPrice: 38_600 });
    const opened: unknown[] = [];
    const pt = detailTree(plain, { sheet: { kind: 'actions' }, onSheet: (s) => opened.push(s) });
    const link = all(pt, (e) => e.props.id === 'detail-action-link')[0] as El;
    expect(text(link)).toBe('両建てに結ぶ');
    (link.props.onClick as () => void)();
    expect(opened).toEqual([{ kind: 'link' }]);
    // 足を持つ取引には出さない
    const legs = cfd('l', { price: 1, exitPrice: 1, legs: true });
    expect(
      all(
        detailTree(legs, { sheet: { kind: 'actions' } }),
        (e) => e.props.id === 'detail-action-link',
      ),
    ).toEqual([]);
  });

  it('崩れたまとまりは知らせと ［解く］ と単独の判定。まとまりを読んでいる間は判定のカードを出さない', () => {
    const { f, g } = h1();
    let unlinked = 0;
    const group: GroupDetail = { phase: 'ready', state: groupStateOf(g, byId(f)), byId: byId(f) };
    const tree = detailTree(f, { state: detailState(f, group), onUnlinkGroup: () => unlinked++ });
    expect(text(all(tree, hasClass('gbroken'))[0] as El)).toContain(
      '両建てのまとまりが崩れています',
    );
    expect(all(tree, hasClass('verdict'))).toHaveLength(1);
    const btn = all(tree, (e) => e.type === 'button' && text(e) === '解く')[0] as El;
    (btn.props.onClick as () => void)();
    expect(unlinked).toBe(1);
    const loading = detailTree(f, { state: detailState(f, { phase: 'loading' }) });
    expect(all(loading, hasClass('verdict'))).toEqual([]);
    expect(text(loading)).toContain('両建てのまとまりを読み込んでいます');
  });
});

describe('相手を選ぶシート（AC-3）', () => {
  const f = future('f1', { exitPrice: 38_600 });
  const c = cfd('c1', { price: 38_450, exitPrice: 38_620 });
  const sections = pickerSections(f, [c], INSTRUMENTS);
  const body = (selected: string[]) => {
    const state: PickerState = {
      phase: 'ready',
      sections,
      selected,
      mainSide: null,
      saving: false,
      error: null,
    };
    const members = rolesOf(f, selected.length ? [c] : [], 'L');
    return expand(
      <GroupPickerBody
        prefix="t"
        base={f}
        state={state}
        members={members}
        instruments={INSTRUMENTS}
        volume={volumeLine(members)}
        preview={previewLine(members)}
        accountName={() => undefined}
        onToggle={noop}
        onSwap={noop}
        onLink={noop}
        onRetry={noop}
      />,
    );
  };

  it('選ぶ前は ［結ぶ］ を押せず理由を出す。選ぶと量の比べ・判定の 1 行・押せる ［結ぶ］', () => {
    const before = body([]);
    expect(text(before)).toContain('本玉: XYZ 先物 L 1 · 量 1,000');
    const btn = all(before, (e) => e.type === 'button' && text(e) === '結ぶ')[0] as El;
    expect(btn.props.disabled).toBe(true);
    expect(text(before)).toContain('相手を選んでください');
    const cand = all(before, hasClass('gpick__cand'))[0] as El;
    expect(cand.props['aria-pressed']).toBe('false');
    const after = body(['c1']);
    expect(text(after)).toContain('決済の代わり 量 1,000 / 本玉 量 1,000 · 揃っています');
    expect(all(after, hasClass('gpick__cand'))[0]?.props['aria-pressed']).toBe('true');
    expect(
      (all(after, (e) => e.type === 'button' && text(e) === '結ぶ')[0] as El).props.disabled,
    ).toBe(false);
    expect(text(all(after, hasClass('gpick__vline'))[0] as El)).toContain('計画どおりの勝ち');
  });
});

describe('まとまりの画面（AC-5）', () => {
  const view = (
    state: GroupScreenState,
    over: Partial<Parameters<typeof TradeGroupView>[0]> = {},
  ) =>
    expand(
      <TradeGroupView
        state={state}
        sheet={null}
        onSheet={noop}
        draft={{ price: '', orderType: '', reason: '' }}
        draftError={null}
        onDraft={noop}
        onSaveExit={noop}
        onGapSlip={noop}
        onUnlink={noop}
        onReload={noop}
        onRelogin={noop}
        {...over}
      />,
    );
  const ready = (g: ReturnType<typeof h1>['g'], ts: StoredTrade[]): GroupScreenState => ({
    phase: 'ready',
    group: g,
    state: groupStateOf(g, byId(...ts)),
    byId: byId(...ts),
    instruments: INSTRUMENTS,
    accounts: [],
    saving: null,
    error: null,
  });

  it('H1: 題・判定のカード（+1.5R）・固定の 1 行・メンバーの行（押すとその取引の詳細）', () => {
    const { f, c, g } = h1();
    const tree = view(ready(g, [f, c]));
    expect(text(all(tree, (e) => e.type === 'h1')[0] as El)).toBe('両建て · XYZ 先物 L');
    expect(text(all(tree, hasClass('verdict'))[0] as El)).toContain('計画どおりの勝ち');
    expect(text(all(tree, hasClass('gfix__line'))[0] as El)).toContain('XYZ CFD S 100');
    expect(text(all(tree, hasClass('gfix__line'))[0] as El)).toContain('38,450');
    const hrefs = all(
      all(tree, hasClass('gmembers'))[0]?.children ?? [],
      (e) => e.type === 'a',
    ).map((a) => a.props.href);
    expect(hrefs).toEqual(['/trades/f1', '/trades/c1']);
    // 持ち続けたが当たらないので「窓・滑りでしたか」は聞かない
    expect(text(tree)).not.toContain('窓・滑りでしたか');
  });

  it('H2: 持ち続けたが当たり未回答なら判定のカードの中で「窓・滑りでしたか」を聞く', () => {
    const { f, c, g } = h2();
    let answered: boolean | null = null;
    const tree = view(ready(g, [f, c]), { onGapSlip: (a) => (answered = a) });
    const card = all(tree, hasClass('verdict'))[0] as El;
    expect(text(card)).toContain('窓・滑りでしたか');
    const radios = all([card], (e) => e.type === 'input' && e.props.type === 'radio');
    ((radios[1] as El).props.onChange as () => void)();
    expect(answered).toBe(false);
  });

  it('通貨が違う損益は通貨ごとの 1 行（換算しない）', () => {
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
    const tree = view(ready(g, [f, c]));
    expect(text(tree)).toContain('損益 +90,000円 · −250.00 USD');
  });

  it('崩れたまとまりは知らせと ［解く］ と読めたメンバー', () => {
    const { f, g } = h1();
    const tree = view(ready(g, [f]));
    expect(text(tree)).toContain('両建てのまとまりが崩れています');
    expect(all(tree, hasClass('verdict'))).toEqual([]);
    expect(all(tree, (e) => e.type === 'a' && e.props.href === '/trades/f1')).toHaveLength(1);
  });

  it('無いまとまりは「このまとまりは見つかりません」', () => {
    expect(text(view({ phase: 'notFound' }))).toContain('このまとまりは見つかりません');
  });
});

describe('一覧の行の部品（AC-9）', () => {
  it('最初の本玉の行は札と R と「両建て」、決済の代わりの行は役割の文字で R・リスクの段が無い', () => {
    const { f, c, g } = h2();
    const index = groupIndexOf([g], byId(f, c));
    const lead = expand(<TradeRow row={tradeRow(f, INSTRUMENTS, [], groupRowInfo(f, index))} />);
    expect(text(lead)).toContain('両建て');
    expect(text(lead)).toContain('B 悪い損失');
    expect(text(all(lead, hasClass('traderow__nums'))[0] as El)).toContain('−1.5R');
    const member = expand(<TradeRow row={tradeRow(c, INSTRUMENTS, [], groupRowInfo(c, index))} />);
    expect(text(member)).toContain('決済の代わり');
    expect(all(member, hasClass('traderow__nums'))).toEqual([]);
    expect(text(member)).not.toContain('—');
  });
});

describe('独立レビューの直し（#267 の B1・非 block）', () => {
  it('B1: 決済の代わりのメンバー（単独なら C）の「なぜ」のカードは、まとまりが計画どおりの勝ちなら「なぜ守れたか」・案内なし', () => {
    const { f, c, g } = h1();
    const group: GroupDetail = {
      phase: 'ready',
      state: groupStateOf(g, byId(f, c)),
      byId: byId(f, c),
    };
    // 単独の判定は C（LC なし）
    expect(summarize(c).judgment?.grade).toBe('C');
    const tree = detailTree(c, { state: detailState(c, group) });
    const why = all(tree, hasClass('dwhy'))[0] as El;
    expect(text(all([why], (e) => e.type === 'h2')[0] as El)).toBe('なぜ守れたか');
    expect(all([why], (e) => e.type === 'button' && hasClass('info')(e))).toEqual([]);
  });

  it('B1: まとまりを読んでいる間・読めなかったときの「なぜ」は中立の題（単独の判定で決めない）', () => {
    const { c } = h1();
    for (const group of [{ phase: 'loading' }, { phase: 'failed' }] as GroupDetail[]) {
      const why = all(detailTree(c, { state: detailState(c, group) }), hasClass('dwhy'))[0] as El;
      expect(text(all([why], (e) => e.type === 'h2')[0] as El)).toBe('心理と振り返り');
    }
  });

  it('［解く］ の添えは上書きがあれば「修正ごと」戻ることを言う。崩れたまとまりは戻せない添え', () => {
    const { f, c, g } = h1();
    const st = (gr: typeof g, ts: StoredTrade[]): GroupScreenState => ({
      phase: 'ready',
      group: gr,
      state: groupStateOf(gr, byId(...ts)),
      byId: byId(...ts),
      instruments: INSTRUMENTS,
      accounts: [],
      saving: null,
      error: null,
    });
    const rowOf = (s: GroupScreenState) =>
      text(
        all(
          expand(
            <TradeGroupView
              state={s}
              sheet="actions"
              onSheet={noop}
              draft={{ price: '', orderType: '', reason: '' }}
              draftError={null}
              onDraft={noop}
              onSaveExit={noop}
              onGapSlip={noop}
              onUnlink={noop}
              onReload={noop}
              onRelogin={noop}
            />,
          ),
          (e) => e.props.id === 'group-action-unlink',
        )[0] as El,
      );
    expect(rowOf(st(g, [f, c]))).toContain('8 秒は元に戻せます · 記録・心理は残ります');
    expect(rowOf(st({ ...g, exit: { price: 38_440 } }, [f, c]))).toContain('修正ごと');
    expect(rowOf(st(g, [f]))).toContain('記録・心理・Good / More は残ります');
  });

  it('段の見出しは候補の向きで決まり、先にエントリーした相手を選んでも替わらない', () => {
    const f = future('f1', { exitPrice: 38_600 });
    const c = cfd('c1', { price: 38_450, exitPrice: 38_620 });
    const sections = pickerSections(c, [f], INSTRUMENTS);
    const heads = (selected: string[]) => {
      const state: PickerState = {
        phase: 'ready',
        sections,
        selected,
        mainSide: null,
        saving: false,
        error: null,
      };
      const members = rolesOf(c, selected.length ? [f] : [], selected.length ? 'L' : 'S');
      return all(
        expand(
          <GroupPickerBody
            prefix="t"
            base={c}
            state={state}
            members={members}
            instruments={INSTRUMENTS}
            volume={volumeLine(members)}
            preview={previewLine(members)}
            accountName={() => undefined}
            onToggle={noop}
            onSwap={noop}
            onLink={noop}
            onRetry={noop}
          />,
        ),
        hasClass('gpick__section-title'),
      ).map(text);
    };
    expect(heads([])).toEqual(['逆の向き']);
    expect(heads(['f1'])).toEqual(['逆の向き']);
  });
});
