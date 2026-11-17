// 記号（SVG）。色は currentColor（文字の色を継ぐ）、読み上げからは隠す（名前は親の文字・aria-label が持つ）
import type { JSX } from 'preact';

export type IconName =
  | 'home'
  | 'record'
  | 'list'
  | 'settings'
  | 'circle'
  | 'triangle'
  | 'cross'
  | 'dash'
  | 'back'
  | 'moon'
  | 'sun'
  | 'image'
  | 'lock'
  | 'check'
  | 'logout'
  | 'mark';

const SHAPES: Readonly<Record<IconName, () => JSX.Element>> = {
  home: () => (
    <>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v11h4.5v-6h4v6h4.5V9" />
    </>
  ),
  record: () => (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  list: () => (
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
    </>
  ),
  settings: () => (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  circle: () => <circle cx="12" cy="12" r="7" />,
  triangle: () => <path d="M12 4.5 20 19H4z" />,
  cross: () => <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  dash: () => <path d="M5.5 12h13" />,
  logout: () => (
    <>
      <path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14" />
      <path d="M10 8l-4 4 4 4M6 12h9.5" />
    </>
  ),
  check: () => <path d="M5 12.5l4.5 4.5L19 7.5" />,
  back: () => <path d="M14.5 6l-6 6 6 6" />,
  moon: () => <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  sun: () => (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  image: () => (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M3.5 16l5-5 4 4 3-3 5 5" />
      <circle cx="15.5" cy="9" r="1.5" />
    </>
  ),
  lock: () => (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="3" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  // アプリの印: 下げたあと、決めた所で止まって上を向く線
  mark: () => (
    <>
      <path d="M3.5 6.5 9 13l3.5-3 3 3.5 5-6" />
      <path d="M3.5 18.5h17" />
    </>
  ),
};

export interface IconProps {
  readonly name: IconName;
  readonly class?: string;
}

export function Icon({ name, class: cls }: IconProps) {
  return (
    <svg
      class={cls ? `icon ${cls}` : 'icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]()}
    </svg>
  );
}
