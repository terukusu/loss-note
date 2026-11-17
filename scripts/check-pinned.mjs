// 画面の直接の依存（package.json の dependencies / devDependencies）が正確な版（x.y.z）だけで書かれているかを検査する。
// 範囲指定（^・~・x・*・>= など）があれば 1 で終わる。版の固定は lock（package-lock.json）と合わせて守る
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const exact = /^\d+\.\d+\.\d+$/;
const bad = [];
for (const field of ['dependencies', 'devDependencies']) {
  for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
    if (!exact.test(spec)) bad.push(`${field}: ${name}@${spec}`);
  }
}
if (bad.length > 0) {
  console.error(`正確な版（x.y.z）でない直接の依存が ${bad.length} 件あります:`);
  for (const b of bad) console.error(`  ${b}`);
  process.exit(1);
}
console.log('ok: 直接の依存はすべて正確な版です');
