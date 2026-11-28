// 両建てのまとまり（次の画面 `/trades/groups/<id>`。#267・設計書 7.7・9.2・ADR-0027）:
// - 上の帯「‹ 前の画面」・題「両建て · 〈銘柄〉 L」・「…」（操作のシート: 固定の価格などを直す・解く）
// - 判定のカード（取引の詳細と同じ形。LC の物差しは本玉の価格・決済は部分の量の加重平均の価格 P。損益は通貨が違えば通貨ごと）。
//   「窓・滑りでしたか」は持ち続けたが当たり、決済の理由を上書きしていないときだけカードの中で聞く（5.8 の 5）
// - 固定の 1 行と注記・メンバーの行（押すとその取引の詳細）・なぜのカード（心理と Good / More はメンバーの和。付け外しは
//   すべてのメンバーに書く。6.5）
// - 崩れたまとまり（4.8）は知らせと ［解く］ と、読めたメンバーの行
// TradeGroup・TradeGroupView は hook を持たない（開いているシート・下書きは TradeGroupScreen が持つ）
import '../styles/detail.css';
import '../styles/groups.css';
import { Fragment, type JSX } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { EmotionTagId } from '../../../core/emotion-tags';
import type { GroupExitBody } from '../../../core/record';
import type { ReflectionSide, ReflectionTopicId } from '../../../core/reflection';
import { api, signOutActive } from '../auth/session';
import { type BackTarget, TopBar } from '../components/AppBar';
import { Button, IconButton, RowLink } from '../components/Button';
import { useEmotionChoices } from '../components/EmotionChoices';
import { EmotionCard, EmotionSheetBody } from '../components/Emotions';
import { EmptyState } from '../components/EmptyState';
import { BrokenGroupNotice, MemberList } from '../components/GroupParts';
import { InfoTip } from '../components/InfoTip';
import { NumberField } from '../components/NumberField';
import { ReflectionCard, ReflectionSheetBody } from '../components/Reflection';
import { Segment } from '../components/Segment';
import { Sheet } from '../components/Sheet';
import { EXIT_REASONS } from '../components/TradeFields';
import { Verdict } from '../components/Verdict';
import { hasManyAccounts, tradeAccountName } from '../lib/accounts';
import { APP_NAME } from '../lib/app-name';
import { badgeModel } from '../lib/badge';
import { WHY_TITLE } from '../lib/detail-view';
import { hiddenOf } from '../lib/emotion-choices-controller';
import {
  createEmotionController,
  type EmotionController,
  type EmotionState,
} from '../lib/emotion-controller';
import { EMOTION_SHEET_TITLE } from '../lib/emotion-tags';
import { formatPrice } from '../lib/format';
import { createGroupController, type GroupScreenState } from '../lib/group-controller';
import {
  asksGapSlip,
  type ExitDraft,
  exitDraftOf,
  firstMainOf,
  fixLineParts,
  gapSlipReason,
  groupBody,
  groupNoteText,
  groupSide,
  groupSummary,
  groupTitle,
  groupWhy,
  mainsOf,
  memberRows,
  pnlListText,
  readExitDraft,
  UNLINK_BROKEN_NOTE,
  unlinkLabel,
  unlinkNote,
} from '../lib/position-group';
import { REFLECTION_TITLE, reflectionCardSides } from '../lib/reflection';
import {
  createReflectionController,
  type ReflectionController,
  type ReflectionState,
} from '../lib/reflection-controller';
import { createRequest } from '../lib/request';
import { NavigatorContext } from '../lib/router';
import { titleOf } from '../lib/routes';
import { UnlinksContext } from '../lib/unlinks-context';
import { backTargetOf, type ReflectionActions } from './TradeDetail';
import { LoadState } from './Trades';

/** 開いているシート */
export type GroupSheet = 'actions' | 'exit' | 'emotion' | 'reflection' | null;

export const GROUP_SHEET_ID = {
  actions: 'group-actions-sheet',
  exit: 'group-exit-sheet',
  emotion: 'group-emotion-sheet',
  reflection: 'group-reflection-sheet',
} as const;

/** 操作のシートの行の文字 */
export const EDIT_EXIT_LABEL = '固定の価格などを直す';
export const UNLINK_LABEL = '解く';
/** 直すシートの題 */
export const EXIT_SHEET_TITLE = '固定の価格と決済';
/** 固定の価格の「i」の中身（5.8 の 1・7.7） */
export const FIX_PRICE_INFO =
  'CFD の価格は先物と差があることがあります（現物の指数を元にした CFD・金利と配当の差）。LC と比べる価格なので、差の大きい銘柄は先物の価格に合わせた値を入力してください。空にすると、決済の代わりのインの量の加重平均に戻ります。';

function notFoundState(): JSX.Element {
  return (
    <EmptyState
      icon="list"
      title="このまとまりは見つかりません"
      description="解かれたか、URL が間違っている可能性があります。"
    >
      <Button href="/trades" variant="secondary" icon="back">
        一覧へ戻る
      </Button>
    </EmptyState>
  );
}

export function TradeGroup({ id }: { readonly id: string }) {
  return <TradeGroupScreen id={id} />;
}

function TradeGroupScreen({ id }: { readonly id: string }) {
  const controller = useMemo(() => createGroupController({ api, id }), [id]);
  const [state, setState] = useState<GroupScreenState>(controller.getState());
  const [sheet, setSheet] = useState<GroupSheet>(null);
  const [draft, setDraft] = useState<ExitDraft>({ price: '', orderType: '', reason: '' });
  const [draftError, setDraftError] = useState<string | null>(null);
  const nav = useContext(NavigatorContext);
  const unlinks = useContext(UnlinksContext);
  const emotion = useRef<EmotionController | null>(null);
  const [emotionState, setEmotionState] = useState<EmotionState | null>(null);
  const reflection = useRef<ReflectionController | null>(null);
  const [reflectionState, setReflectionState] = useState<ReflectionState | null>(null);
  const choices = useEmotionChoices();
  useEffect(() => {
    const off = controller.subscribe(setState);
    void controller.load();
    return () => {
      off();
      controller.dispose();
      emotion.current?.dispose();
      emotion.current = null;
      reflection.current?.dispose();
      reflection.current = null;
      setEmotionState(null);
      setReflectionState(null);
    };
  }, [controller]);
  const title =
    state.phase === 'ready' && state.state.kind === 'ok'
      ? groupTitle(mainsOf(state.state.members), state.instruments)
      : null;
  useEffect(() => {
    document.title = title ? `${title} — ${APP_NAME}` : titleOf({ name: 'tradeGroup', id });
  }, [title, id]);

  const memberIds = () =>
    state.phase === 'ready' && state.state.kind === 'ok'
      ? state.state.members.map((m) => m.trade.id)
      : [];
  const onSheet = (next: GroupSheet) => {
    const cur = controller.getState();
    if (next === 'exit' && cur.phase === 'ready') {
      setDraft(exitDraftOf(cur.group));
      setDraftError(null);
      controller.clearError();
    }
    if (next === 'emotion' && cur.phase === 'ready' && cur.state.kind === 'ok') {
      if (!emotion.current?.getState().sending) {
        emotion.current?.dispose();
        const c = createEmotionController({
          request: createRequest(api),
          tradeIds: memberIds(),
          initial: groupWhy(cur.state.members).emotions,
          onSaved: (tags) => controller.applyEmotionTags(tags),
        });
        emotion.current = c;
        c.subscribe(setEmotionState);
      }
    }
    if (next !== 'reflection' && reflection.current) {
      reflection.current.setDraft('good', '');
      reflection.current.setDraft('more', '');
    }
    if (next === 'reflection' && cur.phase === 'ready' && cur.state.kind === 'ok') {
      if (!reflection.current?.getState().sending) {
        reflection.current?.dispose();
        const c = createReflectionController({
          request: createRequest(api),
          tradeIds: memberIds(),
          initial: groupWhy(cur.state.members).reflection,
          onSaved: (r) => controller.applyReflection(r),
        });
        reflection.current = c;
        c.subscribe(setReflectionState);
      }
    }
    setSheet(next);
  };
  return (
    <TradeGroupView
      back={backTargetOf(nav, '/trades')}
      state={state}
      sheet={sheet}
      onSheet={onSheet}
      draft={draft}
      draftError={draftError}
      onDraft={(d) => {
        setDraft(d);
        setDraftError(null);
      }}
      onSaveExit={() => {
        const read = readExitDraft(draft);
        if (read.error) {
          setDraftError(read.error);
          return;
        }
        void controller.saveExit(read.exit).then((ok) => {
          if (ok) setSheet(null);
        });
      }}
      onGapSlip={(answer) => {
        const cur = controller.getState();
        if (cur.phase !== 'ready' || cur.state.kind !== 'ok') return;
        const exit: GroupExitBody = {
          ...(cur.group.exit ?? {}),
          reason: gapSlipReason(answer, firstMainOf(cur.state.members)),
        };
        void controller.saveExit(exit);
      }}
      onUnlink={() => {
        // 判定に使えるまとまりは、解いた後に上書きごと結び直せるよう本文を預ける（[元に戻す]。ADR-0007 の形・7.7）
        const cur = controller.getState();
        const undo =
          cur.phase === 'ready' && cur.state.kind === 'ok'
            ? {
                label: unlinkLabel(mainsOf(cur.state.members), cur.instruments),
                body: groupBody(cur.group.members, cur.group.exit),
              }
            : null;
        void controller.unlink().then((ok) => {
          if (!ok) return;
          setSheet(null);
          if (undo) unlinks?.done(undo.label, undo.body);
          nav?.back('/trades');
        });
      }}
      {...(emotionState ? { emotion: emotionState } : {})}
      onEmotionToggle={(tag) => emotion.current?.toggle(tag)}
      emotionHidden={hiddenOf(choices.state)}
      {...(reflectionState ? { reflection: reflectionState } : {})}
      onReflection={{
        toggle: (side, tid) => reflection.current?.toggle(side, tid),
        draft: (side, text) => reflection.current?.setDraft(side, text),
        add: (side) => reflection.current?.addNote(side),
        remove: (side, i) => reflection.current?.removeNote(side, i),
        done: () => reflection.current?.commitDrafts() ?? true,
      }}
      onReload={() => {
        void controller.load();
      }}
      onRelogin={() => {
        void signOutActive();
      }}
    />
  );
}

export interface TradeGroupViewProps {
  readonly back?: BackTarget;
  readonly state: GroupScreenState;
  readonly sheet: GroupSheet;
  readonly onSheet: (s: GroupSheet) => void;
  readonly draft: ExitDraft;
  readonly draftError: string | null;
  readonly onDraft: (d: ExitDraft) => void;
  readonly onSaveExit: () => void;
  readonly onGapSlip: (answer: boolean) => void;
  readonly onUnlink: () => void;
  readonly emotion?: EmotionState;
  readonly onEmotionToggle?: (id: EmotionTagId) => void;
  readonly emotionHidden?: readonly EmotionTagId[];
  readonly reflection?: ReflectionState;
  readonly onReflection?: ReflectionActions;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
}

/** 「…」のボタンの id */
export const GROUP_MORE_ID = 'group-more';

/** まとまりの画面（hook を持たない） */
export function TradeGroupView(p: TradeGroupViewProps) {
  const { state } = p;
  const back: BackTarget = p.back ?? { label: '取引', href: '/trades' };
  if (state.phase === 'notFound') {
    return (
      <>
        <TopBar back={back} title="両建て" />
        {notFoundState()}
      </>
    );
  }
  if (state.phase !== 'ready') {
    return (
      <>
        <TopBar back={back} title="両建て" />
        <LoadState {...p} />
      </>
    );
  }
  const st = state.state;
  const many = hasManyAccounts(state.accounts);
  const accountName = (t: Parameters<typeof tradeAccountName>[0]) =>
    many ? tradeAccountName(t, state.accounts) : undefined;
  const more = (
    <IconButton
      icon="more"
      label="操作"
      id={GROUP_MORE_ID}
      class="appbar__more"
      onClick={() => p.onSheet('actions')}
    />
  );
  if (st.kind === 'broken') {
    const present = state.group.members.flatMap((m) => {
      const trade = state.byId.get(m.tradeId);
      return trade ? [{ trade, role: m.role }] : [];
    });
    return (
      <>
        <TopBar back={back} title="両建て" actions={more} />
        <div class="detail group">
          <BrokenGroupNotice
            busy={state.saving === 'unlink'}
            error={state.error ?? undefined}
            onUnlink={p.onUnlink}
          />
          {present.length > 0 ? (
            <MemberList rows={memberRows(present, state.instruments, accountName)} />
          ) : null}
        </div>
        <GroupSheets {...p} />
      </>
    );
  }
  const mains = mainsOf(st.members);
  const summary = groupSummary(st.ev, st.members);
  const side = groupSide(st.ev, mains);
  const pnlList = pnlListText(st.ev);
  const fix = fixLineParts(st.ev, st.members, state.instruments);
  const notes = st.ev.ok
    ? st.ev.notes.map((n) => groupNoteText(n, state.byId, state.instruments))
    : [];
  const ask = asksGapSlip(st.ev, state.group);
  const tier = badgeModel(summary.judgment?.grade ?? null).tier;
  const why = groupWhy(st.members);
  const off = tier === 'break' || tier === 'worst';
  return (
    <>
      <TopBar back={back} title={groupTitle(mains, state.instruments)} actions={more} />
      <div class="detail group">
        <Verdict
          summary={summary}
          side={side}
          titleId="group-verdict-title"
          rulerFirst
          {...(pnlList === null ? {} : { account: `損益 ${pnlList}（通貨ごと・換算しません）` })}
          {...(ask
            ? {
                gapSlip: (
                  <Segment
                    label="窓・滑りでしたか"
                    name="group-gap-slip"
                    value={null}
                    onChange={(v) => p.onGapSlip(v === 'yes')}
                    options={[
                      { value: 'yes', label: 'はい' },
                      { value: 'no', label: 'いいえ' },
                    ]}
                  />
                ),
              }
            : {})}
        />
        {state.error && p.sheet !== 'exit' ? (
          <p class="notice notice--error" role="alert">
            {state.error}
          </p>
        ) : null}
        {fix.length > 0 ? (
          <section class="card gfix" aria-label="固定">
            <p class="gfix__line">
              {fix.map((seg, i) => (
                <Fragment key={seg}>
                  {i > 0 ? ' ' : null}
                  <span class="detail__seg">{i > 0 ? `· ${seg}` : seg}</span>
                </Fragment>
              ))}
              <InfoTip term="fixPoint" size="sm" />
            </p>
            {notes.map((n) => (
              <p key={n} class="gfix__note">
                {n}
              </p>
            ))}
          </section>
        ) : null}
        <MemberList rows={memberRows(st.members, state.instruments, accountName)} />
        <section class="card dwhy" aria-labelledby="group-why-title">
          <h2 class="dwhy__title" id="group-why-title">
            {WHY_TITLE[tier]}
          </h2>
          <EmotionCard
            tags={why.emotions}
            error={p.sheet === 'emotion' ? null : (p.emotion?.error ?? null)}
            onOpen={() => p.onSheet('emotion')}
          />
          <ReflectionCard
            sides={reflectionCardSides(why.reflection, { moreFirst: off })}
            error={p.sheet === 'reflection' ? null : (p.reflection?.error ?? null)}
            onOpen={() => p.onSheet('reflection')}
          />
        </section>
      </div>
      <GroupSheets {...p} />
    </>
  );
}

/** 操作のシート・直すシート・心理・Good / More のシート（hook を持たない） */
function GroupSheets(p: TradeGroupViewProps) {
  const { state, sheet } = p;
  if (state.phase !== 'ready') return null;
  const ok = state.state.kind === 'ok';
  const fix = ok && state.state.kind === 'ok' && state.state.ev.ok ? state.state.ev.fix : undefined;
  const firstMain = ok && state.state.kind === 'ok' ? firstMainOf(state.state.members) : undefined;
  const defaultReason = EXIT_REASONS.find(
    (r) => r.value === (firstMain?.record.exit.reason ?? 'other'),
  );
  const set = <K extends keyof ExitDraft>(k: K, v: ExitDraft[K]) =>
    p.onDraft({ ...p.draft, [k]: v });
  return (
    <>
      <Sheet
        id={GROUP_SHEET_ID.actions}
        open={sheet === 'actions'}
        kind="info"
        title="操作"
        onDismiss={() => p.onSheet(null)}
      >
        <div class="dlist detail__actions">
          {ok ? (
            <RowLink id="group-action-exit" onClick={() => p.onSheet('exit')}>
              {EDIT_EXIT_LABEL}
            </RowLink>
          ) : null}
          <RowLink
            id="group-action-unlink"
            onClick={p.onUnlink}
            meta={ok ? unlinkNote(state.group.exit !== undefined) : UNLINK_BROKEN_NOTE}
          >
            {state.saving === 'unlink' ? '解いています…' : UNLINK_LABEL}
          </RowLink>
        </div>
        {state.error && sheet === 'actions' ? (
          <p class="notice notice--error" role="alert">
            {state.error}
          </p>
        ) : null}
      </Sheet>
      <Sheet
        id={GROUP_SHEET_ID.exit}
        open={sheet === 'exit' && ok}
        kind="form"
        title={EXIT_SHEET_TITLE}
        onDismiss={() => p.onSheet(null)}
      >
        <form
          class="gsheet"
          onSubmit={(e) => {
            e.preventDefault();
            p.onSaveExit();
          }}
        >
          <NumberField
            id="group-fix-price"
            label="固定の価格"
            value={p.draft.price}
            onInput={(v) => set('price', v)}
            inputMode="decimal"
            {...(fix
              ? {
                  placeholder: formatPrice(fix.derivedPrice),
                  hint: `空 = ${formatPrice(fix.derivedPrice)}（決済の代わりのインの量の加重平均）`,
                }
              : {})}
            {...(p.draftError ? { error: p.draftError } : {})}
            info={
              <InfoTip
                label="固定の価格"
                body={FIX_PRICE_INFO}
                id="group-fix-price-info"
                size="sm"
              />
            }
          />
          <div class="field">
            <div class="field__head">
              <label class="field__label" for="group-fix-order">
                決済の代わりのエントリーの注文の種類
              </label>
            </div>
            <select
              id="group-fix-order"
              class="select"
              value={p.draft.orderType}
              onChange={(ev) => set('orderType', ev.currentTarget.value as ExitDraft['orderType'])}
            >
              <option value="">不明</option>
              <option value="stop">逆指値</option>
              <option value="market">成行</option>
              <option value="limit">指値</option>
            </select>
          </div>
          <div class="field">
            <div class="field__head">
              <label class="field__label" for="group-fix-reason">
                決済の理由
              </label>
            </div>
            <select
              id="group-fix-reason"
              class="select"
              value={p.draft.reason}
              onChange={(ev) => set('reason', ev.currentTarget.value as ExitDraft['reason'])}
            >
              <option value="">最初の本玉の理由（{defaultReason?.label ?? 'その他'}）</option>
              {EXIT_REASONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {state.error && sheet === 'exit' ? (
            <p class="notice notice--error" role="alert">
              {state.error}
            </p>
          ) : null}
          <div class="gsheet__actions">
            <Button type="submit" variant="primary" block disabled={state.saving !== null}>
              {state.saving === 'exit' ? '保存しています…' : '保存'}
            </Button>
          </div>
        </form>
      </Sheet>
      <Sheet
        id={GROUP_SHEET_ID.emotion}
        open={sheet === 'emotion' && p.emotion !== undefined}
        kind="form"
        title={EMOTION_SHEET_TITLE.detail}
        onDismiss={() => p.onSheet(null)}
      >
        {p.emotion ? (
          <EmotionSheetBody
            prefix="group"
            context="detail"
            state={p.emotion}
            {...(p.emotionHidden ? { hidden: p.emotionHidden } : {})}
            onToggle={(id) => p.onEmotionToggle?.(id)}
            onClose={() => p.onSheet(null)}
          />
        ) : null}
      </Sheet>
      <Sheet
        id={GROUP_SHEET_ID.reflection}
        open={sheet === 'reflection' && p.reflection !== undefined}
        kind="form"
        title={REFLECTION_TITLE}
        onDismiss={() => p.onSheet(null)}
      >
        {p.reflection ? (
          <ReflectionSheetBody
            prefix="group"
            state={p.reflection}
            onToggle={(side: ReflectionSide, id: ReflectionTopicId) =>
              p.onReflection?.toggle(side, id)
            }
            onDraft={(side, text) => p.onReflection?.draft(side, text)}
            onAddNote={(side) => p.onReflection?.add(side)}
            onRemoveNote={(side, i) => p.onReflection?.remove(side, i)}
            onClose={() => {
              if (p.onReflection?.done() ?? true) p.onSheet(null);
            }}
          />
        ) : null}
      </Sheet>
    </>
  );
}
