// 使えないアカウントの旗（Issue #43 R6）。/api/* が 403（許可リストに無い）を返したら立て、アプリの殻が
// 「このアカウントでは使えません」の画面に差し替える。DOM なし・記憶の中だけ（再読み込みで消え、次の 403 でまた立つ）。
// 守りは API の許可リスト（画面の旗は見た目。ADR-0003 決定 6）
//
// 旗には世代がある。ログイン・ログアウトのたびに下ろして世代を進め、要求を送った時点の世代と違う 403
// （前のアカウントで送った要求の、遅れて届いた応答）では立てない（次のアカウントに「使えません」を出さない）
import type { AuthState } from './gate';

export interface ForbiddenFlag {
  /** 今の世代（要求を送る前に控える） */
  generation(): number;
  /** 403 を受けた。控えた世代が今と同じときだけ立てる（知らせるのは変わったときだけ） */
  markFrom(generation: number): void;
  /** 下ろして世代を進める（ログイン・ログアウトのとき） */
  reset(): void;
  isSet(): boolean;
  /** 変わったときに今の値を知らせる（すぐに今の値を 1 回知らせる）。やめる関数を返す */
  subscribe(fn: (set: boolean) => void): () => void;
}

export function createForbiddenFlag(): ForbiddenFlag {
  let set = false;
  let gen = 0;
  const listeners = new Set<(set: boolean) => void>();
  const change = (next: boolean) => {
    if (set === next) return;
    set = next;
    for (const fn of [...listeners]) fn(set);
  };
  return {
    generation: () => gen,
    markFrom(g) {
      if (g === gen) change(true);
    },
    reset() {
      gen += 1;
      change(false);
    },
    isSet: () => set,
    subscribe(fn) {
      listeners.add(fn);
      fn(set);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/**
 * アプリの殻の配線（認証の状態が変わったとき）: ログアウトしたら旗を下ろす。ログインしたら旗を下ろしてから
 * 1 度だけ確かめの要求を送る（ホームは /api を読まないので、使えないアカウントなら 403 ですぐ旗が立つ）
 */
export function onAuthKind(
  kind: AuthState['kind'],
  flag: ForbiddenFlag,
  probe: () => Promise<unknown>,
): void {
  if (kind === 'signedOut') flag.reset();
  if (kind === 'signedIn') {
    flag.reset();
    void probe().catch(() => {});
  }
}
