// 画面の上の帯（docs/ui-guidelines.md 9.2・9.3・9.12。#127）。hook を持たない。
// - TopBar: 次の画面（詳細・用語集）の帯。左に「‹ 前の画面の名前」のボタン、真ん中に題（h1）、右にその画面の操作
// - SheetBar: 全画面のシート（記録する・編集）の帯。左上に ✕ のアイコンのボタン（読み上げの名前「キャンセル」）、真ん中に題（h1）
// h1 は画面が変わったときにフォーカスを受ける（tabindex=-1）。帯は上の安全域の分だけ内側に寄せ、面は端まで敷く（9.6）
import type { ComponentChildren } from 'preact';
import { Link } from '../lib/router';
import { IconButton } from './Button';
import { Icon } from './Icon';

export interface BackTarget {
  /** 前の画面の名前（「‹ 取引」の〈取引〉） */
  readonly label: string;
  /** 押したとき（前の画面へ戻る）。無ければ href へのリンク */
  readonly onBack?: (() => void) | undefined;
  readonly href?: string;
}

/** 「‹ 前の画面の名前」のボタン（アイコンと名前。読み上げは「〈名前〉へ戻る」） */
export function BackButton({ back }: { readonly back: BackTarget }) {
  const body = (
    <>
      <Icon name="back" />
      <span class="appbar__backlabel">{back.label}</span>
    </>
  );
  const name = `${back.label}へ戻る`;
  if (back.onBack || back.href === undefined) {
    return (
      <button type="button" class="appbar__back" aria-label={name} onClick={back.onBack}>
        {body}
      </button>
    );
  }
  return (
    <Link href={back.href} class="appbar__back" aria-label={name}>
      {body}
    </Link>
  );
}

export interface TopBarProps {
  readonly back: BackTarget;
  readonly title: string;
  /** 帯の右の操作（［編集］など） */
  readonly actions?: ComponentChildren;
}

export function TopBar(p: TopBarProps) {
  return (
    <header class="appbar">
      <div class="appbar__start">
        <BackButton back={p.back} />
      </div>
      <h1 class="appbar__title" tabIndex={-1}>
        {p.title}
      </h1>
      <div class="appbar__end">{p.actions ?? null}</div>
    </header>
  );
}

export interface SheetBarProps {
  readonly title: string;
  /** ✕（キャンセル）。押したとき。無ければ cancelHref へのリンク */
  readonly onCancel?: (() => void) | undefined;
  readonly cancelHref?: string;
  /** 保存中など、✕ を押せない */
  readonly cancelDisabled?: boolean;
  /** 帯の右（進み具合など） */
  readonly end?: ComponentChildren;
}

/** 全画面のシートの帯（左上の ✕ = キャンセル。広い形でも同じ左上） */
export function SheetBar(p: SheetBarProps) {
  return (
    <header class="appbar appbar--sheet">
      <div class="appbar__start">
        <IconButton
          icon="close"
          label="キャンセル"
          class="appbar__close"
          {...(p.onCancel || p.cancelHref === undefined
            ? { onClick: p.onCancel, disabled: p.cancelDisabled ?? false }
            : { href: p.cancelHref })}
        />
      </div>
      <h1 class="appbar__title" tabIndex={-1}>
        {p.title}
      </h1>
      <div class="appbar__end">{p.end ?? null}</div>
    </header>
  );
}
