// 画面の移りの動きの種類を決める純関数（#136・ui-guidelines 9.8・設計書 C64）。DOM・history に触れない。
// 動かすか・どう動かすかはここだけで決め、View Transitions の糊（view-transition.ts）は結果の種類を <html data-motion> に写す
import { type Route, screenKindOf } from './routes';

/**
 * 画面の移りの動き: forward = 右から重なる（進む）/ back = 右へ外れる（戻る）/ fade = 重ねて薄く替える（タブ）/
 * up = 下から出る（全画面のシートを開く）/ down = 下へ外れる（全画面のシートを閉じる）/ none = 動かさない
 */
export type Motion = 'forward' | 'back' | 'fade' | 'up' | 'down' | 'none';

/** 動きのある種類（<html data-motion> の値） */
export const MOTIONS: readonly Exclude<Motion, 'none'>[] = [
  'forward',
  'back',
  'fade',
  'up',
  'down',
];

/**
 * 戻る / 進む（popstate）の出どころ: app = アプリが自分で戻した（上の帯の「‹」・✕・タブの押し直し）/ ua = 端末が自分で
 * 動きを付けた（hasUAVisualTransition が真。iPhone の端からのスワイプなど）/ browser = 端末は動きを付けていない（同じ印が偽。
 * Android の戻るのキーなど）/ unknown = その印をブラウザが持たない（端末が動かしたか分からない）
 */
export type PopCause = 'app' | 'ua' | 'browser' | 'unknown';

/** 画面の移りの経路（router.tsx の NavVia と同じ値） */
export type MotionVia = 'init' | 'push' | 'replace' | 'pop' | 'tab' | 'retap';

/** 移りの前後の 1 画面 */
export interface MotionScreen {
  readonly route: Route;
  /** アプリの中の深さ（印の appDepth。ホームの段 = 0） */
  readonly depth: number;
  /** URL（パス + 検索） */
  readonly href: string;
}

export interface ScreenChange {
  readonly from: MotionScreen;
  readonly to: MotionScreen;
  readonly via: MotionVia;
  /** via が pop のときの出どころ（ほかは null） */
  readonly cause: PopCause | null;
}

/**
 * 移りの動き（9.8）。順に: 開いた・置き換え・先頭へ送る・同じ URL・ログインの画面との間は動かさない → 戻る / 進むは端末が
 * 動きを付けた・付けたか分からないなら動かさない（二重の動きにしない）→ 全画面のシートへ入る = up・出る = down → タブの
 * 切り替え = fade → 深さが増えた = forward・減った = back・同じ = fade
 */
export function motionOf(c: ScreenChange): Motion {
  if (c.via === 'init' || c.via === 'replace' || c.via === 'retap') return 'none';
  if (c.from.href === c.to.href) return 'none';
  const from = screenKindOf(c.from.route);
  const to = screenKindOf(c.to.route);
  if (from === 'bare' || to === 'bare') return 'none';
  if (c.via === 'pop' && c.cause !== 'app' && c.cause !== 'browser') return 'none';
  if (to === 'sheet' && from !== 'sheet') return 'up';
  if (from === 'sheet' && to !== 'sheet') return 'down';
  if (c.via === 'tab') return 'fade';
  const d = c.to.depth - c.from.depth;
  if (d > 0) return 'forward';
  if (d < 0) return 'back';
  return 'fade';
}

/** popstate の hasUAVisualTransition（無いブラウザは undefined）→ 出どころ。アプリが自分で戻したときは app を先に決める */
export function popCauseOf(ua: boolean | undefined): PopCause {
  if (ua === true) return 'ua';
  if (ua === false) return 'browser';
  return 'unknown';
}
