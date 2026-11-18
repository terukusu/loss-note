// AI の利用状況のカードの描画（Issue #62 の AC-5・AC-6・AC-7）。DOM のライブラリを使わず、hook を持たない
// AiUsageView を要素の木に展開して見る。値はすべて架空
import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { AiUsageCard, AiUsageView } from '../../ui/src/components/AiUsage';
import {
  type AiUsageBody,
  AMOUNT_REACHED_TEXT,
  BYPASS_TEXT,
  NEAR_SUMMARY,
  REACHED_SUMMARY,
  USAGE_INTRO,
  USAGE_LOAD_FAILED,
  usageView,
} from '../../ui/src/lib/ai-usage';
import type { AiUsageState } from '../../ui/src/lib/ai-usage-controller';
import { AUTH_EXPIRED } from '../../ui/src/lib/request';
import { Settings, SettingsScreen } from '../../ui/src/pages/Settings';

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

const noop = () => {};
const LIMITS = { count: 30, userMicroUsd: 1_000_000, dailyMicroUsd: 2_000_000 };

function readyState(over: Partial<AiUsageBody> = {}): AiUsageState {
  const b: AiUsageBody = {
    today: { date: '2026-11-18', count: 3, microUsd: 120_000 },
    month: { month: '2026-11', count: 5, microUsd: 200_000 },
    limits: LIMITS,
    bypass: false,
    blocked: { count: false, microUsd: false },
    ...over,
  };
  return { phase: 'ready', view: usageView(b) };
}

const render = (
  state: AiUsageState,
  over: { onReload?: () => void; onRelogin?: () => void } = {},
) => expand(AiUsageView({ state, onReload: noop, onRelogin: noop, ...over }));

const cls = (e: El) => String(e.props.class ?? '');

describe('利用状況のカード', () => {
  it('#2: 残りを主に、使った量と割合を添える。今月は同じ行の組み。説明と全体の上限の値（AC-5・AC-6）', () => {
    const tree = render(readyState());
    const t = text(tree);
    for (const s of [
      'AI の利用状況',
      USAGE_INTRO,
      '今日（11 月 18 日）',
      'あと 27 回',
      '3 / 30 回 使用・10%',
      'あと 0.88 USD',
      '0.12 / 1.00 USD 使用・12%',
      '今月（11 月）',
      '5 回',
      '0.20 USD',
      '2.00 USD',
    ]) {
      expect(t).toContain(s);
    }
    expect(t).not.toContain(BYPASS_TEXT);
    expect(t).not.toContain('Console');
    // 近い・届いたでないときはまとめの行が無い
    expect(all(tree, (e) => cls(e) === 'usage__summary')).toHaveLength(0);
    // 主の値は残り（太字の値の部品）。今日と今月で同じ行の組み（.usage__row / .usage__label）
    const values = all(tree, (e) => cls(e) === 'usage__value').map(text);
    expect(values).toEqual(['あと 27 回', 'あと 0.88 USD', '5 回', '0.20 USD']);
    expect(all(tree, (e) => cls(e) === 'usage__label').map(text)).toEqual([
      '回数',
      '金額（目安）',
      '回数',
      '金額（目安）',
    ]);
    // 棒は読み上げに出さない（同じ値を文字で出す）。幅は属性（style 属性を使わない）
    const bars = all(tree, (e) => e.type === 'svg' && cls(e) === 'usage__bar');
    expect(bars).toHaveLength(2);
    for (const b of bars) expect(b.props['aria-hidden']).toBe('true');
    const fills = all(tree, (e) => cls(e) === 'usage__fill').map((e) => e.props.width);
    expect(fills).toEqual(['10%', '12%']);
    expect(all(tree, (e) => 'style' in e.props)).toHaveLength(0);
  });

  it('#3: 近いだけなら、まとめの行に「上限に近づいています」と上限の記号', () => {
    const tree = render(
      readyState({ today: { date: '2026-11-18', count: 24, microUsd: 300_000 } }),
    );
    const summary = all(tree, (e) => cls(e) === 'usage__summary');
    expect(summary).toHaveLength(1);
    expect(summary[0]?.props['data-status']).toBe('near');
    expect(text(summary)).toBe(NEAR_SUMMARY);
    expect(all(summary, (e) => e.type === 'svg')).toHaveLength(1);
  });

  it('#5: 金額で止まるときは、見出しのすぐ下のまとめの行で届いたと出し、使えない残りを棒の上に点線の枠で示す', () => {
    const tree = render(
      readyState({
        today: { date: '2026-11-18', count: 3, microUsd: 721_265 },
        blocked: { count: false, microUsd: true },
      }),
    );
    const group = all(tree, (e) => cls(e) === 'usage__group')[0];
    const kids = (group?.children ?? []).filter((n): n is El => typeof n !== 'string');
    expect(kids.map((k) => cls(k))[0]).toBe('usage__heading');
    expect(cls(kids[1] as El)).toBe('usage__summary');
    expect(kids[1]?.props['data-status']).toBe('reached');
    expect(text(kids[1] as El)).toBe(REACHED_SUMMARY);
    expect(text(tree)).toContain(AMOUNT_REACHED_TEXT);
    const rest = all(tree, (e) => cls(e) === 'usage__rest');
    expect(rest.map((e) => [e.props.x, e.props.width])).toEqual([['72%', '28%']]);
  });

  it('#4: 回数で届いたときは棒が 100%（使えない残りの枠は無い）', () => {
    const tree = render(
      readyState({
        today: { date: '2026-11-18', count: 30, microUsd: 400_000 },
        blocked: { count: true, microUsd: false },
      }),
    );
    expect(all(tree, (e) => cls(e) === 'usage__fill').map((e) => e.props.width)).toEqual([
      '100%',
      '40%',
    ]);
    expect(all(tree, (e) => cls(e) === 'usage__rest')).toHaveLength(0);
    expect(text(tree)).toContain(REACHED_SUMMARY);
  });

  it('#8: 上限を受けない利用者は「あなたの 1 日の上限: なし」と全体の上限の 1 行、値だけ（棒・割合なし）', () => {
    const tree = render(
      readyState({
        today: { date: '2026-11-18', count: 40, microUsd: 1_500_000 },
        month: { month: '2026-11', count: 52, microUsd: 1_900_000 },
        bypass: true,
        limits: { count: null, userMicroUsd: null, dailyMicroUsd: 2_000_000 },
      }),
    );
    const t = text(tree);
    expect(t).toContain(BYPASS_TEXT);
    expect(t).toContain('2.00 USD');
    expect(t).toContain('40 回');
    expect(t).toContain('1.50 USD');
    expect(t).not.toContain('%');
    expect(all(tree, (e) => e.type === 'svg')).toHaveLength(0);
    expect(all(tree, (e) => cls(e) === 'usage__notes')).toHaveLength(0);
    expect(t).toContain(USAGE_INTRO);
  });

  it('#12: 読み込めないときは決まった文言と [再読み込み]、ログインが切れたら [もう一度ログイン]（AC-7）', () => {
    let reloads = 0;
    const tree = render(
      { phase: 'failed', text: USAGE_LOAD_FAILED, auth: false },
      {
        onReload: () => {
          reloads++;
        },
      },
    );
    const alert = all(tree, (e) => e.props.role === 'alert')[0];
    expect(alert && text(alert)).toBe(USAGE_LOAD_FAILED);
    const btn = all(tree, (e) => e.type === 'button')[0];
    expect(btn && text(btn)).toBe('再読み込み');
    (btn?.props.onClick as (() => void) | undefined)?.();
    expect(reloads).toBe(1);

    const auth = render({ phase: 'failed', text: AUTH_EXPIRED, auth: true });
    expect(text(auth)).toContain(AUTH_EXPIRED);
    expect(text(all(auth, (e) => e.type === 'button'))).toBe('もう一度ログイン');
  });

  it('読み込み中は状態の文だけ', () => {
    const tree = render({ phase: 'loading' });
    expect(all(tree, (e) => e.props.role === 'status').map(text)).toEqual(['読み込んでいます…']);
  });

  it('カードのクラスに判定の段のクラス・バッジを使わない（AC-7）', () => {
    const tree = render(
      readyState({
        today: { date: '2026-11-18', count: 24, microUsd: 721_265 },
        blocked: { count: false, microUsd: true },
      }),
    );
    const bad = all(tree, (e) => /\b(badge|tier|verdict)/.test(cls(e)));
    expect(bad).toHaveLength(0);
  });

  it('設定の画面では口座・銘柄のカードと別の部品（読めなくてもほかのカードの状態に触れない。AC-7）', () => {
    const vn = Settings({
      theme: 'dark',
      onTheme: noop,
      onSignOut: noop,
      signOutBusy: false,
      signOutError: null,
    }) as VNode<{ children: VNode[] }>;
    const types = (vn.props.children as VNode[]).map((c) => c?.type);
    expect(types).toContain(SettingsScreen);
    expect(types).toContain(AiUsageCard);
    expect(types.indexOf(AiUsageCard)).toBe(types.indexOf(SettingsScreen) + 1);
  });
});
