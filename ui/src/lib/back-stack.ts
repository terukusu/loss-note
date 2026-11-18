// 戻る（Android のバックキー・ブラウザの戻る・iPhone の左端スワイプ）で、開いている層（「i」の吹き出しなど）を一番上から
// 1 つ閉じる規則（Issue #57。option-simulator の戻るのスタックと同じ規則）。純関数（DOM・history・時刻に触らない）。
// 糊（back-layers.ts）が出来事を流し、効果を実行する:
// - push: 履歴に 1 段積む（URL は変えない。history.state.back = 自分が積んだ段の数）
// - go: history.go(n)（UI で閉じた層の段を戻して数を合わせる。その popstate では何も閉じない）
// - close: 層の閉じ方（Esc と同じ）を上から順に呼ぶ
// 開く・閉じるは層の一覧だけを変え、履歴の操作は後始末（settle）でまとめて差し引きする（同じ操作の中の「閉じて開く」は
// 何もしない）。go の popstate を待つ間（awaiting）は push を保留する（go が新しく積んだ段から戻るのを防ぐ）。
// 層にするのは「i」の吹き出し（と後の説明カード・確かめ）だけ。折りたたみ・その場の欄・トーストは層にしない

export interface BackLayer {
  readonly id: string;
  /** 履歴に 1 段積む層か（利用者の操作の中で開いた・pushState に失敗していない） */
  readonly entry: boolean;
}

export interface BackState {
  readonly layers: readonly BackLayer[];
  /** 今の履歴の項目の back（自分が積んだ段の数） */
  readonly hist: number;
  /** 自分の go が着く先の back（その popstate を待っている間。無ければ null） */
  readonly awaiting: number | null;
}

export type BackEvent =
  | { readonly type: 'open'; readonly id: string; readonly activation: boolean }
  | { readonly type: 'close'; readonly id: string }
  | { readonly type: 'settle' }
  | { readonly type: 'popstate'; readonly back: number }
  | { readonly type: 'pushFailed'; readonly back: number }
  | { readonly type: 'unstick' };

export type BackEffect =
  | { readonly kind: 'push'; readonly back: number }
  | { readonly kind: 'go'; readonly n: number }
  | { readonly kind: 'close'; readonly ids: readonly string[] };

export interface BackResult {
  readonly state: BackState;
  readonly effects: readonly BackEffect[];
}

export const BACK_INITIAL: BackState = { layers: [], hist: 0, awaiting: null };

/** 履歴に積むべき段の数（entry の層の数） */
export function backTarget(s: BackState): number {
  let n = 0;
  for (const l of s.layers) if (l.entry) n++;
  return n;
}

/** 一番上の層の id（無ければ null） */
export function backTop(s: BackState): string | null {
  return s.layers.at(-1)?.id ?? null;
}

/** history.state から back を読む（無い・壊れた値は 0。画面の行き来の項目は state を持たない） */
export function backOf(state: unknown): number {
  const raw =
    typeof state === 'object' && state !== null ? (state as { back?: unknown }).back : undefined;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

const none = (state: BackState): BackResult => ({ state, effects: [] });

function settle(s: BackState): BackResult {
  if (s.awaiting !== null) return none(s);
  const t = backTarget(s);
  if (t > s.hist) {
    const effects: BackEffect[] = [];
    for (let b = s.hist + 1; b <= t; b++) effects.push({ kind: 'push', back: b });
    return { state: { ...s, hist: t }, effects };
  }
  if (t < s.hist) {
    return { state: { ...s, hist: t, awaiting: t }, effects: [{ kind: 'go', n: t - s.hist }] };
  }
  return none(s);
}

/** 利用者が履歴を back へ動かした（戻る / 進む・再読み込みの後の古い項目） */
function userMove(s: BackState, want: number): BackResult {
  if (want < s.hist) {
    // 上から entry の層を hist − want 個（その上の積まない層も一緒に）外す
    let drop = s.hist - want;
    const layers = [...s.layers];
    const ids: string[] = [];
    while (drop > 0 && layers.length > 0) {
      const l = layers.pop() as BackLayer;
      ids.push(l.id);
      if (l.entry) drop--;
    }
    return {
      state: { layers, hist: want, awaiting: null },
      effects: ids.length > 0 ? [{ kind: 'close', ids }] : [],
    };
  }
  if (want > s.hist) {
    // 進む・古い項目: 何も開かず、いた所へ戻す
    return { state: { ...s, awaiting: s.hist }, effects: [{ kind: 'go', n: s.hist - want }] };
  }
  return none(s);
}

export function backReduce(s: BackState, e: BackEvent): BackResult {
  switch (e.type) {
    case 'open':
      if (s.layers.some((l) => l.id === e.id)) return none(s);
      return none({ ...s, layers: [...s.layers, { id: e.id, entry: e.activation }] });
    case 'close':
      if (!s.layers.some((l) => l.id === e.id)) return none(s);
      return none({ ...s, layers: s.layers.filter((l) => l.id !== e.id) });
    case 'settle':
      return settle(s);
    case 'popstate':
      if (s.awaiting !== null && e.back === s.awaiting) return settle({ ...s, awaiting: null });
      return userMove({ ...s, awaiting: null }, e.back);
    case 'pushFailed': {
      // 下から数えて back 番目以降の entry の層を積まない層にする
      let k = 0;
      const layers = s.layers.map((l) => {
        if (!l.entry) return l;
        k++;
        return k >= e.back ? { id: l.id, entry: false } : l;
      });
      return none({ ...s, layers, hist: Math.max(0, e.back - 1) });
    }
    case 'unstick':
      return settle({ ...s, awaiting: null });
  }
}
