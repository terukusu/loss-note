// ログインの門（Issue #3 R5・契約 C-7）。純関数: 認証の状態と画面から、何を描くか・どこへ置き換えるかを決める。
// ログインしていなければ、ログイン画面以外の中身を出さず /login?next=<開こうとした画面> へ置き換える。
// 状態が分かるまで（unknown）は中身もログイン画面も出さない（再読み込みでログイン画面がちらつかない）。
//
// この門は画面の振る舞い（中身を描かない・ログイン画面へ導く）であって、守りではない。画面のコードは公開で、
// 門はブラウザの開発ツールで外せる。記録を守る本体は API での ID トークンの検証と uid での絞り込み（#4。ADR-0003）
// ログイン済みでも /api/* が 403（使える利用者の許可リストに無い。#43）を返したら、どの画面でも中身を描かず
// 「このアカウントでは使えません」を出す（forbidden。URL は置き換えない）。守りは API の許可リスト
import { hrefOf, type Route, type RouteOptions, safeNext } from '../lib/routes';

export type AuthState =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'signedOut' }
  | { readonly kind: 'signedIn' };

export interface GateResult {
  readonly render: 'loading' | 'login' | 'page' | 'forbidden';
  /** 履歴を置き換える先（戻るで中身の画面に戻らない） */
  readonly replace?: string;
}

export function gate(
  auth: AuthState,
  route: Route,
  pathname: string,
  search: string,
  opts: RouteOptions,
  forbidden = false,
): GateResult {
  if (auth.kind === 'unknown') return { render: 'loading' };
  if (auth.kind === 'signedOut') {
    if (route.name === 'login') return { render: 'login' };
    const here = `${pathname}${search}`;
    return {
      render: 'loading',
      replace: here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`,
    };
  }
  if (forbidden) return { render: 'forbidden' };
  if (route.name === 'login') {
    const next = new URLSearchParams(search).get('next');
    return { render: 'loading', replace: hrefOf(safeNext(next, opts)) };
  }
  return { render: 'page' };
}
