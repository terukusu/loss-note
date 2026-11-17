// 2〜3 択のセグメント（記録の 3 つのタップに使う。契約 C-3）。制御された部品で、状態は親が持つ。
// 中身はネイティブの radio（読み上げの role="radio"・矢印キーでの移動と選択・Tab で選ばれた 1 つに止まる、を
// ブラウザが持つ）。選ばれたものは面と太さと checked で表す（色だけに頼らない）。
// radio は項目の全面に透明で重ね、当たり = 項目の大きさ（44×44px 以上）。選んだ項目は右上にチェックの記号を重ねる（幅を取らない）
import { Icon, type IconName } from './Icon';

export interface SegmentOption<V extends string> {
  readonly value: V;
  readonly label: string;
  readonly icon?: IconName;
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
}

export function Segment<V extends string>(p: SegmentProps<V>) {
  const name = p.name ?? `seg-${p.label}`;
  return (
    <div class="field">
      {p.showLabel === false ? null : (
        <span class="field__label" aria-hidden="true">
          {p.label}
        </span>
      )}
      <div class="seg" role="radiogroup" aria-label={p.label} data-count={p.options.length}>
        {p.options.map((o) => (
          <label key={o.value} class="seg__item">
            <input
              class="seg__input"
              type="radio"
              name={name}
              value={o.value}
              checked={o.value === p.value}
              onChange={() => p.onChange(o.value)}
            />
            {o.icon ? <Icon name={o.icon} /> : null}
            {o.value === p.value ? <Icon name="check" class="seg__check" /> : null}
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
