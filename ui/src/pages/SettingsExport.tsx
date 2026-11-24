// 設定の次の画面「データの書き出し」（#167・設計書 9.2 の設定の行・10.1・ADR-0025）。
// - 上の帯「‹ 設定」と題 → 先頭の 1 行 → JSON・CSV の 2 つの面（名前・中身の 1 行・ボタン）→ 含まれないもの → 状態の文
// - 押すと書き出しの API を 1 回読み、端末に保存する（通信と状態は lib/export-controller.ts、保存は lib/download.ts）
// - 書き出している間はどちらのボタンも押せない（二重に送らない）。終わった文は role="status"、失敗は role="alert"
//   （ログインが切れたら ［もう一度ログイン］）
// SettingsExport は controller を持つ hook の層、描画は hook を持たない SettingsExportView
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { api, signOutActive } from '../auth/session';
import { type BackTarget, TopBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { saveTextFile } from '../lib/download';
import {
  createExportController,
  type ExportController,
  type ExportState,
} from '../lib/export-controller';
import { EXPORT_TEXT, type ExportKind } from '../lib/export-data';
import { NavigatorContext } from '../lib/router';
import { backTargetOf } from './TradeDetail';
import '../styles/settings.css';

export function SettingsExport() {
  const nav = useContext(NavigatorContext);
  const controller = useMemo<ExportController>(
    () => createExportController({ api, save: saveTextFile }),
    [],
  );
  const [state, setState] = useState<ExportState>(controller.getState());
  useEffect(() => controller.subscribe(setState), [controller]);
  return (
    <SettingsExportView
      back={backTargetOf(nav, '/settings')}
      state={state}
      onExport={(kind) => void controller.run(kind)}
      onRelogin={() => void signOutActive()}
    />
  );
}

export interface SettingsExportViewProps {
  readonly back?: BackTarget;
  readonly state: ExportState;
  readonly onExport: (kind: ExportKind) => void;
  readonly onRelogin: () => void;
}

const OPTIONS: readonly {
  readonly kind: ExportKind;
  readonly name: string;
  readonly variant: 'primary' | 'secondary';
}[] = [
  { kind: 'json', name: 'JSON', variant: 'primary' },
  { kind: 'csv', name: 'CSV', variant: 'secondary' },
];

export function SettingsExportView({ back, state, onExport, onRelogin }: SettingsExportViewProps) {
  const busy = state.phase === 'busy';
  return (
    <>
      <TopBar back={back ?? { label: '設定', href: '/settings' }} title={EXPORT_TEXT.title} />
      <p class="setlead">{EXPORT_TEXT.lead}</p>
      <ul class="setlist setexport">
        {OPTIONS.map((o) => (
          <li key={o.kind} class="setlist__item setexport__option">
            <h2 class="setexport__name">{o.name}</h2>
            <p class="setexport__note" id={`settings-export-${o.kind}-note`}>
              {EXPORT_TEXT[o.kind].note}
            </p>
            <Button
              variant={o.variant}
              icon="download"
              block
              id={`settings-export-${o.kind}`}
              describedBy={`settings-export-${o.kind}-note`}
              disabled={busy}
              onClick={() => onExport(o.kind)}
            >
              {busy && state.kind === o.kind ? EXPORT_TEXT.busy : EXPORT_TEXT[o.kind].label}
            </Button>
          </li>
        ))}
      </ul>
      <p class="setlead">{EXPORT_TEXT.excluded}</p>
      <p class="setexport__status" role="status">
        {state.phase === 'done' ? state.text : ''}
      </p>
      {state.phase === 'failed' ? (
        <div class="notice notice--error" role="alert">
          <p>{state.text}</p>
          {state.auth ? (
            <Button variant="secondary" icon="logout" onClick={onRelogin}>
              もう一度ログイン
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
