// 取引の詳細のレッグの表（#117。設計書 7.6「列の幅が 720px 未満は 2 行のカードの並び。720px 以上は 1 行の表:
// 限月 / P・C / 行使価格 / 売買 / 枚数 / イン / 決済 / 損益。窓ではなく列の幅のコンテナクエリ」）。hook を持たない。
// 同じ行を 2 つの見せ方で持ち、CSS のコンテナクエリ（styles/legs.css）がどちらかを見せる。損益の数字に色は付けない（C34）
import type { LegRowView } from '../lib/option-view';
import '../styles/legs.css';

export const LEG_TABLE_TITLE_ID = 'detail-legs-title';

export function LegTable({ rows }: { readonly rows: readonly LegRowView[] }) {
  return (
    <section class="card section legtable" aria-labelledby={LEG_TABLE_TITLE_ID}>
      <h2 class="section__title" id={LEG_TABLE_TITLE_ID}>
        レッグ
      </h2>
      <div class="legtable__box">
        {/* 狭い列: 2 行のカード */}
        <ul class="legtable__cards">
          {rows.map((r) => (
            <li key={r.id} class="legtable__card">
              <span class="legtable__head">{r.head}</span>
              <span class="legtable__sub">
                <span>{r.prices}</span>
                <span class="num legtable__pnl">{r.pnl}</span>
              </span>
            </li>
          ))}
        </ul>
        {/* 広い列: 1 行の表 */}
        <table class="legtable__table">
          <thead>
            <tr>
              <th scope="col">限月</th>
              <th scope="col">P / C</th>
              <th scope="col" class="num">
                行使価格
              </th>
              <th scope="col">売買</th>
              <th scope="col" class="num">
                枚数
              </th>
              <th scope="col" class="num">
                イン
              </th>
              <th scope="col" class="num">
                決済
              </th>
              <th scope="col" class="num">
                損益
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.contractMonth}</td>
                <td>{r.optionType}</td>
                <td class="num">{r.strike}</td>
                <td>{r.side}</td>
                <td class="num">{r.quantity}</td>
                <td class="num">{r.entry}</td>
                <td class="num">
                  {r.exit}
                  {r.expired ? <span class="legtable__expired"> 満期で消滅</span> : null}
                </td>
                <td class="num">{r.pnl}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
