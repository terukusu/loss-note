// 画面のテストの両建てのまとまりの例（#267。設計書 5.8 の例と同じ架空の値）。core のテストの group-builder の取引に、保存の形の
// 鍵（版・更新の時刻・逆参照）を足す。銘柄: XYZ 先物（乗数 1,000）・XYZ CFD（乗数 10）・ABC CFD（同じ株価指数・名前が違う）
import type {
  GroupRole,
  InstrumentRecord,
  StoredPositionGroup,
  StoredTrade,
} from '../../../core/record';
import { FIX, type MemberOpts, MIN, MON, tradeOf } from '../../core/helpers/group-builder';

export { ENTRY, FIX, MIN, MON } from '../../core/helpers/group-builder';

const inst = (
  id: string,
  name: string,
  underlying: string,
  multiplier: number,
  kind: InstrumentRecord['underlyingKind'] = 'index',
): InstrumentRecord => ({
  id,
  name,
  underlying,
  underlyingKind: kind,
  productForm: name.includes('CFD') ? 'spotCfd' : 'future',
  priceCurrency: 'JPY',
  multiplier,
  quantityStep: 1,
  createdAt: 1,
  updatedAt: 1,
});

export const XYZ_FUT = inst('fut', 'XYZ 先物', 'XYZ', 1_000);
export const XYZ_MINI = inst('mini', 'XYZ ミニ先物', 'XYZ', 100);
export const XYZ_CFD = inst('cfd', 'XYZ CFD', 'XYZ', 10);
export const ABC_CFD = inst('abc', 'ABC CFD', 'ABC', 10);
export const GOLD = inst('gold', 'GOLD 先物', 'GOLD', 10, 'commodity');
export const INSTRUMENTS: readonly InstrumentRecord[] = [XYZ_FUT, XYZ_MINI, XYZ_CFD, ABC_CFD, GOLD];

/** 保存した取引（group-builder の取引 + 銘柄の ID・版・逆参照） */
export function stored(
  id: string,
  o: MemberOpts,
  extra: { readonly instrumentId?: string; readonly groupId?: string } = {},
): StoredTrade {
  const t = tradeOf(id, o);
  return {
    ...t,
    schemaVersion: 1,
    updatedAt: t.createdAt,
    record: { ...t.record, instrumentId: extra.instrumentId ?? XYZ_FUT.id },
    ...(extra.groupId ? { positionGroupId: extra.groupId } : {}),
  } as StoredTrade;
}

/** 本玉: XYZ 先物 L 1 枚・イン 38,000・LC 37,700（口座 A） */
export function future(
  id: string,
  o: Partial<MemberOpts> & { exitPrice: number },
  groupId?: string,
) {
  return stored(id, o, { instrumentId: XYZ_FUT.id, ...(groupId ? { groupId } : {}) });
}

/** 決済の代わり: XYZ CFD S 100（量 1,000）・LC なし（口座 B）。FIX にエントリーして MON + 5 分に決済 */
export function cfd(
  id: string,
  o: Partial<MemberOpts> & { price: number; exitPrice: number },
  groupId?: string,
  instrumentId = XYZ_CFD.id,
) {
  return stored(
    id,
    {
      side: 'S',
      multiplier: 10,
      quantity: 100,
      entryTime: FIX,
      lc: null,
      exitTime: MON + 5 * MIN,
      accountId: 'B',
      capitalYen: 20_000_000,
      ...o,
    },
    { instrumentId, ...(groupId ? { groupId } : {}) },
  );
}

/** 保存したまとまり（メンバーの時刻の写しは取引から） */
export function groupOf(
  id: string,
  members: readonly { readonly trade: StoredTrade; readonly role: GroupRole }[],
  exit?: StoredPositionGroup['exit'],
): StoredPositionGroup {
  return {
    id,
    schemaVersion: 1,
    members: members.map(({ trade, role }) => ({
      tradeId: trade.id,
      role,
      entryTime: trade.record.entries[0].time ?? null,
      exitTime: trade.record.exit.time,
    })),
    ...(exit ? { exit } : {}),
    createdAt: MON + 10 * MIN,
    updatedAt: MON + 10 * MIN,
  };
}

/** H1（利確の固定）: 先物 38,600 で決済、CFD S 100 を 38,450 で固定・38,620 で買い戻し → +1.5R・計画どおりの勝ち */
export function h1(gid = 'g1') {
  const f = future('f1', { exitPrice: 38_600 }, gid);
  const c = cfd('c1', { price: 38_450, exitPrice: 38_620 }, gid);
  const g = groupOf(gid, [
    { trade: f, role: 'main' },
    { trade: c, role: 'hedge' },
  ]);
  return { f, c, g };
}

/** H2（損切りの固定が遅れた）: CFD S 100 を 37,550 → −1.5R・B */
export function h2(gid = 'g2') {
  const f = future('f2', { exitPrice: 37_400 }, gid);
  const c = cfd('c2', { price: 37_550, exitPrice: 37_420 }, gid);
  const g = groupOf(gid, [
    { trade: f, role: 'main' },
    { trade: c, role: 'hedge' },
  ]);
  return { f, c, g };
}
