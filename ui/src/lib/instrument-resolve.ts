// 保存するときの銘柄の ID の決め方（記録する画面 #13 と直す画面 #9 が共有する）。
// 一覧に同じ名前（nameKey）があればその ID、無ければ名前だけで足す（既定は API が埋める。C21）。
// 409（ほかの端末が同じ名前を先に足した）なら一覧を取り直して照合する
import type { InstrumentRecord } from '../../../core/record';
import { findInstrument } from './instrument-name';
import { Failed, getJson, JSON_HEADERS, type RequestFn } from './request';

export async function resolveInstrument(
  request: RequestFn,
  name: string,
  matchedId: string | undefined,
  instruments: readonly InstrumentRecord[],
): Promise<{ id: string; instruments: readonly InstrumentRecord[] }> {
  if (matchedId !== undefined) return { id: matchedId, instruments };
  const res = await request('/api/instruments', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  });
  if (res.status === 409) {
    const again = await getJson<{ items: InstrumentRecord[] }>(
      await request('/api/instruments'),
      200,
    );
    const found = Array.isArray(again.items) ? findInstrument(name, again.items) : undefined;
    if (!found) throw new Failed('other');
    return { id: found.id, instruments: again.items };
  }
  const created = await getJson<InstrumentRecord>(res, 201);
  return { id: created.id, instruments: [...instruments, created] };
}
