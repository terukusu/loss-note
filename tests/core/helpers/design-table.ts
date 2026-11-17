// 設計書 5.6 の例の表を読む（テストだけが使う。core/ はファイルを読まない）。
// 正は設計書の表そのもの。`### 5.6` の見出しの後の最初の表から、`#` の列と「期待」の列を取る

export interface DesignTableRow {
  readonly id: string;
  readonly expectation: string;
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function parseDesignTable(markdown: string): DesignTableRow[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^###\s+5\.6\s/.test(l));
  if (start < 0) throw new Error('設計書に「### 5.6」の見出しがありません');

  const rows: DesignTableRow[] = [];
  let inTable = false;
  let header: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^#{1,3}\s/.test(line)) break;
    const isRow = line.trim().startsWith('|');
    if (!inTable) {
      if (isRow) {
        inTable = true;
        header = cells(line);
      }
      continue;
    }
    if (!isRow) break;
    const c = cells(line);
    if (c.every((x) => /^:?-+:?$/.test(x))) continue; // 区切りの行
    if (header[0] !== '#') throw new Error(`5.6 の表の最初の列が「#」ではありません: ${header[0]}`);
    rows.push({ id: c[0] ?? '', expectation: c[c.length - 1] ?? '' });
  }
  return rows;
}

/** 期待の列の判定の言葉（1 文字の A / B / C は語の境で探す。「LC」「C19」には当てない） */
const GRADE_TOKEN = /危ない勝ち|計画どおりの勝ち|(?<![A-Za-z0-9])[ABC](?![A-Za-z0-9])/g;

export interface ExpectationPart {
  /** 判定の言葉（A / B / C / 危ない勝ち / 計画どおりの勝ち） */
  readonly word: string;
  /** その判定の言葉から次の判定の言葉の手前までの文 */
  readonly text: string;
  /** 期待の列の先頭から始まるか */
  readonly atStart: boolean;
}

/** 期待の列を判定の言葉ごとに分ける（「「はい」なら A、「いいえ」なら B（持ち続けた）」→ A の部分と B の部分） */
export function splitExpectation(expectation: string): ExpectationPart[] {
  const hits = [...expectation.matchAll(GRADE_TOKEN)];
  return hits.map((m, i) => {
    const start = m.index ?? 0;
    const end = hits[i + 1]?.index ?? expectation.length;
    return { word: m[0], text: expectation.slice(start, end), atStart: start === 0 };
  });
}

/** 括弧（全角）の中の文をつなげて返す */
export function parenthesized(text: string): string {
  return [...text.matchAll(/（([^（）]*)）/g)].map((m) => m[1] ?? '').join(' ');
}
