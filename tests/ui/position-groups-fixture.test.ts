// 画面が作る両建てのまとまりの本文（#267 の AC-11）を、共有の合成の fixture `tests/fixtures/records/position-groups.json` に書く。
// API のテスト（api/tests/test_position_groups_fixture.py）が同じ fixture を本物の API に通し、結ぶ（POST 201）・固定の価格などを
// 直す（PUT 200）・解く（DELETE 204）と、メンバーの逆参照を確かめる。取引の ID は API が決めるので、本文の tradeId は取引の
// 名前の印（F・C など）。値はすべて架空（設計書 5.8 の H1・H5）。
// 本文の形が変わったら `UPDATE_FIXTURES=1 npx vitest run tests/ui/position-groups-fixture.test.ts` で書き直す
import { describe, expect, it } from 'vitest';
import type {
  InstrumentBody,
  PositionGroupBody,
  StoredTrade,
  TradeRecord,
} from '../../core/record';
import { groupBody, previewLine, readExitDraft, rolesOf } from '../../ui/src/lib/position-group';
import { cfd, ENTRY, future, stored, XYZ_CFD, XYZ_FUT, XYZ_MINI } from './helpers/group-examples';

const node = (
  globalThis as unknown as {
    process: {
      env: Record<string, string | undefined>;
      getBuiltinModule(id: 'node:fs'): {
        readFileSync(p: URL, enc: 'utf8'): string;
        writeFileSync(p: URL, data: string): void;
      };
    };
  }
).process;
const fs = node.getBuiltinModule('node:fs');
const FIXTURE = new URL('../fixtures/records/position-groups.json', import.meta.url);

interface FixtureTrade {
  readonly name: string;
  /** 銘柄の名前の印（instruments の name） */
  readonly instrument: string;
  /** 取引の本文（instrumentId は銘柄の名前の印。口座は既定の口座） */
  readonly record: TradeRecord;
}

interface Scene {
  readonly name: string;
  /** 結ぶ本文（相手を選ぶシートの ［結ぶ］ が送る POST の本文。tradeId は取引の名前の印） */
  readonly create: PositionGroupBody;
  /** 固定の価格などを直す本文（まとまりの画面の下のシートの ［保存］ が送る PUT の本文） */
  readonly update: PositionGroupBody;
  /** 画面のまとまりの判定（読むだけ。API は判定を持たない） */
  readonly expect: { readonly grade: string; readonly r: number | null };
}

/** 取引の本文から、保存の形の鍵（口座 = 既定の口座）を外して銘柄の印にする */
function bodyOf(t: StoredTrade, instrument: string): FixtureTrade {
  const { accountId: _a, ...rest } = t.record;
  return { name: t.id, instrument, record: { ...rest, instrumentId: instrument } as TradeRecord };
}

const instrumentBody = (i: typeof XYZ_FUT): InstrumentBody => ({
  name: i.name,
  underlying: i.underlying ?? i.name,
  underlyingKind: i.underlyingKind,
  productForm: i.productForm,
  priceCurrency: i.priceCurrency,
  multiplier: i.multiplier,
  quantityStep: i.quantityStep,
});

function build() {
  // H1: 本玉 F（XYZ 先物 L 1 枚）と決済の代わり C（XYZ CFD S 100 を 38,450）
  const f = future('F', { exitPrice: 38_600 });
  const c = cfd('C', { price: 38_450, exitPrice: 38_620 });
  // H5: 本玉 2 件（先物 F5 + ミニ先物 M5）と決済の代わり C5（CFD S 150）。3 件のまとまり
  const f5 = future('F5', { exitPrice: 38_400 });
  const m5 = stored(
    'M5',
    {
      multiplier: 100,
      quantity: 5,
      price: 38_100,
      lc: 37_800,
      entryTime: ENTRY,
      exitPrice: 38_400,
    },
    { instrumentId: XYZ_MINI.id },
  );
  const c5 = cfd('C5', { price: 38_300, quantity: 150, exitPrice: 38_420 });
  const pick = (base: StoredTrade, picked: StoredTrade[], exitPrice: string): Scene => {
    const members = rolesOf(base, picked, base.record.side);
    const ids = members.map((m) => ({ tradeId: m.trade.id, role: m.role }));
    const line = previewLine(members);
    const read = readExitDraft({ price: exitPrice, orderType: 'market', reason: '' });
    return {
      name: base.id,
      create: groupBody(ids),
      update: groupBody(ids, read.exit),
      expect: {
        grade: line.kind === 'judged' ? line.grade : '',
        r: line.kind === 'judged' ? (line.r ?? null) : null,
      },
    };
  };
  return {
    instruments: [instrumentBody(XYZ_FUT), instrumentBody(XYZ_MINI), instrumentBody(XYZ_CFD)],
    trades: [
      bodyOf(f, XYZ_FUT.name),
      bodyOf(c, XYZ_CFD.name),
      bodyOf(f5, XYZ_FUT.name),
      bodyOf(m5, XYZ_MINI.name),
      bodyOf(c5, XYZ_CFD.name),
    ],
    scenes: [pick(f, [c], '38,440'), pick(f5, [m5, c5], '')],
  };
}

describe('position-groups.json（AC-11）', () => {
  it('画面が作るまとまりの本文と一致する', () => {
    const want = `${JSON.stringify(build(), null, 2)}\n`;
    if (node.env.UPDATE_FIXTURES === '1') fs.writeFileSync(FIXTURE, want);
    expect(fs.readFileSync(FIXTURE, 'utf8')).toBe(want);
  });

  it('H1 の結ぶ本文は本玉 F と決済の代わり C、直す本文は固定の価格 38,440 と成行。H5 は 3 件で上書きは注文の種類だけ', () => {
    const { scenes } = build();
    expect(scenes[0]?.create).toEqual({
      members: [
        { tradeId: 'F', role: 'main' },
        { tradeId: 'C', role: 'hedge' },
      ],
    });
    expect(scenes[0]?.update.exit).toEqual({ price: 38_440, orderType: 'market' });
    expect(scenes[0]?.expect.grade).toBe('safeWin');
    expect(scenes[1]?.create.members.map((m) => m.role)).toEqual(['main', 'main', 'hedge']);
    expect(scenes[1]?.update.exit).toEqual({ orderType: 'market' });
    expect(scenes[1]?.expect.r).toBeCloseTo(400_000 / 450_000, 9);
  });
});
