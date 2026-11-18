// 判定に関わる言葉の用語集のデータ（Issue #57 AC-6・AC-7・AC-8、#76 の用語集・文の中のリンク）
import { describe, expect, it } from 'vitest';
import designMd from '../../docs/design.md?raw';
import { badgeModel } from '../../ui/src/lib/badge';
import {
  GLOSSARY,
  GLOSSARY_GROUPS,
  type GlossaryId,
  glossaryTerm,
  isGlossaryId,
} from '../../ui/src/lib/glossary';
import {
  glossaryAnchor,
  glossaryHref,
  linkSegments,
  plainText,
  rawLinkIds,
  relatedIds,
  termTexts,
} from '../../ui/src/lib/glossary-text';

const IDS: readonly GlossaryId[] = [
  'lc',
  'brokenCondition',
  'tp',
  'oneR',
  'r',
  'risk',
  'riskTolerance',
  'capital',
  'timeframe',
  'gapSlip',
  'lcDecided',
  'lcMove',
  'timeframeChange',
  'ruler',
  'judgment',
];

/** 項目の文をすべてつないだ見える文字（言葉・短い説明・続き・一覧・例。リンクの印は外す） */
function allText(id: GlossaryId): string {
  const t = glossaryTerm(id);
  return [t.term, ...(t.items ?? []).map((i) => i.name), ...termTexts(t)].map(plainText).join('\n');
}

/** 設計書の見出し（## / ###）の節の番号（「3」「5.1」など） */
const DESIGN_SECTIONS = new Set(
  [...designMd.matchAll(/^#{2,3} (\d+(?:\.\d+)?)[.\s]/gm)].map((m) => m[1] ?? ''),
);

describe('用語のデータの形', () => {
  it('15 項目・ID は重複なし・すべての ID がある', () => {
    expect(GLOSSARY).toHaveLength(15);
    expect(GLOSSARY.map((g) => g.id).sort()).toEqual([...IDS].sort());
    expect(isGlossaryId('lc')).toBe(true);
    expect(isGlossaryId('nope')).toBe(false);
  });

  it('短い説明は 1 文・続きは 0〜3 文・一覧と例は任意（例は 1 つまで）・見出しと短い形がある', () => {
    for (const g of GLOSSARY) {
      expect(g.term.length).toBeGreaterThan(0);
      expect(g.label.length).toBeGreaterThan(0);
      const lead = plainText(g.summary);
      expect(lead.endsWith('。')).toBe(true);
      expect(lead.slice(0, -1)).not.toContain('。');
      expect(g.body.length).toBeLessThanOrEqual(3);
      for (const b of g.body) expect(plainText(b).endsWith('。')).toBe(true);
      expect(g.design.length).toBeGreaterThan(0);
    }
  });

  it('JSON にそのまま直せる（関数・undefined を持たない）', () => {
    expect(JSON.parse(JSON.stringify(GLOSSARY))).toEqual(GLOSSARY);
  });

  it('外部の URL・HTML の文字列を持たない（KEEP-6）', () => {
    const s = JSON.stringify(GLOSSARY);
    expect(s).not.toMatch(/https?:|<[a-z/]/i);
  });

  it('知らない ID は例外', () => {
    expect(() => glossaryTerm('nope' as GlossaryId)).toThrow();
  });
});

describe('文の中のリンク（#57 オーナーの要望・#76）', () => {
  it('linkSegments: [[id]] は短い形・[[id|文字]] はその文字、知らない ID は文字のまま', () => {
    expect(linkSegments('決めた [[lc]] で切れた')).toEqual([
      { kind: 'text', text: '決めた ' },
      { kind: 'link', id: 'lc', text: 'LC' },
      { kind: 'text', text: ' で切れた' },
    ]);
    expect(linkSegments('[[capital|資金]]の割合')).toEqual([
      { kind: 'link', id: 'capital', text: '資金' },
      { kind: 'text', text: 'の割合' },
    ]);
    expect(linkSegments('[[nope|なにか]]と[[zzz]]')).toEqual([
      { kind: 'text', text: 'なにか' },
      { kind: 'text', text: 'と' },
      { kind: 'text', text: 'zzz' },
    ]);
    expect(linkSegments('リンクなし')).toEqual([{ kind: 'text', text: 'リンクなし' }]);
    expect(plainText('[[r]] は [[oneR]] で割る')).toBe('R は 1R で割る');
  });

  it('用語集の全文のリンク先はすべて用語集にある（知らない ID 0 件）', () => {
    const unknown = GLOSSARY.flatMap((g) =>
      termTexts(g).flatMap((t) => rawLinkIds(t).filter((id) => !isGlossaryId(id))),
    );
    expect(unknown).toEqual([]);
  });

  it('リンクの印が崩れていない（[[ と ]] が対で、見える文字に残らない）', () => {
    for (const g of GLOSSARY) {
      for (const t of termTexts(g)) {
        expect(plainText(t)).not.toMatch(/\[\[|\]\]/);
      }
    }
  });

  it('関係する言葉: 自分を除いたリンク先。判定・R・物差しから LC へたどれる。どの項目も、ほかのどれかからたどれる', () => {
    expect(relatedIds(glossaryTerm('r'))).toEqual(['oneR', 'lc']);
    for (const id of ['judgment', 'r', 'ruler', 'lcDecided', 'lcMove'] as const) {
      expect(relatedIds(glossaryTerm(id))).toContain('lc');
    }
    const reached = new Set(GLOSSARY.flatMap((g) => relatedIds(g)));
    const orphans = GLOSSARY.map((g) => g.id).filter(
      (id) => !reached.has(id) && !['judgment', 'ruler', 'lcDecided'].includes(id),
    );
    expect(orphans).toEqual([]);
  });

  it('用語集の画面の行き先', () => {
    expect(glossaryAnchor('oneR')).toBe('glossary-oneR');
    expect(glossaryHref('oneR')).toBe('/glossary#glossary-oneR');
    expect(glossaryHref('oneR', '/trades/t1')).toBe('/glossary?from=%2Ftrades%2Ft1#glossary-oneR');
  });
});

describe('用語集の区切りとリンクの見え方（#57 デザインの再レビュー 4・6・7）', () => {
  it('どの項目も 3 つの区切りのどれか。区切りの順に並ぶ', () => {
    const order = GLOSSARY_GROUPS.map((g) => g.id);
    const seen = GLOSSARY.map((g) => order.indexOf(g.group));
    expect(seen.every((i) => i >= 0)).toBe(true);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it('1 文字だけのリンクは無い（押しやすく、何の言葉か分かる）', () => {
    const one = GLOSSARY.flatMap((g) =>
      termTexts(g).flatMap((t) =>
        linkSegments(t).flatMap((x) =>
          x.kind === 'link' && [...x.text].length < 2 ? [`${g.id}:${x.text}`] : [],
        ),
      ),
    );
    expect(one).toEqual([]);
  });

  it('1 つの項目の中で同じ言葉へのリンクは 1 回だけ', () => {
    for (const g of GLOSSARY) {
      const ids = termTexts(g).flatMap((t) =>
        linkSegments(t).flatMap((x) => (x.kind === 'link' ? [x.id] : [])),
      );
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('判定の項目の grade はその名前のバッジ', () => {
    for (const i of glossaryTerm('judgment').items ?? []) {
      expect(i.grade).toBeDefined();
      expect(badgeModel(i.grade ?? null).label).toBe(i.name);
    }
  });

  it('N11: 窓・滑りは「持ち続けた」に数えないだけ（ほかの条件に当たれば B）。LC は「思惑が外れたと確認できる価格」', () => {
    const g = allText('gapSlip');
    expect(g).toContain('「LC で切らずに持ち続けた」には数えません');
    expect(g).toContain('ほかの条件に当たらなければ A いい損失');
    expect(plainText(glossaryTerm('lc').summary)).toBe('思惑が外れたと確認できる価格です。');
  });
});

describe('AC-6: 説明の中身（例 I1・I5・I6・I7・I8）', () => {
  it('I1 時間足を変えたか: 長い足へ = B、短い足へ・そのまま = 判定に影響しない', () => {
    const s = allText('timeframeChange');
    for (const w of ['長い足へ', 'B 悪い損失', '短い足へ', 'そのまま', '判定に影響しません']) {
      expect(s).toContain(w);
    }
  });

  it('I5 LC を動かしたか: 下げた（ショートなら上げた）= リスクが増える向き = B・詰めた = リスクが減る向き = 判定に影響しない（用語集の言葉。#57 の読み替え）', () => {
    const s = allText('lcMove');
    for (const w of [
      '下げた',
      'ショートなら上げた',
      'リスクが増える向き',
      'B 悪い損失',
      '詰めた',
      'リスクが減る向き',
      '判定に影響しません',
    ]) {
      expect(s).toContain(w);
    }
    expect(s).not.toContain('広げた');
    expect(s).not.toContain('狭めた');
  });

  it('LC を入る前に決めていたか: 決めていない = C 極悪な損失', () => {
    expect(allText('lcDecided')).toContain('C 極悪な損失');
  });

  it('I6 判定: 5 つの判定の名前が並ぶ', () => {
    const s = allText('judgment');
    for (const w of [
      'A いい損失',
      'B 悪い損失',
      'C 極悪な損失',
      '計画どおりの勝ち',
      '危ない勝ち',
    ]) {
      expect(s).toContain(w);
    }
  });

  it('I7 R: R = 損益 ÷ 1R・計画どおりの LC なら −1R 前後・架空の例 −1.2R', () => {
    const s = allText('r');
    for (const w of ['1R', '−1R 前後', '架空', 'イン 100.00', 'LC 99.50', '決済 99.40', '−1.2R']) {
      expect(s).toContain(w);
    }
  });

  it('I7 の例の数は式どおり（ロング: (99.40 − 100.00) ÷ |100.00 − 99.50| = −1.2）', () => {
    expect((99.4 - 100) / Math.abs(100 - 99.5)).toBeCloseTo(-1.2, 12);
  });

  it('I8 LC の物差し: 決めた LC が −1R、決済が越えた幅', () => {
    const s = allText('ruler');
    for (const w of ['LC を −1R', '決済', '超えて']) expect(s).toContain(w);
  });
});

describe('AC-7: 判定の名前は判定のバッジと同じ', () => {
  it('判定の説明の名前の一覧 = バッジの 5 つのラベル', () => {
    const fromBadge = (['A', 'B', 'C', 'safeWin', 'riskyWin'] as const).map(
      (g) => badgeModel(g).label,
    );
    const names = (glossaryTerm('judgment').items ?? []).map((i) => i.name);
    expect([...names].sort()).toEqual([...fromBadge].sort());
  });
});

describe('AC-8: 説明が指す設計書の節は設計書の見出しにある', () => {
  it('見出しを読めている（自己テスト）', () => {
    for (const n of ['3', '5.1', '5.3', '5.4']) expect(DESIGN_SECTIONS.has(n)).toBe(true);
    expect(DESIGN_SECTIONS.has('5.99')).toBe(false);
  });

  it.each(GLOSSARY.map((g) => [g.id, g.design] as const))('%s', (_id, design) => {
    for (const n of design) expect(DESIGN_SECTIONS.has(n)).toBe(true);
  });
});
