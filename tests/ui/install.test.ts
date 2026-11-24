// アプリとしてインストール（Issue #121）。状態の決め方・端末の見分け・表示の形（純関数）と、権利を受け取って確認を出す糊
// （偽の env）。Issue 本文の例の表 #1〜#7 を入力にする
import { describe, expect, it, vi } from 'vitest';
import {
  INSTALL_TEXT,
  type InstallFacts,
  installKindOf,
  installView,
  isAppleMobile,
} from '../../ui/src/lib/install';
import { createInstallStore, type InstallEnv } from '../../ui/src/lib/install-prompt';

const UA = {
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadOs:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  firefoxPc: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
};

const facts = (p: Partial<InstallFacts>): InstallFacts => ({
  standalone: false,
  canPrompt: false,
  appleMobile: false,
  installed: false,
  ...p,
});

describe('isAppleMobile', () => {
  it('iPhone・iPad（iPadOS の Mac の形 + タッチ）は true、Android・PC・タッチの無い Mac は false', () => {
    expect(isAppleMobile(UA.iphone, 'iPhone', 5)).toBe(true);
    expect(isAppleMobile(UA.ipadOs, 'MacIntel', 5)).toBe(true);
    expect(isAppleMobile(UA.ipadOs, 'MacIntel', 0)).toBe(false);
    expect(isAppleMobile(UA.androidChrome, 'Linux armv8l', 5)).toBe(false);
    expect(isAppleMobile(UA.firefoxPc, 'Win32', 0)).toBe(false);
  });
});

describe('installKindOf と installView（例の表）', () => {
  it('#1 権利あり → ［インストール］', () => {
    const k = installKindOf(facts({ canPrompt: true }));
    expect(k).toBe('prompt');
    expect(installView(k)).toEqual({ button: true, status: null, hint: null });
  });
  it('#2 確認で「インストール」→ インストールしました・ボタンなし', () => {
    const k = installKindOf(facts({ installed: true }));
    expect(installView(k)).toEqual({ button: false, status: INSTALL_TEXT.done, hint: null });
  });
  it('#3 確認でキャンセル（権利を使い切った）→ メニューから入れる 1 行', () => {
    expect(installView(installKindOf(facts({})))).toEqual({
      button: false,
      status: null,
      hint: INSTALL_TEXT.other,
    });
  });
  it('#4 iPhone の Safari のタブ → 共有 → ホーム画面に追加', () => {
    const v = installView(installKindOf(facts({ appleMobile: true })));
    expect(v.hint).toBe(INSTALL_TEXT.ios);
    expect(v.hint).toContain('ホーム画面に追加');
    expect(v.button).toBe(false);
  });
  it('#5 #6 ホーム画面から開いた窓は、権利・端末・インストールによらずインストール済み', () => {
    for (const canPrompt of [false, true])
      for (const appleMobile of [false, true])
        for (const installed of [false, true]) {
          const k = installKindOf(facts({ standalone: true, canPrompt, appleMobile, installed }));
          expect(k).toBe('installed');
          expect(installView(k).status).toBe(INSTALL_TEXT.installed);
        }
  });
  it('#7 権利の来ない PC のブラウザ → メニューから入れる 1 行', () => {
    expect(installView(installKindOf(facts({}))).hint).toBe(INSTALL_TEXT.other);
  });
});

/** 偽の window（イベントを後から dispatch できる） */
function fakeEnv(
  o: {
    ua?: string;
    platform?: string;
    touch?: number;
    standalone?: boolean;
    iosStandalone?: boolean;
  } = {},
) {
  const handlers = new Map<string, ((e: Event) => void)[]>();
  const mediaHandlers: (() => void)[] = [];
  const media = {
    matches: o.standalone ?? false,
    addEventListener: (_t: 'change', fn: () => void) => mediaHandlers.push(fn),
  };
  const env: InstallEnv = {
    addEventListener: (type, fn) => handlers.set(type, [...(handlers.get(type) ?? []), fn]),
    matchMedia: (q) => {
      expect(q).toBe('(display-mode: standalone)');
      return media;
    },
    navigator: {
      userAgent: o.ua ?? UA.androidChrome,
      platform: o.platform ?? 'Linux armv8l',
      maxTouchPoints: o.touch ?? 5,
      ...(o.iosStandalone !== undefined ? { standalone: o.iosStandalone } : {}),
    },
  };
  const fire = (type: string, e: unknown = {}) => {
    for (const fn of handlers.get(type) ?? []) fn(e as Event);
  };
  const setStandalone = (v: boolean) => {
    media.matches = v;
    for (const fn of mediaHandlers) fn();
  };
  return { env, fire, setStandalone };
}

function promptEvent(outcome: 'accepted' | 'dismissed' | 'throw') {
  return {
    preventDefault: vi.fn(),
    prompt: vi.fn(() => (outcome === 'throw' ? Promise.reject(new Error('x')) : Promise.resolve())),
    userChoice: Promise.resolve({ outcome: outcome === 'throw' ? 'dismissed' : outcome }),
  };
}

describe('createInstallStore', () => {
  it('AC-2: 起動の時点の権利を受け取り、既定の動きを止め、後から購読しても prompt', () => {
    const { env, fire } = fakeEnv();
    const store = createInstallStore(env);
    expect(store.getState().kind).toBe('other');
    const ev = promptEvent('accepted');
    fire('beforeinstallprompt', ev);
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.kind));
    expect(store.getState()).toEqual({ kind: 'prompt', busy: false });
    expect(seen).toEqual([]);
  });

  it('AC-3: 押すと確認を 1 回だけ出し、「インストール」→ done', async () => {
    const { env, fire } = fakeEnv();
    const store = createInstallStore(env);
    const ev = promptEvent('accepted');
    fire('beforeinstallprompt', ev);
    const seen: unknown[] = [];
    store.subscribe((s) => seen.push(s));
    const first = store.promptInstall();
    expect(store.getState()).toEqual({ kind: 'prompt', busy: true });
    const second = store.promptInstall(); // 押している間の 2 回目は無視
    await Promise.all([first, second]);
    expect(ev.prompt).toHaveBeenCalledTimes(1);
    expect(store.getState()).toEqual({ kind: 'done', busy: false });
    expect(seen).toEqual([
      { kind: 'prompt', busy: true },
      { kind: 'done', busy: false },
    ]);
    await store.promptInstall(); // 権利は使い切った
    expect(ev.prompt).toHaveBeenCalledTimes(1);
  });

  it('AC-3: キャンセル → other（権利を使い切った）、次の権利が来たら prompt に戻る', async () => {
    const { env, fire } = fakeEnv();
    const store = createInstallStore(env);
    fire('beforeinstallprompt', promptEvent('dismissed'));
    await store.promptInstall();
    expect(store.getState()).toEqual({ kind: 'other', busy: false });
    fire('beforeinstallprompt', promptEvent('accepted'));
    expect(store.getState().kind).toBe('prompt');
  });

  it('確認を出せなかった（prompt が例外）→ other', async () => {
    const { env, fire } = fakeEnv();
    const store = createInstallStore(env);
    fire('beforeinstallprompt', promptEvent('throw'));
    await store.promptInstall();
    expect(store.getState()).toEqual({ kind: 'other', busy: false });
  });

  it('権利が無いときに押しても何も起きない', async () => {
    const { env } = fakeEnv();
    const store = createInstallStore(env);
    const seen: unknown[] = [];
    store.subscribe((s) => seen.push(s));
    await store.promptInstall();
    expect(seen).toEqual([]);
  });

  it('appinstalled（メニューから入れた）→ done、権利を捨てる', () => {
    const { env, fire } = fakeEnv();
    const store = createInstallStore(env);
    fire('beforeinstallprompt', promptEvent('accepted'));
    fire('appinstalled');
    expect(store.getState().kind).toBe('done');
  });

  it('ホーム画面のアプリとして開いた（display-mode の変化・iOS の standalone）→ installed', () => {
    const a = fakeEnv();
    const store = createInstallStore(a.env);
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.kind));
    a.setStandalone(true);
    expect(seen).toEqual(['installed']);
    a.fire('beforeinstallprompt', promptEvent('accepted'));
    expect(store.getState().kind).toBe('installed');

    const ios = fakeEnv({ ua: UA.iphone, platform: 'iPhone', iosStandalone: true });
    expect(createInstallStore(ios.env).getState().kind).toBe('installed');
    const iosTab = fakeEnv({ ua: UA.iphone, platform: 'iPhone', iosStandalone: false });
    expect(createInstallStore(iosTab.env).getState().kind).toBe('ios');
  });

  it('matchMedia が無い環境でも動く', () => {
    const { env } = fakeEnv();
    const { matchMedia: _m, ...rest } = env;
    expect(createInstallStore(rest).getState().kind).toBe('other');
  });
});
