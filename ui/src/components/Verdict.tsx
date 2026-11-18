// 判定・理由・R・リスクの枠（記録する画面 #13・取引の詳細と直す画面 #9 が共有する。Issue #9 で Record.tsx から出した。
// クラス・文言・順は同じ）。枠の色は判定の段だけ、数字は無色（C34）。hook を持たない
import { type ComponentChildren, Fragment } from 'preact';
import type { Grade } from '../../../core/judge';
import type { Side } from '../../../core/trade';
import { badgeModel } from '../lib/badge';
import { formatPct } from '../lib/format';
import { reasonText } from '../lib/reasons';
import { type Preview, RISK_NOTE, type Summary } from '../lib/record-form';
import { MISSING, OFF_PLAN_TEXT, TAPS_LABEL, type TapAnswer } from '../lib/trade-view';
import { FX_NOT_CHECKED, sizingLine, verdictNotes } from '../lib/verdict-notes';
import { Icon } from './Icon';
import { InfoTip } from './InfoTip';
import { JudgeBadge } from './JudgeBadge';
import { MoneyNum, RNum } from './Num';
import { Ruler } from './Ruler';

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
  /**
   * 押せない理由の案内（記録する画面だけ。欄の名前つきの 1 文。null = 押せる）。渡さなければ、判定を待つ間に
   * 決まった案内を出す（直す画面）
   */
  readonly hint?: string | null;
  /** 案内の要素の id（[記録する] の aria-describedby が指す） */
  readonly hintId?: string;
  /** 見出しの id（既定は記録する画面の id。詳細の画面は別の id を渡す） */
  readonly titleId?: string;
  /** 直す前の判定（直す画面だけ。直す前 → 直した後が分かるように、判定の行の上に出す） */
  readonly before?: Summary;
  /**
   * 3 つ目のタップの答えとチャートの時間足の違いが食い違うときの 1 行（記録する画面だけ。#27）。チャートからの
   * 「時間足を変えた」の理由の 2 行目に、責めずに事実として並べる
   */
  readonly chartConflict?: string | null;
  /** 3 つのタップの答え（取引の詳細だけ。理由の下に札で並べる。#34） */
  readonly taps?: { readonly items: readonly TapAnswer[]; readonly note: string | null };
  /**
   * どの口座の資金で割ったかの 1 行（#47 U10・U17。口座が 2 つ以上のときだけ画面が渡す）。数の段のすぐ下に無色で出す
   */
  readonly account?: string;
  /**
   * 「見ていないもの」の注記のすぐ後に置く操作（編集の画面だけ。写した資金が空で今の口座の資金があるときの
   * [今の値で計算し直す]。#31）。注記が無ければ出さない
   */
  readonly asideAction?: ComponentChildren;
}

/** 3 つのタップの答えの札（外れた札は形の印・「外れ」の文字・読み上げの「計画から外れた」） */
function Taps({ items, note }: NonNullable<VerdictProps['taps']>) {
  return (
    <>
      <ul class="taps" aria-label={TAPS_LABEL}>
        {items.map((a) => (
          <li key={a.label} class={a.offPlan ? 'taps__item taps__item--off' : 'taps__item'}>
            <span class="taps__chip">
              {a.offPlan ? (
                <>
                  <Icon name="offPlan" />
                  <span class="taps__off" aria-hidden="true">
                    外れ
                  </span>
                </>
              ) : null}
              <span>
                {a.label}: {a.value}
              </span>
              {a.offPlan ? <span class="sr-only">{OFF_PLAN_TEXT}</span> : null}
            </span>
            {/* 問いの説明（記録する画面と同じ「i」。札の枠の外に置く = 枠の入れ子を増やさない。#57 デザインレビュー 8） */}
            <InfoTip term={a.term} size="sm" id={`info-tap-${a.term}`} />
          </li>
        ))}
      </ul>
      {note ? <p class="verdict__aside">{note}</p> : null}
    </>
  );
}

/** 値が出ない場所（「—」。読み上げには「出ません」。理由は枠の下の注記に 1 回だけ） */
function None() {
  return (
    <span class="verdict__none">
      <span aria-hidden="true">{MISSING}</span>
      <span class="sr-only">出ません</span>
    </span>
  );
}

/** 判定・理由・R・リスクの枠。枠の色は判定の段だけ、数字は無色 */
export function Verdict(v: VerdictProps) {
  const titleId = v.titleId ?? VERDICT_TITLE_ID;
  const j = v.summary.judgment;
  const tier = badgeModel(j?.grade ?? null).tier;
  const lead = j ? GRADE_LEAD[j.grade] : undefined;
  const pending = v.pending === true;
  const n = verdictNotes(v.summary, { pending });
  const sizing = sizingLine(v.summary, { pending });
  const hint =
    v.hint !== undefined && v.hint !== null
      ? v.hint
      : pending
        ? v.hasErrors
          ? '誤りのある欄を直すと、判定と理由が出ます。'
          : '足りない欄をそろえると、判定と理由が出ます。'
        : null;
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
        {/* 判定の名前の説明（#57。見出しの横・バッジの前。箱は見出しの段の下に開く） */}
        <InfoTip term="judgment" />
        <JudgeBadge grade={j?.grade ?? null} size="lg" />
      </div>
      {v.before ? (
        <p class="verdict__before">
          <span class="verdict__label">編集前</span>
          <JudgeBadge grade={v.before.judgment?.grade ?? null} />
          {v.before.r !== undefined ? <RNum value={v.before.r} /> : null}
          <span class="verdict__label">→ 編集後（下）</span>
        </p>
      ) : null}
      {lead ? <p class="verdict__lead">{lead}</p> : null}
      {n.hideRisk && v.summary.pnlYen === undefined ? null : (
        <dl class="verdict__stats">
          {n.hideRisk ? null : (
            <>
              <div class="verdict__stat">
                <dt class="verdict__label verdict__label--info">
                  R<InfoTip term="r" size="sm" prefer="above" />
                </dt>
                <dd>
                  {v.summary.r !== undefined ? <RNum value={v.summary.r} size="xl" /> : <None />}
                </dd>
              </div>
              <div class="verdict__stat">
                <dt class="verdict__label">リスク</dt>
                <dd>
                  {v.summary.riskPct !== undefined ? (
                    <span class="num num--lg">{formatPct(v.summary.riskPct)}</span>
                  ) : (
                    <None />
                  )}
                </dd>
              </div>
            </>
          )}
          {v.summary.pnlYen !== undefined ? (
            <div
              class={
                (v.summary.currency ?? 'JPY') === 'JPY'
                  ? 'verdict__stat'
                  : 'verdict__stat verdict__stat--pnl-row'
              }
            >
              <dt class="verdict__label">損益</dt>
              <dd>
                <MoneyNum
                  value={v.summary.pnlYen}
                  currency={v.summary.currency ?? 'JPY'}
                  size="lg"
                />
              </dd>
            </div>
          ) : !n.hideRisk && v.summary.riskNote === RISK_NOTE.noOneRFx ? (
            // 外貨建てで為替も損益も無い: 損益も「—」（注記は「為替か損益を入力すると表示されます」の 1 回。U26・F2）
            <div class="verdict__stat">
              <dt class="verdict__label">損益</dt>
              <dd>
                <None />
              </dd>
            </div>
          ) : null}
        </dl>
      )}
      {/* 数量と提案の数量（#67。数の段のすぐ下・口座の 1 行の前に無色で 1 行。区切りの中では折らず、「·」は前の区切りの末尾に付ける） */}
      {sizing !== null ? (
        <p class="verdict__aside verdict__sizing">
          {sizing.map((seg, i) => (
            <Fragment key={seg}>
              {i > 0 ? ' ' : null}
              <span class="verdict__seg">{i < sizing.length - 1 ? `${seg} ·` : seg}</span>
            </Fragment>
          ))}
        </p>
      ) : null}
      {v.account ? <p class="verdict__aside verdict__account">{v.account}</p> : null}

      {n.notes.map((t) => (
        <p key={t} class="verdict__aside verdict__why">
          {t}
        </p>
      ))}
      {/* LC の物差し（#34。数の後・理由の前に 1 段。判定が出てから） */}
      {!pending && v.summary.ruler ? <Ruler ruler={v.summary.ruler} /> : null}
      {n.reasons.length > 0 ? (
        <ul class="reasons" aria-label="理由">
          {n.reasons.map((r, i) => (
            <li key={`${r.kind}-${i}`} class="reasons__item">
              {reasonText(r, v.side)}
              {v.chartConflict && r.kind === 'timeframeLonger' && r.source === 'chart' ? (
                <span class="reasons__sub">{v.chartConflict}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {n.aside.map((r, i) => (
        <p key={`${r.kind}-${i}`} class="verdict__aside">
          {n.fxMissing && r.kind === 'riskNotChecked' && r.cause === 'noOneR'
            ? FX_NOT_CHECKED
            : reasonText(r, v.side)}
        </p>
      ))}
      {v.asideAction && n.aside.length > 0 ? (
        <div class="verdict__action">{v.asideAction}</div>
      ) : null}
      {v.taps ? <Taps {...v.taps} /> : null}
      {hint ? (
        <p class="verdict__hint" id={v.hintId}>
          {hint}
        </p>
      ) : null}
      {v.gapSlip ? <div class="verdict__ask">{v.gapSlip}</div> : null}
      {v.caption ? <p class="verdict__caption">{v.caption}</p> : null}
      {v.note ? <p class="verdict__caption">{v.note}</p> : null}
    </section>
  );
}
