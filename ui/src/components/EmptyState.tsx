// 空の状態（見出し・説明・任意の動作）
import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from './Icon';

export interface EmptyStateProps {
  readonly icon: IconName;
  readonly title: string;
  readonly description?: ComponentChildren;
  readonly children?: ComponentChildren;
}

export function EmptyState(p: EmptyStateProps) {
  return (
    <section class="empty card">
      <div class="empty__icon">
        <Icon name={p.icon} />
      </div>
      <h2 class="empty__title">{p.title}</h2>
      {p.description ? <p class="empty__desc">{p.description}</p> : null}
      {p.children ? <div class="empty__actions">{p.children}</div> : null}
    </section>
  );
}
