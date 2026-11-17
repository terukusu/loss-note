// 判定のバッジ（契約 C-2）。ラベルの文字 + 段の記号（読み上げから隠す）+ 段の色
import type { Grade } from '../../../core/judge';
import { badgeModel } from '../lib/badge';
import { Icon } from './Icon';

export function JudgeBadge({
  grade,
  size,
}: {
  readonly grade: Grade | null;
  readonly size?: 'lg';
}) {
  const m = badgeModel(grade);
  return (
    <span class={size === 'lg' ? `${m.className} badge--lg` : m.className}>
      <Icon name={m.symbol} class="badge__mark" />
      <span>{m.label}</span>
    </span>
  );
}
