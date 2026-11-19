// 明細に時間帯の書かれていない時刻を、選んだ時間帯から日本時間に直す純関数（Issue #58 の後半。ui/src/lib/statement-tz.ts）。
// 例 Z1〜Z10 の値はすべて架空。端末の時間帯に依らないことを TZ を替えて確かめる
import { afterEach, describe, expect, it } from 'vitest';
import { toLocalInput } from '../../ui/src/lib/datetime';
import { applyDraft, type Draft, type DraftField, EMPTY_DRAFT } from '../../ui/src/lib/record-form';
import { fillFromRow, markEdited } from '../../ui/src/lib/statement-fill';
import {
  applyZone,
  gapText,
  isTzId,
  jstText,
  MAIN_ZONES,
  OTHER_ZONES,
  otherResultLine,
  readZoneMemory,
  rememberedGapText,
  rememberedText,
  resultText,
  TZ_CHOICES,
  TZ_TEXT,
  type TzId,
  tzFieldsOf,
  unapplyZone,
  wallToEpoch,
  writeZoneMemory,
  writtenLine,
  ZONE_KEY,
} from '../../ui/src/lib/statement-tz';
import { ROW_E1, ROW_E9, unknownTz } from './helpers/statement-rows';

const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process;
const original = proc.env.TZ;
afterEach(() => {
  if (original === undefined) delete proc.env.TZ;
  else proc.env.TZ = original;
});

const OPENED: Draft = applyDraft(EMPTY_DRAFT, {
  type: 'reset',
  values: { instrumentName: '架空指数B', quantity: '1', exitTime: '2026-11-18T14:37' },
});
const NONE = new Set<DraftField>();

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** epoch → その時間帯の壁の時計（「YYYY-MM-DDTHH:MM」。テストの側で Intl から組む） */
function wallText(ms: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(ms));
  const g = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

const okMs = (w: string, id: TzId) => {
  const r = wallToEpoch(w, id);
  return r.kind === 'ok' ? r.ms : r.kind;
};

describe('wallToEpoch（P-58b の例）', () => {
  it.each(['Asia/Tokyo', 'UTC', 'America/New_York'])('端末の時間帯 %s でも同じ epoch', (tz) => {
    proc.env.TZ = tz;
    expect(okMs('2026-11-10T10:30', 'jst')).toBe(Date.UTC(2026, 10, 10, 1, 30));
    expect(okMs('2026-11-10T10:30', 'gmt')).toBe(Date.UTC(2026, 10, 10, 10, 30));
    // Z3: 米国東部の標準時（−5 時間）
    expect(okMs('2026-11-10T10:30', 'us-east')).toBe(Date.UTC(2026, 10, 10, 15, 30));
    // Z4: 米国東部の夏時間（−4 時間）
    expect(okMs('2026-07-10T10:30', 'us-east')).toBe(Date.UTC(2026, 6, 10, 14, 30));
    // Z5: 夏時間の切り替えで存在しない時刻
    expect(okMs('2026-03-08T02:30', 'us-east')).toBe('gap');
    // Z6: 2 回ある時刻は早い方（夏時間 −4 時間）
    expect(okMs('2026-11-01T01:30', 'us-east')).toBe(Date.UTC(2026, 10, 1, 5, 30));
    expect(okMs('2026-02-30T10:00', 'gmt')).toBe('invalid');
    expect(okMs('2026/11/10 10:30', 'gmt')).toBe('invalid');
    // Etc/GMT-N は符号が逆 = UTC+N
    expect(okMs('2026-11-10T10:30', 'utc2')).toBe(Date.UTC(2026, 10, 10, 8, 30));
    expect(okMs('2026-11-10T10:30', 'utc3')).toBe(Date.UTC(2026, 10, 10, 7, 30));
    expect(okMs('2026-11-10T10:30', 'hk-sg')).toBe(Date.UTC(2026, 10, 10, 2, 30));
  });

  it('範囲の外（1970 年より前・2100 年以後）は invalid', () => {
    expect(okMs('1970-01-01T08:59', 'jst')).toBe('invalid');
    expect(okMs('2100-01-01T09:00', 'jst')).toBe('invalid');
  });

  it('性質: 夏時間の無い時間帯は固定のずれ。ok の ms を壁の時計に戻すと書かれた時刻（種つき乱数 300 件）', () => {
    const fixed: [TzId, number][] = [
      ['jst', 9],
      ['gmt', 0],
      ['utc2', 2],
      ['utc3', 3],
      ['hk-sg', 8],
    ];
    const r = rng(58);
    const p = (n: number) => String(n).padStart(2, '0');
    for (let i = 0; i < 300; i++) {
      // 香港は 1979 年まで夏時間があったので 1980 年から。日は 31 まで（暦に無い日は invalid）
      const y = 1980 + Math.floor(r() * 120);
      const mo = 1 + Math.floor(r() * 12);
      const d = 1 + Math.floor(r() * 31);
      const h = Math.floor(r() * 24);
      const mi = Math.floor(r() * 60);
      const w = `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}`;
      for (const [id, off] of fixed) {
        const want = Date.UTC(y, mo - 1, d, h, mi) - off * 3_600_000;
        const got = wallToEpoch(w, id);
        if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) expect(got.kind).toBe('invalid');
        else if (want >= 0 && want < 4_102_444_800_000)
          expect(got).toEqual({ kind: 'ok', ms: want });
        else expect(got.kind).toBe('invalid');
      }
    }
  });

  it('性質: 夏時間のある時間帯でも ok の ms をその時間帯の壁の時計に戻すと書かれた時刻で、2 回ある時刻は早い方。gap は 1 時間前後とも書かれた時刻にならない（種つき乱数 400 件・月末を含む）', () => {
    const r = rng(7);
    const p = (n: number) => String(n).padStart(2, '0');
    for (let i = 0; i < 400; i++) {
      const y = 2000 + Math.floor(r() * 40);
      const mo = 1 + Math.floor(r() * 12);
      const d = 1 + Math.floor(r() * 31);
      const h = Math.floor(r() * 24);
      const mi = Math.floor(r() * 60);
      const w = `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}`;
      const valid = new Date(Date.UTC(y, mo - 1, d)).getUTCDate() === d;
      for (const z of OTHER_ZONES) {
        const got = wallToEpoch(w, z.id);
        if (!valid) {
          expect(got.kind).toBe('invalid');
          continue;
        }
        if (got.kind === 'gap') {
          // 飛びの中: 書かれた時刻を UTC とみなした値の前後 1 日のどの瞬間もその壁の時計にならない（前後のずれ幅で確かめる）
          const asUtc = Date.UTC(y, mo - 1, d, h, mi);
          for (let off = -6; off <= 8; off += 0.5)
            expect(wallText(asUtc - off * 3_600_000, z.zone)).not.toBe(w);
          continue;
        }
        expect(got.kind).toBe('ok');
        if (got.kind !== 'ok') continue;
        expect(wallText(got.ms, z.zone)).toBe(w);
        // 早い方: 1 時間前（2 回ある時刻の 1 回目）は書かれた時刻ではない
        expect(wallText(got.ms - 3_600_000, z.zone)).not.toBe(w);
      }
    }
  });

  it('境目の例（英国・欧州・米国の飛びと 2 回ある時刻・年と月の境目）', () => {
    const jstOf = (w: string, id: TzId) => {
      const g = wallToEpoch(w, id);
      return g.kind === 'ok' ? jstText(g.ms) : g.kind;
    };
    expect(jstOf('2026-03-29T01:30', 'uk')).toBe('gap');
    expect(jstOf('2026-10-25T01:30', 'uk')).toBe('2026/10/25 09:30');
    expect(jstOf('2026-10-25T02:30', 'eu-central')).toBe('2026/10/25 09:30');
    expect(jstOf('2026-03-29T02:30', 'eu-central')).toBe('gap');
    expect(jstOf('2026-03-29T03:30', 'eu-east')).toBe('gap');
    expect(jstOf('2026-03-08T02:00', 'us-central')).toBe('gap');
    expect(jstOf('2026-03-08T03:00', 'us-east')).toBe('2026/03/08 16:00');
    expect(jstOf('2026-11-01T02:00', 'us-east')).toBe('2026/11/01 16:00');
    expect(jstOf('2026-12-31T20:00', 'gmt')).toBe('2027/01/01 05:00');
    expect(jstOf('2026-12-31T23:30', 'us-east')).toBe('2027/01/01 13:30');
    expect(jstOf('2024-02-29T23:00', 'us-east')).toBe('2024/03/01 13:00');
  });
});

describe('表示の文', () => {
  it.each(['Asia/Tokyo', 'America/New_York'])('jstText は端末の時間帯 %s に依らない', (tz) => {
    proc.env.TZ = tz;
    expect(jstText(Date.UTC(2026, 10, 10, 15, 30))).toBe('2026/11/11 00:30');
  });

  it('Z1: 選択肢の横の日本時間と、欄ごとの明細の時刻', () => {
    expect(writtenLine('決済の時刻', '2026-11-10T10:30')).toBe('決済の時刻: 明細 2026/11/10 10:30');
    expect(resultText('2026-11-10T10:30', 'jst')).toBe('2026/11/10 10:30');
    expect(resultText('2026-11-10T10:30', 'gmt')).toBe('2026/11/10 19:30');
    expect(resultText('2026-11-10T10:30', 'us-east')).toBe('2026/11/11 00:30');
    expect(resultText('2026-07-10T10:30', 'us-east')).toBe('2026/07/10 23:30');
    expect(resultText('2026-03-08T02:30', 'us-east')).toBe(TZ_TEXT.gapOption);
    expect(resultText('2026-11-01T01:30', 'us-east')).toBe('2026/11/01 14:30');
    expect(otherResultLine('2026-11-10T10:30', 'us-east')).toBe(
      '米国東部（夏時間あり） → 日本時間 2026/11/11 00:30',
    );
  });

  it('AC-11: 説明は「選んだタイムゾーンから日本時間に直して」を含み、「違えば欄を直します」を含まない', () => {
    expect(TZ_TEXT.lead).toContain('選んだタイムゾーンから日本時間に直して');
    for (const t of [
      TZ_TEXT.lead,
      rememberedText('gmt'),
      rememberedText('jst'),
      gapText('us-east'),
    ])
      expect(t).not.toContain('違えば欄を直します');
  });

  it('Z7: 覚えたタイムゾーンで入れたときの 1 行', () => {
    expect(rememberedText('gmt')).toBe(
      '前に選んだ GMT（+9 時間）で日本時間に直しました。違うときは変更してください。',
    );
    expect(rememberedText('jst')).toBe(
      '前に選んだ日本時間（そのまま）で入力しました。違うときは変更してください。',
    );
  });

  it('文の中の名前: 英字で始まる名前だけ前に空白', () => {
    expect(rememberedText('us-east')).toBe(
      '前に選んだ米国東部（夏時間あり）で日本時間に直しました。違うときは変更してください。',
    );
    expect(gapText('utc2')).toBe(
      '明細の時刻は UTC+2（夏時間なし）では夏時間の切り替えで存在しません。ほかのタイムゾーンを選んでください。',
    );
  });

  it('覚えたタイムゾーンでは存在しない時刻: 「直しました」を言わず、ほかを選ぶよう促す', () => {
    const t = rememberedGapText('us-east');
    expect(t).toBe(
      '前に選んだ米国東部（夏時間あり）では、明細の時刻が夏時間の切り替えで存在しません。ほかのタイムゾーンを選んでください。',
    );
    expect(t).not.toContain('直しました');
  });

  it('一覧: 最初の 2 つは日本時間と GMT、ID は重ならない', () => {
    expect(MAIN_ZONES.map((z) => z.name)).toEqual(['日本時間（そのまま）', 'GMT（+9 時間）']);
    expect(new Set(TZ_CHOICES.map((z) => z.id)).size).toBe(TZ_CHOICES.length);
    expect(OTHER_ZONES.length).toBe(8);
  });
});

describe('applyZone・unapplyZone', () => {
  it.each(['Asia/Tokyo', 'America/New_York'])(
    'Z2: GMT を選ぶと欄に 19:30（日本時間）が端末の時間帯 %s の文字で入り、印は「読み取り」',
    (tz) => {
      proc.env.TZ = tz;
      const f = fillFromRow(OPENED, ROW_E9, NONE);
      expect(tzFieldsOf(f.marks)).toEqual(['exitTime']);
      const a = applyZone(f.draft, f.marks, ROW_E9, 'gmt', ['exitTime']);
      expect(a.draft.exitTime).toBe(toLocalInput(Date.UTC(2026, 10, 10, 10, 30)));
      expect(a.marks.exitTime).toBe('read');
      expect(a.gaps).toEqual([]);
    },
  );

  it('選び直しても前の結果に重ねない（明細の時刻から直す）', () => {
    proc.env.TZ = 'Asia/Tokyo';
    const f = fillFromRow(OPENED, ROW_E9, NONE);
    const g = applyZone(f.draft, f.marks, ROW_E9, 'gmt', ['exitTime']);
    const j = applyZone(g.draft, g.marks, ROW_E9, 'jst', ['exitTime']);
    expect(j.draft.exitTime).toBe('2026-11-10T10:30');
    const g2 = applyZone(j.draft, j.marks, ROW_E9, 'gmt', ['exitTime']);
    expect(g2.draft.exitTime).toBe('2026-11-10T19:30');
  });

  it('Z5: その時間帯に無い時刻の欄は値も印も変えず gaps に出す', () => {
    const row = { ...ROW_E9, exitTime: unknownTz('2026-03-08T02:30') };
    const f = fillFromRow(OPENED, row, NONE);
    const a = applyZone(f.draft, f.marks, row, 'us-east', ['exitTime']);
    expect(a.draft).toBe(f.draft);
    expect(a.marks.exitTime).toBe('tz');
    expect(a.gaps).toEqual(['exitTime']);
  });

  it('KEEP-6: 利用者が直した欄（修正済み）は書き換えない。エントリーの時刻も時間帯が無ければ直す', () => {
    proc.env.TZ = 'Asia/Tokyo';
    const row = {
      ...ROW_E1,
      entryTime: unknownTz('2026-11-10T09:05'),
      exitTime: unknownTz('2026-11-10T10:30'),
      timeZoneNeedsCheck: true,
    };
    const f = fillFromRow(OPENED, row, NONE);
    expect(tzFieldsOf(f.marks)).toEqual(['entryTime', 'exitTime']);
    const edited = markEdited(f.marks, 'exitTime');
    const a = applyZone({ ...f.draft, exitTime: '2026-11-10T11:00' }, edited, row, 'gmt', [
      'entryTime',
      'exitTime',
    ]);
    expect(a.draft.exitTime).toBe('2026-11-10T11:00');
    expect(a.marks.exitTime).toBe('edited');
    expect(a.draft.entryTime).toBe('2026-11-10T18:05');
    expect(a.marks.entryTime).toBe('read');
  });

  it('unapplyZone: 選んだタイムゾーンで入れた欄だけを明細の時刻と印 tz に戻す', () => {
    proc.env.TZ = 'Asia/Tokyo';
    const f = fillFromRow(OPENED, ROW_E9, NONE);
    const g = applyZone(f.draft, f.marks, ROW_E9, 'gmt', ['exitTime']);
    const u = unapplyZone(g.draft, g.marks, ROW_E9, ['exitTime']);
    expect(u.draft.exitTime).toBe('2026-11-10T10:30');
    expect(u.marks.exitTime).toBe('tz');
    const e = markEdited(g.marks, 'exitTime');
    expect(unapplyZone(g.draft, e, ROW_E9, ['exitTime']).marks.exitTime).toBe('edited');
  });
});

describe('端末に覚える（KEEP-7・AC-10）', () => {
  const mem = () => {
    const data = new Map<string, string>();
    const sets: [string, string][] = [];
    return {
      data,
      sets,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        sets.push([k, v]);
        data.set(k, v);
      },
    };
  };

  it('書くのは鍵 1 つと一覧の ID だけ。読みは一覧の ID だけを返す', () => {
    const s = mem();
    expect(writeZoneMemory(s, 'gmt')).toBe(true);
    expect(s.sets).toEqual([[ZONE_KEY, 'gmt']]);
    expect(ZONE_KEY).toBe('loss-note.statementTimeZone');
    expect(readZoneMemory(s)).toBe('gmt');
  });

  it('Z10: 知らない名前・例外・保存先なしは null', () => {
    const s = mem();
    s.data.set(ZONE_KEY, 'Mars/Base');
    expect(readZoneMemory(s)).toBeNull();
    const throws = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readZoneMemory(throws)).toBeNull();
    expect(writeZoneMemory(throws, 'gmt')).toBe(false);
    expect(readZoneMemory(null)).toBeNull();
    expect(writeZoneMemory(null, 'gmt')).toBe(false);
    expect(isTzId('America/New_York')).toBe(false);
  });
});
