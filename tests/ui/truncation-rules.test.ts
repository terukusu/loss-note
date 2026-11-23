import { describe, expect, it } from 'vitest';

/**
 * 文字の省略は「省略してよい所」だけ（docs/ui-guidelines.md 10.3・Issue #176）。
 * 画面の CSS（ui/src の *.css。開発の時だけの見本 pages/dev は本番に入らないので数えない）で、末尾を「…」で省く指定
 * （text-overflow: ellipsis）と行の数で切る指定（line-clamp）を持つ規則のセレクタを数え、下の 2 つの表の外が 0 件であることを見る。
 * - ALLOWED: 10.3 の「省略してよい所」の表（利用者が付けた名前・上の帯）と、はみ出しの保険の 2 つ
 * - KNOWN: 直すのを別の Issue に分けた、残している外れ（Issue の番号つき）。直して省略の指定が無くなったら、このテストが
 *   落ちて一覧から消すことを知らせる（ui:check の ZOOM_KNOWN と同じ約束）
 * 実際の幅で切れるかは ui:check の LV1（いちばん長い値の状態）が測る
 */

const fs = (
  globalThis as unknown as {
    process: { getBuiltinModule(id: 'node:fs'): { readFileSync(p: URL, enc: 'utf8'): string } };
  }
).process.getBuiltinModule('node:fs');
const files: Record<string, string> = Object.fromEntries(
  Object.keys(import.meta.glob('../../ui/src/**/*.css'))
    .filter((path) => !path.includes('/pages/dev/'))
    .map((path) => [path, fs.readFileSync(new URL(path, import.meta.url), 'utf8')]),
);

/** 省略してよい所（セレクタ → 何の文字か・全文のある所） */
const ALLOWED: Readonly<Record<string, string>> = {
  '.traderow__name': '一覧の行の銘柄の名前（全文は詳細）',
  '.traderow__account': '一覧の行の口座の名前（全文は詳細・設定の口座）',
  '.homerow__name': 'ホームの行の銘柄の名前（全文は詳細）',
  '.homerow__account': 'ホームの行の口座の名前（全文は詳細・設定の口座）',
  '.seg__note': '口座の Segment の見出しの右の「選択中: 〈名前〉」（全文は設定の口座）',
  '.seg__text':
    '口座の Segment の選択肢の名前（truncate のときだけ付く。全文は「選択中」の 1 行と設定の口座）',
  '.appbar__title': '上の帯の題（全文は画面の中の題）',
  '.appbar__backlabel': '上の帯の「‹ 前の画面の名前」（全文は前の画面）',
  '.record__status': '保険: 下の帯の状態の文（実際の省略は ui:check が外れとして測る）',
  '.gsi__text': '保険: Google でログインするボタンの文字（ブランドの決まった形）',
};

/** 残している外れ（直したら消す） */
const KNOWN: Readonly<Record<string, string>> = {
  '.rsum__tzmark': '#212 記録するの時刻の印',
  '.rchart__line': '#212 チャートの小さな枠の状態の 1 行（記録する・編集）',
  '.rchartrow__l1': '#212 2 段目のチャートの行の 1 行目',
  '.rchartrow__l2': '#212 2 段目のチャートの行の 2 行目',
  '.record__lc .lcrow > .field > .field__hint': '#212 LC の欄の手がかり',
};

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const norm = (sel: string) => sel.replace(/\s+/g, ' ').trim();

/**
 * 省略の指定を持つ規則のセレクタ（`,` で分けた 1 つずつ）。入れ子の規則（`&`）は親のセレクタと組まずにそのまま返す
 * （今の CSS に入れ子の省略は無い。あれば表に無いセレクタとして落ちる）
 */
function truncatingSelectors(css: string): string[] {
  const src = stripComments(css);
  const out: string[] = [];
  const stack: { start: number; open: number }[] = [];
  let boundary = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') {
      stack.push({ start: boundary, open: i });
      boundary = i + 1;
    } else if (c === '}') {
      const top = stack.pop();
      if (top) {
        const body = src.slice(top.open + 1, i);
        // 自分の宣言だけを見る（入れ子の規則の中身を除く）
        const own = body.replace(/\{[^{}]*\}/g, '');
        if (/text-overflow\s*:\s*ellipsis|line-clamp\s*:/.test(own)) {
          for (const s of src.slice(top.start, top.open).split(',')) out.push(norm(s));
        }
      }
      boundary = i + 1;
    } else if (c === ';') {
      boundary = i + 1;
    }
  }
  return out;
}

const found = Object.entries(files).flatMap(([path, css]) =>
  truncatingSelectors(css).map((selector) => ({ path: path.replace('../../', ''), selector })),
);

describe('文字の省略は「省略してよい所」だけ（ui-guidelines 10.3・#176）', () => {
  it('解析の確かめ: 宣言の中の省略を拾い、コメントと入れ子の中身を自分の宣言に数えない', () => {
    expect(
      truncatingSelectors(
        '/* .x { text-overflow: ellipsis } */\n.a,\n.b .c {\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n' +
          '.d { color: red; .e { text-overflow: ellipsis; } }\n.f { -webkit-line-clamp: 2; }\n@media (x) { .g { text-overflow: ellipsis } }',
      ),
    ).toEqual(['.a', '.b .c', '.e', '.f', '.g']);
  });

  it('画面の CSS を読めている', () => {
    expect(Object.keys(files).length).toBeGreaterThan(5);
    expect(found.length).toBeGreaterThan(0);
  });

  it('表に無い要素の省略が 0 件', () => {
    const outside = found.filter((f) => !(f.selector in ALLOWED) && !(f.selector in KNOWN));
    expect(outside.map((f) => `${f.path}: ${f.selector}`)).toEqual([]);
  });

  it('残している外れ（KNOWN）は今も省略している（直したら KNOWN から消す）', () => {
    const now = new Set(found.map((f) => f.selector));
    expect(Object.keys(KNOWN).filter((s) => !now.has(s))).toEqual([]);
  });

  it('省略してよい所の表は使われている（使わなくなったら表から消す）', () => {
    const now = new Set(found.map((f) => f.selector));
    expect(Object.keys(ALLOWED).filter((s) => !now.has(s))).toEqual([]);
  });

  it('詳細のチャートの札の時間足は 1 つの塊（折らない・切らない）', () => {
    const detail = stripComments(files['../../ui/src/styles/detail.css'] ?? '');
    expect(detail).toMatch(/\.dchart__tf\s*\{[^}]*white-space:\s*nowrap/);
  });
});
