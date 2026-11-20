// 振り返りの期間の選択（Issue #88 契約 U-1）。1 日・7 日・1 か月・3 か月・任意の Segment（radio。1 タップ・矢印キー）と、
// 任意のときだけ開始日・終了日の欄。制御された部品で、選んだ期間は親が URL に入れる（P6）。hook を持たない
import {
  PERIOD_KEYS,
  PERIOD_LABEL,
  type PeriodKey,
  type PeriodRange,
  type PeriodSelection,
} from '../lib/period';
import { Segment } from './Segment';
import { TextField } from './TextField';

export interface PeriodPickerProps {
  readonly selection: PeriodSelection;
  readonly range: PeriodRange;
  /** 期間の項目を押した（任意の最初の日付は親が決める） */
  readonly onKey: (key: PeriodKey) => void;
  /** 任意の日付を変えた（空 = 未選択） */
  readonly onDates: (from: string, to: string) => void;
}

const OPTIONS = PERIOD_KEYS.map((k) => ({ value: k, label: PERIOD_LABEL[k] }));

/** 期間の 5 つの選択肢（振り返りのタブでは上に貼り付く帯の中。#128） */
export function PeriodSegment(p: PeriodPickerProps) {
  return (
    <div class="review__period">
      <Segment
        label="期間"
        name="review-period"
        showLabel={false}
        options={OPTIONS}
        value={p.selection.key}
        onChange={p.onKey}
      />
    </div>
  );
}

/**
 * 指定の期間の開始日・終了日の欄（指定のときだけ）。貼り付く帯の外に置き、スクロールで流れる（帯が窓の 3 割を取らないように。
 * デザイン a5（#128）。期間のシートへ移すのは U3（#129））
 */
export function PeriodDates(p: PeriodPickerProps) {
  const sel = p.selection;
  if (sel.key !== 'custom') return null;
  const error = p.range.ok ? undefined : p.range.error;
  return (
    <div class="review__dates">
      <TextField
        id="review-from"
        label="開始日"
        type="date"
        value={sel.from ?? ''}
        onInput={(v) => p.onDates(v, sel.to ?? '')}
      />
      <TextField
        id="review-to"
        label="終了日"
        type="date"
        value={sel.to ?? ''}
        onInput={(v) => p.onDates(sel.from ?? '', v)}
        {...(error === undefined ? {} : { error })}
      />
    </div>
  );
}
