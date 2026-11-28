// Быстрые проверки без браузера: запускаются перед каждой выкладкой (GitHub Actions) и командой `npm run check`.
// Ловят ошибки, из-за которых сайт уже ломался: синтаксис, расхождение сайта и базы, забытая версия кэша.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let bad = 0;
const fail = m => { console.error('✗ ' + m); bad++; };
const ok = m => console.log('✓ ' + m);

// 1. синтаксис
for (const f of ['app.js', 'sw.js', 'config.js']) {
  try { new Function(read(f)); ok('синтаксис ' + f); } catch (e) { fail('синтаксис ' + f + ': ' + e.message); }
}

const app = read('app.js'), sw = read('sw.js'), schema = read('supabase/schema.sql');

// 2. виды данных сайта есть в проверке базы (иначе сервер отклоняет синхронизацию — так было в ноябре 2026)
const karr = (app.match(/const KARR = \{([^}]*)\}/) || [])[1] || '';
const kinds = [...karr.matchAll(/(\w+)\s*:/g)].map(m => m[1]).concat('set');
const checks = [...schema.matchAll(/check \(kind in \(([^)]*)\)\)/g)].map(m => m[1]);
if (kinds.length < 2) fail('не нашёл KARR в app.js');
if (!checks.length) fail('не нашёл check (kind in …) в schema.sql');
for (const list of checks) {
  const allowed = [...list.matchAll(/'(\w+)'/g)].map(m => m[1]);
  const miss = kinds.filter(k => !allowed.includes(k));
  if (miss.length) fail('schema.sql не разрешает виды: ' + miss.join(', ') + ' (строка: ' + list + ')');
}
if (checks.length) ok('виды данных совпадают с базой: ' + kinds.join(', '));
const snapLine = (app.match(/const EMPTY_SNAP = .*/) || [''])[0];
for (const k of kinds) if (!snapLine.includes(' ' + k + ': {}')) fail('вид ' + k + ' нет в EMPTY_SNAP');

// 3. версия в профиле совпадает с версией кэша
const ver = (app.match(/const VER = (\d+)/) || [])[1], cache = (sw.match(/lingua-v(\d+)/) || [])[1];
if (!ver || ver !== cache) fail('VER в app.js (' + ver + ') не совпадает с lingua-v' + cache + ' в sw.js'); else ok('версия ' + ver);

// 4. файлы оболочки существуют
const shell = JSON.parse((sw.match(/const SHELL = (\[[^\]]*\])/) || [])[1].replace(/'/g, '"'));
for (const f of shell) if (f !== './' && !fs.existsSync(path.join(root, f))) fail('в SHELL есть несуществующий файл ' + f);
ok('файлы оболочки на месте');

// 5. пути только относительные (сайт живёт ещё и в подпапке GitHub Pages)
const html = read('index.html');
const abs = [...html.matchAll(/(?:src|href)="(\/[^/"][^"]*)"/g)].map(m => m[1]);
if (abs.length) fail('абсолютные пути в index.html: ' + abs.join(', ')); else ok('пути относительные');

// 6. в репозиторий не попали секреты
for (const f of ['app.js', 'config.js', 'index.html', 'sw.js']) {
  const t = read(f);
  if (/AIza[0-9A-Za-z_-]{30,}/.test(t)) fail('похоже на ключ Google в ' + f);
  if (/service_role|sb_secret_/i.test(t) && f === 'config.js') fail('секретный ключ Supabase в ' + f);
}
ok('секретов не видно');

if (bad) { console.error('\nПроверок не прошло: ' + bad); process.exit(1); }
console.log('\nВсе проверки прошли');
