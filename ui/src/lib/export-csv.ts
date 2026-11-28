// データの書き出しの CSV（#167 の R5・例 E4〜E8・ADR-0025）。DOM・通信・現在時刻に触れない純関数。
// - 1 行 1 取引。並びは取引の一覧と同じ（決済の新しい順。trade-view.ts の sortTrades = API の trade_sort_key）
// - 判定・R・リスク（%）・損益は画面と同じ計算（record-form.ts の summarize = core の evaluateTrade）。値は保存した snapshot だけから
// - 数の欄は表計算で数として読める形（桁区切り・単位・符号の記号を付けない）。R・リスク・損益は小数 2 桁に丸める（計算の誤差を出さない）。
//   出ない値（LC なしの R など）は空の欄（「—」を書かない）
// - 文字の欄が = + - @（全角の ＝ ＋ － ＠ も。先頭の空白の後も）・タブ・CR で始まるときは先頭に ' を足す（表計算で式として
//   動かさない）。カンマ・引用符・改行を含む欄は
//   引用符で囲み、引用符は 2 つにする（RFC 4180）
// - 改行は CRLF。先頭に BOM（表計算ソフトが UTF-8 として開く）
// - 列の名前は取引の詳細の「すべての欄」と同じ言葉（決済の時刻・L / S・根拠が崩れる条件 など）
// - 日時は端末の時間帯の「YYYY-MM-DD HH:mm」（画面の日時の表示と同じ時間帯）
import { EMOTION_TAG_IDS } from '../../../core/emotion-tags';
import { accountCurrencyOf, type GroupRole, type StoredTrade } from '../../../core/record';
import {
  normalizeReflection,
  REFLECTION_SIDES,
  type ReflectionSide,
} from '../../../core/reflection';
import { tradeAccountName } from './accounts';
import { badgeModel } from './badge';
import { emotionNames } from './emotion-tags';
import type { ExportData } from './export-data';
import { ROLE_TEXT } from './group-text';
import { type GroupIndex, groupIndexOf, groupRowInfo } from './position-group';
import { TIMEFRAME_NAME } from './reasons';
import { summarize } from './record-form';
import { reflectionCardSides } from './reflection';
import { instrumentNameOf, sortTrades } from './trade-view';

/** 見出しの行（列の並び） */
export const CSV_COLUMNS = [
  '決済の時刻',
  'エントリーの時刻',
  '銘柄',
  '口座',
  'L / S',
  '判定',
  'R',
  'リスク（%）',
  '損益',
  '通貨',
  '数量',
  'イン',
  'LC',
  'TP',
  '決済',
  '時間足',
  '根拠が崩れる条件',
  '心理',
  'Good',
  'More',
  '総評',
  '両建て',
  'まとまり',
  'ID',
] as const;

export const BOM = '﻿';
const EOL = '\r\n';

/** 表計算が式として読む先頭（先頭の空白・全角の空白の後の = + - @ と全角の ＝ ＋ － ＠、タブ・CR） */
const FORMULA_START = /^[\s\u3000]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r]/;

/** 文字の欄（式の無害化 → 必要なら引用符で囲む） */
export function textCell(value: string | undefined): string {
  if (value === undefined || value === '') return '';
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** 数の欄（有限でない・無い = 空。dp を渡したら小数 dp 桁に丸める。−0 は 0） */
export function numCell(value: number | undefined, dp?: number): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  const v = dp === undefined ? value : Math.round(value * 10 ** dp) / 10 ** dp;
  return String(v === 0 ? 0 : v);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 端末の時間帯の「YYYY-MM-DD HH:mm」 */
export function csvDateTime(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Good / More（#123）の 1 欄: 話題の名前と一言を「 / 」でつなぐ（無ければ空） */
function reflectionText(t: StoredTrade, side: ReflectionSide): string {
  const part = reflectionCardSides(normalizeReflection(t.reflection)).find((x) => x.side === side);
  return part ? [...part.topics, ...part.notes].join(' / ') : '';
}

/**
 * 両建てのまとまり（#267・4.8・C75）: 判定・R・リスクの列は最初の本玉の行にだけまとまりの値を入れ、ほかのメンバーの行は空
 * （R の列を足し上げても 1 まとまり = 1 件）。崩れたまとまり・逆参照の指す先が無い取引は単独の取引の値。損益は各行の取引の値のまま
 */
function tradeLine(t: StoredTrade, data: ExportData, index: GroupIndex): string {
  const info = groupRowInfo(t, index);
  const own = summarize(t);
  const s = info?.kind === 'lead' ? info.summary : own;
  const blank = info !== undefined && info.kind !== 'lead';
  const role = roleOf(t, index);
  const r = t.record;
  // 数量の合計は有効数字 15 桁に丸める（0.1 + 0.2 を 0.3 に。core/numeric.ts の floorToStep と同じ桁）
  const quantity = Number(r.entries.reduce((sum, e) => sum + e.quantity, 0).toPrecision(15));
  // 買い増し・ナンピン（エントリーが 2 つ以上）は価格を「 / 」でつないだ文字（数の欄にしない）
  const entryPrice =
    r.entries.length === 1
      ? numCell(r.entries[0]?.price)
      : textCell(r.entries.map((e) => String(e.price)).join(' / '));
  return [
    textCell(csvDateTime(r.exit.time)),
    textCell(csvDateTime(r.entries[0]?.time)),
    textCell(instrumentNameOf(t, data.instruments)),
    textCell(tradeAccountName(t, data.accounts)),
    textCell(r.side),
    blank ? '' : textCell(badgeModel(s.judgment?.grade ?? null).label),
    blank ? '' : numCell(s.r, 2),
    blank ? '' : numCell(s.riskPct, 2),
    numCell(own.pnlYen, 2),
    textCell(accountCurrencyOf(t.snapshot)),
    numCell(quantity),
    entryPrice,
    numCell(r.lc),
    numCell(r.tp),
    numCell(r.exit.price),
    textCell(r.timeframe === undefined ? undefined : TIMEFRAME_NAME[r.timeframe]),
    textCell(r.brokenCondition),
    // 知らない ID（後の版で足したタグ）は名前が無いので外す
    textCell(
      emotionNames((t.emotionTags ?? []).filter((id) => EMOTION_TAG_IDS.includes(id))).join(' / '),
    ),
    ...REFLECTION_SIDES.map((side) => textCell(reflectionText(t, side))),
    textCell(r.exit.review),
    textCell(role === undefined ? undefined : ROLE_TEXT[role]),
    textCell(role === undefined ? undefined : t.positionGroupId),
    textCell(t.id),
  ].join(',');
}

/** まとまりの中の役割（ok なまとまりのメンバーだけ。崩れた・指す先が無い・読めない = undefined） */
function roleOf(t: StoredTrade, index: GroupIndex): GroupRole | undefined {
  const gid = t.positionGroupId;
  if (gid === undefined) return undefined;
  const st = index.groups.get(gid);
  if (st?.kind !== 'ok') return undefined;
  return st.members.find((m) => m.trade.id === t.id)?.role;
}

/** 書き出しの本文 → まとまりの索引（すべてのまとまりを含むので、逆参照の指す先が無い取引は単独の取引の値になる） */
function indexOf(data: ExportData): GroupIndex {
  const refs = data.trades.flatMap((t) => (t.positionGroupId ? [t.positionGroupId] : []));
  return groupIndexOf(data.positionGroups ?? [], new Map(data.trades.map((t) => [t.id, t])), refs);
}

/** 書き出しの本文 → CSV の文字（BOM つき・CRLF。取引が 0 件なら見出しの行だけ） */
export function exportCsv(data: ExportData): string {
  const index = indexOf(data);
  const lines = [
    CSV_COLUMNS.join(','),
    ...sortTrades(data.trades).map((t) => tradeLine(t, data, index)),
  ];
  return `${BOM}${lines.join(EOL)}${EOL}`;
}
