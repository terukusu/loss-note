"""テスト用の記憶の保存先（``loss_note_api.store.Store`` と同じ約束）。

API のテストはこれとエミュレーターの Firestore の両方で同じテストを回す（conftest の ``store_kind``）。
チャート（Issue #12）は ``users[uid]["charts"]["{tradeId}-{slot}"]``。``fail_charts`` を立てると、チャートに触れる
書き込みが何も書かずに StoreUnavailable になる（取引とチャートを一緒に書く約束の試験。AC-6）。
明細の読み取りの計上（Issue #44）は ``read_days[uid][day]``（Firestore の ``users/{uid}/statement_read_days/{day}``。
記録の ``users`` と分けて持ち、記録に書き込みが無いことを確かめるテストに混ざらない）と ``spend[day]``。
``fail_limits`` を立てると予約が、``fail_settle`` を立てると精算が、何も書かずに StoreUnavailable になる。
口座（Issue #47）は ``users[uid]["accounts"]``。既定の口座 ``default`` は口座を読む・使う入口で無ければ、ロックの中で
設定から 1 回だけ作る（FirestoreStore と同じ約束。``default_created`` に作った回数を数える）。取引の作成・直しでは
取引より先に書く（FirestoreStore と同じく、取引の書き込みが失敗しても既定の口座は残る）。
明細の特徴の覚え（Issue #66）は ``users[uid]["statement_profiles"][鍵]``。読むだけでは ``users`` に何も足さない
（読み取りの前後で記録が同じかを確かめるテストのため）。``fail_profiles`` を立てると覚えの読み書きが何も書かずに
StoreUnavailable になる。
"""

import copy
import secrets
import string
import threading

from loss_note_api import accounts, trade_pages, trade_range
from loss_note_api.accounts import DEFAULT_ACCOUNT_ID
from loss_note_api.charts import SLOTS, chart_doc_id
from loss_note_api.logs import log_event
from loss_note_api.read_limits import USAGE_MAX_DAYS, effective_user_micro
from loss_note_api.store import Conflict, MissingAccount, MissingInstrument, StoreUnavailable, check_known_version

_ALNUM = string.ascii_letters + string.digits


def _new_id() -> str:
    return "".join(secrets.choice(_ALNUM) for _ in range(20))


class MemoryStore:
    def __init__(self):
        self._lock = threading.Lock()
        self.users: dict[str, dict[str, dict[str, dict]]] = {}
        self.fail_with: Exception | None = None  # 次の呼び出しで投げる例外（500 の試験）
        self.unavailable = False
        self.fail_charts = False  # チャートの書き込みで失敗する（何も書かない）
        self.fail_limits = False  # 読み取りの予約で失敗する（何も書かない）
        self.fail_settle = False  # 読み取りの精算で失敗する（何も書かない）
        self.read_days: dict[str, dict[str, dict]] = {}  # 利用者の日の計上（users/{uid}/statement_read_days/{day}）
        self.spend: dict[str, dict] = {}  # 全体の日の計上（statement_read_spend/{day}）
        self.warm_calls = 0  # 起動の準備の回数（#60）
        self.usage_reads = 0  # 使った量の読みの回数（#62）
        self.fail_warm: Exception | None = None  # 起動の準備で投げる例外（#60）
        self.default_created = 0  # 既定の口座を移し替えで作った回数（#47 M3）
        # 一覧の 1 ページで読んだ取引の文書の件数（#87 AC-2。Firestore の limit + 1 と同じ）
        self.trade_page_reads: list[int] = []
        # 索引の不足（FailedPrecondition）の逃げ道を通す（#87。FirestoreStore と同じログを出して全件から切る）
        self.page_index_missing = False
        self.fail_profiles = False  # 明細の特徴の覚えの読み書きで失敗する（#66）

    def _col(self, uid, name):
        if self.fail_with is not None:
            raise self.fail_with
        if self.unavailable:
            raise StoreUnavailable("test")
        return self.users.setdefault(uid, {}).setdefault(name, {})

    def count(self, uid, name) -> int:
        return len(self.users.get(uid, {}).get(name, {}))

    # ── 取引 ──
    def list_trades(self, uid):
        with self._lock:
            return [(k, copy.deepcopy(v)) for k, v in self._col(uid, "trades").items()]

    def list_trades_page(self, uid, order, after, limit):
        # Firestore の並び・start_after・limit(limit + 1) と同じ結果（並びと切り出しは trade_pages.page_of）
        with self._lock:
            items = [(k, copy.deepcopy(v)) for k, v in self._col(uid, "trades").items()]
        page = trade_pages.page_of(items, order, after, limit)
        if self.page_index_missing:
            log_event(event="trades_page_fallback", reason=f"index_{order}")
            self.trade_page_reads.append(len(items))
            return page
        self.trade_page_reads.append(len(page))
        return page

    def list_trades_in_exit_range(self, uid, start, end, limit):
        # Firestore の where（>= start・< end）と同じ境目（trade_range.in_range）、決済の新しい順に limit 件
        with self._lock:
            items = [(k, copy.deepcopy(v)) for k, v in self._col(uid, "trades").items()]
        hit = sorted((it for it in items if trade_range.in_range(it[1], start, end)), key=trade_pages.exit_key)
        return hit[:limit]

    def get_trade(self, uid, trade_id):
        with self._lock:
            return copy.deepcopy(self._col(uid, "trades").get(trade_id))

    def _chart_write(self):
        if self.fail_charts:
            raise StoreUnavailable("test")

    def create_trade(self, uid, instrument_id, account_id, build, charts=None,
                     build_default=accounts.build_default_now):  # fmt: skip
        with self._lock:
            inst = self._col(uid, "instruments").get(instrument_id)
            if inst is None:
                raise MissingInstrument()
            account, pending = self._read_account(uid, account_id, build_default)
            if account is None:
                raise MissingAccount()
            # 既定の口座は取引より先に書く（FirestoreStore はトランザクションの外で先に作るので、取引の書き込みが
            # 失敗しても口座は残る。冪等の 1 文書なので害は無い。2 つの保存先で同じ振る舞いにする）
            self._write_default(uid, pending)
            doc = build(copy.deepcopy(inst), copy.deepcopy(account))
            tid = _new_id()
            if charts:
                self._chart_write()
            # ここから下は失敗しない（取引・チャートを一緒に書く = トランザクションと同じ）
            self._col(uid, "trades")[tid] = copy.deepcopy(doc)
            for slot, chart in (charts or {}).items():
                self._col(uid, "charts")[chart_doc_id(tid, slot)] = copy.deepcopy(chart)
            return tid, doc

    def update_trade(self, uid, trade_id, instrument_id, account_id, mutate,
                     build_default=accounts.build_default_now, refresh=False, charts=None):  # fmt: skip
        with self._lock:
            col = self._col(uid, "trades")
            if trade_id not in col:
                return None
            check_known_version(col[trade_id])  # 銘柄・口座を読む前・既定の口座を書く前（FirestoreStore と同じ。#115）
            instrument = None
            if refresh or instrument_id != col[trade_id]["record"]["instrumentId"]:
                inst = self._col(uid, "instruments").get(instrument_id)
                if inst is None:
                    raise MissingInstrument()
                instrument = copy.deepcopy(inst)
            account, pending = None, None
            stored = accounts.account_id_of(col[trade_id]["record"])
            target = account_id if account_id is not None else stored
            if refresh or target != stored:
                account, pending = self._read_account(uid, target, build_default)
                if account is None:
                    raise MissingAccount()
                self._write_default(uid, pending)  # 取引より先（create_trade と同じ）
                account = copy.deepcopy(account)
            new = mutate(copy.deepcopy(col[trade_id]), instrument, account)
            if charts:
                self._chart_write()
            # ここから下は失敗しない（取引・チャートを一緒に書く = トランザクションと同じ）
            for slot, chart in (charts or {}).items():
                key = chart_doc_id(trade_id, slot)
                if chart is None:
                    self._col(uid, "charts").pop(key, None)
                else:
                    self._col(uid, "charts")[key] = copy.deepcopy(chart)
            col[trade_id] = copy.deepcopy(new)
            return new

    def delete_trade(self, uid, trade_id):
        with self._lock:
            trades = self._col(uid, "trades")
            if trade_id not in trades:
                return False
            self._chart_write()
            del trades[trade_id]
            for slot in SLOTS:
                self._col(uid, "charts").pop(chart_doc_id(trade_id, slot), None)
            return True

    # ── チャート ──
    def get_chart(self, uid, trade_id, slot):
        with self._lock:
            return copy.deepcopy(self._col(uid, "charts").get(chart_doc_id(trade_id, slot)))

    def put_chart(self, uid, trade_id, slot, chart, mutate):
        with self._lock:
            trades = self._col(uid, "trades")
            if trade_id not in trades:
                return None
            check_known_version(trades[trade_id])
            new = mutate(copy.deepcopy(trades[trade_id]))
            self._chart_write()
            self._col(uid, "charts")[chart_doc_id(trade_id, slot)] = copy.deepcopy(chart)
            trades[trade_id] = copy.deepcopy(new)
            return new

    def delete_chart(self, uid, trade_id, slot, mutate):
        with self._lock:
            trades = self._col(uid, "trades")
            key = chart_doc_id(trade_id, slot)
            if trade_id not in trades:
                return None
            check_known_version(trades[trade_id])  # 枠の有無より先（FirestoreStore と同じ。#115）
            # 有無は取引の文書の要約で見る（FirestoreStore と同じ約束）
            if slot not in (trades[trade_id].get("charts") or {}):
                return None
            new = mutate(copy.deepcopy(trades[trade_id]))
            self._chart_write()
            self._col(uid, "charts").pop(key, None)
            trades[trade_id] = copy.deepcopy(new)
            return new

    # ── 心理のタグ（#156）──
    def set_emotion_tags(self, uid, trade_ids, mutate):
        with self._lock:
            trades = self._col(uid, "trades")
            if any(tid not in trades for tid in trade_ids):
                return None
            for tid in trade_ids:
                check_known_version(trades[tid])  # 1 件でも知らない版なら何も書かない（FirestoreStore と同じ）
            news = [mutate(copy.deepcopy(trades[tid])) for tid in trade_ids]
            for tid, new in zip(trade_ids, news, strict=True):
                trades[tid] = copy.deepcopy(new)
            return news

    # ── 口座（#47）──
    def _read_account(self, uid, account_id, build_default):
        """(口座, 作る既定の口座の (設定, 文書) or None)。既定の口座が無ければ設定から作る文書を返す（まだ書かない）"""
        col = self._col(uid, "accounts")
        if account_id in col:
            return col[account_id], None
        if account_id != DEFAULT_ACCOUNT_ID:
            return None, None
        settings = copy.deepcopy(self._col(uid, "settings").get("current"))
        doc = build_default(copy.deepcopy(settings))
        return doc, (settings, doc)

    def _write_default(self, uid, pending):
        if pending is None:
            return
        settings, doc = pending
        self._col(uid, "accounts")[DEFAULT_ACCOUNT_ID] = copy.deepcopy(doc)
        self.default_created += 1
        accounts.log_default_created(settings, doc)

    def list_accounts(self, uid, build_default):
        with self._lock:
            _acc, pending = self._read_account(uid, DEFAULT_ACCOUNT_ID, build_default)
            self._write_default(uid, pending)
            return [(k, copy.deepcopy(v)) for k, v in self._col(uid, "accounts").items()]

    def get_account(self, uid, account_id, build_default):
        with self._lock:
            acc, pending = self._read_account(uid, account_id, build_default)
            self._write_default(uid, pending)
            return copy.deepcopy(acc)

    def create_account(self, uid, doc, build_default):
        with self._lock:
            _acc, pending = self._read_account(uid, DEFAULT_ACCOUNT_ID, build_default)
            taken = self._name_taken(uid, doc["nameKey"], collection="accounts")
            if taken or (pending is not None and pending[1]["nameKey"] == doc["nameKey"]):
                raise Conflict("duplicateName")
            self._write_default(uid, pending)
            aid = _new_id()
            self._col(uid, "accounts")[aid] = copy.deepcopy(doc)
            return aid

    def update_account(self, uid, account_id, mutate, build_default):
        with self._lock:
            prev, pending = self._read_account(uid, account_id, build_default)
            if prev is None:
                return None
            def in_use():
                return any(accounts.account_id_of(t["record"]) == account_id
                           for t in self._col(uid, "trades").values())  # fmt: skip

            new = mutate(copy.deepcopy(prev), in_use)
            if self._name_taken(uid, new["nameKey"], except_id=account_id, collection="accounts"):
                raise Conflict("duplicateName")
            if pending is not None:
                # 既定の口座を作ってすぐ直す: 作る文書を直した値に置き換える
                pending = (pending[0], new)
                self._write_default(uid, pending)
            else:
                self._col(uid, "accounts")[account_id] = copy.deepcopy(new)
            return new

    # ── 銘柄 ──
    def _name_taken(self, uid, key, except_id=None, collection="instruments"):
        return any(k != except_id and v["nameKey"] == key for k, v in self._col(uid, collection).items())

    def list_instruments(self, uid):
        with self._lock:
            return [(k, copy.deepcopy(v)) for k, v in self._col(uid, "instruments").items()]

    def get_instrument(self, uid, instrument_id):
        with self._lock:
            return copy.deepcopy(self._col(uid, "instruments").get(instrument_id))

    def create_instrument(self, uid, doc):
        with self._lock:
            if self._name_taken(uid, doc["nameKey"]):
                raise Conflict("duplicateName")
            iid = _new_id()
            self._col(uid, "instruments")[iid] = copy.deepcopy(doc)
            return iid

    def update_instrument(self, uid, instrument_id, mutate):
        with self._lock:
            col = self._col(uid, "instruments")
            if instrument_id not in col:
                return None
            new = mutate(copy.deepcopy(col[instrument_id]))
            if self._name_taken(uid, new["nameKey"], except_id=instrument_id):
                raise Conflict("duplicateName")
            col[instrument_id] = copy.deepcopy(new)
            return new

    def delete_instrument(self, uid, instrument_id):
        with self._lock:
            col = self._col(uid, "instruments")
            if instrument_id not in col:
                return False
            if any(t["record"]["instrumentId"] == instrument_id for t in self._col(uid, "trades").values()):
                raise Conflict("inUse")
            del col[instrument_id]
            return True

    # ── 明細の読み取りの計上（#44）──
    def reserve_read(self, uid, day, decide, reserve_micro):
        with self._lock:
            if self.fail_limits:
                raise StoreUnavailable("test")
            if self.fail_with is not None:
                raise self.fail_with
            if self.unavailable:
                raise StoreUnavailable("test")
            days = self.read_days.setdefault(uid, {})
            user = days.get(day, {})
            spend = self.spend.get(day, {})
            count = int(user.get("count", 0))
            # 本物と同じ: 欠け・負は「数えられない」として回数 × 予約額に見積もる（#51。多めに数える側）
            user_spent = effective_user_micro(count, user.get("microUsd"), reserve_micro)
            spent = int(spend.get("microUsd", 0))
            decision = decide(count, user_spent, spent)
            if decision == "ok":
                days[day] = {"count": count + 1, "microUsd": user_spent + reserve_micro}
                self.spend[day] = {"count": int(spend.get("count", 0)) + 1, "microUsd": spent + reserve_micro}
            return decision

    def settle_read(self, uid, day, delta_micro):
        with self._lock:
            if self.fail_settle:
                raise StoreUnavailable("test")
            if delta_micro == 0:
                return
            for doc in (self.read_days.setdefault(uid, {}).setdefault(day, {}), self.spend.setdefault(day, {})):
                doc["microUsd"] = int(doc.get("microUsd", 0)) + delta_micro

    # ── 使った量（#62）──
    def read_days_between(self, uid, first, last):
        with self._lock:
            if self.fail_limits or self.unavailable:
                raise StoreUnavailable("test")
            if self.fail_with is not None:
                raise self.fail_with
            self.usage_reads += 1
            days = sorted((d, copy.deepcopy(doc)) for d, doc in self.read_days.get(uid, {}).items()
                          if first <= d <= last)
            return days[:USAGE_MAX_DAYS]

    # ── 起動の準備（#60）──
    def warm(self):
        with self._lock:
            self.warm_calls += 1
            if self.fail_warm is not None:
                raise self.fail_warm

    # ── 明細の特徴の覚え（#66）──
    def _profiles_failing(self):
        if self.fail_profiles or self.unavailable:
            raise StoreUnavailable("test")
        if self.fail_with is not None:
            raise self.fail_with

    def get_statement_profile(self, uid, key):
        with self._lock:
            self._profiles_failing()
            return copy.deepcopy(self.users.get(uid, {}).get("statement_profiles", {}).get(key))

    def put_statement_profile(self, uid, key, doc, build_default):
        with self._lock:
            self._profiles_failing()
            acc, pending = self._read_account(uid, doc["accountId"], build_default)
            if acc is None:
                raise MissingAccount()
            self._write_default(uid, pending)
            self._col(uid, "statement_profiles")[key] = copy.deepcopy(doc)

    # ── 設定 ──
    def get_settings(self, uid):
        with self._lock:
            return copy.deepcopy(self._col(uid, "settings").get("current"))

    def update_settings(self, uid, mutate):
        with self._lock:
            col = self._col(uid, "settings")
            new = mutate(copy.deepcopy(col.get("current")))
            col["current"] = copy.deepcopy(new)
            return new
