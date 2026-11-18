"""テスト用の記憶の保存先（``loss_note_api.store.Store`` と同じ約束）。

API のテストはこれとエミュレーターの Firestore の両方で同じテストを回す（conftest の ``store_kind``）。
チャート（Issue #12）は ``users[uid]["charts"]["{tradeId}-{slot}"]``。``fail_charts`` を立てると、チャートに触れる
書き込みが何も書かずに StoreUnavailable になる（取引とチャートを一緒に書く約束の試験。AC-6）。
明細の読み取りの計上（Issue #44）は ``read_days[uid][day]``（Firestore の ``users/{uid}/statement_read_days/{day}``。
記録の ``users`` と分けて持ち、記録に書き込みが無いことを確かめるテストに混ざらない）と ``spend[day]``。
``fail_limits`` を立てると予約が、``fail_settle`` を立てると精算が、何も書かずに StoreUnavailable になる。
"""

import copy
import secrets
import string
import threading

from loss_note_api.charts import SLOTS, chart_doc_id
from loss_note_api.store import Conflict, MissingInstrument, StoreUnavailable

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
        self.fail_warm: Exception | None = None  # 起動の準備で投げる例外（#60）

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

    def get_trade(self, uid, trade_id):
        with self._lock:
            return copy.deepcopy(self._col(uid, "trades").get(trade_id))

    def _chart_write(self):
        if self.fail_charts:
            raise StoreUnavailable("test")

    def create_trade(self, uid, instrument_id, build, charts=None):
        with self._lock:
            inst = self._col(uid, "instruments").get(instrument_id)
            if inst is None:
                raise MissingInstrument()
            doc = build(copy.deepcopy(inst), copy.deepcopy(self._col(uid, "settings").get("current")))
            tid = _new_id()
            if charts:
                self._chart_write()
            # ここから下は失敗しない（取引とチャートを一緒に書く = トランザクションと同じ）
            self._col(uid, "trades")[tid] = copy.deepcopy(doc)
            for slot, chart in (charts or {}).items():
                self._col(uid, "charts")[chart_doc_id(tid, slot)] = copy.deepcopy(chart)
            return tid, doc

    def update_trade(self, uid, trade_id, instrument_id, mutate):
        with self._lock:
            col = self._col(uid, "trades")
            if trade_id not in col:
                return None
            instrument = None
            if instrument_id != col[trade_id]["record"]["instrumentId"]:
                inst = self._col(uid, "instruments").get(instrument_id)
                if inst is None:
                    raise MissingInstrument()
                instrument = copy.deepcopy(inst)
            new = mutate(copy.deepcopy(col[trade_id]), instrument)
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
            new = mutate(copy.deepcopy(trades[trade_id]))
            self._chart_write()
            self._col(uid, "charts")[chart_doc_id(trade_id, slot)] = copy.deepcopy(chart)
            trades[trade_id] = copy.deepcopy(new)
            return new

    def delete_chart(self, uid, trade_id, slot, mutate):
        with self._lock:
            trades = self._col(uid, "trades")
            key = chart_doc_id(trade_id, slot)
            # 有無は取引の文書の要約で見る（FirestoreStore と同じ約束）
            if trade_id not in trades or slot not in (trades[trade_id].get("charts") or {}):
                return None
            new = mutate(copy.deepcopy(trades[trade_id]))
            self._chart_write()
            self._col(uid, "charts").pop(key, None)
            trades[trade_id] = copy.deepcopy(new)
            return new

    # ── 銘柄 ──
    def _name_taken(self, uid, key, except_id=None):
        return any(k != except_id and v["nameKey"] == key for k, v in self._col(uid, "instruments").items())

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
            spent = int(spend.get("microUsd", 0))
            decision = decide(count, spent)
            if decision == "ok":
                days[day] = {"count": count + 1}
                self.spend[day] = {"count": int(spend.get("count", 0)) + 1, "microUsd": spent + reserve_micro}
            return decision

    def settle_read(self, day, delta_micro):
        with self._lock:
            if self.fail_settle:
                raise StoreUnavailable("test")
            if delta_micro == 0:
                return
            doc = self.spend.setdefault(day, {})
            doc["microUsd"] = int(doc.get("microUsd", 0)) + delta_micro

    # ── 起動の準備（#60）──
    def warm(self):
        with self._lock:
            self.warm_calls += 1
            if self.fail_warm is not None:
                raise self.fail_warm

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
