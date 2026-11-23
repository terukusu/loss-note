// 2〜3 択のセグメント（記録の決済までの行動のタップ・L / S などに使う。契約 C-3）。制御された部品で、状態は親が持つ。
// 中身はネイティブの radio（読み上げの role="radio"・矢印キーでの移動と選択・Tab で選ばれた 1 つに止まる、を
// ブラウザが持つ）。選ばれたものは面の濃さ・強調の枠・文字の前のチェックの記号の 3 つで表す（色だけに頼らない。Issue #33）。
// radio は項目の全面に透明で重ね、当たり = 項目の大きさ（44×44px 以上）。項目はそれぞれが入力の部品の枠を持つ
// （セグメント全体の枠は持たない。カードの中で枠が 3 段にならない）
import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from './Icon';

export interface SegmentOption<V extends string> {
  readonly value: V;
  readonly label: string;
  readonly icon?: IconName;
  /** 選べない項目（理由は部品の下の 1 行で言い、describedBy で結ぶ。#165 の「取消」） */
  readonly disabled?: boolean;
}

export interface SegmentProps<V extends string> {
  readonly label: string;
  readonly options: readonly SegmentOption<V>[];
  readonly value: V | null;
  readonly onChange: (value: V) => void;
  /** radio のグループの名前（同じ画面に同じ label のセグメントを 2 つ置くときに変える） */
  readonly name?: string;
  /** 見出しを部品の上に見せるか（false なら読み上げの名前だけ） */
  readonly showLabel?: boolean;
  /** 欄の印（明細の読み取りの「読み取り」「明細から」など。#15）。見出しの横に文字で出し、読み上げの説明に入れる */
  readonly mark?: string;
  /** 印の要素の ID の元（印を出すときに渡す。空白を含まない） */
  readonly id?: string;
  /**
   * 長い項目の名前を 1 行の「…」で省略する（口座の名前。#47 U4）。項目は中身に合わせた幅（短い名前は小さく、
   * 長い名前が残りを取る。1 つは 60% まで）で、チェックの記号は切らない。全文は項目の文字のまま（読み上げの名前に入る）と
   * title（ポインタを置くと出る）
   */
  readonly truncate?: boolean;
  /** 部品の下の説明の要素の ID（直す画面で口座を替えたときの 1 行など。#47 U19）。radiogroup の読み上げの説明に結ぶ */
  readonly describedBy?: string | undefined;
  /**
   * truncate のとき、残りの幅を取る項目の位置（長い名前が 1 つだけあるとき。ほかの項目は名前の幅のまま）。
   * 無ければ等分。どちらでも ✓ の幅はどの項目にも先に取り、選ぶたびに境目が動かない（再レビュー 2・N2）
   */
  readonly grow?: number | null | undefined;
  /** 見出しの右の 1 行（「選択中: 〈名前〉」。1 行・省略・全文は title）。読み上げは radio の名前で足りるので外す */
  readonly note?: string | null | undefined;
  /** 見出しの横の「i」（言葉の説明の InfoTip。#57）。radiogroup の外（見出しの段）に置き、説明は段の下に開く */
  readonly info?: ComponentChildren;
}

export function Segment<V extends string>(p: SegmentProps<V>) {
  const name = p.name ?? `seg-${p.label}`;
  const markId = `${p.id ?? name.replace(/\s+/g, '_')}-mark`;
  const label =
    p.showLabel === false ? null : (
      <span class="field__label" aria-hidden="true">
        {p.label}
      </span>
    );
  const note = p.note ? (
    <span class="seg__note" aria-hidden="true" title={p.note}>
      {p.note}
    </span>
  ) : null;
  const fit = p.truncate === true && p.grow !== undefined && p.grow !== null;
  return (
    <div class="field">
      {/* 名前の段は「i」・印・添えの有無にかかわらず同じ形（#210。NumberField と同じ直し方）。形を替えると Preact が後ろの
          radio を作り直し、選んでいる間に印が出入りするとフォーカスが外れる。見出しを見せず何も無い段は CSS で隠す
          （.field__head:empty） */}
      <div class="field__head">
        {label}
        {p.info ?? null}
        {p.mark ? (
          <span id={markId} class="field__mark">
            {p.mark}
          </span>
        ) : null}
        {note}
      </div>
      <div
        class={p.truncate ? (fit ? 'seg seg--truncate seg--fit' : 'seg seg--truncate') : 'seg'}
        role="radiogroup"
        aria-label={p.label}
        aria-describedby={
          [p.mark ? markId : null, p.describedBy ?? null].filter(Boolean).join(' ') || undefined
        }
        data-count={p.options.length}
      >
        {p.options.map((o, i) => (
          <label
            key={o.value}
            class={[
              'seg__item',
              fit && i === p.grow ? 'seg__item--grow' : '',
              o.disabled ? 'seg__item--off' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            title={p.truncate ? o.label : undefined}
          >
            <input
              class="seg__input"
              type="radio"
              name={name}
              value={o.value}
              checked={o.value === p.value}
              disabled={o.disabled === true}
              onChange={() => p.onChange(o.value)}
            />
            {o.value === p.value ? (
              <Icon name="check" class="seg__check" />
            ) : p.truncate ? (
              <Icon name="check" class="seg__check seg__check--off" />
            ) : null}
            {o.icon ? <Icon name={o.icon} /> : null}
            <span class={p.truncate ? 'seg__text' : undefined}>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
