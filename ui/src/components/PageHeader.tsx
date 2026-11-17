// 画面の見出し。h1 は画面が変わったときにフォーカスを受ける（tabindex=-1。読み上げで迷わない）
import type { ComponentChildren } from 'preact';

export interface PageHeaderProps {
  readonly title: string;
  readonly eyebrow?: string;
  readonly description?: ComponentChildren;
  readonly actions?: ComponentChildren;
}

export function PageHeader(p: PageHeaderProps) {
  return (
    <header class="pagehead">
      <div class="pagehead__text">
        {p.eyebrow ? <p class="pagehead__eyebrow">{p.eyebrow}</p> : null}
        <h1 class="pagehead__title" tabIndex={-1}>
          {p.title}
        </h1>
        {p.description ? <p class="pagehead__desc">{p.description}</p> : null}
      </div>
      {p.actions ? <div class="pagehead__actions">{p.actions}</div> : null}
    </header>
  );
}
