// 書き出したファイルを端末に保存する薄い層（#167・ADR-0025）。画面のソースで object URL を作ってよい唯一のファイル。
// - 書き出しの API は ID トークンの要る fetch で取る（ブラウザの遷移では ID トークンを送れない）。取った文字を Blob にし、
//   object URL を a[download] で開いてブラウザのダウンロードに渡す。ダウンロードの遷移は CSP の img-src・connect-src の
//   対象ではないので、本番の CSP を広げない（画像のプレビューは今までどおり canvas。#15 の AC-13）
// - 文字の Blob（JSON・CSV）だけを受ける。img・iframe の src に使わない。押した後に URL を取り消す
import { EXPORT_MIME, type SavedFile } from './export-data';

/** 取り消すまでの時間（クリックの直後に取り消すと、ブラウザによってはダウンロードが始まらない） */
const REVOKE_AFTER_MS = 10_000;

export function saveTextFile(file: SavedFile): void {
  const blob = new Blob([file.text], { type: EXPORT_MIME[file.kind] });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  a.hidden = true;
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
}
