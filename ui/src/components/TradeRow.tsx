// 取引の一覧・ホームの行（Issue #9 契約 U-1）。行全体が詳細へのリンク（当たり 44px 以上）。
// 幅 720px 以上は 1 行（日付 / 銘柄・L / S / 判定 / R / リスク の列）、未満は 2 行に固定（1 行目 = 判定・R、
// 2 行目 = 銘柄・L / S・日付・リスク）。R とリスクは右揃えで縦に揃う。出ない値は「—」だけで、理由は一覧の上に
// 1 回だけ出す（missingNotes）。色は判定の段（バッジ）だけ、数字は無色（C34）。読み上げの名前は
// 「日付 銘柄 L / S 判定 R リスク」（出ない値は理由の文言）。値はテキストのノードだけ。hook を持たない
import { Link } from '../lib/router';
import type { TradeRow as Row } from '../lib/trade-view';
import { JudgeBadge } from './JudgeBadge';

export function TradeRow({ row }: { readonly row: Row }) {
  return (
    <Link href={row.href} class="traderow" aria-label={row.label}>
      <time class="traderow__date" dateTime={row.dateIso}>
        {row.dateText}
      </time>
      <span class="traderow__inst">
        <span class="traderow__name">{row.instrumentName}</span>
        <span class="traderow__side">{row.sideText}</span>
      </span>
      <span class="traderow__badge">
        <JudgeBadge grade={row.grade} />
      </span>
      <span class={row.rNote === null ? 'num traderow__r' : 'traderow__r traderow__none'}>
        {row.rText}
      </span>
      <span class={row.riskNote === null ? 'num traderow__risk' : 'traderow__risk traderow__none'}>
        {row.riskText}
      </span>
    </Link>
  );
}

/** 行の並び（ul）。notes = 「—」の理由（一覧の上に 1 回だけ）。幅 720 以上は列の見出しを出す */
export function TradeList({
  rows,
  label,
  notes,
}: {
  readonly rows: readonly Row[];
  readonly label: string;
  readonly notes: readonly string[];
}) {
  return (
    <div class="tradelist-wrap">
      {notes.length > 0 ? (
        <ul class="tradelist__notes" aria-label="値が出ない理由">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <div class="tradelist__head" aria-hidden="true">
        <span>決済</span>
        <span>銘柄</span>
        <span>判定</span>
        <span class="tradelist__head-num">R</span>
        <span class="tradelist__head-num">リスク</span>
      </div>
      <ul class="tradelist" aria-label={label}>
        {rows.map((r) => (
          <li key={r.id} class="tradelist__item">
            <TradeRow row={r} />
          </li>
        ))}
      </ul>
    </div>
  );
}
