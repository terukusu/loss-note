// 設定（#3 = テーマの切り替えとログアウト、#5 = 銘柄、#47 = 口座（資金・資金の履歴・許容リスク）。設計書 4.1・4.5・9.2）。
// 3 層: 純関数（lib/settings-form.ts）→ 通信と状態（lib/settings-controller.ts）→ この画面（薄い）。
// Settings は hook を持たない（App のテストが 1 段だけ呼ぶ）。SettingsScreen が controller を購読し、
// 描画は hook を持たない SettingsView に任せる（記録する画面の Record / RecordScreen / RecordView と同じ形）。
// 並びは「口座」→「銘柄」→「AI の利用状況」（#62。components/AiUsage.tsx）→「表示」→「アカウント」。数字に損益の色を付けない（資金は損益でない）
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type {
  AccountPut,
  AccountRecord,
  InstrumentRecord,
  ProductForm,
  UnderlyingKind,
} from '../../../core/record';
import { api, signOutActive } from '../auth/session';
import { AiUsageCard } from '../components/AiUsage';
import { Button, buttonClass } from '../components/Button';
import { AmountText } from '../components/Num';
import { NumberField } from '../components/NumberField';
import { PageHeader } from '../components/PageHeader';
import { Segment } from '../components/Segment';
import { TextField } from '../components/TextField';
import {
  type AccountField,
  accountAllowanceLine,
  accountLine,
  currencyOfAccount,
  draftCurrencyOf,
} from '../lib/accounts';
import { currencyLockedText, unitOf } from '../lib/currency';
import { formatDateTime } from '../lib/datetime';
import { formatAmount } from '../lib/format';
import { Link } from '../lib/router';
import {
  ACCOUNT_FIELD_ID,
  ADD_ACCOUNT_ID,
  accountEditButtonId,
  createSettingsController,
  currencyLocked,
  type EditingAccount,
  type EditingInstrument,
  focusAfter,
  INSTRUMENT_FIELD_ID,
  NEW_NAME_ID,
  SAVE_BUTTON_ID,
  type SettingsController,
  type SettingsNotice,
  type SettingsState,
} from '../lib/settings-controller';
import {
  allowanceText,
  EFFECT_NOTE,
  historyRows,
  type InstrumentDraft,
  type InstrumentField,
  instrumentSummary,
  isProvisional,
  PRODUCT_FORM_LABEL,
  PRODUCT_FORMS,
  PROVISIONAL_MARK,
  UNDERLYING_KIND_LABEL,
  UNDERLYING_KINDS,
} from '../lib/settings-form';
import type { Theme } from '../lib/theme';

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
      <PageHeader
        title="設定"
        description="口座の資金と許容リスクは、記録を始める前に一度入力してください。記録のたびにその時点の値を取引に保存するので、後で変えても記録済みの取引は変わりません。"
      />
      <SettingsScreen />
      {/* AI の利用状況（#62）。独立した部品（読めなくてもほかのカードを止めない） */}
      <AiUsageCard />
      {/* 用語集（#76）。判定に関わる言葉の説明の一覧 */}
      <section class="card section" aria-labelledby="settings-glossary-title">
        <h2 class="section__title" id="settings-glossary-title">
          用語集
        </h2>
        <p class="field__hint">LC・R・判定など、判定に関わる言葉の意味です。</p>
        <div>
          <Link class="btn btn--secondary" href="/glossary">
            用語集を開く
          </Link>
        </div>
      </section>
      <section class="card section">
        <h2 class="section__title">表示</h2>
        <Segment
          label="テーマ"
          value={theme}
          onChange={onTheme}
          options={[
            { value: 'dark', label: 'ダーク', icon: 'moon' },
            { value: 'light', label: 'ライト', icon: 'sun' },
          ]}
        />
        <p class="field__hint">この端末に保存されます。</p>
      </section>
      <section class="card section">
        <h2 class="section__title">アカウント</h2>
        <div>
          <Button variant="secondary" icon="logout" onClick={onSignOut} disabled={signOutBusy}>
            {signOutBusy ? 'ログアウトしています…' : 'ログアウト'}
          </Button>
        </div>
        {signOutError ? (
          <p class="login__error" role="alert">
            {signOutError}
          </p>
        ) : null}
      </section>
    </>
  );
}

const INST_NAME_ID = INSTRUMENT_FIELD_ID.name;

/** 描き直しの後に、その欄・ボタンへフォーカスを移して見える所へ寄せる（null は何もしない） */
function focusSoon(id: string | null) {
  if (id === null) return;
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center' });
  }, 0);
}
const editButtonId = (id: string) => `settings-edit-${id}`;

/** controller を作って購読する（画面を開くたびに作り直す。下書きは画面を離れると消える） */
export function SettingsScreen() {
  const controller = useMemo<SettingsController>(() => createSettingsController({ api }), []);
  const [state, setState] = useState<SettingsState>(controller.getState());

  useEffect(() => {
    const off = controller.subscribe(setState);
    void controller.load();
    return off;
  }, [controller]);

  // 口座を開いたら名前の欄へ、閉じたら [直す]（足す欄は [＋ 口座を足す]）へフォーカスを移す
  const accountKey = state.account ? (state.account.id ?? '+') : null;
  const prevAccount = useRef<string | null>(null);
  useEffect(() => {
    const before = prevAccount.current;
    prevAccount.current = accountKey;
    if (before === accountKey) return;
    if (accountKey !== null) document.getElementById(ACCOUNT_FIELD_ID.name)?.focus();
    else if (before === '+') {
      // 足せたときは focusAfter が新しい行の [直す] へ移す
      if (controller.getState().addedAccountId === null) {
        document.getElementById(ADD_ACCOUNT_ID)?.focus();
      }
    } else if (before !== null) document.getElementById(accountEditButtonId(before))?.focus();
  }, [accountKey, controller]);

  // 銘柄を開いたら名前の欄へ、閉じたら [直す] へフォーカスを移す（読み上げ・キーで迷わない）
  const editingId = state.editing?.id ?? null;
  const prevEditing = useRef<string | null>(null);
  useEffect(() => {
    const before = prevEditing.current;
    prevEditing.current = editingId;
    if (before === editingId) return;
    if (editingId !== null) document.getElementById(INST_NAME_ID)?.focus();
    else if (before !== null) document.getElementById(editButtonId(before))?.focus();
  }, [editingId]);

  return (
    <SettingsView
      state={state}
      onOpenAccount={controller.openAccount}
      onCloseAccount={controller.closeAccount}
      onAccount={controller.updateAccount}
      onSaveAccount={() => {
        void controller
          .saveAccount()
          .then(() => focusSoon(focusAfter('account', controller.getState())));
      }}
      onOpen={controller.openInstrument}
      onClose={controller.closeInstrument}
      onInstrument={controller.updateInstrument}
      onSaveInstrument={() => {
        void controller
          .saveInstrument()
          .then(() => focusSoon(focusAfter('instrument', controller.getState())));
      }}
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
        // ログアウトすると門がログイン画面へ置き換える（戻り先はこの画面）
        void signOutActive();
      }}
    />
  );
}

export interface SettingsViewProps {
  readonly state: SettingsState;
  /** 口座の [直す]（id）・[＋ 口座を足す]（null） */
  readonly onOpenAccount: (id: string | null) => void;
  readonly onCloseAccount: () => void;
  readonly onAccount: (field: AccountField, value: string) => void;
  readonly onSaveAccount: () => void;
  readonly onOpen: (id: string) => void;
  readonly onClose: () => void;
  readonly onInstrument: <K extends InstrumentField>(field: K, value: InstrumentDraft[K]) => void;
  readonly onSaveInstrument: () => void;
  readonly onNewName: (value: string) => void;
  readonly onAdd: () => void;
  readonly onReload: () => void;
  /** ログインが切れたとき: もう一度ログイン */
  readonly onRelogin: () => void;
}

export function SettingsView(p: SettingsViewProps) {
  const { state } = p;
  if (state.phase === 'loading') {
    return (
      <p class="loading" role="status">
        読み込み中…
      </p>
    );
  }
  if (state.phase === 'loadFailed') {
    return (
      <section class="card section">
        <p class="notice notice--error" role="alert">
          {state.error}
        </p>
        <div>
          {state.errorKind === 'auth' ? (
            <Button variant="secondary" icon="logout" onClick={p.onRelogin}>
              もう一度ログイン
            </Button>
          ) : (
            <Button variant="secondary" onClick={p.onReload}>
              再読み込み
            </Button>
          )}
        </div>
      </section>
    );
  }
  return (
    <>
      <AccountsCard {...p} />
      <InstrumentsCard {...p} />
    </>
  );
}

/** 知らせ（成功は role="status"、失敗は role="alert" + ログインが切れたら [もう一度ログイン]） */
function Notice({ notice, onRelogin }: { notice: SettingsNotice; onRelogin: () => void }) {
  if (notice.kind === 'ok') {
    return (
      <p class="notice" role="status">
        {notice.text}
      </p>
    );
  }
  return (
    <div class="notice notice--error" role="alert">
      <p>{notice.text}</p>
      {notice.auth ? (
        <Button variant="secondary" icon="logout" onClick={onRelogin}>
          もう一度ログイン
        </Button>
      ) : null}
    </div>
  );
}

/** 口座の枠（#47 U12〜U15。「資金と許容リスク」を置き換えた。一覧・1 件だけ開く直す・足す） */
function AccountsCard(p: SettingsViewProps) {
  const { state } = p;
  const notice = state.notice?.area === 'accounts' ? state.notice : null;
  const ed = state.account;
  const adding = ed !== null && ed.id === null;
  // 直す・足す欄を開いている間の知らせは、枠の先頭（一覧の上。足す欄からは遠く、360px では見えない）でなく、
  // 欄の [保存] / [追加] のすぐ上に出す（Phase 4b 指摘 4）
  const topNotice = ed === null ? notice : null;
  const editorNotice = ed !== null ? notice : null;
  return (
    <section class="card section" aria-labelledby="settings-account-title">
      <h2 class="section__title" id="settings-account-title">
        口座
      </h2>
      <p class="section__note">
        資金はリスク（%）の分母、許容リスクは冷静なときに決めておく 1 回の負けの線です。
      </p>
      {topNotice ? <Notice notice={topNotice} onRelogin={p.onRelogin} /> : null}
      <ul class="instlist">
        {state.accounts.map((a) => (
          <li key={a.id} class="instlist__item">
            {ed !== null && ed.id === a.id ? (
              <AccountEditor {...p} rec={a} editing={ed} notice={editorNotice} />
            ) : (
              <AccountRow rec={a} busy={ed?.saving === true} onOpen={p.onOpenAccount} />
            )}
          </li>
        ))}
        {adding ? (
          <li class="instlist__item">
            <AccountEditor {...p} rec={null} editing={ed} notice={editorNotice} />
          </li>
        ) : null}
      </ul>
      {adding ? null : (
        <button
          type="button"
          id={ADD_ACCOUNT_ID}
          class={`${buttonClass({ variant: 'ghost', block: true })} accountlist__add`}
          disabled={ed?.saving === true}
          onClick={() => p.onOpenAccount(null)}
        >
          <span>＋ 口座を追加</span>
        </button>
      )}
    </section>
  );
}

function AccountRow({
  rec,
  busy,
  onOpen,
}: {
  rec: AccountRecord;
  busy: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <div class="instlist__row">
      <div class="instlist__text">
        <p class="instlist__name">
          <span>{rec.name}</span>
        </p>
        <p class="accountlist__line">
          <AmountText text={accountLine(rec)} />
        </p>
        <p class="instlist__summary accountlist__summary">
          <AmountText text={accountAllowanceLine(rec)} />
        </p>
      </div>
      <button
        type="button"
        id={accountEditButtonId(rec.id)}
        class={buttonClass({ variant: 'secondary' })}
        aria-label={`${rec.name} を編集`}
        disabled={busy}
        onClick={() => onOpen(rec.id)}
      >
        <span>編集</span>
      </button>
    </div>
  );
}

function AccountEditor(
  p: SettingsViewProps & {
    readonly rec: AccountRecord | null;
    readonly editing: EditingAccount;
    readonly notice: SettingsNotice | null;
  },
) {
  const { rec, editing } = p;
  const d = editing.draft;
  const e = editing.reading.errors;
  const body = editing.reading.body as AccountPut | null;
  // 口座の通貨（#47 PR-2・U30・U31）: 取引のある口座は文字（欄にしない）。資金の単位は入れた通貨に追従
  const savedCurrency = rec ? currencyOfAccount(rec) : 'JPY';
  const locked = rec !== null && currencyLocked(p.state.accountsInUse, rec.id);
  const currency = locked ? savedCurrency : draftCurrencyOf(d, savedCurrency);
  // 入れた値で、すぐに「1 回の負けの上限」を出す（どれかの欄に誤りがある間は出さない）
  const allowance = body
    ? allowanceText(body.capitalYen, body.riskTolerancePct, body.currency ?? currency)
    : null;
  const history = rec ? historyRows(rec.capitalHistory) : [];
  const title = rec ? `${rec.name} を編集` : '口座を追加';
  return (
    <form
      class="instedit"
      noValidate
      aria-label={title}
      onSubmit={(ev) => {
        ev.preventDefault();
        p.onSaveAccount();
      }}
      onKeyDown={(ev) => {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          p.onCloseAccount();
        }
      }}
    >
      <fieldset class="instedit__fields accountedit__fields" disabled={editing.saving}>
        <legend class="sr-only">{rec ? `${rec.name} の値` : '追加する口座の値'}</legend>
        <TextField
          id={ACCOUNT_FIELD_ID.name}
          label="名前"
          value={d.name}
          onInput={(v) => p.onAccount('name', v)}
          placeholder="例: 口座 B"
          {...(e.name ? { error: e.name } : {})}
        />
        {locked ? (
          <p class="field__hint accountedit__currency" id={ACCOUNT_FIELD_ID.currency}>
            {currencyLockedText(savedCurrency)}
          </p>
        ) : (
          <TextField
            id={ACCOUNT_FIELD_ID.currency}
            label="通貨"
            value={d.currency}
            onInput={(v) => p.onAccount('currency', v)}
            placeholder="例: JPY"
            hint="英字 3 文字（例: JPY・USD）。取引を記録すると変更できません。"
            {...(e.currency ? { error: e.currency } : {})}
          />
        )}
        <NumberField
          id={ACCOUNT_FIELD_ID.capital}
          label={rec ? '資金' : '資金（任意）'}
          unit={unitOf(currency)}
          value={d.capital}
          onInput={(v) => p.onAccount('capital', v)}
          placeholder={currency === 'JPY' ? '例: 1,000,000' : '例: 10,000.00'}
          hint={
            currency === 'JPY'
              ? '円の整数で入力します（全角の数字・カンマ区切りも使えます）。'
              : '小数 2 桁まで入力できます（全角の数字・カンマ区切りも使えます）。'
          }
          {...(e.capital ? { error: e.capital } : {})}
        />
        <NumberField
          id={ACCOUNT_FIELD_ID.risk}
          label="許容リスク"
          unit="%"
          value={d.risk}
          onInput={(v) => p.onAccount('risk', v)}
          hint="1 回の取引で、資金の何 % まで負けてよいか。0.5〜3（初期値 1）。"
          {...(e.risk ? { error: e.risk } : {})}
        />
      </fieldset>
      {editing.reading.warning ? (
        <p class="notice" role="status">
          {editing.reading.warning}
        </p>
      ) : null}
      {allowance ? (
        <p class="settings__allowance">
          <AmountText text={allowance} />
        </p>
      ) : null}
      {/* 欄ごとの誤りが出ているときは要約を出さない（欄の下の文言だけ。記録する画面の口座の追加の欄と同じ。再レビュー 4）。
          欄に結べない知らせ（通信の失敗・見つからない）だけを [保存] / [追加] のすぐ上に出す */}
      {p.notice && !(p.notice.kind === 'error' && (e.name || e.currency || e.capital || e.risk)) ? (
        <Notice notice={p.notice} onRelogin={p.onRelogin} />
      ) : null}
      <div class="instedit__actions">
        <Button type="submit" id={SAVE_BUTTON_ID.account} disabled={editing.saving}>
          {editing.saving ? (rec ? '保存しています…' : '追加しています…') : rec ? '保存' : '追加'}
        </Button>
        <Button variant="ghost" onClick={p.onCloseAccount} disabled={editing.saving}>
          キャンセル
        </Button>
      </div>
      {rec ? (
        <>
          <p class="field__hint">{EFFECT_NOTE}</p>
          <details class="settings__history-wrap">
            <summary class="settings__subtitle">資金の履歴（{history.length} 件）</summary>
            {history.length > 0 ? (
              <ol class="settings__history" aria-label={`${rec.name} の資金の履歴`}>
                {history.map((h) => (
                  <li key={`${h.at}-${h.valueYen}`} class="settings__history-row">
                    <time dateTime={new Date(h.at).toISOString()}>{formatDateTime(h.at)}</time>
                    <span>
                      {h.valueYen === null
                        ? '未設定'
                        : formatAmount(h.valueYen, h.currency ?? 'JPY')}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p class="field__hint">
                まだありません。資金を保存すると、変えた日時と金額が残ります。
              </p>
            )}
          </details>
        </>
      ) : null}
    </form>
  );
}

function InstrumentsCard(p: SettingsViewProps) {
  const { state } = p;
  const notice = state.notice?.area === 'instruments' ? state.notice : null;
  const anyProvisional = state.instruments.some(isProvisional);
  return (
    <section class="card section" aria-labelledby="settings-inst-title">
      <h2 class="section__title" id="settings-inst-title">
        銘柄
      </h2>
      <p class="section__note">{EFFECT_NOTE}</p>
      {anyProvisional ? (
        <p class="field__hint">
          「{PROVISIONAL_MARK}
          」は、記録したときに名前だけで自動で追加した銘柄です。原資産の種類・価格の通貨・乗数を編集すると、これから記録する取引の
          1R・リスク（%）と集計に反映されます。
        </p>
      ) : null}
      {notice ? <Notice notice={notice} onRelogin={p.onRelogin} /> : null}
      {state.instruments.length > 0 ? (
        <ul class="instlist">
          {state.instruments.map((i) => (
            <li key={i.id} class="instlist__item">
              {state.editing?.id === i.id ? (
                <InstrumentEditor rec={i} editing={state.editing} {...p} />
              ) : (
                <InstrumentRow rec={i} busy={state.editing?.saving === true} onOpen={p.onOpen} />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p class="field__hint">
          まだありません。取引を記録すると、銘柄は名前だけで自動で追加されます。
        </p>
      )}
      <form
        class="instlist__add"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          p.onAdd();
        }}
      >
        <TextField
          id={NEW_NAME_ID}
          label="銘柄を追加"
          value={state.newName}
          onInput={p.onNewName}
          placeholder="例: 架空指数A"
          hint="名前だけで追加できます。ほかの項目は初期値（その他・現物・CFD・通貨 未設定・乗数 1・刻み 1）になり、追加後に編集できます。"
          disabled={state.adding}
          {...(state.newNameError ? { error: state.newNameError } : {})}
        />
        <div class="settings__actions">
          <Button type="submit" id={SAVE_BUTTON_ID.add} variant="secondary" disabled={state.adding}>
            {state.adding ? '追加しています…' : '追加'}
          </Button>
        </div>
      </form>
    </section>
  );
}

function InstrumentRow({
  rec,
  busy,
  onOpen,
}: {
  rec: InstrumentRecord;
  busy: boolean;
  onOpen: (id: string) => void;
}) {
  const provisional = isProvisional(rec);
  return (
    <div class="instlist__row">
      <div class="instlist__text">
        <p class="instlist__name">
          <span>{rec.name}</span>
          {provisional ? <span class="field__mark">{PROVISIONAL_MARK}</span> : null}
        </p>
        <p class="instlist__summary">{instrumentSummary(rec)}</p>
      </div>
      <button
        type="button"
        id={editButtonId(rec.id)}
        class={buttonClass({ variant: 'secondary' })}
        aria-label={`${rec.name} を編集`}
        disabled={busy}
        onClick={() => onOpen(rec.id)}
      >
        <span>編集</span>
      </button>
    </div>
  );
}

function InstrumentEditor(
  p: SettingsViewProps & { readonly rec: InstrumentRecord; readonly editing: EditingInstrument },
) {
  const { rec, editing } = p;
  const d = editing.draft;
  const e = editing.reading.errors;
  const set =
    <K extends InstrumentField>(field: K) =>
    (value: InstrumentDraft[K]) =>
      p.onInstrument(field, value);
  return (
    <form
      class="instedit"
      noValidate
      aria-label={`${rec.name} を編集`}
      onSubmit={(ev) => {
        ev.preventDefault();
        p.onSaveInstrument();
      }}
    >
      <fieldset class="instedit__fields" disabled={editing.saving}>
        <legend class="sr-only">{rec.name} の値</legend>
        <TextField
          id={INST_NAME_ID}
          label="名前"
          value={d.name}
          onInput={set('name')}
          hint="名前を変えると、前の名前で記録・読み取りしたときは別の銘柄として新しく追加されます。"
          {...(e.name ? { error: e.name } : {})}
        />
        <TextField
          id={INSTRUMENT_FIELD_ID.underlying}
          label="原資産"
          value={d.underlying}
          onInput={set('underlying')}
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
          placeholder="例: USD"
          hint="英字 3 文字（例: USD・JPY）。空なら未設定。為替の欄は表示されません。"
          {...(e.priceCurrency ? { error: e.priceCurrency } : {})}
        />
        <div class="settings__pair">
          <NumberField
            id={INSTRUMENT_FIELD_ID.multiplier}
            label="乗数"
            value={d.multiplier}
            onInput={set('multiplier')}
            hint="価格 1 の動きが数量 1 あたり何倍になるか。"
            {...(e.multiplier ? { error: e.multiplier } : {})}
          />
          <NumberField
            id={INSTRUMENT_FIELD_ID.quantityStep}
            label="数量の刻み"
            value={d.quantityStep}
            onInput={set('quantityStep')}
            hint="数量の最小単位（例: 0.1）。"
            {...(e.quantityStep ? { error: e.quantityStep } : {})}
          />
        </div>
      </fieldset>
      <div class="instedit__actions">
        <Button type="submit" id={SAVE_BUTTON_ID.instrument} disabled={editing.saving}>
          {editing.saving ? '保存しています…' : '保存'}
        </Button>
        <Button variant="ghost" onClick={p.onClose} disabled={editing.saving}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}
