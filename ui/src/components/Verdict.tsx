// 判定・理由・R・リスクの枠（記録する画面 #13・取引の詳細と直す画面 #9 が共有する。Issue #9 で Record.tsx から出した。
// クラス・文言・順は同じ）。枠の色は判定の段だけ、数字は無色（C34）。hook を持たない
import type { ComponentChildren } from 'preact';
import type { Grade } from '../../../core/judge';
import type { Side } from '../../../core/trade';
import { badgeModel } from '../lib/badge';
import { formatPct } from '../lib/format';
import { reasonText } from '../lib/reasons';
import { type Preview, RISK_NOTE, type Summary } from '../lib/record-form';
import { Icon } from './Icon';
import { JudgeBadge } from './JudgeBadge';
import { RNum, YenNum } from './Num';

export const VERDICT_TITLE_ID = 'record-verdict-title';

/** 判定ごとの添え書き（危ない勝ちは負けと同じくらい目立たせる。設計書 5.4） */
export const GRADE_LEAD: Partial<Record<Grade, string>> = {
  riskyWin: '勝っても、規律は崩れています。',
  C: 'LC を決めずに入った取引です。',
};

export interface VerdictProps {
  readonly summary: Summary | Preview;
  readonly side: Side;
  /** 保存の後の知らせ（「記録しました」） */
  readonly status?: string;
  readonly caption?: string;
  /** 保存の後の添え書き（「チャート 2 枚も保存しました」） */
  readonly note?: string;
  readonly gapSlip?: ComponentChildren;
  /** 判定がまだ出ていない（足りない欄・誤りがある） */
  readonly pending?: boolean;
  /** 入力に誤りがある（案内の文を変える） */
  readonly hasErrors?: boolean;
  /** 見出しの id（既定は記録する画面の id。詳細の画面は別の id を渡す） */
  readonly titleId?: string;
  /** 直す前の判定（直す画面だけ。直す前 → 直した後が分かるように、判定の行の上に出す） */
  readonly before?: Summary;
}

/** 判定・理由・R・リスクの枠。枠の色は判定の段だけ、数字は無色 */
export function Verdict(v: VerdictProps) {
  const titleId = v.titleId ?? VERDICT_TITLE_ID;
  const j = v.summary.judgment;
  const tier = badgeModel(j?.grade ?? null).tier;
  const lead = j ? GRADE_LEAD[j.grade] : undefined;
  const waiting = v.hasErrors ? '誤りを直すと出ます' : 'イン・決済・LC で出ます';
  const rNote = v.summary.invalid
    ? RISK_NOTE.invalid
    : v.summary.noLc
      ? 'LC が無いので出ません'
      : waiting;
  const riskNote = v.summary.riskNote ?? waiting;
  return (
    <section
      class={`card verdict verdict--${tier}${v.status ? ' verdict--saved' : ''}`}
      aria-labelledby={titleId}
    >
      {v.status ? (
        <p class="verdict__status" role="status">
          <Icon name="check" />
          <span>{v.status}</span>
        </p>
      ) : null}
      <div class="verdict__head">
        <h2 class="verdict__title" id={titleId} tabIndex={-1}>
          判定
        </h2>
        <JudgeBadge grade={j?.grade ?? null} size="lg" />
      </div>
      {v.before ? (
        <p class="verdict__before">
          <span class="verdict__label">直す前</span>
          <JudgeBadge grade={v.before.judgment?.grade ?? null} />
          {v.before.r !== undefined ? <RNum value={v.before.r} /> : null}
          <span class="verdict__label">→ 直した後（下）</span>
        </p>
      ) : null}
      {lead ? <p class="verdict__lead">{lead}</p> : null}
      <dl class="verdict__stats">
        <div class="verdict__stat">
          <dt class="verdict__label">R</dt>
          <dd>
            {v.summary.r !== undefined ? (
              <RNum value={v.summary.r} size="xl" />
            ) : (
              <span class="verdict__note">{rNote}</span>
            )}
          </dd>
        </div>
        <div class="verdict__stat">
          <dt class="verdict__label">リスク</dt>
          <dd>
            {v.summary.riskPct !== undefined ? (
              <span class="num num--lg">{formatPct(v.summary.riskPct)}</span>
            ) : (
              <span class="verdict__note">{riskNote}</span>
            )}
          </dd>
        </div>
        {v.summary.pnlYen !== undefined ? (
          <div class="verdict__stat">
            <dt class="verdict__label">損益</dt>
            <dd>
              <YenNum value={v.summary.pnlYen} size="lg" />
            </dd>
          </div>
        ) : null}
      </dl>
      {j ? (
        <ul class="reasons" aria-label="理由">
          {j.reasons.map((r, i) => (
            <li key={`${r.kind}-${i}`} class="reasons__item">
              {reasonText(r, v.side)}
            </li>
          ))}
        </ul>
      ) : v.pending ? (
        <p class="verdict__hint">
          {v.hasErrors
            ? '誤りのある欄を直すと、判定と理由が出ます。'
            : '足りない欄をそろえると、判定と理由が出ます。'}
        </p>
      ) : null}
      {v.gapSlip ? <div class="verdict__ask">{v.gapSlip}</div> : null}
      {v.caption ? <p class="verdict__caption">{v.caption}</p> : null}
      {v.note ? <p class="verdict__caption">{v.note}</p> : null}
    </section>
  );
}
