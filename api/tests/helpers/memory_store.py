"""テスト用の記憶の保存先（``loss_note_api.store.Store`` と同じ約束）。

API のテストはこれとエミュレーターの Firestore の両方で同じテストを回す（conftest の ``store_kind``）。
"""

import copy
import secrets
import string
import threading

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

    def create_trade(self, uid, instrument_id, build):
        with self._lock:
            inst = self._col(uid, "instruments").get(instrument_id)
            if inst is None:
                raise MissingInstrument()
            doc = build(copy.deepcopy(inst), copy.deepcopy(self._col(uid, "settings").get("current")))
            tid = _new_id()
            self._col(uid, "trades")[tid] = copy.deepcopy(doc)
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
            return self._col(uid, "trades").pop(trade_id, None) is not None

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
