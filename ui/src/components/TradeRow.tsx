// 取引の一覧・ホームの行（Issue #9 契約 U-1）。行全体が詳細へのリンク（当たり 44px 以上）。
// 幅 720px 以上は 1 行（日付 / 銘柄・L / S / 判定 / R / リスク の列）、未満は 2 行に固定（1 行目 = 判定・R、
// 2 行目 = 銘柄・L / S・日付・リスク）。R とリスクは右揃えで縦に揃う。出ない値は「—」だけで、理由は一覧の下の脚注に
// 1 回だけ出す（missingNotes）。色は判定の段（バッジ）だけ、数字は無色（C34）。読み上げの名前は
// 「日付 銘柄 L / S [口座] 判定 R リスク」（出ない値は理由の文言）。口座が 2 つ以上のときだけ口座の名前を出す
// （列は足さない。1 行・省略あり。#47 U16）。幅 720 未満は 1 行目（判定と R の間）に、720 以上は銘柄・L / S の後ろに
// 「·」で区切って置く（狭い幅で銘柄と口座がどちらも潰れないように。Phase 4b 指摘 1・8）。同じ名前を 2 か所に持ち、
// CSS でどちらか一方だけを見せる（行の読み上げの名前は aria-label の 1 回だけ）。1 行目の判定の札・口座・R は 1 つの
// セル（traderow__badge）の中に並べ、口座は R の手前まで使う（再レビュー N1）。720 以上はセルを display: contents にして
// 判定・R をそれぞれの列に置く。値はテキストのノードだけ。hook を持たない
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
        {row.accountName !== undefined ? (
          <span class="traderow__account">{row.accountName}</span>
        ) : null}
      </span>
      <span class="traderow__badge">
        <JudgeBadge grade={row.grade} />
        {row.accountName !== undefined ? (
          <span class="traderow__account-top">{row.accountName}</span>
        ) : null}
        <span class={row.rNote === null ? 'num traderow__r' : 'traderow__r traderow__none'}>
          {row.rText}
        </span>
      </span>
      <span class={row.riskNote === null ? 'num traderow__risk' : 'traderow__risk traderow__none'}>
        {row.riskText}
      </span>
    </Link>
  );
}

/** 行の並び（ul）。notes = 「—」の理由（一覧の下の脚注に 1 回だけ）。幅 720 以上は列の見出しを出す */
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
      <div class="tradelist__head" aria-hidden="true">
        <span>決済日時</span>
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
      <TradeNotes notes={notes} />
    </div>
  );
}

/** 「—」の理由の脚注（無ければ描かない）。一覧はページ分けの末尾の段の後に置く（#87） */
export function TradeNotes({ notes }: { readonly notes: readonly string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul class="tradelist__notes" aria-label="値が表示されない理由">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}
