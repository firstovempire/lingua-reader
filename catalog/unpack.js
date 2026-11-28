// Раскладывает книги каталога по файлам: catalog/books/<id>/… — читалка грузит только открытую главу,
// остальное докачивает фоном. Рядом кладёт files.json — список всех файлов книги для фоновой загрузки.
// Запуск: node catalog/unpack.js (после добавления или замены EPUB в каталоге).
const fs = require('fs'), path = require('path');
const JSZip = require('../lib/jszip.min.js');
const DIR = __dirname, OUT = path.join(DIR, 'books');
const list = JSON.parse(fs.readFileSync(path.join(DIR, 'catalog.json'), 'utf8'));
(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  let total = 0;
  for (const b of list) {
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(DIR, b.id + '.epub')));
    const names = Object.keys(zip.files).filter(n => !zip.files[n].dir && n !== 'mimetype').sort();
    let bytes = 0;
    for (const n of names) {
      if (n.includes('..') || path.isAbsolute(n)) throw new Error('странный путь в ' + b.id + ': ' + n);
      const buf = await zip.files[n].async('nodebuffer'); bytes += buf.length;
      const to = path.join(OUT, b.id, n); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, buf);
    }
    fs.writeFileSync(path.join(OUT, b.id, 'files.json'), JSON.stringify({ files: names, bytes }) + '\n');
    total += bytes; console.log((bytes / 1e6).toFixed(1) + ' МБ', names.length, b.id);
  }
  console.log('всего', (total / 1e6).toFixed(1), 'МБ');
})();
