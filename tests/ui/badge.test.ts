// C-2 判定のバッジ（Issue #3 の例の表 J1〜J6・R2）
import { describe, expect, it } from 'vitest';
import type { Grade } from '../../core/judge';
import { Icon } from '../../ui/src/components/Icon';
import { JudgeBadge } from '../../ui/src/components/JudgeBadge';
import { badgeModel, TIER_SYMBOL, TIERS } from '../../ui/src/lib/badge';

describe('badgeModel（例の表 J1〜J6）', () => {
  it.each([
    ['J1', 'A', 'A いい損失', 'plan'],
    ['J2', 'safeWin', '計画どおりの勝ち', 'plan'],
    ['J3', 'B', 'B 悪い損失', 'break'],
    ['J4', 'riskyWin', '危ない勝ち', 'break'],
    ['J5', 'C', 'C 極悪な損失', 'worst'],
    ['J6', null, '判定なし', 'neutral'],
  ] as const)('%s: %s → 「%s」・%s の段', (_id, grade, label, tier) => {
    const m = badgeModel(grade);
    expect(m.label).toBe(label);
    expect(m.tier).toBe(tier);
  });

  it('同じ段は同じ記号とクラス（J1 = J2、J3 = J4）', () => {
    expect(badgeModel('A').symbol).toBe(badgeModel('safeWin').symbol);
    expect(badgeModel('A').className).toBe(badgeModel('safeWin').className);
    expect(badgeModel('B').symbol).toBe(badgeModel('riskyWin').symbol);
    expect(badgeModel('B').className).toBe(badgeModel('riskyWin').className);
  });

  it('違う段は違う記号とクラス（4 段が 1 対 1）', () => {
    const symbols = TIERS.map((t) => TIER_SYMBOL[t]);
    expect(new Set(symbols).size).toBe(TIERS.length);
    const grades: (Grade | null)[] = ['A', 'B', 'C', null];
    const classes = grades.map((g) => badgeModel(g).className);
    expect(new Set(classes).size).toBe(4);
    for (const g of grades) {
      const m = badgeModel(g);
      expect(m.className).toBe(`badge badge--${m.tier}`);
      expect(m.symbol).toBe(TIER_SYMBOL[m.tier]);
    }
  });

  it('部品はラベルを文字で出し、記号は読み上げから隠す', () => {
    const tree = JSON.stringify(JudgeBadge({ grade: 'riskyWin' }));
    expect(tree).toContain('危ない勝ち');
    expect(tree).toContain('badge badge--break');
    // 記号は段の形の Icon。Icon は aria-hidden の SVG で、色は currentColor
    expect(tree).toContain('"name":"triangle"');
    // 開発時の JSX 変換が付ける __self（= this）・__source は循環するので外す
    const icon = JSON.stringify(Icon({ name: 'triangle' }), (k, v) =>
      k === '__self' || k === '__source' ? undefined : v,
    );
    expect(icon).toContain('"aria-hidden":"true"');
    expect(icon).toContain('"stroke":"currentColor"');
  });
});
