// 取引の詳細（Issue #9 契約 U-2。設計書 7.5・9.2、ADR-0006 決定 4。#131 で 1 画面の形に作り直した）:
// - 取引のタブの次の画面。上の帯に「‹ 前の画面」・題（銘柄 · L / S）・［編集］・「…」（操作のシート: 今の値と比べる・削除）
// - 1 画面目に判定のカード（バッジ・LC の物差し〔主役。崩れの文の後・数の前。#231・C66〕・R・リスク・損益・理由・3 つのタップの答えの札）とチャート 2 枚を横に並べる
//   （押すと全画面で見る層）。追加のチャート（#89）は 2 枚の下に同じ形で並べる
// - チャートの下に「なぜ」のカード 1 枚（題は判定の段・心理 → Good / More → 総評。#248・C69）
// - 「すべての欄」「総評」は次の画面（押せる行。その場で開かない。総評の行は「なぜ」のカードの最後）
// - 比較のシートは見るだけ。［編集で今の値にする］ で編集を「今の値」を選んだ状態で開く（写し直すのは編集の保存のとき。#31 の P4）
// - 消すは確認を挟まない（[元に戻す] はアプリの殻のトースト。ADR-0007）。無い ID・ほかの利用者の取引・消した印の取引は
//   「この取引は見つかりません」と一覧へのリンク
// チャートは API から読んだバイト列を canvas に描く（object URL・data URL・img を使わない。CSP を広げない）。
// 見出しは取引が読めたら「銘柄 · L / S」（読めるまで・見つからないときは「取引の詳細」。h1 の要素は同じなので
// 画面の移りで当てたフォーカスは外れない）。
// TradeDetail は hook を持たない（App・経路のテストが 1 段だけ呼ぶ）。「見つかりません」の面は TradeDetail が作って渡す。
// TradeDetailView も hook を持たない（開いているシートは TradeDetailScreen が持って渡す）
import '../styles/detail.css';
import { Fragment, type JSX } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type EmotionTagId, normalizeEmotions } from '../../../core/emotion-tags';
import { accountCurrencyOf } from '../../../core/record';
import {
  normalizeReflection,
  type ReflectionSide,
  type ReflectionTopicId,
} from '../../../core/reflection';
import { api, signOutActive } from '../auth/session';
import { type BackTarget, TopBar } from '../components/AppBar';
import { Button, IconButton, RowLink } from '../components/Button';
import { EXTRA_TITLE } from '../components/ChartPanel';
import { useEmotionChoices } from '../components/EmotionChoices';
import { EmotionCard, EmotionSheetBody } from '../components/Emotions';
import { EmptyState } from '../components/EmptyState';
import { BrokenGroupNotice, GroupLineLink, GroupPickerBody } from '../components/GroupParts';
import { InfoTip } from '../components/InfoTip';
import { LegTable } from '../components/LegTable';
import { ReflectionCard, ReflectionSheetBody } from '../components/Reflection';
import { ResnapshotSummary } from '../components/Resnapshot';
import { Sheet } from '../components/Sheet';
import { Verdict } from '../components/Verdict';
import { hasManyAccounts, tradeAccountName, verdictAsideText } from '../lib/accounts';
import { APP_NAME } from '../lib/app-name';
import { type AnySlot, isMainSlot } from '../lib/charts';
import { DeletionsContext, NO_HIDDEN } from '../lib/deletions-context';
import {
  ACTIONS_LABEL,
  chartCaption,
  chartCaptionParts,
  commentHref,
  DELETE_LABEL,
  DELETE_NOTE,
  DETAIL_SHEET_ID,
  type DetailSheet,
  detailActions,
  fieldsHref,
  groupActionOf,
  shownJudgment,
  WHY_INFO_ID,
  WHY_TITLE_ID,
  whyCardModel,
} from '../lib/detail-view';
import { DRAFT_DOT_TEXT, editKey } from '../lib/drafts';
import { DraftsKeptContext } from '../lib/drafts-context';
import { editBlock } from '../lib/edit-form';
import { hiddenOf } from '../lib/emotion-choices-controller';
import {
  createEmotionController,
  type EmotionController,
  type EmotionState,
} from '../lib/emotion-controller';
import { EMOTION_SHEET_TITLE } from '../lib/emotion-tags';
import {
  createPickerController,
  type PickerController,
  type PickerState,
} from '../lib/group-controller';
import { legRows } from '../lib/option-view';
import {
  DELETE_MEMBER_NOTE,
  groupHref,
  LINK_LABEL,
  memberLineText,
  OPEN_GROUP_LABEL,
  PICKER_TITLE,
  previewLine,
  volumeLine,
} from '../lib/position-group';
import { REFLECTION_TITLE, reflectionCardSides } from '../lib/reflection';
import {
  createReflectionController,
  type ReflectionController,
  type ReflectionState,
} from '../lib/reflection-controller';
import { createRequest } from '../lib/request';
import {
  COMPARE_ROW_LABEL,
  COMPARE_SHEET_TITLE,
  compareRowMeta,
  DETAIL_COMPARE_NOTE,
  detailOffer,
  EDIT_CURRENT_LABEL,
  editCurrentHref,
  type ResnapshotOffer,
} from '../lib/resnapshot';
import { tradeEmotionHref } from '../lib/review-trades';
import { type Navigator, NavigatorContext } from '../lib/router';
import { screenLabel, titleOf } from '../lib/routes';
import { browserCodec } from '../lib/statement-image';
import {
  type ChartView,
  createTradeDetailController,
  type DetailState,
} from '../lib/trade-detail-controller';
import {
  type ChartSlotView,
  chartSlots,
  detailHeading,
  shortLabel,
  tapAnswers,
  timeframeNote,
} from '../lib/trade-view';
import { LoadState } from './Trades';

/** 「この取引は見つかりません」と一覧へのリンク（詳細・直すで同じ。V4・KEEP-3） */
export function notFoundState(): JSX.Element {
  return (
    <EmptyState
      icon="list"
      title="この取引は見つかりません"
      description="削除されたか、URL が間違っている可能性があります。"
    >
      <Button href="/trades" variant="secondary" icon="back">
        一覧へ戻る
      </Button>
    </EmptyState>
  );
}

export function TradeDetail({ id }: { readonly id: string }) {
  return <TradeDetailScreen id={id} notFound={notFoundState()} />;
}

function TradeDetailScreen({
  id,
  notFound,
}: {
  readonly id: string;
  readonly notFound: JSX.Element;
}) {
  const controller = useMemo(
    () =>
      createTradeDetailController({
        api,
        id,
        preview: (bytes, type) => browserCodec.preview(bytes, type),
      }),
    [id],
  );
  const [state, setState] = useState<DetailState>(controller.getState());
  // 開いているシート（操作・比較・チャートを見る層。#131。画面を移ると捨てる）
  const [sheet, setSheet] = useState<DetailSheet | null>(null);
  const del = useContext(DeletionsContext);
  const nav = useContext(NavigatorContext);
  const kept = useContext(DraftsKeptContext);
  // 心理のタグ（#156）: シートを開くときに作り、閉じても送りが終わるまで残す（画面を離れたら捨てる）
  const emotion = useRef<EmotionController | null>(null);
  const [emotionState, setEmotionState] = useState<EmotionState | null>(null);
  // Good / More（#123）: 心理のタグと同じく、シートを開くときに作り、送りが終わるまで残す
  const reflection = useRef<ReflectionController | null>(null);
  const [reflectionState, setReflectionState] = useState<ReflectionState | null>(null);
  // 両建ての相手を選ぶ（#267）: シートを開くときに作り、閉じたら捨てる（結んでいる間は残す）
  const picker = useRef<PickerController | null>(null);
  const [pickerState, setPickerState] = useState<PickerState | null>(null);
  // 心理の選択肢の設定（#163）。画面を開くたびに読む（読めない・読み込み中はすべて出す）
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
      picker.current?.dispose();
      picker.current = null;
      // 別の取引へ移ったとき、前の取引の失敗の文言・集合を残さない
      setEmotionState(null);
      setReflectionState(null);
      setPickerState(null);
    };
  }, [controller]);
  const onSheet = (next: DetailSheet | null) => {
    if (next?.kind === 'emotion') {
      const cur = controller.getState();
      // 送っている間は同じ controller を使い続ける（押した集合を捨てない）。ほかは読んだ取引のタグから作り直す
      if (cur.phase === 'ready' && !emotion.current?.getState().sending) {
        emotion.current?.dispose();
        const c = createEmotionController({
          request: createRequest(api),
          tradeIds: [cur.trade.id],
          initial: normalizeEmotions(cur.trade.emotionTags),
          onSaved: (tags) => controller.applyEmotionTags(tags),
        });
        emotion.current = c;
        c.subscribe(setEmotionState);
      }
    }
    // ✕・戻るで閉じたら書きかけを捨てる（送り中で controller を使い続けるときも、開き直したら空の欄。設計書 9.4）
    if (next?.kind !== 'reflection' && reflection.current) {
      reflection.current.setDraft('good', '');
      reflection.current.setDraft('more', '');
    }
    if (next?.kind === 'reflection') {
      const cur = controller.getState();
      // 送っている間は同じ controller を使い続ける（押した値・書きかけを捨てない）。ほかは読んだ取引の値から作り直す
      if (cur.phase === 'ready' && !reflection.current?.getState().sending) {
        reflection.current?.dispose();
        const c = createReflectionController({
          request: createRequest(api),
          tradeIds: [cur.trade.id],
          initial: cur.trade.reflection,
          onSaved: (r) => controller.applyReflection(r),
        });
        reflection.current = c;
        c.subscribe(setReflectionState);
      }
    }
    if (next?.kind === 'link') {
      const cur = controller.getState();
      if (cur.phase === 'ready' && !picker.current) {
        const c = createPickerController({
          request: createRequest(api),
          base: cur.trade,
          instruments: cur.instruments,
          // 消した印の取引（[元に戻す] を待っている）は候補に出さない
          isHidden: (tid) => del?.state.hidden.has(tid) ?? false,
        });
        picker.current = c;
        c.subscribe(setPickerState);
        void c.load();
      }
    } else if (picker.current) {
      // 閉じたら捨てる（選んだ組は残さない。結んでいる間は結果を待つ）
      const ps = picker.current.getState();
      if (ps.phase !== 'ready' || !ps.saving) {
        picker.current.dispose();
        picker.current = null;
        setPickerState(null);
      }
    }
    setSheet(next);
  };
  // 取引が読めたら、タブ・履歴の名前も見出しと同じにする
  const heading =
    state.phase === 'ready'
      ? detailHeading(state.trade, state.instrumentName, state.accounts)
      : null;
  useEffect(() => {
    if (heading) document.title = `${heading.title} ${heading.sub} — ${APP_NAME}`;
    else document.title = titleOf({ name: 'trade', id });
  }, [heading?.title, heading?.sub, id]);
  return (
    <TradeDetailView
      id={id}
      back={backTargetOf(nav, '/trades')}
      state={state}
      sheet={sheet}
      onSheet={onSheet}
      {...(emotionState ? { emotion: emotionState } : {})}
      onEmotionToggle={(id) => emotion.current?.toggle(id)}
      emotionHidden={hiddenOf(choices.state)}
      {...(reflectionState ? { reflection: reflectionState } : {})}
      onReflection={{
        toggle: (side, id) => reflection.current?.toggle(side, id),
        draft: (side, text) => reflection.current?.setDraft(side, text),
        add: (side) => reflection.current?.addNote(side),
        remove: (side, i) => reflection.current?.removeNote(side, i),
        done: () => reflection.current?.commitDrafts() ?? true,
      }}
      {...(state.phase === 'ready'
        ? {
            emotionHref: (tag: EmotionTagId) => tradeEmotionHref(state.trade, tag, Date.now()),
          }
        : {})}
      {...(pickerState
        ? {
            picker: {
              state: pickerState,
              members: picker.current?.members() ?? [],
              onToggle: (tid: string) => picker.current?.toggle(tid),
              onSwap: () => picker.current?.swap(),
              onRetry: () => void picker.current?.load(),
              onLink: () => {
                const c = picker.current;
                if (!c) return;
                void c.link().then((gid) => {
                  if (gid === null || picker.current !== c) return;
                  c.dispose();
                  picker.current = null;
                  setPickerState(null);
                  setSheet(null);
                  nav?.push(groupHref(gid));
                });
              },
            },
          }
        : {})}
      onUnlinkGroup={() => {
        void controller.unlinkGroup();
      }}
      onReloadGroup={() => {
        void controller.reloadGroup();
      }}
      hidden={del?.state.hidden ?? NO_HIDDEN}
      notFound={notFound}
      editDraft={kept.has(editKey(id))}
      onDelete={() => {
        // 確認を挟まずに消す（取り消しはトーストの [元に戻す]。P4）。前の画面（取引のタブなら一覧）へ戻る（9.7 の 6。
        // 置き換えると同じ URL の一覧が 2 段並ぶ。消した取引は印で隠れる）。操作のシートの段は back が先に巻き戻す
        setSheet(null);
        if (state.phase === 'ready') {
          del?.remove(id, shortLabel(state.trade, state.instrumentName));
        }
        nav?.back('/trades');
      }}
      onReloadChart={(slot) => {
        void controller.reloadChart(slot);
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

/**
 * 上の帯の「‹ 前の画面の名前」（9.2）: 今の並びの 1 つ下の画面の名前と、押すと前の画面へ（無ければ fallback へ置き換え）。
 * 殻の行き来が無い（テストで画面だけ）なら fallback へのリンク
 */
export function backTargetOf(nav: Navigator | null, fallback: string): BackTarget {
  const opts = { dev: import.meta.env.DEV };
  const stack = nav?.current.mark.stack ?? [];
  const prev = stack.length >= 2 ? stack[stack.length - 2] : undefined;
  const label = screenLabel(prev ?? fallback, opts) ?? screenLabel(fallback, opts) ?? '';
  return nav ? { label, onBack: () => nav.back(fallback) } : { label, href: fallback };
}

export interface TradeDetailViewProps {
  readonly id: string;
  /** 上の帯の「‹ 前の画面」（無ければ「‹ 取引」で一覧へのリンク） */
  readonly back?: BackTarget;
  readonly state: DetailState;
  readonly hidden: ReadonlySet<string>;
  readonly notFound: JSX.Element;
  readonly onDelete: () => void;
  readonly onReloadChart: (slot: AnySlot) => void;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
  /** この取引の編集の書きかけを残している（[編集] に印の点。#75） */
  readonly editDraft?: boolean;
  /** 開いているシート（#131。省けばどれも閉じている） */
  readonly sheet?: DetailSheet | null;
  /** シートを開く・替える・閉じる（null） */
  readonly onSheet?: (sheet: DetailSheet | null) => void;
  /** 心理のタグの付け外し（#156。省けばシートの中身を出さない） */
  readonly emotion?: EmotionState;
  readonly onEmotionToggle?: (id: EmotionTagId) => void;
  /** 心理の選択肢に出さないタグ（#163 の設定。省く・読めない・読み込み中 = すべて出す） */
  readonly emotionHidden?: readonly EmotionTagId[];
  /** 心理のチップの行き先（#188。同じ心理の「期間の取引」。省けばチップは押せない札） */
  readonly emotionHref?: (id: EmotionTagId) => string;
  /** Good / More の付け外し・書く（#123。省けばシートの中身を出さない） */
  readonly reflection?: ReflectionState;
  readonly onReflection?: ReflectionActions;
  /** 両建ての相手を選ぶシート（#267。省けばシートの中身を出さない） */
  readonly picker?: PickerProps;
  /** 崩れたまとまりを解く（#267） */
  readonly onUnlinkGroup?: () => void;
  /** まとまりを読み直す（読めなかったとき） */
  readonly onReloadGroup?: () => void;
}

/** 相手を選ぶシートの状態と操作（#267） */
export interface PickerProps {
  readonly state: PickerState;
  readonly members: ReturnType<PickerController['members']>;
  readonly onToggle: (id: string) => void;
  readonly onSwap: () => void;
  readonly onRetry: () => void;
  readonly onLink: () => void;
}

/** Good / More のシートの操作（#123） */
export interface ReflectionActions {
  readonly toggle: (side: ReflectionSide, id: ReflectionTopicId) => void;
  readonly draft: (side: ReflectionSide, text: string) => void;
  readonly add: (side: ReflectionSide) => void;
  readonly remove: (side: ReflectionSide, index: number) => void;
  /** ［完了］: 書きかけを足す。足せない欄があれば false（閉じない） */
  readonly done: () => boolean;
}

/** 「…」のボタンの id */
export const DETAIL_MORE_ID = 'detail-more';

/** 上の帯（‹ 前の画面・題・［編集］・「…」）・決済の時刻の行・判定のカード・チャート・次の画面への行・シート（hook を持たない） */
export function TradeDetailView(p: TradeDetailViewProps) {
  const { state } = p;
  const back: BackTarget = p.back ?? { label: '取引', href: '/trades' };
  const plain = <TopBar back={back} title="取引の詳細" />;
  if (p.hidden.has(p.id) || state.phase === 'notFound') {
    return (
      <>
        {plain}
        {p.notFound}
      </>
    );
  }
  if (state.phase !== 'ready') {
    return (
      <>
        {plain}
        <LoadState {...p} />
      </>
    );
  }
  const t = state.trade;
  const block = editBlock(t);
  const h = detailHeading(t, state.instrumentName, state.accounts);
  const offer = detailOffer(t, state.instruments, state.accounts);
  const sheet = p.sheet ?? null;
  const open = (s: DetailSheet | null) => p.onSheet?.(s);
  return (
    <>
      <TopBar
        back={back}
        title={h.title}
        actions={
          <>
            {block === null ? (
              <Button
                href={`/trades/${t.id}/edit`}
                variant="secondary"
                size="sm"
                {...(p.editDraft ? { dot: DRAFT_DOT_TEXT } : {})}
              >
                編集
              </Button>
            ) : null}
            <IconButton
              icon="more"
              label={ACTIONS_LABEL}
              id={DETAIL_MORE_ID}
              class="appbar__more"
              onClick={() => open({ kind: 'actions' })}
            />
          </>
        }
      />
      <div class="detail__head">
        <p class="detail__when">
          {/* 幅 480px 以上だけ「エントリー … → 」を頭に（360 は見出しの下の行を 1 行に保つ。#58 デザインレビュー 5） */}
          {h.entry ? <span class="detail__entry">{h.entry} → </span> : null}
          {/* 区切り（決済の日時・保有・口座）の中では折らず、「·」は後ろの区切りの頭に付ける（判定の枠の数量の行と同じ） */}
          {h.sub.split(' · ').map((seg, i) => (
            <Fragment key={seg}>
              {i > 0 ? ' ' : null}
              <span class="detail__seg">{i > 0 ? `· ${seg}` : seg}</span>
            </Fragment>
          ))}
        </p>
      </div>
      <DetailBody {...p} />
      <DetailSheets {...p} offer={offer} sheet={sheet} open={open} />
    </>
  );
}

function DetailBody(p: TradeDetailViewProps) {
  const { state } = p;
  if (state.phase !== 'ready') return null;
  const t = state.trade;
  const block = editBlock(t);
  // 口座が 2 つ以上のときだけ、どの口座の資金（記録したとき）で割ったかの 1 行（U17）
  const accountLine = hasManyAccounts(state.accounts)
    ? verdictAsideText(tradeAccountName(t, state.accounts), t.snapshot.capitalYen, {
        recorded: true,
        currency: accountCurrencyOf(t.snapshot),
      })
    : undefined;
  const g = state.group ?? { phase: 'none' as const };
  const verdict = (
    <Verdict
      summary={state.summary}
      side={t.record.side}
      titleId="detail-verdict-title"
      rulerFirst
      {...(accountLine === undefined ? {} : { account: accountLine })}
      taps={{ items: tapAnswers(t, state.summary.judgment), note: timeframeNote(t) }}
    />
  );
  return (
    <div class="detail">
      {/* 両建てのまとまりのメンバー（#267・7.7）: 単独の判定・R・LC の物差しは出さず、まとまりの判定への 1 行。崩れたまとまりは
          知らせと ［解く］ と単独の判定。読めるまで・読めなかったときも単独の判定は出さない（C78） */}
      {g.phase === 'none' ? (
        verdict
      ) : g.phase === 'loading' ? (
        <p class="detail__note gline__status" role="status">
          両建てのまとまりを読み込んでいます…
        </p>
      ) : g.phase === 'failed' ? (
        <div class="detail__note gline__status">
          <p role="alert">両建てのまとまりを読み込めませんでした。</p>
          <Button variant="secondary" size="sm" onClick={() => p.onReloadGroup?.()}>
            再読み込み
          </Button>
        </div>
      ) : g.state.kind === 'broken' ? (
        <>
          <BrokenGroupNotice
            busy={g.unlinking === true}
            error={g.error}
            onUnlink={() => p.onUnlinkGroup?.()}
          />
          {verdict}
        </>
      ) : (
        <GroupLineLink
          id="detail-group-line"
          href={groupHref(g.state.group.id)}
          text={memberLineText(
            g.state.members.find((m) => m.trade.id === t.id)?.role ?? 'main',
            g.state.ev.ok ? g.state.ev.judgment : undefined,
          )}
        />
      )}
      {block !== null ? <p class="detail__note">{block}</p> : null}
      {/* オプションのポジションの足（#117。設計書 7.6。1R の出どころ・最大損失は判定のカードの行） */}
      {t.record.legs !== undefined ? <LegTable rows={legRows(t)} /> : null}
      <ChartsView {...p} />
      {/* なぜの段（#248・C69）: 心理 → Good / More → 総評を 1 枚のカードに。判定のカードとチャート 2 枚を最初の画面に収める
          （#131 の D131）ため、チャートの下に置く */}
      <DetailWhy {...p} />
      {/* 「すべての欄」は次の画面（その場で開かない。設計書 9.2・9.3） */}
      <nav class="dlist detail__links" aria-label="この取引の記録">
        <RowLink href={fieldsHref(t.id)}>すべての欄</RowLink>
      </nav>
    </div>
  );
}

/**
 * 「なぜ」のカード（#248・C69。設計書 9.2・9.4）: 題は判定の段（なぜ守れたか / なぜ崩れたか / 心理と振り返り）、崩れ・極悪で何も
 * 残していなければ題の下に 1 行の案内。中は 心理（#156。付いているチップは押すと同じ心理の期間の取引。#188）→ Good / More
 * （#123。崩れ・極悪は More → Good）→ 総評（総評がある取引だけ。先頭の 1 行を添えた押せる行 → 次の画面）。hook を持たない
 */
function DetailWhy(p: TradeDetailViewProps) {
  const { state } = p;
  if (state.phase !== 'ready') return null;
  const t = state.trade;
  const tags = normalizeEmotions(t.emotionTags);
  const reflection = normalizeReflection(t.reflection);
  const filled = reflectionCardSides(reflection);
  // 両建てのメンバーはまとまりの判定の段（読んでいる間・読めなかったときは中立。#267・C78）
  const m = whyCardModel(t, shownJudgment(state.summary.judgment, state.group)?.grade ?? null, {
    emotions: tags.length,
    reflection: filled.length > 0,
  });
  return (
    <section class="card dwhy" aria-labelledby={WHY_TITLE_ID}>
      <h2 class="dwhy__title" id={WHY_TITLE_ID}>
        {m.title}
        {/* 残すと何に効くかは「i」の中（崩れ・極悪で何も残していないときだけ。C70・#254） */}
        {m.hint !== null ? (
          <InfoTip label={m.title} body={m.hint} id={WHY_INFO_ID} size="sm" />
        ) : null}
      </h2>
      {/* 心理のタグ（#156。設計書 9.4: 付いているチップ〔押すと同じ心理の期間の取引。#188〕と ［変更］、無ければ「＋ 心理を付ける」。押すと同じシート） */}
      <EmotionCard
        tags={tags}
        error={p.sheet?.kind === 'emotion' ? null : (p.emotion?.error ?? null)}
        onOpen={() => p.onSheet?.({ kind: 'emotion' })}
        {...(p.emotionHref ? { hrefOf: p.emotionHref } : {})}
      />
      {/* Good / More（#123。設計書 9.4: 付いている話題の札と自分で書いた行と ［変更］、無ければ「＋ Good / More を書く」） */}
      <ReflectionCard
        sides={reflectionCardSides(reflection, { moreFirst: m.moreFirst })}
        error={p.sheet?.kind === 'reflection' ? null : (p.reflection?.error ?? null)}
        onOpen={() => p.onSheet?.({ kind: 'reflection' })}
      />
      {m.comment !== null ? (
        <div class="dwhy__part dwhy__comment">
          <div class="dlist">
            <RowLink href={commentHref(t.id)}>
              <span class="dwhy__name">総評</span>
              <span class="dwhy__preview">{m.comment.preview}</span>
            </RowLink>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * エントリー時・決済時のチャートを横に並べる（ある枠は押すと全画面で見る層。無い枠は「チャートなし」）。その下に小見出し
 * 「追加のチャート（判定には使いません）」で分けて、追加のチャート（#89。追加した順・一言と時間足つき）
 */
function ChartsView(p: TradeDetailViewProps) {
  const { state } = p;
  if (state.phase !== 'ready') return null;
  const all = chartSlots(state.trade);
  const main = all.filter((c) => isMainSlot(c.slot));
  const extras = all.filter((c) => !isMainSlot(c.slot));
  const tile = (c: ChartSlotView) => (
    <ChartTile
      key={c.slot}
      c={c}
      view={state.charts[c.slot] ?? { phase: 'loading' }}
      onOpen={() => p.onSheet?.({ kind: 'chart', slot: c.slot })}
      onReload={() => p.onReloadChart(c.slot)}
    />
  );
  return (
    <section class="dcharts" aria-labelledby="detail-charts-title">
      <h2 class="sr-only" id="detail-charts-title">
        チャート
      </h2>
      <div class="dcharts__grid">{main.map(tile)}</div>
      {extras.length > 0 ? (
        <>
          <h3 class="charts__subtitle dcharts__subtitle">{EXTRA_TITLE}</h3>
          <div class="dcharts__grid">{extras.map(tile)}</div>
        </>
      ) : null}
    </section>
  );
}

/** チャートの 1 枠（ある = 押せるサムネイル、無い = 「チャートなし」、読めない = 知らせと ［再読み込み］） */
function ChartTile(p: {
  readonly c: ChartSlotView;
  readonly view: ChartView;
  readonly onOpen: () => void;
  readonly onReload: () => void;
}) {
  const { c, view } = p;
  const parts = chartCaptionParts(c);
  const caption = (
    <>
      <span>{parts.name}</span>
      {parts.timeframe !== null ? <span class="dchart__tf">{parts.timeframe}</span> : null}
    </>
  );
  const extra = !isMainSlot(c.slot);
  const cls = `dchart chartview${extra ? ' chartview--extra' : ''}`;
  const tf = c.timeframe ?? '指定なし';
  if (!c.has) {
    return (
      <div class={`${cls} dchart--none`}>
        <span class="dchart__cap">{c.name}</span>
        <p class="chartview__none dchart__msg">チャートなし</p>
      </div>
    );
  }
  if (view.phase === 'failed') {
    return (
      <div class={`${cls} dchart--failed`}>
        <span class="dchart__cap">{caption}</span>
        <p class="dchart__msg dchart__msg--error" role="alert">
          チャートを読み込めませんでした
        </p>
        <Button variant="secondary" size="sm" onClick={p.onReload}>
          再読み込み
        </Button>
      </div>
    );
  }
  if (view.phase !== 'ready') {
    return (
      <div class={`${cls} dchart--loading`}>
        <span class="dchart__cap">{caption}</span>
        <p class="dchart__msg" role="status">
          チャートを読み込んでいます…
        </p>
      </div>
    );
  }
  return (
    <button
      type="button"
      class={`${cls} dchart--ready`}
      id={`detail-chart-${c.slot}`}
      aria-haspopup="dialog"
      aria-label={`${c.note ?? c.name}のチャート（${tf}）を大きく見る`}
      onClick={p.onOpen}
    >
      <span class="dchart__thumb" aria-hidden="true">
        <canvas
          class="chart__preview chartview__canvas dchart__canvas"
          width={view.preview.width}
          height={view.preview.height}
          ref={(el: HTMLCanvasElement | null) => {
            if (el) view.preview.draw(el);
          }}
        />
      </span>
      <span class="dchart__cap" aria-hidden="true">
        {caption}
      </span>
    </button>
  );
}

/** 操作のシート・比較のシート・チャートを見る層（hook を持たない） */
function DetailSheets(
  p: TradeDetailViewProps & {
    readonly offer: ResnapshotOffer | null;
    readonly sheet: DetailSheet | null;
    readonly open: (s: DetailSheet | null) => void;
  },
) {
  const { state, sheet, open } = p;
  if (state.phase !== 'ready') return null;
  const t = state.trade;
  const offer = p.offer;
  const groupAction = groupActionOf(t, state.group);
  const member = state.group?.phase === 'ready' && state.group.state.kind === 'ok';
  const viewing = sheet?.kind === 'chart' ? sheet.slot : null;
  const shown = viewing ? chartSlots(t).find((c) => c.slot === viewing) : undefined;
  const view = viewing ? state.charts[viewing] : undefined;
  return (
    <>
      <Sheet
        id={DETAIL_SHEET_ID.actions}
        open={sheet?.kind === 'actions'}
        kind="info"
        title={ACTIONS_LABEL}
        onDismiss={() => open(null)}
      >
        <div class="dlist detail__actions">
          {detailActions(offer !== null, groupAction).map((a) =>
            a === 'compare' && offer ? (
              <RowLink
                key={a}
                id="detail-action-compare"
                onClick={() => open({ kind: 'compare' })}
                meta={compareRowMeta(offer)}
              >
                {COMPARE_ROW_LABEL}
              </RowLink>
            ) : a === 'link' ? (
              <RowLink key={a} id="detail-action-link" onClick={() => open({ kind: 'link' })}>
                {LINK_LABEL}
              </RowLink>
            ) : a === 'openGroup' && state.group?.phase === 'ready' ? (
              <RowLink
                key={a}
                id="detail-action-group"
                href={groupHref(state.group.state.group.id)}
              >
                {OPEN_GROUP_LABEL}
              </RowLink>
            ) : a === 'delete' ? (
              // 確認を挟まずにすぐ消えるので、押す前に戻せることを添えで言う（#131 のデザインレビュー a3。色は無色のまま）。
              // 両建てのメンバーは、消すとまとまりから外れることも先に言う（4.8）
              <RowLink
                key={a}
                id="detail-action-delete"
                onClick={p.onDelete}
                meta={member ? `${DELETE_MEMBER_NOTE} · ${DELETE_NOTE}` : DELETE_NOTE}
              >
                {DELETE_LABEL}
              </RowLink>
            ) : null,
          )}
        </div>
      </Sheet>
      <Sheet
        id={DETAIL_SHEET_ID.compare}
        open={sheet?.kind === 'compare' && offer !== null}
        kind="info"
        title={COMPARE_SHEET_TITLE}
        onDismiss={() => open(null)}
      >
        {offer ? (
          <div class="detail__compare">
            <ResnapshotSummary offer={offer} prefix="detail" />
            <p class="resnap__status">{DETAIL_COMPARE_NOTE}</p>
            {/* シートのただ 1 つの操作なので幅いっぱい（重さは 2 番目のまま。#131 のデザインレビュー a4） */}
            <Button href={editCurrentHref(t.id)} variant="secondary" block>
              {EDIT_CURRENT_LABEL}
            </Button>
          </div>
        ) : null}
      </Sheet>
      <Sheet
        id={DETAIL_SHEET_ID.emotion}
        open={sheet?.kind === 'emotion' && p.emotion !== undefined}
        kind="form"
        title={EMOTION_SHEET_TITLE.detail}
        onDismiss={() => open(null)}
      >
        {p.emotion ? (
          <EmotionSheetBody
            prefix="detail"
            context="detail"
            state={p.emotion}
            {...(p.emotionHidden ? { hidden: p.emotionHidden } : {})}
            onToggle={(id) => p.onEmotionToggle?.(id)}
            onClose={() => open(null)}
          />
        ) : null}
      </Sheet>
      <Sheet
        id={DETAIL_SHEET_ID.reflection}
        open={sheet?.kind === 'reflection' && p.reflection !== undefined}
        kind="form"
        title={REFLECTION_TITLE}
        onDismiss={() => open(null)}
      >
        {p.reflection ? (
          <ReflectionSheetBody
            prefix="detail"
            state={p.reflection}
            onToggle={(side, id) => p.onReflection?.toggle(side, id)}
            onDraft={(side, text) => p.onReflection?.draft(side, text)}
            onAddNote={(side) => p.onReflection?.add(side)}
            onRemoveNote={(side, i) => p.onReflection?.remove(side, i)}
            onClose={() => {
              if (p.onReflection?.done() ?? true) open(null);
            }}
          />
        ) : null}
      </Sheet>
      <Sheet
        id={DETAIL_SHEET_ID.link}
        open={sheet?.kind === 'link' && p.picker !== undefined}
        kind="form"
        title={PICKER_TITLE}
        onDismiss={() => open(null)}
      >
        {p.picker ? (
          <GroupPickerBody
            prefix="detail"
            base={t}
            state={p.picker.state}
            members={p.picker.members}
            instruments={state.instruments}
            volume={volumeLine(p.picker.members)}
            preview={previewLine(p.picker.members)}
            accountName={(x) =>
              hasManyAccounts(state.accounts) ? tradeAccountName(x, state.accounts) : undefined
            }
            onToggle={p.picker.onToggle}
            onSwap={p.picker.onSwap}
            onRetry={p.picker.onRetry}
            onLink={p.picker.onLink}
          />
        ) : null}
      </Sheet>
      <Sheet
        id={DETAIL_SHEET_ID.chart}
        open={viewing !== null && view?.phase === 'ready'}
        kind="viewer"
        title={shown ? chartCaption(shown) : 'チャート'}
        onDismiss={() => open(null)}
      >
        {shown && view?.phase === 'ready' ? (
          <div class="viewer__stage">
            <canvas
              class="viewer__canvas"
              width={view.preview.width}
              height={view.preview.height}
              role="img"
              aria-label={`${shown.note ?? shown.name}のチャート（${shown.timeframe ?? '指定なし'}）`}
              ref={(el: HTMLCanvasElement | null) => {
                if (el) view.preview.draw(el);
              }}
            />
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
