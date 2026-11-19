// アプリの枠: 上の帯（印と名前）と、ホーム・記録する・一覧・設定の 4 つの行き先（V6）。
// 幅 720px 未満は下部に固定（親指で届く）、それ以上は上の帯の中に横並び。ログイン画面には行き先を出さない
import type { ComponentChildren } from 'preact';
import { DraftDot } from '../components/Button';
import { Icon } from '../components/Icon';
import { APP_NAME } from '../lib/app-name';
import { DRAFT_DOT_TEXT } from '../lib/drafts';
import { Link } from '../lib/router';
import { hrefOf, NAV_ITEMS, type Route } from '../lib/routes';

export interface ShellProps {
  readonly route: Route;
  readonly children: ComponentChildren;
  /** 手元のエミュレーターに繋いでいるか（帯に印を出す） */
  readonly emulator?: boolean;
  /** ログインの状態が分かるまでの面（行き先を出さない） */
  readonly bare?: boolean;
  /** トースト（[元に戻す] など。#9。画面を移っても残る。幅 720 未満は下部の行き先の上、以上は右下） */
  readonly toast?: ComponentChildren;
  /** 記録する画面の書きかけを残している（行き先の [記録する] に印の点。#75） */
  readonly recordDraft?: boolean;
}

function Brand() {
  return (
    <span class="brand">
      <span class="brand__mark">
        <Icon name="mark" />
      </span>
      <span class="brand__name">{APP_NAME}</span>
    </span>
  );
}

export function Shell({ route, children, emulator, bare, toast, recordDraft }: ShellProps) {
  if (route.name === 'login' || bare) {
    return (
      <div class="shell shell--bare">
        <main id="main" class="content content--center">
          {children}
        </main>
      </div>
    );
  }
  return (
    <div class="shell">
      <header class="topbar">
        <div class="topbar__inner">
          <div class="topbar__brand">
            <Brand />
            {emulator ? <span class="envchip">エミュレーター</span> : null}
          </div>
          <nav class="appnav" aria-label="メイン">
            <ul class="appnav__list">
              {NAV_ITEMS.map((item) => {
                const current = item.current.includes(route.name);
                return (
                  <li key={item.label} class="appnav__item">
                    <Link
                      href={hrefOf(item.route)}
                      aria-current={current ? 'page' : undefined}
                      class="appnav__link"
                    >
                      <Icon name={item.icon} class="appnav__icon" />
                      <span class="appnav__label">{item.label}</span>
                      {recordDraft && item.route.name === 'record' ? (
                        <DraftDot text={DRAFT_DOT_TEXT} />
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" class="content">
        {children}
      </main>
      {toast ?? null}
    </div>
  );
}
