// 記録の API の偽物（記憶の中だけ。Issue #13 の controller のテスト用）。値はすべて架空。
// 本物（api/src/loss_note_api/routes.py）に合わせた所:
// - GET /api/trades = { items }（決済の時刻の新しい順、同じなら作った時刻の新しい順）。POST /api/trades = 201 + 取引
//   （snapshot = 銘柄の 5 項目 + 資金 + 許容リスク。create_trade の build）。自分の銘柄に無い ID は 400
// - GET /api/instruments = { items }。POST /api/instruments = 201 + 銘柄（省いた欄は既定: other・spotCfd・通貨 null・
//   乗数 1・刻み 1）。名前が同じ（name_key）なら 409 { error: 'conflict', reason: 'duplicateName' }
// - GET /api/settings = { capitalYen, riskTolerancePct, performanceUnit, capitalHistory }（既定 null・1・R）
// - PUT /api/settings（#5）: 3 欄を丸ごと置き換える。資金が前と違うときだけ履歴（古い順）に { valueYen, at } を足す。
//   範囲外（資金が正でない・許容リスクが 0.5〜3 の外・performanceUnit が R / yen でない）は 400
// - PUT /api/instruments/<id>（#5）: 本文に無い欄は既定に戻す（原資産は消える）。名前が自分以外と同じなら 409、無い ID は 404。
//   直しても記録済みの取引の snapshot は変わらない（取引は記録したときの値を写して持つ。C36）
// - POST /api/statement-reads（#15）: opts.reads の台本を順に返す（無ければ 0 行の statement）。要求は calls に
//   Content-Type とバイト数だけを残す（画像のバイト列そのものは持たない）。holdReads / releaseReads で応答を止める
// 本物との形のずれは api/tests/test_manual_entry_fixture.py・test_statement_entry_fixture.py（画面が作った本文を本物に通す）で塞ぐ
import type {
  InstrumentBody,
  InstrumentRecord,
  PerformanceUnit,
  SettingsRecord,
  StoredTrade,
  TradeRecord,
} from '../../../core/record';
import { nameKey } from '../../../ui/src/lib/instrument-name';
import type { ApiFn } from '../../../ui/src/lib/request';

export interface FakeCall {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  /** 読み取りの要求の Content-Type とバイト数 */
  readonly contentType?: string;
  readonly bytes?: number;
}

/** 読み取りの応答の台本（状態と本文、または通信の失敗） */
export type ReadScript = { readonly status: number; readonly body?: unknown } | 'throw';

export interface FakeOptions {
  readonly instruments?: readonly InstrumentRecord[];
  readonly trades?: readonly StoredTrade[];
  readonly capitalYen?: number | null;
  readonly riskTolerancePct?: number;
  readonly performanceUnit?: PerformanceUnit;
  readonly capitalHistory?: SettingsRecord['capitalHistory'];
  /** パスと方法ごとに返す状態を差し替える（例: { 'POST /api/trades': 503 }） */
  readonly fail?: Readonly<Record<string, number | 'throw'>>;
  /** fail と同じだが 1 回だけ（2 回目からは普通に答える） */
  readonly failOnce?: Readonly<Record<string, number | 'throw'>>;
  /** POST /api/instruments を 1 回だけ 409 にする（ほかの端末が同じ名前を先に足した場面） */
  readonly conflictOnce?: InstrumentRecord;
  /** POST /api/statement-reads の応答（順に使う） */
  readonly reads?: readonly ReadScript[];
}

export interface FakeApi {
  readonly api: ApiFn;
  readonly calls: FakeCall[];
  readonly instruments: InstrumentRecord[];
  readonly trades: StoredTrade[];
  /** 今の設定（PUT /api/settings で変わる） */
  settings(): SettingsRecord;
  /** 待たせている要求を進める（delay を使うとき） */
  hold(): void;
  release(): void;
  /** 読み取りの応答だけを止める / 進める */
  holdReads(): void;
  releaseReads(): void;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function createFakeApi(opts: FakeOptions = {}): FakeApi {
  const instruments: InstrumentRecord[] = [...(opts.instruments ?? [])];
  const trades: StoredTrade[] = [...(opts.trades ?? [])];
  const calls: FakeCall[] = [];
  let clock = 1_800_000_000_000;
  let seq = 0;
  let conflict = opts.conflictOnce;
  const once = new Map(Object.entries(opts.failOnce ?? {}));
  let gate: Promise<void> | null = null;
  let open: (() => void) | null = null;
  let readGate: Promise<void> | null = null;
  let readOpen: (() => void) | null = null;
  const reads = [...(opts.reads ?? [])];

  let current: SettingsRecord = {
    capitalYen: opts.capitalYen ?? null,
    riskTolerancePct: opts.riskTolerancePct ?? 1,
    performanceUnit: opts.performanceUnit ?? 'R',
    capitalHistory: [...(opts.capitalHistory ?? [])],
  };
  const settings = (): SettingsRecord => current;

  const api: ApiFn = async (path, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const key = `${method} ${path}`;
    if (key === 'POST /api/statement-reads') {
      const raw = init.body;
      calls.push({
        method,
        path,
        contentType: new Headers(init.headers).get('Content-Type') ?? '',
        bytes: raw instanceof Uint8Array ? raw.length : -1,
      });
      if (readGate) await readGate;
      const script = reads.shift() ?? { status: 200, body: { kind: 'statement', rows: [] } };
      if (script === 'throw')
        throw new TypeError('読み取りの通信の誤り（偽物。SECRET-本文 は画面に出ないこと）');
      return json(script.status, script.body ?? { error: 'x', detail: 'SECRET-本文' });
    }
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, path, ...(body === undefined ? {} : { body }) });
    if (gate) await gate;
    const f = opts.fail?.[key] ?? once.get(key);
    once.delete(key);
    if (f === 'throw')
      throw new TypeError('ネットワークの誤り（偽物。この文字列は画面に出ないこと）');
    if (typeof f === 'number')
      return json(f, { error: 'unavailable', secret: '応答の本文（偽物）' });

    if (key === 'GET /api/trades') {
      const items = [...trades].sort(
        (a, b) => b.record.exit.time - a.record.exit.time || b.createdAt - a.createdAt,
      );
      return json(200, { items });
    }
    if (key === 'GET /api/instruments') return json(200, { items: instruments });
    if (key === 'GET /api/settings') return json(200, settings());
    if (key === 'PUT /api/settings') {
      const b = body as Record<string, unknown>;
      const cap = b.capitalYen;
      const risk = b.riskTolerancePct;
      const unit = b.performanceUnit;
      const okCap = cap === null || (typeof cap === 'number' && cap > 0 && cap <= 1e12);
      const okRisk = typeof risk === 'number' && risk >= 0.5 && risk <= 3;
      if (!okCap || !okRisk || (unit !== 'R' && unit !== 'yen')) {
        return json(400, { error: 'invalid', issues: [{ field: 'settings' }] });
      }
      clock += 1;
      const history =
        cap === current.capitalYen
          ? current.capitalHistory
          : [...current.capitalHistory, { valueYen: cap as number | null, at: clock }];
      current = {
        capitalYen: cap as number | null,
        riskTolerancePct: risk,
        performanceUnit: unit,
        capitalHistory: history,
      };
      return json(200, current);
    }
    if (method === 'PUT' && path.startsWith('/api/instruments/')) {
      const id = path.slice('/api/instruments/'.length);
      const b = body as InstrumentBody;
      const idx = instruments.findIndex((i) => i.id === id);
      if (idx < 0) return json(404, { error: 'not_found' });
      if (instruments.some((i) => i.id !== id && nameKey(i.name) === nameKey(b.name))) {
        return json(409, { error: 'conflict', reason: 'duplicateName' });
      }
      const prev = instruments[idx] as InstrumentRecord;
      clock += 1;
      const next: InstrumentRecord = {
        id,
        name: b.name.trim(),
        ...(b.underlying === undefined ? {} : { underlying: b.underlying }),
        underlyingKind: b.underlyingKind ?? 'other',
        productForm: b.productForm ?? 'spotCfd',
        priceCurrency: b.priceCurrency ?? null,
        multiplier: b.multiplier ?? 1,
        quantityStep: b.quantityStep ?? 1,
        createdAt: prev.createdAt,
        updatedAt: clock,
      };
      instruments[idx] = next;
      return json(200, next);
    }
    if (key === 'POST /api/instruments') {
      const b = body as InstrumentBody;
      if (conflict) {
        instruments.push(conflict);
        conflict = undefined;
        return json(409, { error: 'conflict', reason: 'duplicateName' });
      }
      if (instruments.some((i) => nameKey(i.name) === nameKey(b.name))) {
        return json(409, { error: 'conflict', reason: 'duplicateName' });
      }
      clock += 1;
      const inst: InstrumentRecord = {
        id: `inst-new-${++seq}`,
        name: b.name.trim(),
        underlyingKind: b.underlyingKind ?? 'other',
        productForm: b.productForm ?? 'spotCfd',
        priceCurrency: b.priceCurrency ?? null,
        multiplier: b.multiplier ?? 1,
        quantityStep: b.quantityStep ?? 1,
        createdAt: clock,
        updatedAt: clock,
      };
      instruments.push(inst);
      return json(201, inst);
    }
    if (key === 'POST /api/trades') {
      const record = body as TradeRecord;
      const inst = instruments.find((i) => i.id === record.instrumentId);
      if (!inst) return json(400, { error: 'invalid', issues: [{ field: 'instrumentId' }] });
      clock += 1;
      const s = settings();
      const stored: StoredTrade = {
        id: `trade-${++seq}`,
        schemaVersion: 1,
        createdAt: clock,
        updatedAt: clock,
        snapshot: {
          instrument: {
            multiplier: inst.multiplier,
            quantityStep: inst.quantityStep,
            priceCurrency: inst.priceCurrency,
            underlyingKind: inst.underlyingKind,
            productForm: inst.productForm,
          },
          capitalYen: s.capitalYen,
          riskTolerancePct: s.riskTolerancePct,
        },
        // API が既定を埋める欄（本文にあれば同じ値）
        record: {
          ...record,
          lcBasis: record.lcBasis ?? 'chart',
          stopOrderPlaced: record.stopOrderPlaced ?? 'unanswered',
          fees: record.fees ?? [],
        },
      };
      trades.push(stored);
      return json(201, stored);
    }
    return json(404, { error: 'not_found' });
  };

  return {
    api,
    calls,
    instruments,
    trades,
    settings,
    hold() {
      gate = new Promise((ok) => {
        open = ok;
      });
    },
    release() {
      const o = open;
      gate = null;
      open = null;
      o?.();
    },
    holdReads() {
      readGate = new Promise((ok) => {
        readOpen = ok;
      });
    },
    releaseReads() {
      const o = readOpen;
      readGate = null;
      readOpen = null;
      o?.();
    },
  };
}
