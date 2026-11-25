// 画面の移りの動きの糊（#136・ui-guidelines 9.8・設計書 C64）: router が画面に知らせる（update）ところを View Transitions で
// 包む。種類は screen-motion.ts の純関数で決め、<html data-motion> に写してから startViewTransition を始め、終わったら外す。
// 新しい画面の撮影は App が描き終えた（見出しへのフォーカスとスクロールの位置を決めた）ときに解ける Promise の後
// （Preact には flushSync が無い）。動きを減らす設定・View Transitions が無いブラウザ・none では update() だけ（今の即時の差し替え）
import { type Motion, motionOf, type ScreenChange } from './screen-motion';

/** startViewTransition の返す値の最小限 */
export interface TransitionHandle {
  readonly finished: Promise<unknown>;
  readonly ready: Promise<unknown>;
  readonly updateCallbackDone?: Promise<unknown>;
}

/** 文書と窓の最小限（テストは偽物） */
export interface MotionEnv {
  /** document.startViewTransition（無いブラウザは null） */
  start(update: () => Promise<void>): TransitionHandle | null;
  /** 動きを減らす設定か（prefers-reduced-motion: reduce） */
  reduced(): boolean;
  /** <html data-motion> を付ける（null で外す） */
  mark(motion: Motion | null): void;
  /** ms 後に呼ぶ（描き終わりの知らせが来ないときの保険） */
  defer(fn: () => void, ms: number): void;
}

export interface ScreenMotion {
  /** 画面の移り。動かすなら update を View Transitions の中で呼び、動かさないならすぐ呼ぶ */
  run(change: ScreenChange, update: () => void, target: object): void;
  /** 画面が描き終えた（App の効果）。target は router の今の画面（useCurrent の値）。それまでに待っている撮影を解く */
  rendered(target: object): void;
}

/** 描き終わりの知らせが来ないときに撮影へ進むまでの時間（ms。ブラウザの更新の締め切り 4 秒より短く） */
const RENDER_TIMEOUT_MS = 1000;

export function createScreenMotion(env: MotionEnv): ScreenMotion {
  /** 描き終わりを待っている撮影（古い順） */
  let waiting: { seq: number; done: () => void }[] = [];
  /** 最後に始めた動き（前の動きの終わりで、後の動きの印を外さない） */
  let latest = 0;
  /** 知らされた画面の順（run の target ごと。動かさない移りも数える） */
  const order = new WeakMap<object, number>();
  let next = 0;
  /** 最後に描き終えた画面の順（それ以前の画面の撮影はもう待たない） */
  let lastRendered = 0;

  const waitRendered = (seq: number) =>
    new Promise<void>((ok) => {
      // 後の画面が先に描けていれば（飛ばされた動きの callback が後で呼ばれた・同じタスクで次の移りが重なった）すぐ撮影へ
      if (seq <= lastRendered) {
        ok();
        return;
      }
      const entry = { seq, done: () => ok() };
      waiting.push(entry);
      env.defer(() => {
        waiting = waiting.filter((w) => w !== entry);
        ok();
      }, RENDER_TIMEOUT_MS);
    });

  return {
    run(change, update, target) {
      const seq = ++next;
      order.set(target, seq);
      const motion = motionOf(change);
      if (motion === 'none' || env.reduced()) {
        update();
        return;
      }
      const id = ++latest;
      env.mark(motion);
      let called = false;
      const once = () => {
        if (called) return Promise.resolve();
        called = true;
        update();
        return waitRendered(seq);
      };
      let handle: TransitionHandle | null = null;
      try {
        handle = env.start(once);
      } catch {
        handle = null;
      }
      const clear = () => {
        if (id === latest) env.mark(null);
      };
      if (!handle) {
        // 無いブラウザ・始められなかった: 印を外し、今の即時の差し替え
        clear();
        if (!called) {
          called = true;
          update();
        }
        return;
      }
      // 飛ばされた動き（続けて次の移りが来た）の ready は reject になる。捨てる（ページのエラーにしない）
      handle.ready.catch(() => {});
      handle.updateCallbackDone?.catch(() => {});
      handle.finished.then(clear, clear);
    },
    rendered(target) {
      const seq = order.get(target);
      if (seq === undefined) return;
      lastRendered = Math.max(lastRendered, seq);
      // この画面と、それより前に知らされた画面の撮影（続けて移った途中の画面は描かれないことがある）を解く
      const done = waiting.filter((w) => w.seq <= lastRendered);
      waiting = waiting.filter((w) => w.seq > lastRendered);
      for (const w of done) w.done();
    },
  };
}

export function windowMotionEnv(win: Window): MotionEnv {
  const doc = win.document;
  const query = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  return {
    start: (update) => {
      const d = doc as Document & {
        startViewTransition?: (cb: () => Promise<void>) => TransitionHandle;
      };
      return typeof d.startViewTransition === 'function' ? d.startViewTransition(update) : null;
    },
    reduced: () => query?.matches === true,
    mark: (motion) => {
      if (motion) doc.documentElement.setAttribute('data-motion', motion);
      else doc.documentElement.removeAttribute('data-motion');
    },
    defer: (fn, ms) => {
      win.setTimeout(fn, ms);
    },
  };
}

/**
 * 押した手応え（:active。9.8）: iOS の Safari は touchstart を聞く要素が無いと :active を付けないので、文書に何もしない
 * touchstart を 1 つ付ける（passive。スクロールを止めない）
 */
export function installPressFeedback(win: Window): void {
  win.document.addEventListener('touchstart', () => {}, { passive: true });
}
