// レッグ 1 本の欄（#117。設計書 7.6「押すとそのレッグのシート（下のシート。同時に開くのは 1 本）で欄を直す」）。
// 記録する画面は取引の欄のシートの次の段に、直す画面は下のシートに置く（重ね方は置き場が決める）。hook を持たない。
// 並び: P / C | 買い / 売り → 限月 | 行使価格 → 枚数 | [満期で消滅] → イン | 決済 → [このレッグを削除]（幅 360 でも 2 列 = 1 画面に
// 収める。#117 のデザインレビュー N1。削除は区切りの下に離して置き、押し間違えても一覧の ［元に戻す］ で戻せる）
// 満期で消滅は押す形のトグル（LC の「なし」と同じ形。aria-pressed）。決済の時刻は持たない（満期で消えたら SQ の日。C54）
import type { LegDraft, LegField } from '../lib/legs-form';
import { LEG_FIELD_LABEL, toggleExpired } from '../lib/legs-form';
import '../styles/legs.css';
import { Button } from './Button';
import { Icon } from './Icon';
import { NumberField } from './NumberField';
import { Segment } from './Segment';
import { TextField } from './TextField';

export interface LegEditorProps {
  readonly leg: LegDraft;
  /** 0 から（id と読み上げの「レッグ 2」） */
  readonly index: number;
  readonly errors?: Readonly<Partial<Record<LegField, string>>>;
  readonly onChange: (leg: LegDraft) => void;
  readonly onRemove: () => void;
}

export const EXPIRED_LABEL = '満期で消滅';
export const EXPIRED_HINT = '決済明細に出ないレッグ。決済は SQ での価値（OTM なら 0）';

export function LegEditor(p: LegEditorProps) {
  const l = p.leg;
  const id = (f: string) => `leg-${p.index}-${f}`;
  const set =
    <K extends keyof LegDraft>(k: K) =>
    (v: LegDraft[K]) =>
      p.onChange({ ...l, [k]: v });
  const err = (f: LegField) => (p.errors?.[f] ? { error: p.errors[f] } : {});
  return (
    <div class="legedit">
      <div class="record__pair record__pair--prices">
        <Segment
          label={LEG_FIELD_LABEL.optionType}
          id={id('type')}
          value={l.optionType}
          onChange={set('optionType')}
          options={[
            // 「P」「C」だけ（題が「P / C」。2 列の幅で折れない。#117 のデザインレビューの見直し 1）
            { value: 'P', label: 'P' },
            { value: 'C', label: 'C' },
          ]}
        />
        <Segment
          label={LEG_FIELD_LABEL.side}
          id={id('side')}
          value={l.side}
          onChange={set('side')}
          options={[
            { value: 'buy', label: '買い' },
            { value: 'sell', label: '売り' },
          ]}
        />
      </div>
      <div class="record__pair record__pair--prices">
        <TextField
          id={id('month')}
          label={LEG_FIELD_LABEL.contractMonth}
          value={l.contractMonth}
          onInput={set('contractMonth')}
          placeholder="2027-01"
          inputMode="numeric"
          {...err('contractMonth')}
        />
        <NumberField
          id={id('strike')}
          label={LEG_FIELD_LABEL.strike}
          value={l.strike}
          onInput={set('strike')}
          {...err('strike')}
        />
      </div>
      <div class="record__pair record__pair--prices">
        <NumberField
          id={id('qty')}
          label={LEG_FIELD_LABEL.quantity}
          value={l.quantity}
          onInput={set('quantity')}
          unit="枚"
          {...err('quantity')}
        />
        <div class="legedit__expired">
          <button
            type="button"
            class="lcnone legedit__toggle"
            id={id('expired')}
            aria-pressed={l.expired ? 'true' : 'false'}
            aria-describedby={id('expired-hint')}
            onClick={() => p.onChange(toggleExpired(l))}
          >
            {l.expired ? <Icon name="check" /> : null}
            <span>{EXPIRED_LABEL}</span>
          </button>
        </div>
      </div>
      <p class="field__hint legedit__hint" id={id('expired-hint')}>
        {EXPIRED_HINT}
      </p>
      <div class="record__pair record__pair--prices">
        <NumberField
          id={id('entry')}
          label={LEG_FIELD_LABEL.entryPrice}
          value={l.entryPrice}
          onInput={set('entryPrice')}
          {...err('entryPrice')}
        />
        <NumberField
          id={id('exit')}
          label={LEG_FIELD_LABEL.exitPrice}
          value={l.exitPrice}
          onInput={set('exitPrice')}
          {...err('exitPrice')}
        />
      </div>
      <hr class="legedit__sep" />
      <Button variant="secondary" size="sm" icon="trash" id={id('remove')} onClick={p.onRemove}>
        このレッグを削除
      </Button>
    </div>
  );
}
