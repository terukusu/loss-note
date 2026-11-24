// 振り返りのタブ・数で見る・期間の取引の hook（pages/Review.tsx の useReview）の URL のつなぎ方（#228）。DOM なし・hook なし。
// hook はこの関数が返す操作をそのまま画面に渡し、前の URL の置き換え（redirect）だけを effect から呼ぶ。テストは本物の
// createNavigator と組み合わせて、hook と同じつなぎ方を通す（つなぎ方をテストの中で書き直さない）
// - 「何で崩れたか」の切り替え（onWhy）は同じ期間のまま `&why=` を置き換える
// - 期間の操作は今の切り替えを保った URL（hrefOf(次の期間, 今の切り替え)）へ置き換える
// - canonical = 前の気づきのセグメントの URL（#162 の `&view=insight`）を同じ期間・同じ切り替えの今の URL に置き換える（振り返りの
//   タブだけ）。どれも置き換えで、履歴を積まない
import {
  canonicalReviewHref,
  type PeriodKey,
  type PeriodSelection,
  parsePeriod,
  parseWhy,
  periodActions,
  reviewHref,
  reviewTableHref,
  type WhyKey,
} from './period';
import { reviewTradesHref, type TrailFilter } from './review-trades';

/** 置き換えだけを使う（router.tsx の Navigator の一部） */
export interface ReplaceNav {
  replace(href: string): void;
}

export interface ReviewNavActions {
  /** 前の URL のときの置き換え先（今の形なら null） */
  readonly canonical: string | null;
  /** 前の URL なら置き換える（hook の effect から呼ぶ） */
  readonly redirect: () => void;
  readonly onWhy: (next: WhyKey) => void;
  readonly onKey: (key: PeriodKey) => void;
  readonly onDates: (from: string, to: string) => void;
  readonly onImports: (include: boolean) => void;
  readonly tableHref: string;
  readonly trailHref: (filter: TrailFilter) => string;
}

/** 今の検索部分と置き換えの窓口 → 振り返りの操作と行き先 */
export function reviewNavActions(
  search: string,
  nav: ReplaceNav | null,
  opts: {
    readonly hrefOf?: (sel: PeriodSelection, why: WhyKey) => string;
    readonly canonical?: boolean;
    readonly now: () => number;
  },
): ReviewNavActions {
  const selection = parsePeriod(search);
  const why = parseWhy(search);
  const hrefOf = opts.hrefOf ?? reviewHref;
  const canonical = opts.canonical ? canonicalReviewHref(search) : null;
  return {
    canonical,
    redirect: () => {
      if (canonical !== null) nav?.replace(canonical);
    },
    onWhy: (next) => {
      if (next !== why) nav?.replace(reviewHref(selection, next));
    },
    tableHref: reviewTableHref(selection),
    // なぜの行・連勝の後・崩れの取引・次は → 同じ期間の「期間の取引」（#185・#228）
    trailHref: (filter) => reviewTradesHref(selection, filter),
    ...periodActions(selection, opts.now, (next) => nav?.replace(hrefOf(next, why))),
  };
}
