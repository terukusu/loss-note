// 設定のタブの根（#3 = テーマの切り替えとログアウト、#133 = まとめた一覧。設計書 9.2 の設定の行・K16・ui-guidelines 9.3・
// 9.9・9.12）と、次の画面「AI の利用状況」（#62・#133）・「心理のタグ」（#163）。
// - 根: 大きな題「設定」（題の下に説明の文は置かない）→ 区切り「口座」（口座 ›）・「記録」（銘柄 › / 心理のタグ › /
//   AI の利用状況 › / 用語集 ›）・「表示」（テーマ）・「アカウント」（ログアウト）。押せる行の右に数の添え（lib/settings-menu.ts）
// - 口座・銘柄の一覧と編集は次の画面（pages/SettingsAccounts.tsx・pages/SettingsInstruments.tsx）、用語集は pages/Glossary.tsx
// Settings は hook を持たない（App のテストが 1 段だけ呼ぶ）。数の添えは SettingsLinks（controller を購読）が描き、描画は hook を
// 持たない SettingsLinksView に任せる
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { api } from '../auth/session';
import { AiUsageCard, useAiUsage } from '../components/AiUsage';
import { type BackTarget, TopBar } from '../components/AppBar';
import { Button, RowLink } from '../components/Button';
import { EmotionChoicesView, useEmotionChoices } from '../components/EmotionChoices';
import { PageHeader } from '../components/PageHeader';
import { Segment } from '../components/Segment';
import { hiddenOf } from '../lib/emotion-choices-controller';
import { EMOTION_CHOICES_TITLE, emotionChoicesMeta } from '../lib/emotion-tags';
import { GLOSSARY } from '../lib/glossary';
import { NavigatorContext } from '../lib/router';
import {
  createSettingsController,
  type SettingsController,
  type SettingsState,
} from '../lib/settings-controller';
import {
  ACCOUNT_GROUP_TITLE,
  DISPLAY_GROUP_TITLE,
  type SettingsLinkGroup,
  settingsMenu,
} from '../lib/settings-menu';
import type { Theme } from '../lib/theme';
import { backTargetOf } from './TradeDetail';
import '../styles/settings.css';

export interface SettingsProps {
  readonly theme: Theme;
  readonly onTheme: (theme: Theme) => void;
  readonly onSignOut: () => void;
  readonly signOutBusy: boolean;
  readonly signOutError: string | null;
}

export function Settings({ theme, onTheme, onSignOut, signOutBusy, signOutError }: SettingsProps) {
  return (
    <>
      <PageHeader title="設定" />
      <SettingsLinks />
      <section class="setgroup" aria-labelledby="settings-group-display">
        <h2 class="setgroup__title" id="settings-group-display">
          {DISPLAY_GROUP_TITLE}
        </h2>
        <div class="setlist setlist--control">
          <span class="setlist__label" aria-hidden="true">
            テーマ
          </span>
          <Segment
            label="テーマ"
            showLabel={false}
            value={theme}
            onChange={onTheme}
            options={[
              { value: 'dark', label: 'ダーク', icon: 'moon' },
              { value: 'light', label: 'ライト', icon: 'sun' },
            ]}
          />
        </div>
      </section>
      <section class="setgroup" aria-labelledby="settings-group-account">
        <h2 class="setgroup__title" id="settings-group-account">
          {ACCOUNT_GROUP_TITLE}
        </h2>
        <Button
          variant="secondary"
          icon="logout"
          block
          onClick={onSignOut}
          disabled={signOutBusy}
          class="setlogout"
        >
          {signOutBusy ? 'ログアウトしています…' : 'ログアウト'}
        </Button>
        {signOutError ? (
          <p class="login__error" role="alert">
            {signOutError}
          </p>
        ) : null}
      </section>
    </>
  );
}

/** 口座・記録の区切り（数の添えのために口座・銘柄と AI の利用状況を読む。読めなければ添えなしで行は出す） */
export function SettingsLinks() {
  const controller = useMemo<SettingsController>(() => createSettingsController({ api }), []);
  const [state, setState] = useState<SettingsState>(controller.getState());
  useEffect(() => {
    const off = controller.subscribe(setState);
    void controller.load();
    return off;
  }, [controller]);
  const usage = useAiUsage();
  const choices = useEmotionChoices();
  const ready = state.phase === 'ready';
  return (
    <SettingsLinksView
      groups={settingsMenu({
        accounts: ready ? state.accounts : null,
        instruments: ready ? state.instruments.length : null,
        emotions: emotionChoicesMeta(
          choices.state.phase === 'ready' ? hiddenOf(choices.state) : null,
        ),
        usageToday: usage.state.phase === 'ready' ? usage.state.view.todayCount : null,
        glossary: GLOSSARY.length,
      })}
    />
  );
}

/** まとめた一覧（区切りの小見出し + 角丸の 1 枚の面に押せる行。hook を持たない） */
export function SettingsLinksView({ groups }: { readonly groups: readonly SettingsLinkGroup[] }) {
  return (
    <>
      {groups.map((g) => (
        <section key={g.id} class="setgroup" aria-labelledby={`settings-group-${g.id}`}>
          <h2 class="setgroup__title" id={`settings-group-${g.id}`}>
            {g.title}
          </h2>
          <ul class="setlist">
            {g.rows.map((r) => (
              <li key={r.id} class="setlist__item">
                <RowLink
                  href={r.href}
                  id={`settings-link-${r.id}`}
                  {...(r.meta !== null ? { meta: r.meta } : {})}
                >
                  {r.label}
                </RowLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/** 設定の次の画面「AI の利用状況」（#62 の部品をそのまま。読めなくても口座・銘柄の画面に触れない） */
export function SettingsAiUsage() {
  const nav = useContext(NavigatorContext);
  return <SettingsAiUsageView back={backTargetOf(nav, '/settings')} />;
}

export function SettingsAiUsageView({ back }: { readonly back?: BackTarget }) {
  return (
    <>
      <TopBar back={back ?? { label: '設定', href: '/settings' }} title="AI の利用状況" />
      <AiUsageCard titled={false} />
    </>
  );
}

/** 設定の次の画面「心理のタグ」（#163。選択肢に出すタグを押して選ぶ。押した時点で保存） */
export function SettingsEmotions() {
  const nav = useContext(NavigatorContext);
  const choices = useEmotionChoices();
  return <SettingsEmotionsView back={backTargetOf(nav, '/settings')} {...choices} />;
}

export function SettingsEmotionsView(
  p: Parameters<typeof EmotionChoicesView>[0] & { readonly back?: BackTarget },
) {
  return (
    <>
      <TopBar back={p.back ?? { label: '設定', href: '/settings' }} title={EMOTION_CHOICES_TITLE} />
      <EmotionChoicesView
        state={p.state}
        onToggle={p.onToggle}
        onReload={p.onReload}
        onRelogin={p.onRelogin}
      />
    </>
  );
}
