// 両建てのまとまりの部品（#267。設計書 7.7・9.2）。どれも hook を持たない（状態は画面の hook の層が持って渡す）。
// - GroupPickerBody: 相手を選ぶ下のシートの中身（本玉の 1 行と ［入れ替える］・候補の段・下の帯の量の比べと判定の 1 行・［結ぶ］）
// - GroupLineLink: メンバーの取引の詳細の、判定のカードの代わりの 1 行（押すとまとまりの画面）
// - BrokenGroupNotice: 崩れたまとまりの知らせと ［解く］
// - MemberList: まとまりの画面のメンバーの行（押すとその取引の詳細）
// 色は判定の段だけ（バッジ）。数字は無色（C34）。値はテキストのノードだけ
import '../styles/groups.css';
import type { GroupRole, InstrumentRecord, StoredTrade } from '../../../core/record';
import { formatPct, formatQuantity } from '../lib/format';
import type { PickerState } from '../lib/group-controller';
import {
  BROKEN_NOTE,
  BROKEN_TEXT,
  entryStartOf,
  type MemberRowModel,
  type PreviewLine,
  ROLE_TEXT,
  shortDateTime,
  tradeShortText,
  volumeOf,
} from '../lib/position-group';
import { instrumentNameOf, SIDE_SHORT } from '../lib/trade-view';
import { Button, RowLink } from './Button';
import { Icon } from './Icon';
import { JudgeBadge } from './JudgeBadge';
import { RNum } from './Num';

/** 相手を選ぶシートの中身の props */
export interface GroupPickerProps {
  readonly prefix: string;
  readonly base: StoredTrade;
  readonly state: PickerState;
  /** 選んだ組と役割（base を先頭に） */
  readonly members: readonly { readonly trade: StoredTrade; readonly role: GroupRole }[];
  readonly instruments: readonly InstrumentRecord[];
  readonly volume: string;
  readonly preview: PreviewLine;
  /** 口座の名前（口座が 2 つ以上のときだけ。無ければ undefined） */
  readonly accountName: (t: StoredTrade) => string | undefined;
  readonly onToggle: (id: string) => void;
  readonly onSwap: () => void;
  readonly onLink: () => void;
  readonly onRetry: () => void;
}

/** 下の帯の判定の 1 行（記録する画面の下の帯と同じ形。押せない静かな行） */
export function PreviewLineView({ line, id }: { readonly line: PreviewLine; readonly id: string }) {
  return (
    <div
      id={id}
      class={line.kind === 'judged' ? 'vline vline--judged gpick__vline' : 'vline gpick__vline'}
    >
      {line.kind === 'judged' ? (
        <>
          <JudgeBadge grade={line.grade} />
          {line.caution !== undefined ? <span class="vline__caution">{line.caution}</span> : null}
          {line.r !== undefined ? <RNum value={line.r} tier="title" /> : null}
          {line.riskPct !== undefined ? (
            <span class="vline__risk">
              リスク <span class="num">{formatPct(line.riskPct)}</span>
            </span>
          ) : null}
        </>
      ) : (
        <span class="record__status">{line.text}</span>
      )}
    </div>
  );
}

/** 候補の 1 行（押すと選ぶ・外す。aria-pressed） */
function Candidate(p: {
  readonly t: StoredTrade;
  readonly selected: boolean;
  readonly instruments: readonly InstrumentRecord[];
  readonly account: string | undefined;
  readonly disabled: boolean;
  readonly onToggle: () => void;
}) {
  const { t } = p;
  const when = `${shortDateTime(entryStartOf(t))} → ${shortDateTime(t.record.exit.time)}`;
  return (
    <button
      type="button"
      class={p.selected ? 'gpick__cand gpick__cand--on' : 'gpick__cand'}
      aria-pressed={p.selected ? 'true' : 'false'}
      disabled={p.disabled}
      onClick={p.onToggle}
    >
      <span class="gpick__check" aria-hidden="true">
        {p.selected ? <Icon name="check" /> : null}
      </span>
      <span class="gpick__main">
        <span class="gpick__title">
          <span class="gpick__name">{instrumentNameOf(t, p.instruments)}</span>
          <span class="gpick__side">{SIDE_SHORT[t.record.side]}</span>
          {p.account !== undefined ? <span class="gpick__account">{p.account}</span> : null}
        </span>
        <span class="gpick__sub">
          <span class="gpick__vol">量 {formatQuantity(volumeOf(t))}</span>
          <span class="gpick__when">{when}</span>
        </span>
      </span>
    </button>
  );
}

/** 相手を選ぶシートの中身（7.7） */
export function GroupPickerBody(p: GroupPickerProps) {
  const { state } = p;
  if (state.phase === 'loading') {
    return (
      <p class="gpick__status" role="status">
        候補を読み込んでいます…
      </p>
    );
  }
  if (state.phase === 'failed') {
    return (
      <div class="gpick__status">
        <p role="alert">{state.error}</p>
        <Button variant="secondary" onClick={p.onRetry}>
          再読み込み
        </Button>
      </div>
    );
  }
  const baseRole = p.members[0]?.role ?? 'main';
  const otherRole: GroupRole = baseRole === 'main' ? 'hedge' : 'main';
  const mains = p.members.filter((m) => m.role === 'main').map((m) => m.trade);
  const sections: { key: string; title: string; items: readonly StoredTrade[] }[] = [
    { key: 'opposite', title: ROLE_TEXT[otherRole], items: state.sections.opposite },
    { key: 'same', title: `${ROLE_TEXT[baseRole]}に加える`, items: state.sections.same },
    { key: 'other', title: 'ほかの銘柄', items: state.sections.other },
  ];
  const empty = sections.every((s) => s.items.length === 0);
  const block = p.preview.kind === 'none';
  return (
    <div class="gpick">
      <div class="gpick__head">
        <p class="gpick__main-line">
          {ROLE_TEXT.main}: {mains.map((t) => tradeShortText(t, p.instruments)).join(' · ')} · 量{' '}
          {formatQuantity(Number(mains.reduce((s, t) => s + volumeOf(t), 0).toPrecision(15)))}
        </p>
        <Button
          variant="tonal"
          size="sm"
          onClick={p.onSwap}
          disabled={state.saving || p.members.length < 2}
        >
          入れ替える
        </Button>
      </div>
      {empty ? (
        <p class="gpick__empty">
          保有の期間が重なる取引がありません。決済の代わりの取引を記録してから結んでください。
        </p>
      ) : (
        sections
          .filter((s) => s.items.length > 0)
          .map((s) => (
            <section
              key={s.key}
              class="gpick__section"
              aria-labelledby={`${p.prefix}-pick-${s.key}`}
            >
              <h3 class="gpick__section-title" id={`${p.prefix}-pick-${s.key}`}>
                {s.title}
              </h3>
              <ul class="gpick__list">
                {s.items.map((t) => (
                  <li key={t.id}>
                    <Candidate
                      t={t}
                      selected={state.selected.includes(t.id)}
                      instruments={p.instruments}
                      account={p.accountName(t)}
                      disabled={state.saving}
                      onToggle={() => p.onToggle(t.id)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
      )}
      <div class="gsheet__actions">
        {p.members.length >= 2 ? <p class="gpick__volume">{p.volume}</p> : null}
        <PreviewLineView line={p.preview} id={`${p.prefix}-pick-verdict`} />
        {state.error ? (
          <p class="gpick__error" role="alert">
            {state.error}
          </p>
        ) : null}
        <Button
          block
          variant="primary"
          onClick={p.onLink}
          disabled={block || state.saving}
          {...(block ? { describedBy: `${p.prefix}-pick-verdict` } : {})}
        >
          {state.saving ? '結んでいます…' : '結ぶ'}
        </Button>
      </div>
    </div>
  );
}

/** メンバーの取引の詳細の 1 行（判定のカードの代わり。押すとまとまりの画面。7.7） */
export function GroupLineLink(p: {
  readonly href: string;
  readonly text: string;
  readonly id?: string;
}) {
  return (
    <nav class="dlist gline" aria-label="両建てのまとまり">
      <RowLink href={p.href} {...(p.id ? { id: p.id } : {})}>
        {p.text}
      </RowLink>
    </nav>
  );
}

/** 崩れたまとまりの知らせと ［解く］（4.8・7.7） */
export function BrokenGroupNotice(p: {
  readonly busy: boolean;
  readonly error?: string | undefined;
  readonly onUnlink: () => void;
}) {
  return (
    <section class="card gbroken" aria-label={BROKEN_TEXT}>
      <p class="gbroken__title">
        <Icon name="offPlan" />
        <span>{BROKEN_TEXT}</span>
      </p>
      <p class="gbroken__note">{BROKEN_NOTE}</p>
      {p.error ? (
        <p class="gbroken__error" role="alert">
          {p.error}
        </p>
      ) : null}
      <Button variant="secondary" size="sm" onClick={p.onUnlink} disabled={p.busy}>
        {p.busy ? '解いています…' : '解く'}
      </Button>
    </section>
  );
}

/** まとまりの画面のメンバーの行（7.7） */
export function MemberList({ rows }: { readonly rows: readonly MemberRowModel[] }) {
  return (
    <section class="gmembers" aria-labelledby="group-members-title">
      <h2 class="gmembers__title" id="group-members-title">
        メンバー
      </h2>
      <ul class="dlist gmembers__list">
        {rows.map((r) => (
          <li key={r.id}>
            <RowLink href={r.href}>
              <span class="gmember">
                <span class="gmember__role">{r.role}</span>
                <span class="gmember__title">
                  {r.title}
                  {r.account !== undefined ? (
                    <span class="gmember__account"> · {r.account}</span>
                  ) : null}
                </span>
                <span class="gmember__sub">
                  <span>{r.volume}</span>
                  <span>{r.when}</span>
                  {r.pnl !== null ? <span class="num">{r.pnl}</span> : null}
                </span>
              </span>
            </RowLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
