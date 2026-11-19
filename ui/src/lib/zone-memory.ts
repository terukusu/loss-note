// 明細の時刻の時間帯を端末に覚える窓口（Issue #58 の後半）。記録する画面の controller に渡す。
// 端末に書くのは時間帯の一覧の ID だけ（鍵 loss-note.statementTimeZone。statement-tz.ts の readZoneMemory /
// writeZoneMemory）。記録の値・明細の値・画像は書かない（記録の画面のソースは端末の保存先に触れない = #13 AC-11 のまま）。
// 保存先が使えない端末（プライベートブラウズなど）では覚えない（その場では当てる）
import type { ZoneMemory } from './record-controller';
import { readZoneMemory, writeZoneMemory } from './statement-tz';
import { safeStorage } from './theme';

export function deviceZoneMemory(): ZoneMemory {
  const storage = () => safeStorage(() => window.localStorage);
  return {
    read: () => readZoneMemory(storage()),
    write: (id) => {
      writeZoneMemory(storage(), id);
    },
  };
}
