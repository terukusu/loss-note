// 取引の一覧の行と月の束（Issue #9 契約 U-1・#132 で作り直した。設計書 9.2、ui-guidelines 9.9・9.12）。hook を持たない。
// - 行は押せる行（行全体が詳細へのリンク。当たり 44px 以上、右の › は擬似要素）。左に判定の段の記号の札、1 行目「銘柄 · L / S」、
//   2 行目「判定の名前 · 11/19 14:05」、右に R と「リスク 0.8%」（危ない勝ちの R は静かな形。#227・C59）。R が出ない行は「—」を 1 つだけ、リスクだけが出ない行は
//   2 段目を出さない（理由は題の行の「i」と行の読み上げの名前。ホームの詰めた行と同じ規則。#128 デザイン a4）
// - 2 行目の判定の名前と時刻はどちらも切らない（1 行に入らなければ時刻を次の行へ折る。R7・#176）
// - 口座が 2 つ以上のときだけ口座の名前（#47）。幅によらず 1 行目の「銘柄 · L / S」の後ろ。4 字ぶん出せない行では区切りごと
//   出さない（「…」だけの口座を作らない。CSS で 1 行の高さに切り、入らない口座は次の行へ落として見せない。設計書 9.2・#132 の
//   デザイン a1）。口座は行の読み上げの名前（aria-label）と詳細には必ずある
// - 月の束: 見出し（スクロールしても上に残る。h2 = 「2026年11月」と右に数）と、まとめた一覧（角丸の 1 枚の面）
// - 色は判定の段（記号の札）だけ、数字は無色（C34）。値はテキストのノードだけ
import { Link } from '../lib/router';
import { listRowModel, type MonthGroup } from '../lib/trade-list';
import type { TradeRow as Row } from '../lib/trade-view';
import { Icon } from './Icon';

/**
 * note: 2 行目の下に添える短い文（期間の取引の画面の心理の名前。#185。取引のタブの一覧・ホームでは渡さない = 今までの形）。
 * badge: 3 行目の頭の小さな札（期間の取引の画面の「この取引」= 押して来た元の取引。#194）。読み上げの名前の頭にも付ける。
 * 渡さない描画は今までと同じ DOM
 */
export function TradeRow({
  row,
  note,
  badge,
}: {
  readonly row: Row;
  readonly note?: string | undefined;
  readonly badge?: string | undefined;
}) {
  const m = listRowModel(row);
  const noteEl = note ? <span class="traderow__note">{note}</span> : null;
  return (
    <Link
      href={row.href}
      class="traderow"
      aria-label={badge ? `${badge}、${row.label}` : row.label}
    >
      <span class={`traderow__mark traderow__mark--${m.tier}`}>
        <Icon name={m.symbol} />
      </span>
      <span class="traderow__main">
        <span class="traderow__title">
          <span class="traderow__head">
            <span class="traderow__name">{row.instrumentName}</span>
            <span class="traderow__side">{row.sideText}</span>
            {row.legsText !== undefined ? <span class="traderow__side">{row.legsText}</span> : null}
          </span>
          {row.accountName !== undefined ? (
            <span class="traderow__account">{row.accountName}</span>
          ) : null}
        </span>
        <span class="traderow__sub">
          <span class="traderow__grade">{m.gradeLabel}</span>
          <time class="traderow__when" dateTime={m.whenIso}>
            {m.when}
          </time>
        </span>
        {badge ? (
          <span class="traderow__extra">
            <span class="traderow__badge">{badge}</span>
            {noteEl}
          </span>
        ) : (
          noteEl
        )}
      </span>
      <span class="traderow__nums">
        <span
          class={
            m.rMissing
              ? 'traderow__r traderow__none'
              : m.rQuiet
                ? 'num traderow__r traderow__r--quiet'
                : 'num num--row traderow__r'
          }
        >
          {m.rText}
        </span>
        {m.riskText !== null ? <span class="traderow__risk">{m.riskText}</span> : null}
      </span>
    </Link>
  );
}

/** 月の束（見出しと行の並び）。見出しの ID は月の鍵から作る */
export function TradeMonth({ group }: { readonly group: MonthGroup }) {
  const id = `trades-month-${group.key}`;
  return (
    <section class="tradelist-month" aria-labelledby={id}>
      <div class="tradelist-month__head">
        <h2 class="tradelist-month__title" id={id}>
          {group.title}
        </h2>
        <p class="tradelist-month__sum">{group.summary}</p>
      </div>
      <ul class="tradelist" aria-label={`${group.title}の取引`}>
        {group.rows.map((r) => (
          <li key={r.id} class="tradelist__item">
            <TradeRow row={r} />
          </li>
        ))}
      </ul>
    </section>
  );
}
