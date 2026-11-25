// AI の利用状況のカード（Issue #62。設計書 8.2・9.2 の「設定」）。設定の画面の中の独立した 1 つの部品で、口座・銘柄の
// カードと状態を共有しない（読めなくても、ほかのカードの操作を止めない）。
// 3 層: 純関数（lib/ai-usage.ts）→ 通信と状態（lib/ai-usage-controller.ts）→ この部品。AiUsageView は hook を持たない。
// 色は付けない（判定の段の色を使わない）。近い・届いたは「今日」の見出しのすぐ下のまとめの 1 行（左の線・上限の記号・文字）で
// 見せる。棒は SVG の rect の width 属性で描き（style 属性を使わない。CSP）、読み上げには出さない（同じ値を文字で出す）。
// 届いたのに棒が 100% に満たない（次の 1 回分に足りない）ときは、使えない残りを点線の枠で示す
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, signOutActive } from '../auth/session';
import {
  USAGE_INFO,
  USAGE_INTRO,
  USAGE_TITLE,
  type UsageMeter,
  type UsageRow,
} from '../lib/ai-usage';
import {
  type AiUsageController,
  type AiUsageState,
  createAiUsageController,
} from '../lib/ai-usage-controller';
import '../styles/ai-usage.css';
import { Button } from './Button';
import { Icon } from './Icon';
import { InfoTip } from './InfoTip';

export interface AiUsageViewProps {
  readonly state: AiUsageState;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
  /** カードの見出し（h2）を出すか（既定 true）。設定の次の画面（#133）では画面の題（h1）が同じ名前なので出さない */
  readonly titled?: boolean;
}

/** controller を作って購読する（開くたびに読み直す）。設定の根の行の添え（#133）と利用状況の画面が使う */
export function useAiUsage(): {
  readonly state: AiUsageState;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
} {
  const controller = useMemo<AiUsageController>(() => createAiUsageController({ api }), []);
  const [state, setState] = useState<AiUsageState>(controller.getState());
  useEffect(() => {
    const off = controller.subscribe(setState);
    void controller.load();
    return off;
  }, [controller]);
  return {
    state,
    onReload: () => {
      void controller.load();
    },
    onRelogin: () => {
      void signOutActive();
    },
  };
}

/** controller を作って購読する（画面を開くたびに読み直す） */
export function AiUsageCard({ titled }: { readonly titled?: boolean } = {}) {
  const u = useAiUsage();
  return <AiUsageView {...u} titled={titled ?? true} />;
}

const TITLE_ID = 'ai-usage-title';

export function AiUsageView({ state, onReload, onRelogin, titled }: AiUsageViewProps) {
  const head = titled ?? true;
  return (
    <section
      class="card section usage"
      {...(head ? { 'aria-labelledby': TITLE_ID } : { 'aria-label': USAGE_TITLE })}
    >
      {head ? (
        <h2 class="section__title" id={TITLE_ID}>
          {USAGE_TITLE}
        </h2>
      ) : null}
      <p class="section__note">
        {USAGE_INTRO}
        <InfoTip label={USAGE_INFO.label} body={USAGE_INFO.body} id={USAGE_INFO.id} />
      </p>
      <UsageBody state={state} onReload={onReload} onRelogin={onRelogin} />
    </section>
  );
}

function UsageBody({ state, onReload, onRelogin }: AiUsageViewProps) {
  if (state.phase === 'loading') {
    return (
      <p class="loading" role="status">
        読み込んでいます…
      </p>
    );
  }
  if (state.phase === 'failed') {
    // 設定の読み込みの失敗と同じ形（知らせの外にボタン。カード → 知らせ → ボタンの 3 段の入れ子にしない）
    return (
      <>
        <p class="notice notice--error" role="alert">
          {state.text}
        </p>
        <div>
          {state.auth ? (
            <Button variant="secondary" icon="logout" onClick={onRelogin}>
              もう一度ログイン
            </Button>
          ) : (
            <Button variant="secondary" onClick={onReload}>
              再読み込み
            </Button>
          )}
        </div>
      </>
    );
  }
  const v = state.view;
  return (
    <>
      <div class="usage__group">
        <h3 class="usage__heading">{v.todayLabel}</h3>
        {v.summary ? (
          <p class="usage__summary" data-status={v.summary.status}>
            <Icon name="limit" />
            <span>{v.summary.text}</span>
          </p>
        ) : null}
        {v.bypass ? (
          <>
            {v.bypassLines.map((line) => (
              <p class="usage__bypass" key={line}>
                {line}
              </p>
            ))}
            <Rows rows={v.todayPlain} />
          </>
        ) : (
          v.today.map((m) => <Meter key={m.label} meter={m} />)
        )}
      </div>
      <div class="usage__group">
        <h3 class="usage__heading">{v.monthLabel}</h3>
        <Rows rows={v.month} />
      </div>
      {v.notes.length > 0 ? (
        <ul class="usage__notes">
          {v.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** ラベル + 値の行（今日の上限なし・今月で同じ組み） */
function Rows({ rows }: { rows: readonly UsageRow[] }) {
  return (
    <dl class="usage__rows">
      {rows.map((r) => (
        <div class="usage__row" key={r.label}>
          <dt class="usage__label">{r.label}</dt>
          <dd class="usage__value">{r.valueText}</dd>
        </div>
      ))}
    </dl>
  );
}

function Meter({ meter }: { meter: UsageMeter }) {
  const used = Math.min(Math.max(meter.pct, 0), 100);
  return (
    <div class="usage__meter" data-status={meter.status}>
      <div class="usage__row">
        <span class="usage__label">{meter.label}</span>
        <span class="usage__value">{meter.mainText}</span>
        <span class="usage__sub">{meter.subText}</span>
      </div>
      <svg class="usage__bar" aria-hidden="true" focusable="false" preserveAspectRatio="none">
        <rect class="usage__track" x="0" y="0" width="100%" height="100%" />
        <rect class="usage__fill" x="0" y="0" width={`${used}%`} height="100%" />
        {meter.unusableRest ? (
          <rect class="usage__rest" x={`${used}%`} y="0" width={`${100 - used}%`} height="100%" />
        ) : null}
      </svg>
      {meter.statusText ? <p class="usage__status">{meter.statusText}</p> : null}
    </div>
  );
}
