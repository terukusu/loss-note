// アプリの枠: 上の帯（印と名前）と、ホーム・記録する・一覧・設定の 4 つの行き先（V6）。
// 幅 720px 未満は下部に固定（親指で届く）、それ以上は上の帯の中に横並び。ログイン画面には行き先を出さない
import type { ComponentChildren } from 'preact';
import { Icon } from '../components/Icon';
import { Link } from '../lib/router';
import { hrefOf, NAV_ITEMS, type Route } from '../lib/routes';

export interface ShellProps {
  readonly route: Route;
  readonly children: ComponentChildren;
}

function Brand() {
  return (
    <span class="brand">
      <span class="brand__mark">
        <Icon name="mark" />
      </span>
      <span class="brand__name">loss-note</span>
    </span>
  );
}

export function Shell({ route, children }: ShellProps) {
  if (route.name === 'login') {
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
          <Brand />
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
    </div>
  );
}
