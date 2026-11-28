// Статистика книг каталога: какая доля текста — частые слова и сколько в книге редких слов.
// Частые слова считаются по самому каталогу: слово частое, если встречается во многих книгах.
// Запуск: node catalog/stats.js — дописывает поля common (% текста) и rare (редких слов) в catalog.json.
const fs = require('fs'), path = require('path');
const JSZip = require('../lib/jszip.min.js');
const DIR = __dirname, TOP = 2000;
const list = JSON.parse(fs.readFileSync(path.join(DIR, 'catalog.json'), 'utf8'));
// грубая основа слова: walked, walking, walks → walk; stories → story
const stem = w => {
  const k = w.replace(/'s$/, ''); if (k.length < 5) return k;
  if (/[^aeiou]ies$/.test(k)) return k.slice(0, -3) + 'y';
  const m = /^(.+?)(ing|ed|es|s)$/.exec(k); // основа не короче 4 букв: thing, speed, need остаются как есть
  return m && m[1].length >= 4 && !/ss$/.test(k) && !/eed$/.test(k) ? m[1] : k;
};
const SKIP = /(toc|nav|titlepage|imprint|colophon|uncopyright|halftitle|loi|endnotes|copyright|dedication)\.x?html$/i;

async function bookTokens(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const out = [];
  for (const name of Object.keys(zip.files).filter(n => /\.x?html?$/i.test(n) && !SKIP.test(n)).sort()) {
    const html = await zip.files[name].async('string');
    const text = html.replace(/<head[\s\S]*?<\/head>/i, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;|&#\d+;/gi, ' ').replace(/’/g, "'");
    for (const m of text.matchAll(/[A-Za-z]+(?:'[a-z]+)?/g)) out.push(m[0]);
  }
  return out;
}
(async () => {
  const books = {};
  for (const b of list) books[b.id] = await bookTokens(path.join(DIR, b.id + '.epub'));
  // имена собственные: почти всегда с заглавной буквы — их не считаем ни частыми, ни редкими
  const cap = new Map(), all = new Map();
  for (const t of Object.values(books)) for (const w of t) { const k = w.toLowerCase(); all.set(k, (all.get(k) || 0) + 1); if (w[0] !== k[0]) cap.set(k, (cap.get(k) || 0) + 1); }
  const proper = k => (cap.get(k) || 0) / all.get(k) > 0.8;
  // частые: в скольких книгах встречается, при равенстве — сколько раз всего
  const df = new Map();
  for (const t of Object.values(books)) for (const k of new Set(t.map(w => w.toLowerCase()).filter(k => !proper(k)).map(stem))) df.set(k, (df.get(k) || 0) + 1);
  const common = new Set([...df.keys()].sort((a, b) => df.get(b) - df.get(a) || (all.get(b) || 0) - (all.get(a) || 0)).slice(0, TOP));
  for (const b of list) {
    let n = 0, c = 0; const rare = new Set();
    for (const w of books[b.id]) { const k = w.toLowerCase(); if (proper(k)) continue; n++; const st = stem(k); if (common.has(st)) c++; else rare.add(st); }
    // common — % текста из 2000 частых слов, rare — сколько в книге разных редких слов
    b.common = n ? Math.round(c / n * 100) : 0; b.rare = rare.size; delete b.perPage;
    console.log(b.level, b.common + '%', b.rare, b.id);
  }
  fs.writeFileSync(path.join(DIR, 'catalog.json'), JSON.stringify(list, null, 1).replace(/^ +/gm, '') + '\n'); // тот же вид, что у build.py
})();
