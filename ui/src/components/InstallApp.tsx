// 設定の根の区切り「アプリ」（#121）。ホーム画面のアプリとして入れる入口。
// - SettingsInstall: 文脈の状態（lib/install-prompt.ts）を購読して InstallAppView に渡す
// - InstallAppView: hook を持たない。行（ラベル + ［インストール］ か状態の文）と、行の下の手順の 1 行。状態の文は読み上げの領域
import { useContext, useEffect, useState } from 'preact/hooks';
import {
  APP_INSTALL_BUTTON,
  APP_INSTALL_BUTTON_LABEL,
  APP_INSTALL_LABEL,
  type InstallKind,
  installView,
} from '../lib/install';
import { InstallContext } from '../lib/install-context';
import { APP_GROUP_TITLE } from '../lib/settings-menu';
import { Button } from './Button';

export function SettingsInstall() {
  const store = useContext(InstallContext);
  const [state, setState] = useState(store.getState());
  useEffect(() => {
    setState(store.getState());
    return store.subscribe(setState);
  }, [store]);
  return (
    <InstallAppView
      kind={state.kind}
      busy={state.busy}
      onInstall={() => {
        void store.promptInstall();
      }}
    />
  );
}

export interface InstallAppViewProps {
  readonly kind: InstallKind;
  readonly busy: boolean;
  readonly onInstall: () => void;
}

export function InstallAppView({ kind, busy, onInstall }: InstallAppViewProps) {
  const v = installView(kind);
  return (
    <section class="setgroup" aria-labelledby="settings-group-app">
      <h2 class="setgroup__title" id="settings-group-app">
        {APP_GROUP_TITLE}
      </h2>
      <div class="setlist setlist--control setinstall">
        <span class="setlist__label">{APP_INSTALL_LABEL}</span>
        {v.button ? (
          <Button
            variant="tonal"
            size="sm"
            icon="plus"
            id="settings-install"
            label={APP_INSTALL_BUTTON_LABEL}
            disabled={busy}
            onClick={onInstall}
          >
            {APP_INSTALL_BUTTON}
          </Button>
        ) : null}
        <span class="setinstall__status" role="status">
          {v.status ?? ''}
        </span>
      </div>
      {v.hint !== null ? <p class="setinstall__hint">{v.hint}</p> : null}
    </section>
  );
}
