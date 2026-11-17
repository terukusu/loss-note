// ボタン（主 / 副 / 控えめ）。当たりは 44×44px 以上（--tap）。href があればアプリの中のリンクとして描く
import type { ComponentChildren } from 'preact';
import { Link } from '../lib/router';
import { Icon, type IconName } from './Icon';

export interface ButtonProps {
  readonly variant?: 'primary' | 'secondary' | 'ghost';
  readonly size?: 'md' | 'lg';
  readonly icon?: IconName;
  readonly block?: boolean;
  readonly href?: string;
  /** フォーカスを戻す先にするときの ID（保存に失敗して戻ったときなど） */
  readonly id?: string;
  readonly type?: 'button' | 'submit';
  readonly disabled?: boolean;
  /** 読み上げの名前（見た目の文字だけでは区別できないとき。例: 2 つの枠の [外す]） */
  readonly label?: string;
  readonly onClick?: () => void;
  readonly children: ComponentChildren;
}

export function buttonClass(p: Pick<ButtonProps, 'variant' | 'size' | 'block'>): string {
  return [
    'btn',
    `btn--${p.variant ?? 'primary'}`,
    p.size === 'lg' ? 'btn--lg' : '',
    p.block ? 'btn--block' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function Button(p: ButtonProps) {
  const cls = buttonClass(p);
  const body = (
    <>
      {p.icon ? <Icon name={p.icon} /> : null}
      <span>{p.children}</span>
    </>
  );
  if (p.href !== undefined) {
    return (
      <Link href={p.href} class={cls}>
        {body}
      </Link>
    );
  }
  return (
    <button
      type={p.type ?? 'button'}
      id={p.id}
      aria-label={p.label}
      class={cls}
      disabled={p.disabled}
      onClick={p.onClick}
    >
      {body}
    </button>
  );
}
