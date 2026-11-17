// datetime-local の文字列（YYYY-MM-DDTHH:mm[:ss]）⇔ エポックからのミリ秒（端末の時間帯。Issue #13）。
// 範囲は API と同じ（1970-01-01 から 2100-01-01 の前まで）
const MAX_TIME_MS = 4_102_444_800_000;

const pad = (n: number) => String(n).padStart(2, '0');

export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 読めない・存在しない日時・範囲外は undefined */
export function fromLocalInput(s: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return undefined;
  const [y = 0, mo = 0, d = 0, h = 0, mi = 0, sec = 0] = m.slice(1).map((x) => Number(x ?? 0));
  const date = new Date(y, mo - 1, d, h, mi, sec);
  // 2 月 30 日などの繰り上がりと、夏時間で存在しない時刻を受けない
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== mi
  ) {
    return undefined;
  }
  const t = date.getTime();
  return t >= 0 && t < MAX_TIME_MS ? t : undefined;
}

/** 分に切る（端末の時間帯。秒・ミリ秒を落とす） */
export function floorToMinute(ms: number): number {
  const d = new Date(ms);
  d.setSeconds(0, 0);
  return d.getTime();
}

/** 日時の表示（資金の履歴など。端末の時間帯。例: 2026/11/18 09:30。Issue #5） */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
