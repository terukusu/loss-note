// アプリとしてインストール（#121）の糊と状態。main.tsx が描く前に 1 つ作る（設定のタブを開く前に届いた権利を失わない）。
// - beforeinstallprompt: 既定の動き（Android の Chrome の下の小さな帯）を止めて、権利を 1 つ持つ。記録の画面の下の帯と
//   重ならないよう、入れ方は設定の ［インストール］ とブラウザのメニューに寄せる（ADR-0018 の追記）
// - promptInstall: ブラウザの確認を 1 回だけ出す。権利は 1 回で使い切る（選んだ結果によらず捨てる）。押している間の 2 回目は無視
// - appinstalled・display-mode の変化を見て、状態を替える
// DOM は env の最小の面だけに触れる（テストは偽の env を渡す）。状態の決め方・文言は純関数 lib/install.ts
import { type InstallKind, installKindOf, isAppleMobile } from './install';

/** Chrome の BeforeInstallPromptEvent のうち使う面（標準の型に無いので最小限に書く） */
export interface InstallPromptEvent {
  preventDefault(): void;
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ readonly outcome: string }>;
}

interface MediaQuery {
  readonly matches: boolean;
  addEventListener?(type: 'change', fn: () => void): void;
}

export interface InstallEnv {
  addEventListener(type: 'beforeinstallprompt' | 'appinstalled', fn: (e: Event) => void): void;
  matchMedia?(query: string): MediaQuery;
  readonly navigator: {
    readonly userAgent: string;
    readonly platform: string;
    readonly maxTouchPoints: number;
    /** iOS の Safari のホーム画面から開いた窓だけ true */
    readonly standalone?: boolean;
  };
}

export interface InstallState {
  readonly kind: InstallKind;
  /** ブラウザの確認を出している間 */
  readonly busy: boolean;
}

export interface InstallStore {
  getState(): InstallState;
  subscribe(fn: (s: InstallState) => void): () => void;
  promptInstall(): Promise<void>;
}

const STANDALONE = '(display-mode: standalone)';

export function createInstallStore(env: InstallEnv): InstallStore {
  const nav = env.navigator;
  const appleMobile = isAppleMobile(
    nav.userAgent ?? '',
    nav.platform ?? '',
    nav.maxTouchPoints ?? 0,
  );
  const media = env.matchMedia?.(STANDALONE) ?? null;
  let pending: InstallPromptEvent | null = null;
  let installed = false;
  let busy = false;
  const listeners = new Set<(s: InstallState) => void>();

  const standalone = () => media?.matches === true || nav.standalone === true;
  let state: InstallState = compute();

  function compute(): InstallState {
    return {
      kind: installKindOf({
        standalone: standalone(),
        // 確認を出している間もボタンを残す（押せない形）。メニューの 1 行に一瞬替わらない
        canPrompt: pending !== null || busy,
        appleMobile,
        installed,
      }),
      busy,
    };
  }
  function update() {
    const next = compute();
    if (next.kind === state.kind && next.busy === state.busy) return;
    state = next;
    for (const fn of listeners) fn(state);
  }

  env.addEventListener('beforeinstallprompt', (e) => {
    const ev = e as unknown as InstallPromptEvent;
    ev.preventDefault();
    pending = ev;
    update();
  });
  env.addEventListener('appinstalled', () => {
    pending = null;
    installed = true;
    update();
  });
  media?.addEventListener?.('change', update);

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async promptInstall() {
      const ev = pending;
      if (ev === null || busy) return;
      pending = null;
      busy = true;
      update();
      try {
        await ev.prompt();
        const choice = await ev.userChoice;
        if (choice.outcome === 'accepted') installed = true;
      } catch {
        // 確認を出せなかった: 権利は使えないので、メニューから入れる 1 行に戻す
      } finally {
        busy = false;
        update();
      }
    },
  };
}

/** 文脈が無いとき（テスト・部品だけの描画）の状態: 案内を出せないブラウザと同じ */
export const IDLE_INSTALL: InstallStore = {
  getState: () => ({ kind: 'other', busy: false }),
  subscribe: () => () => {},
  promptInstall: async () => {},
};
