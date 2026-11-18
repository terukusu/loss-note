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
// - POST /api/trades の multipart（#12）: 部分 record（JSON の文字）+ entryChart / exitChart（画像）。チャートは charts に
//   形式と大きさだけを残す（バイト列は持たない）。チャートの無い枠に時間足 → 400 noChart（本物と同じ）。応答に charts の要約
// - GET /api/trades/<id>・PUT /api/trades/<id>・DELETE /api/trades/<id>・GET /api/trades/<id>/charts/<slot>（#9）: 無い ID は 404。
//   PUT は本文で record を置き換え、銘柄を別の銘柄に変えたときだけ snapshot の銘柄の値をその銘柄の今の値で写し直す
//   （資金・許容リスクは変えない。C36）。チャートの無い枠に時間足 → 400 noChart。DELETE は取引と 2 枠のチャートを消して 204。
//   チャートの GET は opts.chartData（鍵 = 取引 ID-枠）のバイト列を返す（無ければ 404）
// - 口座（#47）: GET /api/accounts = { items }（名前の順）。既定の口座 default（「口座 1」）が無ければ、口座を読む・使う
//   入口（口座の GET・POST・PUT、取引の POST・PUT）で設定の資金・許容リスク・資金の履歴から 1 回だけ作る（本物の移し替え）。
//   POST /api/accounts = 201（資金を入れたら履歴 1 件）・名前が同じなら 409。PUT /api/accounts/<id> = 3 欄を置き換え、
//   資金が前と違うときだけ履歴に足す。無い ID は 404。取引の snapshot の資金・許容リスクは取引の口座（accountId。無い = 既定）
//   から写す。PUT で口座を付け替えたときだけ付け替え先の今の値で写し直す（本文に口座が無ければ前の口座を保つ）。無い口座は 400
// - POST /api/chart-reads（#27）: opts.chartReads の台本を順に返す（無ければ { kind: 'chart', timeframe: null } =
//   時間足を読めなかった）。要求は calls に Content-Type とバイト数だけを残す。holdChartReads / releaseChartReads で止める
// 本物との形のずれは api/tests/test_manual_entry_fixture.py・test_statement_entry_fixture.py（画面が作った本文を本物に通す）で塞ぐ
import {
  type AccountBody,
  type AccountRecord,
  accountIdOf,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_ACCOUNT_NAME,
  type InstrumentBody,
  type InstrumentRecord,
  type PerformanceUnit,
  type SettingsRecord,
  type StoredTrade,
  type TradeRecord,
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
  /** multipart の部分の名前（取引の作成。#12） */
  readonly parts?: readonly string[];
}

/** 保存したチャート（形式と大きさだけ） */
export interface FakeChart {
  readonly contentType: string;
  readonly size: number;
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
  /** チャートの GET が返すバイト列（鍵 = 取引 ID-枠。#9） */
  readonly chartData?: Readonly<Record<string, Uint8Array>>;
  /** 口座（#47。省けば既定の口座を設定から作る = 移し替え） */
  readonly accounts?: readonly AccountRecord[];
  /** POST /api/chart-reads の応答（順に使う。#27） */
  readonly chartReads?: readonly ReadScript[];
}

export interface FakeApi {
  readonly api: ApiFn;
  readonly calls: FakeCall[];
  readonly instruments: InstrumentRecord[];
  readonly trades: StoredTrade[];
  /** 口座（#47。既定の口座を作るのは最初に口座を読む・使うとき） */
  readonly accounts: AccountRecord[];
  /** 保存したチャート（鍵 = 取引 ID-枠）。枚数 = size */
  readonly charts: Map<string, FakeChart>;
  /** 今の設定（PUT /api/settings で変わる） */
  settings(): SettingsRecord;
  /** 待たせている要求を進める（delay を使うとき） */
  hold(): void;
  release(): void;
  /** 読み取りの応答だけを止める / 進める */
  holdReads(): void;
  releaseReads(): void;
  /** チャートの時間足の読み取りの応答だけを止める / 進める（#27） */
  holdChartReads(): void;
  releaseChartReads(): void;
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
  const charts = new Map<string, FakeChart>();
  let clock = 1_800_000_000_000;
  let seq = 0;
  let conflict = opts.conflictOnce;
  const once = new Map(Object.entries(opts.failOnce ?? {}));
  let gate: Promise<void> | null = null;
  let open: (() => void) | null = null;
  let readGate: Promise<void> | null = null;
  let readOpen: (() => void) | null = null;
  const reads = [...(opts.reads ?? [])];
  const chartReads = [...(opts.chartReads ?? [])];
  let chartReadGate: Promise<void> | null = null;
  let chartReadOpen: (() => void) | null = null;

  let current: SettingsRecord = {
    capitalYen: opts.capitalYen ?? null,
    riskTolerancePct: opts.riskTolerancePct ?? 1,
    performanceUnit: opts.performanceUnit ?? 'R',
    capitalHistory: [...(opts.capitalHistory ?? [])],
  };
  const settings = (): SettingsRecord => current;

  const accounts: AccountRecord[] = [...(opts.accounts ?? [])];
  /** 既定の口座が無ければ設定から作る（本物の移し替え。取引・設定は書かない） */
  const ensureDefault = () => {
    if (accounts.some((a) => a.id === DEFAULT_ACCOUNT_ID)) return;
    accounts.push({
      id: DEFAULT_ACCOUNT_ID,
      name: DEFAULT_ACCOUNT_NAME,
      capitalYen: current.capitalYen,
      riskTolerancePct: current.riskTolerancePct,
      capitalHistory: [...current.capitalHistory],
      createdAt: clock,
      updatedAt: clock,
    });
  };
  const sortedAccounts = () => {
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    return [...accounts].sort(
      (a, b) => cmp(nameKey(a.name), nameKey(b.name)) || cmp(a.name, b.name) || cmp(a.id, b.id),
    );
  };
  const okCapital = (cap: unknown) =>
    cap === null || (typeof cap === 'number' && cap > 0 && cap <= 1e12);
  const okRisk = (risk: unknown) => typeof risk === 'number' && risk >= 0.5 && risk <= 3;

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
    if (key === 'POST /api/chart-reads') {
      const raw = init.body;
      calls.push({
        method,
        path,
        contentType: new Headers(init.headers).get('Content-Type') ?? '',
        bytes: raw instanceof Uint8Array ? raw.length : -1,
      });
      if (chartReadGate) await chartReadGate;
      const script = chartReads.shift() ?? {
        status: 200,
        body: { kind: 'chart', timeframe: null },
      };
      if (script === 'throw')
        throw new TypeError('チャートの読み取りの通信の誤り（偽物。SECRET-本文）');
      return json(script.status, script.body ?? { error: 'x', detail: 'SECRET-本文' });
    }
    const form = init.body instanceof FormData ? init.body : undefined;
    const formRecord = form?.get('record');
    const body =
      typeof init.body === 'string'
        ? (JSON.parse(init.body) as unknown)
        : typeof formRecord === 'string'
          ? (JSON.parse(formRecord) as unknown)
          : undefined;
    const partNames: string[] = [];
    form?.forEach((_v, k) => {
      partNames.push(k);
    });
    calls.push({
      method,
      path,
      ...(body === undefined ? {} : { body }),
      ...(form ? { parts: partNames } : {}),
    });
    if (gate) await gate;
    const f = opts.fail?.[key] ?? once.get(key);
    once.delete(key);
    if (f === 'throw')
      throw new TypeError('ネットワークの誤り（偽物。この文字列は画面に出ないこと）');
    if (typeof f === 'number')
      return json(f, { error: 'unavailable', secret: '応答の本文（偽物）' });

    if (key === 'GET /api/trades') {
      const items = [...trades].sort(
        (a, b) =>
          b.record.exit.time - a.record.exit.time ||
          b.createdAt - a.createdAt ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
      return json(200, { items });
    }
    const chartPath = /^\/api\/trades\/([^/]+)\/charts\/([^/]+)$/.exec(path);
    if (chartPath && method === 'GET') {
      const id = decodeURIComponent(chartPath[1] ?? '');
      const slot = chartPath[2] ?? '';
      const t = trades.find((x) => x.id === id);
      const data = opts.chartData?.[`${id}-${slot}`];
      const meta = t?.charts?.[slot as 'entry' | 'exit'];
      if (!t || !meta || !data) return json(404, { error: 'not_found' });
      return new Response(data as BodyInit, {
        status: 200,
        headers: { 'Content-Type': meta.contentType },
      });
    }
    const tradePath = /^\/api\/trades\/([^/]+)$/.exec(path);
    if (tradePath) {
      const id = decodeURIComponent(tradePath[1] ?? '');
      const idx = trades.findIndex((x) => x.id === id);
      if (idx < 0) return json(404, { error: 'not_found' });
      const prev = trades[idx] as StoredTrade;
      if (method === 'GET') return json(200, prev);
      if (method === 'DELETE') {
        trades.splice(idx, 1);
        charts.delete(`${id}-entry`);
        charts.delete(`${id}-exit`);
        return new Response(null, { status: 204 });
      }
      if (method === 'PUT') {
        const record = body as TradeRecord;
        const inst = instruments.find((i) => i.id === record.instrumentId);
        if (!inst) return json(400, { error: 'invalid', issues: [{ field: 'instrumentId' }] });
        for (const slot of ['entry', 'exit'] as const) {
          if (record[`${slot}ChartTimeframe`] !== undefined && !prev.charts?.[slot]) {
            return json(400, {
              error: 'invalid',
              issues: [{ field: `${slot}ChartTimeframe`, kind: 'noChart' }],
            });
          }
        }
        // 口座: 本文に無ければ前の口座のまま。付け替えたときだけ付け替え先の今の値で写し直す（#47 A4・B7）
        const accountMoved =
          record.accountId !== undefined && record.accountId !== accountIdOf(prev.record);
        let movedTo: AccountRecord | undefined;
        if (accountMoved) {
          ensureDefault();
          movedTo = accounts.find((a) => a.id === record.accountId);
          if (!movedTo) {
            return json(400, {
              error: 'invalid',
              issues: [{ field: 'accountId', kind: 'notFound' }],
            });
          }
        }
        clock += 1;
        const changed = inst.id !== prev.record.instrumentId;
        const snap0 = changed
          ? {
              ...prev.snapshot,
              instrument: {
                multiplier: inst.multiplier,
                quantityStep: inst.quantityStep,
                priceCurrency: inst.priceCurrency,
                underlyingKind: inst.underlyingKind,
                productForm: inst.productForm,
              },
            }
          : prev.snapshot;
        const next: StoredTrade = {
          ...prev,
          updatedAt: Math.max(clock, prev.updatedAt + 1),
          snapshot: movedTo
            ? {
                ...snap0,
                capitalYen: movedTo.capitalYen,
                riskTolerancePct: movedTo.riskTolerancePct,
              }
            : snap0,
          record: {
            ...(record.accountId === undefined && prev.record.accountId !== undefined
              ? { accountId: prev.record.accountId }
              : {}),
            ...record,
            lcBasis: record.lcBasis ?? 'chart',
            stopOrderPlaced: record.stopOrderPlaced ?? 'unanswered',
            fees: record.fees ?? [],
          },
        };
        trades[idx] = next;
        return json(200, next);
      }
    }
    if (key === 'GET /api/accounts') {
      ensureDefault();
      return json(200, { items: sortedAccounts() });
    }
    if (key === 'POST /api/accounts') {
      ensureDefault();
      const b = body as AccountBody;
      const name = typeof b.name === 'string' ? b.name.trim() : '';
      const cap = b.capitalYen ?? null;
      const risk = b.riskTolerancePct ?? 1;
      const known = new Set(['name', 'capitalYen', 'riskTolerancePct']);
      if (
        name === '' ||
        !okCapital(cap) ||
        !okRisk(risk) ||
        Object.keys(b).some((k) => !known.has(k))
      ) {
        return json(400, { error: 'invalid', issues: [{ field: 'account' }] });
      }
      if (accounts.some((a) => nameKey(a.name) === nameKey(name))) {
        return json(409, { error: 'conflict', reason: 'duplicateName' });
      }
      clock += 1;
      const created: AccountRecord = {
        id: `acc-new-${++seq}`,
        name,
        capitalYen: cap,
        riskTolerancePct: risk,
        capitalHistory: cap === null ? [] : [{ valueYen: cap, at: clock }],
        createdAt: clock,
        updatedAt: clock,
      };
      accounts.push(created);
      return json(201, created);
    }
    const accountPath = /^\/api\/accounts\/([^/]+)$/.exec(path);
    if (accountPath) {
      ensureDefault();
      const id = decodeURIComponent(accountPath[1] ?? '');
      const idx = accounts.findIndex((a) => a.id === id);
      if (idx < 0) return json(404, { error: 'not_found' });
      const prev = accounts[idx] as AccountRecord;
      if (method === 'GET') return json(200, prev);
      if (method === 'PUT') {
        const b = body as Record<string, unknown>;
        const name = typeof b.name === 'string' ? b.name.trim() : '';
        const cap = b.capitalYen;
        const risk = b.riskTolerancePct;
        if (name === '' || !('capitalYen' in b) || !okCapital(cap) || !okRisk(risk)) {
          return json(400, { error: 'invalid', issues: [{ field: 'account' }] });
        }
        if (accounts.some((a) => a.id !== id && nameKey(a.name) === nameKey(name))) {
          return json(409, { error: 'conflict', reason: 'duplicateName' });
        }
        clock += 1;
        const next: AccountRecord = {
          id,
          name,
          capitalYen: cap as number | null,
          riskTolerancePct: risk as number,
          capitalHistory:
            cap === prev.capitalYen
              ? prev.capitalHistory
              : [...prev.capitalHistory, { valueYen: cap as number | null, at: clock }],
          createdAt: prev.createdAt,
          updatedAt: Math.max(clock, prev.updatedAt + 1),
        };
        accounts[idx] = next;
        return json(200, next);
      }
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
      const parts: Partial<Record<'entry' | 'exit', FakeChart>> = {};
      for (const slot of ['entry', 'exit'] as const) {
        const f = form?.get(`${slot}Chart`);
        if (f instanceof Blob) parts[slot] = { contentType: f.type, size: f.size };
        if (record[`${slot}ChartTimeframe`] !== undefined && !parts[slot]) {
          return json(400, {
            error: 'invalid',
            issues: [{ field: `${slot}ChartTimeframe`, kind: 'noChart' }],
          });
        }
      }
      ensureDefault();
      const acc = accounts.find((a) => a.id === accountIdOf(record));
      if (!acc) {
        return json(400, { error: 'invalid', issues: [{ field: 'accountId', kind: 'notFound' }] });
      }
      clock += 1;
      const s = { capitalYen: acc.capitalYen, riskTolerancePct: acc.riskTolerancePct };
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
        ...(Object.keys(parts).length > 0
          ? { charts: parts as NonNullable<StoredTrade['charts']> }
          : {}),
      };
      for (const [slot, c] of Object.entries(parts)) charts.set(`${stored.id}-${slot}`, c);
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
    accounts,

    charts,
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
    holdChartReads() {
      chartReadGate = new Promise((ok) => {
        chartReadOpen = ok;
      });
    },
    releaseChartReads() {
      const o = chartReadOpen;
      chartReadGate = null;
      chartReadOpen = null;
      o?.();
    },
  };
}
