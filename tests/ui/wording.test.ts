// 画面の言葉の用語集（docs/ui-guidelines.md 8 章。Issue #74）と画面の文字列の突き合わせ。
// 8 章の表を読み、(1) 使わない言葉が画面の文字列に 0 件 (2) 内部の呼び名の識別子で引いた画面の名前が表の言い方と一字一句同じ
// (3) アプリの中の用語集の項目がすべて表にある (4) 文の中の [〜] が押せるボタンの名前、を確かめる。
// 画面の文字列は TypeScript の構文木から拾う（文字列・テンプレートの文字・JSX の文字。コメントは拾わない）
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import guide from '../../docs/ui-guidelines.md?raw';
import { LC_MOVE_HINT } from '../../ui/src/components/TradeFields';
import { CHART_SLOT_TEXT } from '../../ui/src/lib/charts';
import { formatHolding } from '../../ui/src/lib/datetime';
import { TOAST_TEXT } from '../../ui/src/lib/deletions';
import { EDIT_SAVE_FAILED } from '../../ui/src/lib/edit-controller';
import {
  GLOSSARY,
  GLOSSARY_GROUPS,
  type GlossaryId,
  glossaryTerm,
} from '../../ui/src/lib/glossary';
import { FIELD_LABEL, MISSING_LABEL, MSG } from '../../ui/src/lib/record-form';
import { titleOf } from '../../ui/src/lib/routes';
import { LATE_LC_NAME, POINT_NAME, RULER_LABEL } from '../../ui/src/lib/ruler-view';
import { ADD_FAILED, instrumentAdded } from '../../ui/src/lib/settings-controller';
import { INSTRUMENT_FIELD_LABEL, PROVISIONAL_MARK } from '../../ui/src/lib/settings-form';
import { MARK_LABEL } from '../../ui/src/lib/statement-fill';
import { TZ_TEXT } from '../../ui/src/lib/statement-tz';
import { SIDE_TEXT, TAPS_LABEL } from '../../ui/src/lib/trade-view';

const sources = import.meta.glob('../../ui/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** 画面のソース（開発の時だけの部品の見本を除く） */
const SCREEN = Object.entries(sources).filter(([p]) => !p.includes('/pages/dev/'));

/** ソースの中の画面の文字列（文字列・テンプレートの文字・JSX の文字。前後の空白を詰める） */
function screenStrings(file: string, src: string): string[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, false, kind);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      out.push(n.text);
    } else if (ts.isJsxText(n)) {
      const t = n.text.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** 使わない言葉を含む文字列（「ファイル: 言葉: 文字列」） */
function bannedHits(
  files: readonly (readonly [string, string])[],
  words: readonly string[],
): string[] {
  const hits: string[] = [];
  for (const [file, src] of files) {
    for (const s of screenStrings(file, src)) {
      for (const w of words) {
        // [〜] の形はボタンの名前: 文の中の [〜] と、ボタンの文字そのもの（〜 だけの文字列）の両方を拾う
        const button = /^\[(.+)\]$/.exec(w)?.[1];
        if (s.includes(w) || (button !== undefined && s === button))
          hits.push(`${file}: ${w}: ${s}`);
      }
    }
  }
  return hits;
}

/** 見出し（### 8.x …）の節の中の表の行（見出しの行と区切りの行を除き、セルに分ける） */
function tableRows(heading: string): string[][] {
  const start = guide.indexOf(`\n### ${heading}\n`);
  if (start < 0) return [];
  const rest = guide.slice(start + 1);
  const end = rest.search(/\n#{2,3} /);
  const body = end < 0 ? rest : rest.slice(0, end);
  const rows = body
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map((l) =>
      l
        .slice(1, l.endsWith('|') ? -1 : undefined)
        .split('|')
        .map((c) => c.trim()),
    );
  return rows.slice(2); // 見出しの行と区切りの行
}

/** セルの中のバッククォートで囲んだ言葉 */
function codes(cell: string | undefined): string[] {
  return [...(cell ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
}

const OPS = tableRows('8.1 操作の言葉');
const TERMS = tableRows('8.2 相場の用語');
const MAP = tableRows('8.3 内部の呼び名と画面の言い方');
const KEEP = tableRows('8.4 変えない言葉');

const BANNED = [...OPS.flatMap((r) => codes(r[1])), ...TERMS.flatMap((r) => codes(r[2]))];
const ALL_STRINGS = SCREEN.flatMap(([f, s]) => screenStrings(f, s));

/** 8.3 の識別子 → 画面の名前 */
function resolve(id: string): string | undefined {
  const [head, key = ''] = id.split('.');
  const pick = <T extends object>(o: T): unknown => (o as Record<string, unknown>)[key];
  switch (head) {
    case 'FIELD_LABEL':
      return pick(FIELD_LABEL) as string | undefined;
    case 'MISSING_LABEL':
      return pick(MISSING_LABEL) as string | undefined;
    case 'GLOSSARY':
      return GLOSSARY.find((g) => g.id === key)?.term;
    case 'GLOSSARY_GROUPS':
      return GLOSSARY_GROUPS.find((g) => g.id === key)?.name;
    case 'formatHolding':
      // 表の例（2 日 4 時間）の文
      return formatHolding(0, (2 * 24 + 4) * 3_600_000) ?? undefined;
    case 'LC_MOVE_HINT':
      return LC_MOVE_HINT;
    case 'TAPS_LABEL':
      return TAPS_LABEL;
    case 'RULER_LABEL':
      return RULER_LABEL;
    case 'POINT_NAME':
      return pick(POINT_NAME) as string | undefined;
    case 'LATE_LC_NAME':
      return LATE_LC_NAME;
    case 'MARK_LABEL':
      return pick(MARK_LABEL) as string | undefined;
    case 'TZ_TEXT':
      return pick(TZ_TEXT) as string | undefined;
    case 'PROVISIONAL_MARK':
      return PROVISIONAL_MARK;
    case 'INSTRUMENT_FIELD_LABEL':
      return pick(INSTRUMENT_FIELD_LABEL) as string | undefined;
    case 'CHART_SLOT_TEXT':
      return (pick(CHART_SLOT_TEXT) as { name: string } | undefined)?.name;
    case 'SIDE_TEXT':
      return pick(SIDE_TEXT) as string | undefined;
    case 'ROUTE_TITLE':
      return key === 'tradeEdit'
        ? titleOf({ name: 'tradeEdit', id: 'x' }).replace(/ — .*$/, '')
        : undefined;
    default:
      return undefined;
  }
}

describe('用語集の表が読める（#74 AC-8）', () => {
  it('8.1〜8.4 の 4 つの表に行がある', () => {
    expect(OPS.length).toBeGreaterThan(10);
    expect(TERMS.length).toBeGreaterThan(10);
    expect(MAP.length).toBeGreaterThan(10);
    expect(KEEP.length).toBeGreaterThan(3);
  });

  it('使う言葉・使わない言葉・識別子・画面の言い方はバッククォートで囲んである（読み落としが無い）', () => {
    for (const r of OPS) expect(codes(r[0]).length, r.join(' | ')).toBeGreaterThan(0);
    for (const r of TERMS) expect(codes(r[1]).length, r.join(' | ')).toBeGreaterThan(0);
    for (const r of MAP) {
      expect(codes(r[1]), r.join(' | ')).toHaveLength(1);
      expect(codes(r[2]), r.join(' | ')).toHaveLength(1);
    }
  });

  it('使う言葉と使わない言葉が重ならない', () => {
    const use = new Set([...OPS.flatMap((r) => codes(r[0])), ...TERMS.flatMap((r) => codes(r[1]))]);
    for (const w of BANNED) for (const u of use) expect(u.includes(w), `${u} ⊃ ${w}`).toBe(false);
  });
});

describe('使わない言葉が画面に出ない（#74 AC-1）', () => {
  it('検査そのものの自己テスト: 使わない言葉を 1 つ含む文字列・JSX の文字・テンプレートを拾い、コメントは拾わない', () => {
    const sample: [string, string][] = [
      ['a.ts', "export const A = '口座を足す';"],
      ['b.tsx', 'export const B = () => <button>消す</button>;'],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: 検査するソースの中のテンプレート
      ['c.ts', 'export const C = (n: string) => `${n} を消しました`;'],
      ['d.ts', '// 口座を足す\n/* 消す */\nexport const D = 1;'],
      [
        'e.tsx',
        "export const E = () => <><b>保存する</b><i>{'もう一度 [保存する] を押す'}</i><u>保存すると</u></>;",
      ],
    ];
    expect(bannedHits(sample, ['足す', '消す', '消し', '[保存する]'])).toEqual([
      'a.ts: 足す: 口座を足す',
      'b.tsx: 消す: 消す',
      'c.ts: 消し:  を消しました',
      'e.tsx: [保存する]: 保存する',
      'e.tsx: [保存する]: もう一度 [保存する] を押す',
    ]);
  });

  it('使わない言葉は 30 語以上ある（表が空にならない）', () => {
    expect(BANNED.length).toBeGreaterThan(30);
  });

  it('画面のソースの文字列に使わない言葉が 0 件', () => {
    expect(bannedHits(SCREEN, BANNED)).toEqual([]);
  });
});

describe('相場の用語と画面の言葉（#74 AC-2）', () => {
  it('8.2 の画面の言葉は、どれも画面の文字列のどこかにある（表だけの言葉にしない）', () => {
    const joined = ALL_STRINGS.join('\n');
    for (const r of TERMS)
      for (const w of codes(r[1])) expect(joined.includes(w), `${r[0]}: ${w}`).toBe(true);
  });

  it('主な欄の名前（例の表 #9〜#11）', () => {
    expect(FIELD_LABEL.entryTime).toBe('エントリーの時刻');
    expect(FIELD_LABEL.brokenCondition).toBe('根拠が崩れる条件');
    expect(FIELD_LABEL.exitPrice).toBe('決済');
    expect(MISSING_LABEL.exitPrice).toBe('決済');
    expect(GLOSSARY_GROUPS.find((g) => g.id === 'action')?.name).toBe('決済までの行動');
    // 一覧の列の見出し「決済日時」は #132 で行を詰めた 2 行にして列の見出しごと無くした（8.2 の表からも外した）
    expect(ALL_STRINGS).not.toContain('決済日時');
    expect(ALL_STRINGS).toContain('根拠が崩れる条件（任意）');
    expect(MSG.lcDirection('L')).toBe('ロングの LC はインより下にしてください');
    expect(MSG.lcDirection('S')).toBe('ショートの LC はインより上にしてください');
  });
});

describe('内部の呼び名と画面の言い方の対応表（#74 AC-3）', () => {
  it('識別子で引いた画面の名前が、表の画面の言い方と一字一句同じ', () => {
    for (const r of MAP) {
      const [id = ''] = codes(r[1]);
      const [say] = codes(r[2]);
      expect(resolve(id), `${id}`).toBe(say);
    }
  });
});

describe('アプリの中の用語集（#74 AC-4）', () => {
  it('用語集の全項目が対応表にあり、見出しが表の画面の言い方と同じ', () => {
    const rows = new Map(MAP.map((r) => [codes(r[1])[0] ?? '', codes(r[2])[0] ?? '']));
    for (const g of GLOSSARY) {
      expect(rows.get(`GLOSSARY.${g.id}`), g.id).toBe(glossaryTerm(g.id as GlossaryId).term);
    }
  });
});

describe('文の中の [〜] はボタンの名前（#74 AC-5）', () => {
  // [[id]] は用語集の中のリンク（ボタンの名前ではない）
  const BRACKETS = [
    ...new Set(
      ALL_STRINGS.flatMap((s) =>
        [...s.replace(/\[\[[^\]]*\]\]/g, '').matchAll(/\[([^[\]]+)\]/g)]
          .map((m) => m[1] ?? '')
          // CSS のセレクタ（[href^="…"] など）は除く。ボタンの名前は日本語を含む
          .filter((b) => /[\u3040-\u30ff\u4e00-\u9fff]/.test(b)),
      ),
    ),
  ];
  const NAMES = new Set([...OPS.flatMap((r) => codes(r[0])), ...KEEP.flatMap((r) => codes(r[0]))]);

  it('文の中の [〜] を拾う（検査が空回りしない。今の画面の [〜] はこの 5 つ。キャンセルは左上の ✕ になった = #127）', () => {
    expect([...BRACKETS].sort()).toEqual(['保存', '削除', '記録', '記録する', '追加'].sort());
  });

  it('[〜] は用語集の操作の言葉・変えない言葉にあり、その名前のボタン（文字列）が画面にある', () => {
    for (const b of BRACKETS) {
      expect(NAMES.has(b), `[${b}] が用語集に無い`).toBe(true);
      expect(ALL_STRINGS.includes(b), `[${b}] のボタンが画面に無い`).toBe(true);
    }
  });
});

describe('例の表の新しい文言（#74 AC-6）', () => {
  it('#2・#3・#1 の誤りの文とトースト', () => {
    expect(TOAST_TEXT.deleted('US30 L 11/10')).toBe('US30 L 11/10 を削除しました');
    expect(TOAST_TEXT.failed).toBe('削除できませんでした。もう一度 [削除] を押してください。');
    expect(EDIT_SAVE_FAILED).toBe(
      '保存できませんでした。入力内容は残っています。もう一度 [保存] を押してください。',
    );
    expect(ADD_FAILED).toBe('追加できませんでした。もう一度 [追加] を押してください。');
    expect(instrumentAdded('GOLD')).toBe('GOLD を追加しました。');
  });

  it('#12 の入力の誤り', () => {
    expect(MSG.notNumber).toBe('数値を入力してください（例: 100.5）');
    expect(MSG.nameInvalid).toBe('40 字以内で入力してください（改行・タブは使えません）');
  });

  it('#4〜#8 の画面の文字', () => {
    for (const s of [
      // #133: 設定の口座の画面の ［＋ 口座を追加］ は ＋ をアイコンにした（文字は「口座を追加」。動詞は 8.1 の「追加」のまま）
      '口座を追加',
      '再読み込み',
      'もう一度ログイン',
      'この行をスキップ',
      '明細の時刻にタイムゾーンが書かれていません。選んだタイムゾーンから日本時間に直して欄に入力します。',
      '決済したら、その場で 30 秒。[記録] を押して、決済明細とチャートのスクショを貼り付け、LC と 3 つの質問に答えると判定が表示されます。',
      '決済までの行動',
    ])
      expect(ALL_STRINGS, s).toContain(s);
  });
});
