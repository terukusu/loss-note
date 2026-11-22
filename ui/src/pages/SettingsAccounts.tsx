// 設定の次の画面「口座」（#133。#47 の口座の一覧・直す・足す。設計書 9.2 の設定の行・ui-guidelines 9.3・9.7・9.12・ADR-0012）。
// 3 層: 純関数（lib/accounts.ts・lib/settings-form.ts・lib/settings-menu.ts）→ 通信と状態（lib/settings-controller.ts）→ この画面。
// - 上の帯「‹ 設定」と題「口座」。先頭に 1 行と「i」（冒頭の説明の移し先）
// - まとめた一覧: 口座ごとの押せる行（名前・「1,000,000円 · 許容 1%」・1 回の負けの額）と ［＋ 口座を追加］。押すと編集・追加の
//   下のシート（その場に欄を開かない）。シートの中は名前・通貨・資金・許容リスク・［保存］ / ［追加］（主のボタン）・資金の履歴
//   （畳まない。シートの中がスクロール）。閉じるは ✕・Esc・外・戻る（下書きは捨てる。保存の規則は controller のまま）
// - 数字に損益の色を付けない（資金は損益でない）
// SettingsAccounts は controller を購読するだけ。描画は hook を持たない SettingsAccountsView
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import type { AccountPut, AccountRecord } from '../../../core/record';
import { api, signOutActive } from '../auth/session';
import { type BackTarget, TopBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { InfoTip } from '../components/InfoTip';
import { AmountText } from '../components/Num';
import { NumberField } from '../components/NumberField';
import { SetAddRow, SetRow, SettingsLoad, SettingsNotice } from '../components/SettingsParts';
import { Sheet } from '../components/Sheet';
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
import { commitFocusedEntry } from '../lib/keyboard-reveal';
import { NavigatorContext } from '../lib/router';
import {
  ACCOUNT_FIELD_ID,
  ADD_ACCOUNT_ID,
  accountEditButtonId,
  createSettingsController,
  currencyLocked,
  type EditingAccount,
  focusAfter,
  type SettingsNotice as Notice,
  SAVE_BUTTON_ID,
  type SettingsController,
  type SettingsState,
} from '../lib/settings-controller';
import { allowanceText, historyRows } from '../lib/settings-form';
import { ACCOUNTS_INFO, ACCOUNTS_LEAD_SET, accountsLead } from '../lib/settings-menu';
import type { SheetDismiss } from '../lib/sheet';
import { backTargetOf } from './TradeDetail';
import '../styles/settings.css';

/** 口座の編集・追加の下のシートの ID */
export const ACCOUNT_SHEET_ID = 'settings-account-sheet';

/** 描き直しの後に、その欄・ボタンへフォーカスを移して見える所へ寄せる（null は何もしない） */
export function focusSoon(id: string | null) {
  if (id === null) return;
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center' });
  }, 0);
}

/** シートが先に閉じた（戻る・close watcher）なら、保存中でも状態を閉じる（シートと状態を食い違わせない） */
export const forceOf = (reason: SheetDismiss) => reason === 'back' || reason === 'native';

/** controller を作って購読する（画面を開くたびに作り直す。下書きは画面を離れると消える） */
export function SettingsAccounts() {
  const nav = useContext(NavigatorContext);
  const controller = useMemo<SettingsController>(() => createSettingsController({ api }), []);
  const [state, setState] = useState<SettingsState>(controller.getState());
  useEffect(() => {
    const off = controller.subscribe(setState);
    void controller.load();
    return off;
  }, [controller]);
  return (
    <SettingsAccountsView
      state={state}
      back={backTargetOf(nav, '/settings')}
      onOpenAccount={controller.openAccount}
      onCloseAccount={controller.closeAccount}
      onAccount={controller.updateAccount}
      onSaveAccount={() => {
        void controller
          .saveAccount()
          .then(() => focusSoon(focusAfter('account', controller.getState())));
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

export interface SettingsAccountsViewProps {
  readonly state: SettingsState;
  /** 上の帯の「‹ 前の画面」（無ければ「‹ 設定」で設定へのリンク） */
  readonly back?: BackTarget;
  /** 口座の行（id）・[＋ 口座を追加]（null） */
  readonly onOpenAccount: (id: string | null) => void;
  /** シートを閉じる（force = 保存中でも。シートが先に閉じたとき） */
  readonly onCloseAccount: (force?: boolean) => void;
  readonly onAccount: (field: AccountField, value: string) => void;
  readonly onSaveAccount: () => void;
  readonly onReload: () => void;
  /** ログインが切れたとき: もう一度ログイン */
  readonly onRelogin: () => void;
}

export function SettingsAccountsView(p: SettingsAccountsViewProps) {
  const { state } = p;
  const back: BackTarget = p.back ?? { label: '設定', href: '/settings' };
  const ed = state.account;
  const notice = state.notice?.area === 'accounts' ? state.notice : null;
  const rec = ed && ed.id !== null ? (state.accounts.find((a) => a.id === ed.id) ?? null) : null;
  return (
    <>
      <TopBar back={back} title="口座" />
      <p class="setlead">
        {/* 資金が未設定の口座があるときだけ頼む文（読めるまでは頼まない文。a-5） */}
        {state.phase === 'ready' ? accountsLead(state.accounts) : ACCOUNTS_LEAD_SET}
        <InfoTip label={ACCOUNTS_INFO.label} body={ACCOUNTS_INFO.body} id={ACCOUNTS_INFO.id} />
      </p>
      {state.phase !== 'ready' ? (
        <SettingsLoad state={state} onReload={p.onReload} onRelogin={p.onRelogin} />
      ) : (
        <>
          {/* シートを開いている間の知らせは、シートの中の [保存] / [追加] のすぐ上に出す */}
          {notice && ed === null ? (
            <SettingsNotice notice={notice} onRelogin={p.onRelogin} />
          ) : null}
          <ul class="setlist" aria-label="口座の一覧">
            {state.accounts.map((a) => (
              <li key={a.id} class="setlist__item">
                <SetRow
                  id={accountEditButtonId(a.id)}
                  label={`${a.name} を編集`}
                  name={a.name}
                  sub={
                    <>
                      <span class="setrow__line">
                        <AmountText text={accountLine(a)} />
                      </span>
                      <span class="setrow__line setrow__line--sub">
                        <AmountText text={accountAllowanceLine(a)} />
                      </span>
                    </>
                  }
                  disabled={ed?.saving === true || state.accountSaving}
                  onClick={() => p.onOpenAccount(a.id)}
                />
              </li>
            ))}
            <li class="setlist__item">
              <SetAddRow
                id={ADD_ACCOUNT_ID}
                disabled={ed?.saving === true || state.accountSaving}
                onClick={() => p.onOpenAccount(null)}
              >
                口座を追加
              </SetAddRow>
            </li>
          </ul>
        </>
      )}
      <Sheet
        id={ACCOUNT_SHEET_ID}
        open={state.phase === 'ready' && ed !== null}
        title={ed === null ? '' : rec ? `${rec.name} を編集` : '口座を追加'}
        kind="form"
        onDismiss={(reason) => p.onCloseAccount(forceOf(reason))}
      >
        {ed !== null ? (
          <AccountForm {...p} rec={rec} editing={ed} notice={notice} inUse={state.accountsInUse} />
        ) : null}
      </Sheet>
    </>
  );
}

function AccountForm(
  p: SettingsAccountsViewProps & {
    readonly rec: AccountRecord | null;
    readonly editing: EditingAccount;
    readonly notice: Notice | null;
    readonly inUse: ReadonlySet<string> | null;
  },
) {
  const { rec, editing } = p;
  const d = editing.draft;
  const e = editing.reading.errors;
  const body = editing.reading.body as AccountPut | null;
  // 口座の通貨（#47 PR-2・U30・U31）: 取引のある口座は文字（欄にしない）。資金の単位は入れた通貨に追従
  const savedCurrency = rec ? currencyOfAccount(rec) : 'JPY';
  const locked = rec !== null && currencyLocked(p.inUse, rec.id);
  const currency = locked ? savedCurrency : draftCurrencyOf(d, savedCurrency);
  // 入れた値で、すぐに「1 回の負けの上限」を出す（どれかの欄に誤りがある間は出さない）
  const allowance = body
    ? allowanceText(body.capitalYen, body.riskTolerancePct, body.currency ?? currency)
    : null;
  const history = rec ? historyRows(rec.capitalHistory) : [];
  return (
    <form
      class="setform"
      noValidate
      aria-label={rec ? `${rec.name} を編集` : '口座を追加'}
      onSubmit={(ev) => {
        ev.preventDefault();
        // 送る前にフォーカス中の欄を外して入力（変換中の文字）を確定させる（#183。キーボードの間は ［保存］ が本文の最後）
        commitFocusedEntry(ev.currentTarget);
        p.onSaveAccount();
      }}
    >
      <fieldset class="setform__fields" disabled={editing.saving}>
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
          <p class="field__hint setform__currency" id={ACCOUNT_FIELD_ID.currency}>
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
          // 書き方の注記は置かない（単位は欄の右・桁は例・誤りは欄の下の文言が言う。#133 デザインレビュー a-2）
          placeholder={currency === 'JPY' ? '例: 1,000,000' : '例: 10,000.00'}
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
        <p class="setform__allowance">
          <AmountText text={allowance} />
        </p>
      ) : null}
      {rec ? (
        // 資金の履歴（畳まない。その場の折りたたみを使わない = ui-guidelines 9.1 の A3。シートの中がスクロールする）
        <section class="sethistory" aria-labelledby="settings-history-title">
          <h3 class="sethistory__title" id="settings-history-title">
            資金の履歴（{history.length} 件）
          </h3>
          {history.length > 0 ? (
            <ol class="sethistory__list" aria-label={`${rec.name} の資金の履歴`}>
              {history.map((h) => (
                <li key={`${h.at}-${h.valueYen}`} class="sethistory__row">
                  <time dateTime={new Date(h.at).toISOString()}>{formatDateTime(h.at)}</time>
                  <span>
                    {h.valueYen === null ? '未設定' : formatAmount(h.valueYen, h.currency ?? 'JPY')}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p class="field__hint">
              まだありません。資金を保存すると、変えた日時と金額が残ります。
            </p>
          )}
        </section>
      ) : null}
      {/* ［保存］ / ［追加］ はシートの下に貼り付ける（開いた直後から見え、履歴までスクロールしても残る。#133 デザインレビュー
          a-1）。欄ごとの誤りが出ているときは要約を出さない（欄の下の文言だけ。#47 再レビュー 4）。欄に結べない知らせ
          （通信の失敗・見つからない）だけを帯の中のボタンのすぐ上に出す。「記録済みの取引は変わらない」は口座の画面の「i」が言う（a-2） */}
      <div class="setform__actions">
        {p.notice &&
        !(p.notice.kind === 'error' && (e.name || e.currency || e.capital || e.risk)) ? (
          <SettingsNotice notice={p.notice} onRelogin={p.onRelogin} />
        ) : null}
        <Button type="submit" id={SAVE_BUTTON_ID.account} block disabled={editing.saving}>
          {editing.saving ? (rec ? '保存しています…' : '追加しています…') : rec ? '保存' : '追加'}
        </Button>
      </div>
    </form>
  );
}
