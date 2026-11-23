// 設定の次の画面「銘柄」（#133。#5 の銘柄の一覧・直す・足す。設計書 4.1・9.2 の設定の行・ui-guidelines 9.3・9.7・9.12）。
// 3 層: 純関数（lib/settings-form.ts）→ 通信と状態（lib/settings-controller.ts）→ この画面。
// - 上の帯「‹ 設定」と題「銘柄」。まとめた一覧: 銘柄ごとの押せる行（名前・初期値のままの印・要約）と ［＋ 銘柄を追加］
// - 行を押すと編集の下のシート（7 欄・［保存］）、［＋ 銘柄を追加］ で追加の下のシート（名前・［追加］）。追加の欄は押すまで無い
// - 銘柄の正規化（#140）の行の 1 行・候補・プレビューは、この画面の行（InstrumentRow の添え）と編集のシート（InstrumentForm の
//   欄の後）に足す
// SettingsInstruments は controller を購読するだけ。描画は hook を持たない SettingsInstrumentsView
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import type { InstrumentRecord, ProductForm, UnderlyingKind } from '../../../core/record';
import { api, signOutActive } from '../auth/session';
import { type BackTarget, TopBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { NumberField } from '../components/NumberField';
import { Segment } from '../components/Segment';
import { SetAddRow, SetRow, SettingsLoad, SettingsNotice } from '../components/SettingsParts';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';
import { enterChain, enterPropsOf } from '../lib/enter-chain';
import { commitFocusedEntry, notePress, takeSubmit } from '../lib/keyboard-reveal';
import { NavigatorContext } from '../lib/router';
import {
  createSettingsController,
  type EditingInstrument,
  focusAfter,
  INSTRUMENT_FIELD_ID,
  NEW_NAME_ID,
  SAVE_BUTTON_ID,
  type SettingsController,
  type SettingsState,
} from '../lib/settings-controller';
import {
  EFFECT_NOTE,
  type InstrumentDraft,
  type InstrumentField,
  instrumentSummaryLines,
  isProvisional,
  PRODUCT_FORM_LABEL,
  PRODUCT_FORMS,
  PROVISIONAL_MARK,
  UNDERLYING_KIND_LABEL,
  UNDERLYING_KINDS,
} from '../lib/settings-form';
import { focusSoon, forceOf } from './SettingsAccounts';
import { backTargetOf } from './TradeDetail';
import '../styles/settings.css';

/** 銘柄の編集・追加の下のシートの ID */
export const INSTRUMENT_SHEET_ID = 'settings-inst-sheet';
export const INSTRUMENT_ADD_SHEET_ID = 'settings-inst-add-sheet';
/** 銘柄の行のボタンの ID（シートを閉じた後にフォーカスを戻す先） */
export const instrumentEditButtonId = (id: string) => `settings-edit-${id}`;
/** ［＋ 銘柄を追加］ の ID */
export const ADD_INSTRUMENT_ID = 'settings-inst-add';
/** 初期値のままの銘柄の説明（編集のシートの中。開いている銘柄が初期値のままのときだけ） */
export const PROVISIONAL_NOTE = `「${PROVISIONAL_MARK}」は、記録したときに名前だけで自動で追加した銘柄です。原資産の種類・価格の通貨・乗数を編集すると、これから記録する取引の 1R・リスク（%）と集計に反映されます。`;

export function SettingsInstruments() {
  const nav = useContext(NavigatorContext);
  const controller = useMemo<SettingsController>(() => createSettingsController({ api }), []);
  const [state, setState] = useState<SettingsState>(controller.getState());
  useEffect(() => {
    const off = controller.subscribe(setState);
    void controller.load();
    return off;
  }, [controller]);
  return (
    <SettingsInstrumentsView
      state={state}
      back={backTargetOf(nav, '/settings')}
      onOpen={controller.openInstrument}
      onClose={controller.closeInstrument}
      onInstrument={controller.updateInstrument}
      onSaveInstrument={() => {
        void controller
          .saveInstrument()
          .then(() => focusSoon(focusAfter('instrument', controller.getState())));
      }}
      onOpenAdd={controller.openAddInstrument}
      onCloseAdd={controller.closeAddInstrument}
      onNewName={controller.setNewName}
      onAdd={() => {
        void controller
          .addInstrument()
          .then(() => focusSoon(focusAfter('add', controller.getState())));
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

export interface SettingsInstrumentsViewProps {
  readonly state: SettingsState;
  readonly back?: BackTarget;
  readonly onOpen: (id: string) => void;
  readonly onClose: (force?: boolean) => void;
  readonly onInstrument: <K extends InstrumentField>(field: K, value: InstrumentDraft[K]) => void;
  readonly onSaveInstrument: () => void;
  readonly onOpenAdd: () => void;
  readonly onCloseAdd: (force?: boolean) => void;
  readonly onNewName: (value: string) => void;
  readonly onAdd: () => void;
  readonly onReload: () => void;
  readonly onRelogin: () => void;
}

export function SettingsInstrumentsView(p: SettingsInstrumentsViewProps) {
  const { state } = p;
  const back: BackTarget = p.back ?? { label: '設定', href: '/settings' };
  const notice = state.notice?.area === 'instruments' ? state.notice : null;
  const ready = state.phase === 'ready';
  const ed = state.editing;
  const rec = ed ? (state.instruments.find((i) => i.id === ed.id) ?? null) : null;
  const sheetOpen = ed !== null || state.addOpen;
  const busy = ed?.saving === true || state.instrumentSaving || state.adding;
  return (
    <>
      <TopBar back={back} title="銘柄" />
      {!ready ? (
        <SettingsLoad state={state} onReload={p.onReload} onRelogin={p.onRelogin} />
      ) : (
        <>
          {notice && !sheetOpen ? <SettingsNotice notice={notice} onRelogin={p.onRelogin} /> : null}
          {state.instruments.length === 0 ? (
            <p class="setlead">
              まだありません。取引を記録すると、銘柄は名前だけで自動で追加されます。
            </p>
          ) : null}
          <ul class="setlist" aria-label="銘柄の一覧">
            {state.instruments.map((i) => (
              <li key={i.id} class="setlist__item">
                <InstrumentRow rec={i} busy={busy} onOpen={p.onOpen} />
              </li>
            ))}
            <li class="setlist__item">
              <SetAddRow id={ADD_INSTRUMENT_ID} disabled={busy} onClick={p.onOpenAdd}>
                銘柄を追加
              </SetAddRow>
            </li>
          </ul>
        </>
      )}
      <Sheet
        id={INSTRUMENT_SHEET_ID}
        open={ready && ed !== null && rec !== null}
        title={rec ? `${rec.name} を編集` : ''}
        kind="form"
        onDismiss={(reason) => p.onClose(forceOf(reason))}
      >
        {ed !== null && rec !== null ? (
          <InstrumentForm {...p} rec={rec} editing={ed} notice={notice} />
        ) : null}
      </Sheet>
      <Sheet
        id={INSTRUMENT_ADD_SHEET_ID}
        open={ready && state.addOpen}
        title="銘柄を追加"
        kind="form"
        onDismiss={(reason) => p.onCloseAdd(forceOf(reason))}
      >
        {state.addOpen ? <AddForm {...p} notice={notice} /> : null}
      </Sheet>
    </>
  );
}

function InstrumentRow({
  rec,
  busy,
  onOpen,
}: {
  readonly rec: InstrumentRecord;
  readonly busy: boolean;
  readonly onOpen: (id: string) => void;
}) {
  const provisional = isProvisional(rec);
  const [line1, line2] = instrumentSummaryLines(rec);
  return (
    <SetRow
      id={instrumentEditButtonId(rec.id)}
      label={`${rec.name} を編集`}
      name={
        <>
          <span>{rec.name}</span>
          {provisional ? <span class="field__mark">{PROVISIONAL_MARK}</span> : null}
        </>
      }
      sub={
        <>
          <span class="setrow__line">{line1}</span>
          <span class="setrow__line setrow__line--sub">{line2}</span>
        </>
      }
      disabled={busy}
      onClick={() => onOpen(rec.id)}
    />
  );
}

function InstrumentForm(
  p: SettingsInstrumentsViewProps & {
    readonly rec: InstrumentRecord;
    readonly editing: EditingInstrument;
    readonly notice: SettingsState['notice'];
  },
) {
  const { rec, editing } = p;
  const d = editing.draft;
  const e = editing.reading.errors;
  const set =
    <K extends InstrumentField>(field: K) =>
    (value: InstrumentDraft[K]) =>
      p.onInstrument(field, value);
  // 決定キーの並び（#174。表の例 #8）: 名前 → 原資産 → 価格の通貨 → 乗数 → 数量の刻み（完了。保存は送らない）。
  // 原資産の種類（select）・取引の形態（Segment）は飛ばす
  const chain = enterChain([
    INSTRUMENT_FIELD_ID.name,
    INSTRUMENT_FIELD_ID.underlying,
    INSTRUMENT_FIELD_ID.priceCurrency,
    INSTRUMENT_FIELD_ID.multiplier,
    INSTRUMENT_FIELD_ID.quantityStep,
  ]);
  const enter = (id: string) => enterPropsOf(chain, id);
  return (
    <form
      class="setform"
      noValidate
      aria-label={`${rec.name} を編集`}
      onPointerDown={notePress}
      onPointerUp={notePress}
      onPointerCancel={notePress}
      onKeyDown={notePress}
      onSubmit={(ev) => {
        ev.preventDefault();
        // キーボードの印の間は、本文の最後の ［保存］ を押したときだけ送り、欄の Enter による暗黙の送信では保存しない（記録する・
        // 編集と同じ守り。#174・ui-guidelines 10.1）。送る前にフォーカス中の欄を外して入力（変換中の文字）を確定させる（#183）
        if (!takeSubmit(ev.currentTarget)) return;
        p.onSaveInstrument();
      }}
    >
      {isProvisional(rec) ? <p class="field__hint">{PROVISIONAL_NOTE}</p> : null}
      <fieldset class="setform__fields" disabled={editing.saving}>
        <legend class="sr-only">{rec.name} の値</legend>
        <TextField
          id={INSTRUMENT_FIELD_ID.name}
          label="名前"
          value={d.name}
          onInput={set('name')}
          {...enter(INSTRUMENT_FIELD_ID.name)}
          hint="名前を変えると、前の名前で記録・読み取りしたときは別の銘柄として新しく追加されます。"
          {...(e.name ? { error: e.name } : {})}
        />
        <TextField
          id={INSTRUMENT_FIELD_ID.underlying}
          label="原資産"
          value={d.underlying}
          onInput={set('underlying')}
          {...enter(INSTRUMENT_FIELD_ID.underlying)}
          placeholder="任意。例: 架空指数"
          {...(e.underlying ? { error: e.underlying } : {})}
        />
        <div class="field">
          <label class="field__label" for={INSTRUMENT_FIELD_ID.underlyingKind}>
            原資産の種類
          </label>
          <select
            id={INSTRUMENT_FIELD_ID.underlyingKind}
            class="select"
            value={d.underlyingKind}
            onChange={(ev) => set('underlyingKind')(ev.currentTarget.value as UnderlyingKind)}
          >
            {UNDERLYING_KINDS.map((k) => (
              <option key={k} value={k}>
                {UNDERLYING_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <Segment<ProductForm>
          label="取引の形態"
          name="settings-product-form"
          value={d.productForm}
          onChange={set('productForm')}
          options={PRODUCT_FORMS.map((f) => ({ value: f, label: PRODUCT_FORM_LABEL[f] }))}
        />
        <TextField
          id={INSTRUMENT_FIELD_ID.priceCurrency}
          label="価格の通貨"
          value={d.priceCurrency}
          onInput={set('priceCurrency')}
          {...enter(INSTRUMENT_FIELD_ID.priceCurrency)}
          placeholder="例: USD"
          hint="英字 3 文字（例: USD・JPY）。空なら未設定。為替の欄は表示されません。"
          {...(e.priceCurrency ? { error: e.priceCurrency } : {})}
        />
        <div class="setform__pair">
          <NumberField
            id={INSTRUMENT_FIELD_ID.multiplier}
            label="乗数"
            value={d.multiplier}
            onInput={set('multiplier')}
            {...enter(INSTRUMENT_FIELD_ID.multiplier)}
            hint="価格 1 の動きが数量 1 あたり何倍になるか。"
            {...(e.multiplier ? { error: e.multiplier } : {})}
          />
          <NumberField
            id={INSTRUMENT_FIELD_ID.quantityStep}
            label="数量の刻み"
            value={d.quantityStep}
            onInput={set('quantityStep')}
            {...enter(INSTRUMENT_FIELD_ID.quantityStep)}
            hint="数量の最小単位（例: 0.1）。"
            {...(e.quantityStep ? { error: e.quantityStep } : {})}
          />
        </div>
        {/* 銘柄の正規化（#140）の候補・プレビューはここに足す */}
      </fieldset>
      <p class="field__hint">{EFFECT_NOTE}</p>
      {/* ［保存］ はシートの下に貼り付ける（開いた直後から見える。#133 デザインレビュー a-1）。欄に結べない知らせはそのすぐ上 */}
      <div class="setform__actions">
        {p.notice ? <SettingsNotice notice={p.notice} onRelogin={p.onRelogin} /> : null}
        <Button type="submit" id={SAVE_BUTTON_ID.instrument} block disabled={editing.saving}>
          {editing.saving ? '保存しています…' : '保存'}
        </Button>
      </div>
    </form>
  );
}

function AddForm(p: SettingsInstrumentsViewProps & { readonly notice: SettingsState['notice'] }) {
  const { state } = p;
  return (
    <form
      class="setform"
      noValidate
      aria-label="銘柄を追加"
      onSubmit={(ev) => {
        ev.preventDefault();
        // 送る前にフォーカス中の欄を外して入力（変換中の文字）を確定させる（#183。キーボードの間は ［保存］ が本文の最後）
        commitFocusedEntry(ev.currentTarget);
        p.onAdd();
      }}
    >
      <TextField
        id={NEW_NAME_ID}
        label="名前"
        value={state.newName}
        onInput={p.onNewName}
        placeholder="例: 架空指数A"
        hint="名前だけで追加できます。ほかの項目は初期値（その他・現物・CFD・通貨 未設定・乗数 1・刻み 1）になり、追加後に編集できます。"
        disabled={state.adding}
        {...(state.newNameError ? { error: state.newNameError } : {})}
      />
      <div class="setform__actions">
        {p.notice ? <SettingsNotice notice={p.notice} onRelogin={p.onRelogin} /> : null}
        <Button type="submit" id={SAVE_BUTTON_ID.add} block disabled={state.adding}>
          {state.adding ? '追加しています…' : '追加'}
        </Button>
      </div>
    </form>
  );
}
