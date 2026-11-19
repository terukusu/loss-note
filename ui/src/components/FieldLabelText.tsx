// 欄の名前の文字（「〜（任意）」の「（任意）」だけを薄く小さく分ける。任意の欄が一目で分かるように。#58 デザインレビュー 3）。
// 文字そのものは同じ（読み上げ・テストの文字は「根拠が崩れる条件（任意）」のまま）
const OPTIONAL = '（任意）';

export function FieldLabelText({ text }: { readonly text: string }) {
  if (!text.endsWith(OPTIONAL) || text === OPTIONAL) return <>{text}</>;
  return (
    <>
      {text.slice(0, -OPTIONAL.length)}
      <span class="field__optional">{OPTIONAL}</span>
    </>
  );
}
