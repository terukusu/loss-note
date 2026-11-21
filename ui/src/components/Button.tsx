// 押せる形の部品（docs/ui-guidelines.md 9.12。#127）。操作はボタン（重さ 3 段）・チップ・押せる行のどれかで、文字だけの
// リンクの見た目の操作は置かない（文字のリンクは文の中で用語集などへ移るときだけ = GlossaryText）。当たりは 44×44px 以上（--tap）。
// - Button: 1 番目 primary（面の塗り。1 画面に 1 つ）/ 2 番目 secondary（枠と薄い面）・tonal（薄い面だけ。文字はアクセント）
// - IconButton: 3 番目（アイコンだけ。読み上げの名前を必ず付ける。✕・‹・…・i）
// - RowLink: 押せる行（行全体が当たり、右に ›）
// - Chip: 角の丸い面（関係する言葉の札など）。onClick を渡すと押す形（選ぶ・外す。aria-pressed。#156）
// href があればアプリの中のリンクとして描く
import type { ComponentChildren } from 'preact';
import { Link } from '../lib/router';
import { Icon, type IconName } from './Icon';

export interface ButtonProps {
  readonly variant?: 'primary' | 'secondary' | 'tonal';
  /** sm = 帯・カードの見出しの行の中の小さいボタン（見た目の高さ 36px・当たりは 44px のまま。#127 デザイン a4・a5） */
  readonly size?: 'sm' | 'md' | 'lg';
  readonly icon?: IconName;
  readonly block?: boolean;
  readonly href?: string;
  /** フォーカスを戻す先にするときの ID（保存に失敗して戻ったときなど） */
  readonly id?: string;
  readonly type?: 'button' | 'submit';
  readonly disabled?: boolean | undefined;
  /** 読み上げの名前（見た目の文字だけでは区別できないとき。例: 2 つの枠の [外す]） */
  readonly label?: string | undefined;
  /** 読み上げの説明の要素の id（押せない理由など。aria-describedby） */
  readonly describedBy?: string;
  readonly onClick?: (() => void) | undefined;
  /** 書きかけの印の点（#75）。読み上げに足す文（例: 「入力の途中あり」）。省けば点を出さない */
  readonly dot?: string;
  /** 足すクラス（置き場の調整） */
  readonly class?: string | undefined;
  readonly children: ComponentChildren;
}

/** 書きかけの印の点（見た目は点だけ、読み上げは文。#75） */
export function DraftDot({ text }: { readonly text: string }) {
  return (
    <>
      <span class="draftdot" aria-hidden="true" />
      <span class="sr-only">（{text}）</span>
    </>
  );
}

export function buttonClass(
  p: Pick<ButtonProps, 'variant' | 'size' | 'block'> & { readonly class?: string | undefined },
): string {
  return [
    'btn',
    `btn--${p.variant ?? 'primary'}`,
    p.size === 'lg' ? 'btn--lg' : p.size === 'sm' ? 'btn--sm' : '',
    p.block ? 'btn--block' : '',
    p.class ?? '',
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
      {p.dot ? <DraftDot text={p.dot} /> : null}
    </>
  );
  if (p.href !== undefined) {
    return (
      <Link href={p.href} class={cls} aria-label={p.label}>
        {body}
      </Link>
    );
  }
  return (
    <button
      type={p.type ?? 'button'}
      id={p.id}
      aria-label={p.label}
      aria-describedby={p.describedBy}
      class={cls}
      disabled={p.disabled}
      onClick={p.onClick}
    >
      {body}
    </button>
  );
}

export interface IconButtonProps {
  readonly icon: IconName;
  /** 読み上げの名前（必須。見た目はアイコンだけ） */
  readonly label: string;
  readonly href?: string;
  readonly id?: string;
  readonly disabled?: boolean | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly class?: string | undefined;
}

/** 3 番目の重さ: アイコンだけのボタン（当たり 44px。帯の端・カードの右上） */
export function IconButton(p: IconButtonProps) {
  const cls = p.class ? `iconbtn ${p.class}` : 'iconbtn';
  if (p.href !== undefined) {
    return (
      <Link href={p.href} class={cls} aria-label={p.label} id={p.id}>
        <Icon name={p.icon} />
      </Link>
    );
  }
  return (
    <button
      type="button"
      id={p.id}
      class={cls}
      aria-label={p.label}
      disabled={p.disabled}
      onClick={p.onClick}
    >
      <Icon name={p.icon} />
    </button>
  );
}

export interface RowLinkProps {
  readonly href?: string;
  readonly onClick?: (() => void) | undefined;
  /** 行の右の添え（件数・「未記入」など。› の左） */
  readonly meta?: ComponentChildren;
  readonly id?: string;
  readonly children: ComponentChildren;
}

/** 押せる行: 行全体が当たり、右に ›（擬似要素で描く。読み上げは行の文字） */
export function RowLink(p: RowLinkProps) {
  const body = (
    <>
      <span class="rowlink__text">{p.children}</span>
      {p.meta ? <span class="rowlink__meta">{p.meta}</span> : null}
    </>
  );
  if (p.href !== undefined) {
    return (
      <Link href={p.href} class="rowlink" id={p.id}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" class="rowlink" id={p.id} onClick={p.onClick}>
      {body}
    </button>
  );
}

/** チップ: 角の丸い面（押せるときは a。関係する言葉の札など） */
export function Chip(p: {
  readonly href?: string;
  readonly selected?: boolean;
  /**
   * 押す形（#156。心理のタグなど、選ぶ・外すチップ）: button と aria-pressed。選ぶと面 + アクセントの輪 + ✓（✓ は読み上げから
   * 隠す。押されているかは aria-pressed が伝える）
   */
  readonly onClick?: () => void;
  readonly children: ComponentChildren;
}) {
  const cls = p.selected ? 'chip chip--selected' : 'chip';
  if (p.onClick !== undefined) {
    return (
      <button
        type="button"
        class={`${cls} chip--toggle`}
        aria-pressed={p.selected ? 'true' : 'false'}
        onClick={p.onClick}
      >
        {p.selected ? <Icon name="check" class="chip__check" /> : null}
        <span>{p.children}</span>
      </button>
    );
  }
  if (p.href !== undefined) {
    // ページの中のリンク（#…）はブラウザに任せる（用語集の項目へ。Glossary.tsx が履歴に積む）
    return p.href.startsWith('#') ? (
      <a href={p.href} class={cls}>
        {p.children}
      </a>
    ) : (
      <Link href={p.href} class={cls}>
        {p.children}
      </Link>
    );
  }
  return <span class={cls}>{p.children}</span>;
}
