// 「i」の説明（吹き出し）の開閉・位置・中身（Issue #57 契約 UI-57）。DOM なし。部品 components/InfoTip.tsx は状態と
// 測りだけを持ち、規則はここ: 開閉 = infoNext（押す = 反転、それ以外 = 閉じる）、たどった言葉 = infoTrail（文の中の
// 用語集のリンクで積む・戻る / Esc / [‹ 前の説明] で 1 つずつ外す）、位置 = infoPlace（窓・切る祖先の端で切れない揃え・
// 優先の向きに入らなければ反対）、中身 = infoContent。吹き出しは同時に 1 つ（ほかの「i」を開くと閉じる）
import { type GlossaryId, type GlossaryItem, glossaryTerm } from './glossary';

/** 開閉のきっかけ。press = 「i」を押した、escape = Esc、back = 戻る、outside = 吹き出しの外を押した、
 *  other = ほかの「i」が開いた */
export type InfoEvent = 'press' | 'escape' | 'back' | 'outside' | 'other';

/** 次の開閉の状態（押すだけが反転し、ほかはすべて閉じる） */
export function infoNext(open: boolean, ev: InfoEvent): boolean {
  return ev === 'press' ? !open : false;
}

export interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface InfoPlaceInput {
  /** 「i」のボタン（当たりの箱） */
  readonly button: Box;
  /** 吹き出しの幅・高さ（px） */
  readonly width: number;
  readonly height: number;
  /** 吹き出しを切る祖先の箱（左右・上下それぞれ、overflow が visible でない最も近い祖先。切らない向きは ±Infinity）。無ければ null */
  readonly clip: Box | null;
  /** 窓（貼り付きの帯・下部の行き先を除いた見える範囲） */
  readonly view: Box;
  /** ボタンと吹き出しのすき間（px） */
  readonly gap: number;
  /** 先に試す向き（既定は下。3 つの質問の「i」は上 = 説明している選択肢を隠さない） */
  readonly prefer?: 'below' | 'above';
}

/**
 * start = 左端をボタンの左端に、end = 右端をボタンの右端に、fit = ボタンを含むカードの左右 8px の内側（カードは窓の中にある）
 */
export type InfoAlign = 'start' | 'end' | 'fit';

export interface InfoPlace {
  readonly align: InfoAlign;
  /** ボタンの上に開く */
  readonly above: boolean;
}

const EPS = 0.5;

function inter(a: Box, b: Box | null): Box {
  if (!b) return a;
  return {
    left: Math.max(a.left, b.left),
    right: Math.min(a.right, b.right),
    top: Math.max(a.top, b.top),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

/** 切る祖先の箱は、切らない向きを ±Infinity で表す（NaN だけを測れない値とする） */
function clipOk(b: Box): boolean {
  return ![b.left, b.right, b.top, b.bottom].some(Number.isNaN);
}

function finiteBox(b: Box): boolean {
  return [b.left, b.right, b.top, b.bottom].every(Number.isFinite);
}

/** 上に開くか（優先の向きに入ればそれ・入らず反対に入れば反対・どちらにも入らなければ null） */
function aboveIn(i: InfoPlaceInput, area: Box): boolean | null {
  const g = Math.max(0, i.gap);
  const belowFits = i.button.bottom + g + i.height <= area.bottom + EPS;
  const aboveFits = i.button.top - g - i.height >= area.top - EPS;
  if (i.prefer === 'above') {
    if (aboveFits) return true;
    if (belowFits) return false;
    return null;
  }
  if (belowFits) return false;
  if (aboveFits) return true;
  return null;
}

/**
 * 吹き出しの位置。範囲は窓（見える範囲）と切る祖先の重なり。左右は、ボタンの中心が範囲の右半分なら end を先に、入らなければ
 * 反対、どちらにも入らなければ fit（ボタンを含むカードの左右 8px の内側に広げる）。縦は同じ範囲で下 → 上の順に入る方、
 * どちらにも入らなければ下。測れない値（非有限・幅や高さが 0 以下）は start・下
 */
export function infoPlace(i: InfoPlaceInput): InfoPlace {
  const fallback: InfoPlace = { align: 'start', above: false };
  if (
    !finiteBox(i.button) ||
    !finiteBox(i.view) ||
    (i.clip !== null && !clipOk(i.clip)) ||
    !(i.width > 0) ||
    !(i.height > 0) ||
    !Number.isFinite(i.gap)
  )
    return fallback;
  const area = inter(i.view, i.clip);
  const above = aboveIn(i, area) === true;
  if (!(area.right > area.left)) return { align: 'fit', above };
  const startFits = i.button.left + i.width <= area.right + EPS;
  const endFits = i.button.right - i.width >= area.left - EPS;
  const preferEnd = (i.button.left + i.button.right) / 2 > (area.left + area.right) / 2;
  let align: InfoAlign;
  if (preferEnd ? endFits : startFits) align = preferEnd ? 'end' : 'start';
  else if (preferEnd ? startFits : endFits) align = preferEnd ? 'start' : 'end';
  else align = 'fit';
  return { align, above };
}

/**
 * 開いた吹き出しを見える範囲に入れるための窓のスクロールの量（px。正 = 下へ）。下端がはみ出す量だけ動かすが、上端
 * （吹き出しと「i」のうち上にある方 − 見える範囲の上端）を越えて動かさない（「i」と吹き出しの上を隠さない）。負にならない
 * （option-simulator の revealDelta）
 */
export function infoReveal(pop: Box, view: Box, buttonTop = pop.top): number {
  const over = pop.bottom - view.bottom;
  const room = Math.min(pop.top, buttonTop) - view.top;
  if (!(over > 0) || !Number.isFinite(over) || !Number.isFinite(room)) return 0;
  return Math.max(0, Math.min(over, room));
}

/** 包む要素（「i」のボタンと吹き出しを含む .info-wrap）の最小限 */
export interface FocusScope<T> {
  contains(node: T): boolean;
}

/**
 * フォーカスが移った先で吹き出しを閉じるか（#57 再レビュー 3 の B3）。「i」と吹き出しの外へ出たときだけ閉じる。
 * 吹き出しの中（たどった後の吹き出しそのもの・文の中のリンク・[‹ 前の説明]・「用語集で見る」）と「i」へのフォーカスでは閉じない
 */
export function infoFocusCloses<T>(scope: FocusScope<T> | null, target: T | null): boolean {
  if (!scope || target === null) return false;
  return !scope.contains(target);
}

/** 閉じたときにボタンへフォーカスを戻すか（Esc・戻るで、フォーカスが吹き出しの中かボタンにあったときだけ） */
export function infoRefocus(ev: InfoEvent, focusInside: boolean): boolean {
  return (ev === 'escape' || ev === 'back') && focusInside;
}

/** たどった言葉の並び（吹き出しの中で用語集のリンクを押すたびに 1 つ積む）の次の状態 */
export type TrailEvent =
  | { readonly type: 'link'; readonly id: GlossaryId }
  | { readonly type: 'up'; readonly depth: number }
  | { readonly type: 'clear' };

/**
 * link = 末尾に積む（今見ている言葉と同じなら積まない）、up = depth 段目まで戻す（0 = 「i」の言葉そのもの。戻る・Esc・
 * [‹ 前の説明] は今の段数 − 1）、clear = 空に（吹き出しを閉じた）
 */
export function infoTrail(trail: readonly GlossaryId[], ev: TrailEvent): readonly GlossaryId[] {
  if (ev.type === 'clear') return [];
  if (ev.type === 'up') return trail.slice(0, Math.max(0, Math.min(trail.length, ev.depth)));
  if (trail.at(-1) === ev.id) return trail;
  return [...trail, ev.id];
}

/** 説明の出どころ: 用語のデータの ID か、言葉と文（明細の枠の補足） */
export type InfoSource =
  | { readonly term: GlossaryId; readonly id?: string }
  | { readonly label: string; readonly body: string; readonly id: string };

export interface InfoContent {
  /** ボタンの名前「「〈言葉〉」の説明」（「i」の言葉。たどっても変えない） */
  readonly name: string;
  /** 説明の箱の要素の ID（ボタンの aria-controls） */
  readonly panelId: string;
  /** たどった先の言葉の見出し（「i」の言葉そのものを見ている間は null） */
  readonly title: string | null;
  /** 1 つ前の説明の言葉（戻るボタンの「‹ 〈言葉〉」。たどっていなければ null） */
  readonly back: string | null;
  /** 先頭の短い説明（用語のデータの summary。リンクの印つき。明細の補足は null） */
  readonly lead: string | null;
  /** 続きの文（リンクの印つき） */
  readonly body: readonly string[];
  readonly items: readonly GlossaryItem[];
  readonly example: string | null;
  /** 用語集の画面のその項目（末尾の「用語集で見る」。明細の補足は null） */
  readonly glossary: GlossaryId | null;
  /** 今の段数（0 = 「i」の言葉そのもの） */
  readonly depth: number;
}

/**
 * 吹き出しの末尾に「用語集で見る」を出すか。入力のある画面（記録する・取引の編集）では出さない（用語集の画面へ移ると書きかけの欄が
 * 消えるため。吹き出しの中のたどりで足りる。#57 デザインの再レビュー）
 */
export function showsGlossaryLink(pathname: string): boolean {
  return !/^\/record\/?$|^\/trades\/[^/]+\/edit\/?$/.test(pathname);
}

export function infoName(label: string): string {
  return `「${label}」の説明`;
}

/** 出どころとたどった言葉から、ボタンの名前と箱の中身を作る（見せるのはたどった言葉の末尾） */
export function infoContent(src: InfoSource, trail: readonly GlossaryId[] = []): InfoContent {
  const name = 'term' in src ? infoName(glossaryTerm(src.term).term) : infoName(src.label);
  const panelId = 'term' in src ? (src.id ?? `info-${src.term}`) : src.id;
  const top = trail.at(-1);
  const baseName = 'term' in src ? glossaryTerm(src.term).term : src.label;
  const prev = trail.at(-2);
  const back = top === undefined ? null : prev === undefined ? baseName : glossaryTerm(prev).term;
  if (top !== undefined || 'term' in src) {
    const id = top ?? (src as { term: GlossaryId }).term;
    const t = glossaryTerm(id);
    return {
      name,
      panelId,
      title: top === undefined ? null : t.term,
      back,
      lead: t.summary,
      body: t.body,
      items: t.items ?? [],
      example: t.example ?? null,
      glossary: t.id,
      depth: trail.length,
    };
  }
  return {
    name,
    panelId,
    title: null,
    back: null,
    lead: null,
    body: [src.body],
    items: [],
    example: null,
    glossary: null,
    depth: 0,
  };
}
