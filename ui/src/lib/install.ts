// アプリとしてインストール（#121・ADR-0018 の追記）の純関数。DOM・通信を持たない。
// - 状態は 5 つ: installed（ホーム画面のアプリとして開いている）/ prompt（ブラウザがインストールの案内の権利
//   beforeinstallprompt を渡した）/ ios（iPhone・iPad。共有 → ホーム画面に追加）/ other（案内を出せない・まだ条件を満たさない）/
//   done（いまインストールした）
// - 決め方の順: 開いている形（standalone）→ いまインストールした → 権利 → iPhone・iPad → ほか
// - サービスワーカーは置かない（今の Chrome は beforeinstallprompt に SW を求めない。ADR-0018）

export type InstallKind = 'installed' | 'prompt' | 'ios' | 'other' | 'done';

export interface InstallFacts {
  /** ホーム画面のアプリとして開いている（display-mode: standalone か iOS の navigator.standalone） */
  readonly standalone: boolean;
  /** インストールの案内の権利を持っている */
  readonly canPrompt: boolean;
  /** iPhone・iPad */
  readonly appleMobile: boolean;
  /** このページを開いている間にインストールした（appinstalled か、確認で「インストール」を選んだ） */
  readonly installed: boolean;
}

export function installKindOf(f: InstallFacts): InstallKind {
  if (f.standalone) return 'installed';
  if (f.installed) return 'done';
  if (f.canPrompt) return 'prompt';
  if (f.appleMobile) return 'ios';
  return 'other';
}

/** iPhone・iPad か（iPadOS 13 以降の Safari は PC の Mac と同じ形を名乗るので、MacIntel + タッチで見分ける） */
export function isAppleMobile(ua: string, platform: string, maxTouchPoints: number): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return true;
  return platform === 'MacIntel' && maxTouchPoints > 1;
}

export const APP_INSTALL_LABEL = 'ホーム画面のアプリ';
export const APP_INSTALL_BUTTON = 'インストール';
/** ボタンの読み上げの名前 */
export const APP_INSTALL_BUTTON_LABEL = 'アプリとしてインストール';

export const INSTALL_TEXT = {
  installed: 'インストール済み',
  done: 'インストールしました',
  ios: '共有ボタン（□ に ↑）から「ホーム画面に追加」を選ぶと、アイコンから 1 回で開けます。',
  other:
    'ブラウザのメニューの「アプリをインストール」か「ホーム画面に追加」から入れると、アイコンから 1 回で開けます。',
} as const;

export interface InstallView {
  /** 行の右に ［インストール］ を出すか */
  readonly button: boolean;
  /** 行の右の短い状態の文（無ければ null） */
  readonly status: string | null;
  /** 行の下の手順の 1 行（無ければ null） */
  readonly hint: string | null;
}

export function installView(kind: InstallKind): InstallView {
  switch (kind) {
    case 'installed':
      return { button: false, status: INSTALL_TEXT.installed, hint: null };
    case 'done':
      return { button: false, status: INSTALL_TEXT.done, hint: null };
    case 'prompt':
      return { button: true, status: null, hint: null };
    case 'ios':
      return { button: false, status: null, hint: INSTALL_TEXT.ios };
    case 'other':
      return { button: false, status: null, hint: INSTALL_TEXT.other };
  }
}
