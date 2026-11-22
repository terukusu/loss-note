// 設定の画面（#133）の共通の部品。hook を持たない。口座の画面・銘柄の画面が使う
// - SettingsNotice: 知らせ（成功は role="status"、失敗は role="alert" + ログインが切れたら [もう一度ログイン]）
// - SettingsLoad: 読み込み中・読み込みの失敗（[再読み込み] / [もう一度ログイン]）
// - SetRow: まとめた一覧の押せる行（行全体が当たり、右に ›。名前と 1〜2 行の添え）。押すと編集の下のシート
// - SetAddRow: まとめた一覧の末尾の ［＋ 〇〇を追加］ の行（＋ のアイコンつき。押すと追加の下のシート）
import type { ComponentChildren } from 'preact';
import type { SettingsNotice as Notice, SettingsState } from '../lib/settings-controller';
import { Button } from './Button';
import { Icon } from './Icon';

export function SettingsNotice({
  notice,
  onRelogin,
}: {
  readonly notice: Notice;
  readonly onRelogin: () => void;
}) {
  if (notice.kind === 'ok') {
    return (
      <p class="notice" role="status">
        {notice.text}
      </p>
    );
  }
  return (
    <div class="notice notice--error" role="alert">
      <p>{notice.text}</p>
      {notice.auth ? (
        <Button variant="secondary" icon="logout" onClick={onRelogin}>
          もう一度ログイン
        </Button>
      ) : null}
    </div>
  );
}

/** 読み込み中・失敗のとき中身の代わりに出す（ready なら null） */
export function SettingsLoad({
  state,
  onReload,
  onRelogin,
}: {
  readonly state: SettingsState;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
}) {
  if (state.phase === 'loading') {
    return (
      <p class="loading" role="status">
        読み込んでいます…
      </p>
    );
  }
  if (state.phase === 'loadFailed') {
    return (
      <section class="card section">
        <p class="notice notice--error" role="alert">
          {state.error}
        </p>
        <div>
          {state.errorKind === 'auth' ? (
            <Button variant="secondary" icon="logout" onClick={onRelogin}>
              もう一度ログイン
            </Button>
          ) : (
            <Button variant="secondary" onClick={onReload}>
              再読み込み
            </Button>
          )}
        </div>
      </section>
    );
  }
  return null;
}

export interface SetRowProps {
  /** ボタンの ID（シートを閉じた後・足した後にフォーカスを戻す先） */
  readonly id: string;
  /** 読み上げの名前（「口座 1 を編集」。添えは aria-describedby で読む） */
  readonly label: string;
  readonly name: ComponentChildren;
  readonly sub: ComponentChildren;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}

export function SetRow(p: SetRowProps) {
  const subId = `${p.id}-sub`;
  return (
    <button
      type="button"
      id={p.id}
      class="setrow"
      aria-label={p.label}
      aria-describedby={subId}
      aria-haspopup="dialog"
      disabled={p.disabled}
      onClick={p.onClick}
    >
      <span class="setrow__text">
        <span class="setrow__name">{p.name}</span>
        <span class="setrow__sub" id={subId}>
          {p.sub}
        </span>
      </span>
    </button>
  );
}

export function SetAddRow(p: {
  readonly id: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      id={p.id}
      class="setrow setrow--add"
      aria-haspopup="dialog"
      disabled={p.disabled}
      onClick={p.onClick}
    >
      <Icon name="plus" />
      <span>{p.children}</span>
    </button>
  );
}
