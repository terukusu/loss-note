// ログインの打ち切り（ADR-0003 の決定 8）。純関数: firebase を読み込まない。
// エミュレーターが止まっていると SDK のポップアップのログインは失敗を返さずに待ち続けるので、
// ログインの操作（op）と並行して接続先に届くか（probe）を確かめ、届かなければ network-request-failed で打ち切る。
// 届くなら操作の結果（成功・失敗）をそのまま返す

/** SDK の失敗と同じ形（code を持つ）にして、画面の文言の対応（errors.ts）に乗せる */
export function networkError(): Error & { code: string } {
  return Object.assign(new Error('ログインのサービスに届きません'), {
    code: 'auth/network-request-failed',
  });
}

export function raceUnreachable<T>(op: Promise<T>, probe: () => Promise<boolean>): Promise<T> {
  // 打ち切った後に操作が失敗しても（利用者がポップアップを閉じるなど）、拾われない失敗にしない
  op.catch(() => {});
  const unreachable = probe().then(
    (ok) => (ok ? new Promise<never>(() => {}) : Promise.reject(networkError())),
    () => Promise.reject(networkError()),
  );
  return Promise.race([op, unreachable]);
}

/** 接続先に届くか（応答の中身は見ない。届かない・timeoutMs で応答が無ければ false） */
export async function reachable(
  url: string,
  fetchFn: (input: string, init?: RequestInit) => Promise<unknown> = (i, n) => fetch(i, n),
  timeoutMs = 5000,
): Promise<boolean> {
  try {
    await fetchFn(`${url}/`, { mode: 'no-cors', signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}
