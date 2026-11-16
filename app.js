/* Lingua Reader — шаг 1 (локальный режим)
   Читалка EPUB: тап по слову → перевод с контекстом (Gemini), фраза двумя тапами,
   листание тапом по краям и свайпом, шторка перевода, Aa, оглавление, закладки,
   цитаты и заметки, поиск по книге, слова по книгам. Всё хранится в этом браузере. */
(() => {
'use strict';

/* ================= утилиты ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const P = {
  back: '<path d="m15 18-6-6 6-6"/>', chev: '<path d="m9 6 6 6-6 6"/>', up: '<path d="m6 15 6-6 6 6"/>',
  speak: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  quote: '<path d="M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6"/>', note: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  mark: '<path d="M6 3h12v18l-6-4-6 4z"/>', check: '<path d="m5 12 5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', ext: '<path d="M7 17 17 7M9 7h8v8"/>',
  flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.6 1 2.6 2 3 0-3 .5-5.5 1-8.5z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'
};
const ico = (n, size = 22, extra = '') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true'); s.style.cssText = `width:${size}px;height:${size}px;${extra}`; s.innerHTML = P[n]; return s; };
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Память браузера переполнена'); } }
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
let toastT; function toast(m, ms = 2400) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => t.style.display = 'none', ms); }
const buzz = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
const isDesk = () => matchMedia('(min-width:900px)').matches;
function speak(text) { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 0.9; const v = speechSynthesis.getVoices().find(v => /^en(-|_)US/i.test(v.lang)); if (v) u.voice = v; speechSynthesis.speak(u); } catch (e) {} }

/* ================= облако ================= */
const CFG = window.LR_CONFIG || {};
const CLOUD = !!(CFG.SUPABASE_URL && CFG.SUPABASE_KEY && window.supabase);
const sb = CLOUD ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } }) : null;
let user = null, keyLast4 = '', lastRegion = '', lastModel = '', loggedFor = '';
const REGION_NAMES = { 'eu-west-3': 'Париж', 'eu-central-1': 'Франкфурт', 'eu-west-1': 'Ирландия', 'eu-west-2': 'Лондон' };

/* ================= данные ================= */
const DEF = { level: '', font: 'lit', size: 19, lh: 'm', margin: 'm', theme: 'paper', model: 'gemini-3.5-flash-lite', revDir: 'en', sound: true, goal: 10 };
let S = Object.assign({}, DEF, LS.get('lr_s', {}));
const fixModel = () => { if (!S.model || /^gemini-(2\.5|3\.8)-flash$/.test(S.model)) S.model = DEF.model; };
fixModel();
const saveS = () => { LS.set('lr_s', S); schedule(); };
let books = LS.get('lr_books', []);
let words = LS.get('lr_words', []);
let notes = LS.get('lr_notes', []);
let marks = LS.get('lr_marks', []);
const DEV = LS.get('lr_dev', '') || (() => { const d = uid().slice(-6); LS.set('lr_dev', d); return d; })();
let days = LS.get('lr_days', []);
const saveDays = () => { LS.set('lr_days', days); schedule(); };
const cache = LS.get('lr_cache', {});
const saveBooks = () => { LS.set('lr_books', books); schedule(); }, saveWords = () => { LS.set('lr_words', words); schedule(); }, saveNotes = () => { LS.set('lr_notes', notes); schedule(); }, saveMarks = () => { LS.set('lr_marks', marks); schedule(); };
const getKey = () => CLOUD ? (keyLast4 ? '••••' + keyLast4 : '') : LS.get('lr_key', '');

const DAY = 86400000;
/* --- синхронизация: локально сразу, на сервер с задержкой; сервер — главный --- */
const EMPTY_SNAP = () => ({ book: {}, word: {}, note: {}, mark: {}, day: {}, set: {} });
let snap = LS.get('lr_snap', null) || EMPTY_SNAP(); if (!snap.day) snap.day = {};
let queue = LS.get('lr_queue', {});
let syncT = null, syncing = false;
const KARR = { book: () => books, word: () => words, note: () => notes, mark: () => marks, day: () => days };
function diffAll() {
  for (const k of Object.keys(KARR)) {
    const seen = new Set();
    for (const o of KARR[k]()) { if (!o || !o.id) continue; seen.add(o.id); const j = JSON.stringify(o); if (snap[k][o.id] !== j) { snap[k][o.id] = j; queue[k + '|' + o.id] = { kind: k, id: o.id, data: o }; } }
    for (const id of Object.keys(snap[k])) if (!seen.has(id)) { delete snap[k][id]; queue[k + '|' + id] = { kind: k, id, data: null }; }
  }
  const js = JSON.stringify(S); if (snap.set.S !== js) { snap.set.S = js; queue['set|S'] = { kind: 'set', id: 'S', data: S }; }
}
function schedule() { if (!CLOUD || !user) return; diffAll(); LS.set('lr_snap', snap); LS.set('lr_queue', queue); clearTimeout(syncT); syncT = setTimeout(flush, 1200); }
async function flush() {
  if (!CLOUD || !user || syncing) return;
  const items = Object.entries(queue); if (!items.length) return;
  syncing = true;
  try {
    const now = new Date().toISOString();
    const rows = items.map(([, it]) => ({ kind: it.kind, id: it.id, data: it.data ? JSON.parse(JSON.stringify(it.data)) : {}, deleted: !it.data, updated_at: now }));
    for (let i = 0; i < rows.length; i += 200) { const r = await sb.from('items').upsert(rows.slice(i, i + 200), { onConflict: 'user_id,kind,id' }); if (r.error) throw r.error; }
    for (const [k, it] of items) if (queue[k] === it) delete queue[k];
    LS.set('lr_queue', queue);
  } catch (e) { console.warn('sync failed', e); clearTimeout(syncT); syncT = setTimeout(flush, 15000); }
  finally { syncing = false; }
}
async function pull() {
  await flush();
  const all = [];
  for (let from = 0; ; from += 1000) { const r = await sb.from('items').select('kind,id,data,deleted').order('kind').order('id').range(from, from + 999); if (r.error) throw r.error; all.push(...r.data); if (r.data.length < 1000) break; }
  const by = { book: [], word: [], note: [], mark: [], day: [] }; let set = null;
  for (const row of all) { if (row.deleted) continue; if (row.kind === 'set') set = row.data; else if (by[row.kind]) by[row.kind].push(row.data); }
  for (const it of Object.values(queue)) { if (it.kind === 'set') continue; const arr = by[it.kind]; const i = arr.findIndex(x => x.id === it.id); if (it.data) { if (i >= 0) arr[i] = it.data; else arr.push(it.data); } else if (i >= 0) arr.splice(i, 1); }
  const byT = (a, b) => (b.t || b.added || 0) - (a.t || a.added || 0);
  books = by.book.sort(byT); words = by.word.sort(byT); notes = by.note.sort(byT); marks = by.mark.sort(byT); days = by.day;
  if (set && !queue['set|S']) { S = Object.assign({}, DEF, set); fixModel(); }
  LS.set('lr_books', books); LS.set('lr_words', words); LS.set('lr_notes', notes); LS.set('lr_marks', marks); LS.set('lr_days', days); LS.set('lr_s', S);
  snap = EMPTY_SNAP();
  for (const k of Object.keys(KARR)) for (const o of KARR[k]()) snap[k][o.id] = JSON.stringify(o);
  snap.set.S = JSON.stringify(S);
  LS.set('lr_snap', snap);
}
const bookPath = b => user.id + '/' + b.id + '.epub';
async function uploadBook(b, buf) {
  if (!CLOUD || !user) return;
  const r = await sb.storage.from('books').upload(bookPath(b), new Blob([buf], { type: 'application/epub+zip' }), { contentType: 'application/epub+zip', upsert: true });
  if (r.error) throw new Error(r.error.message || 'не удалось загрузить файл');
  b.up = true; saveBooks();
}
async function ensureUploads() {
  for (const b of books.filter(x => !x.up)) { try { const buf = await files.get(b.id); if (buf) await uploadBook(b, buf); } catch (e) { console.warn('upload', e); } }
}

/* ================= статистика: дни, серия, цель ================= */
// строка на день и устройство: id = YYYY-MM-DD_dev, чтобы два устройства не перетирали друг друга
const dkey = (t = Date.now()) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function today() { const id = dkey() + '_' + DEV; let d = days.find(x => x.id === id); if (!d) { d = { id, date: dkey(), read: 0, rev: 0, got: 0 }; days.push(d); } return d; }
function dayTotals() { const m = {}; for (const d of days) { const x = m[d.date] || (m[d.date] = { read: 0, rev: 0, got: 0, saved: 0 }); x.read += d.read || 0; x.rev += d.rev || 0; x.got += d.got || 0; } for (const w of words) if (w.t) { const k = dkey(w.t); (m[k] || (m[k] = { read: 0, rev: 0, got: 0, saved: 0 })).saved++; } return m; }
const activeDay = x => x && (x.read >= 60 || x.rev > 0 || x.saved > 0);
function streakInfo() {
  const m = dayTotals(); let cur = 0; const t = new Date(); t.setHours(12, 0, 0, 0);
  const todayOn = activeDay(m[dkey(t)]); if (!todayOn) t.setDate(t.getDate() - 1);
  while (activeDay(m[dkey(t)])) { cur++; t.setDate(t.getDate() - 1); }
  let best = 0, run = 0, prev = null;
  for (const k of Object.keys(m).filter(k => activeDay(m[k])).sort()) { const d = new Date(k + 'T12:00:00'); run = prev && Math.round((d - prev) / DAY) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return { cur, best: Math.max(best, cur), todayOn, m };
}
// время чтения: считаем, пока открыта книга, вкладка видна и было действие за последние 2 минуты
let lastAct = 0, readAcc = 0;
const act = () => { lastAct = Date.now(); };
setInterval(() => {
  if (current !== 'Reader' || document.visibilityState !== 'visible' || Date.now() - lastAct > 120000) return;
  readAcc += 5;
  if (readAcc >= 60) { today().read += readAcc; readAcc = 0; saveDays(); }
}, 5000);
document.addEventListener('pointerdown', act, true); document.addEventListener('keydown', act, true);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && readAcc) { today().read += readAcc; readAcc = 0; saveDays(); } });

const FONTS = [
  { id: 'lit', name: 'Literata', css: 'Literata, Georgia, serif' },
  { id: 'mer', name: 'Merriweather', css: 'Merriweather, Georgia, serif' },
  { id: 'pts', name: 'PT Serif', css: '"PT Serif", Georgia, serif' },
  { id: 'lor', name: 'Lora', css: 'Lora, Georgia, serif' },
  { id: 'int', name: 'Inter', css: 'Inter, system-ui, sans-serif' }
];
const FONT_URL = 'https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&family=Merriweather:ital,wght@0,400;0,700;1,400&family=PT+Serif:ital,wght@0,400;0,700;1,400&family=Lora:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;600&display=swap';
const LH = { s: 1.45, m: 1.62, l: 1.85 }, GUT = { s: 16, m: 26, l: 40 };
const THEME = {
  paper: { page: '#FBF8F1', text: '#2A2620', sel: '#F6E3A1', selOp: '0.75', blend: 'multiply', saved: '#6FAF98', quote: '#F6E3A1' },
  sepia: { page: '#F1E4C8', text: '#3B2F1E', sel: '#EBC873', selOp: '0.75', blend: 'multiply', saved: '#5E9C84', quote: '#EBC873' },
  night: { page: '#1E1D1A', text: '#D9D4C7', sel: '#8A7330', selOp: '0.9', blend: 'normal', saved: '#4E8C77', quote: '#6B5A23' }
};

/* файлы книг — IndexedDB */
const files = {
  db: null,
  open() { return this.db || (this.db = new Promise((res, rej) => { const r = indexedDB.open('lr-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); },
  async put(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('f', 'readwrite'); t.objectStore('f').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  async get(k) { const db = await this.open(); return new Promise(res => { const r = db.transaction('f').objectStore('f').get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); }); },
  async del(k) { const db = await this.open(); return new Promise(res => { const t = db.transaction('f', 'readwrite'); t.objectStore('f').delete(k); t.oncomplete = res; t.onerror = res; }); }
};

/* ================= экраны и навигация ================= */
const SCREENS = ['Login', 'Level', 'Key', 'Lib', 'Words', 'Review', 'Profile', 'Reader'];
const TABBED = new Set(['Lib', 'Words', 'Review', 'Profile']);
let current = '';
function show(name) {
  current = name;
  SCREENS.forEach(n => $('#s' + n).classList.toggle('on', n === name));
  document.body.classList.toggle('tabs', TABBED.has(name));
  document.body.classList.toggle('reading', name === 'Reader');
  $$('#tabbar button').forEach(b => { if (b.dataset.go === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (name !== 'Reader') { closeSheet(); closeModal(); document.body.classList.remove('chrome'); }
  if (name === 'Lib') renderLib();
  if (name === 'Words') renderWords();
  if (name === 'Profile') renderProfile();
  if (name === 'Review') { if (rv && rv.pos >= rv.queue.length && !rv.got.length && !rv.miss.length) rv = null; renderReview(); }
  updBadge();
}
$$('#tabbar button').forEach(b => b.onclick = () => show(b.dataset.go));
function updBadge() { const b = $('#revBadge'); const n = words.filter(w => (w.due || 0) <= Date.now()).length; b.hidden = !n; b.textContent = n; }

function applyTheme() {
  document.body.dataset.theme = S.theme;
  document.documentElement.style.setProperty('--gut', GUT[S.margin] + 'px');
  document.querySelector('meta[name=theme-color]').content = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#F6F1E7';
}

/* ================= онбординг: уровень ================= */
const LEVELS = [['A2', 'Начальный', 'Читаю простые тексты со словарём'], ['B1', 'Средний', 'Понимаю общий смысл, но часто спотыкаюсь'], ['B2', 'Выше среднего', 'Читаю свободно, ищу оттенки и идиомы'], ['C1', 'Продвинутый', 'Нужны только редкие слова и нюансы']];
let lvlReturn = 'Key';
function renderLevels() {
  const box = $('#lvlList'); box.innerHTML = '';
  const cur = S.level || 'B1';
  LEVELS.forEach(([c, n, d]) => box.append(h('button', { class: 'lvl', role: 'radio', 'aria-checked': String(cur === c), onclick: () => { S.level = c; saveS(); renderLevels(); } },
    h('b', null, c), h('span', null, h('strong', { style: 'font-size:16px' }, n), h('small', null, d)))));
}
$('#lvlNext').onclick = () => { if (!S.level) { S.level = 'B1'; saveS(); } if (lvlReturn === 'Key') openKey(); else show(lvlReturn); };

/* ================= онбординг: ключ ================= */
let keyReturn = 'Lib';
function openKey(ret) { $('#keyNote').textContent = CLOUD ? 'Ключ сохраняется на сервере и больше не показывается в браузере. Переводы идут через сервер в Париже — VPN не нужен.' : 'Ключ хранится только в этом браузере. Запросы идут напрямую в Google, поэтому из России нужен VPN.'; keyReturn = ret || 'Lib'; $('#keyIn').value = ''; const k = getKey(); $('#keyIn').placeholder = k ? 'сохранён ••••' + k.slice(-4) : 'AQ.Ab…'; $('#keyMsg').innerHTML = ''; $('#keySkip').textContent = k ? 'Отмена' : 'Пропустить пока'; show('Key'); }
$('#keyBack').onclick = () => { if (keyReturn === 'Lib' && !getKey()) { lvlReturn = 'Key'; renderLevels(); show('Level'); } else show(keyReturn); };
$('#keySkip').onclick = () => show(keyReturn);
$('#keyPaste').onclick = async () => { try { $('#keyIn').value = (await navigator.clipboard.readText()).trim(); } catch (e) { toast('Нет доступа к буферу — вставьте вручную'); } };
$('#keySave').onclick = async () => {
  const v = $('#keyIn').value.trim() || getKey();
  const msg = $('#keyMsg');
  if (!v) { msg.replaceChildren(h('div', { class: 'err', text: 'Вставьте ключ.' })); return; }
  msg.replaceChildren(h('div', { class: 'muted' }, h('span', { class: 'spin' }), '  Проверяю ключ…'));
  $('#keySave').disabled = true;
  try {
    if (CLOUD) {
      const typed = $('#keyIn').value.trim();
      if (typed) { const r = await sb.rpc('set_api_key', { p_key: typed }); if (r.error) throw new Error(/bad key/.test(r.error.message) ? 'Ключ слишком короткий — скопируйте его целиком.' : r.error.message); keyLast4 = typed.slice(-4); }
      await gemini('Return the JSON {"translation":"ok"}', null, null, null, 25000);
    } else { await gemini('Return the JSON {"translation":"ok"}', null, null, v, 20000); LS.set('lr_key', v); }
    msg.innerHTML = ''; toast('Ключ работает' + (lastRegion ? ' · сервер: ' + (REGION_NAMES[lastRegion] || lastRegion) : '')); show(keyReturn);
  }
  catch (e) { msg.replaceChildren(h('div', { class: 'err', text: e.message })); }
  finally { $('#keySave').disabled = false; }
};

/* ================= Gemini ================= */
function partialParse(txt) {
  try { return JSON.parse(txt); } catch (e) {}
  const r = {}, un = v => { try { return JSON.parse('"' + v + '"'); } catch (e) { return v; } };
  ['translation', 'pos', 'base_form', 'transcription', 'explanation', 'sentence_translation'].forEach(k => {
    const m = txt.match(new RegExp('"' + k + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"')); if (m && m[1]) r[k] = un(m[1]);
  });
  const ex = [...txt.matchAll(/\{\s*"en"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"ru"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g)].map(m => ({ en: un(m[1]), ru: un(m[2]) }));
  if (ex.length) r.examples = ex;
  return r;
}
function apiError(status, data) {
  const m = (data && data.error && (data.error.message || JSON.stringify(data.error))) || ('HTTP ' + status);
  if (/location is not supported/i.test(m)) return 'Google не принимает запросы из этого региона. Включите VPN (например, Франция) и повторите.';
  if (status === 400 && /API key/i.test(m)) return 'Ключ не принят. Скопируйте его заново целиком.';
  if (status === 401 || status === 403) return 'Ключ не принят (' + status + '). Проверьте, что он скопирован целиком.\n' + m;
  if (status === 404) return 'Модель «' + S.model + '» недоступна. Смените модель в профиле.\n' + m;
  if (status === 429) return 'Лимит бесплатного тарифа: подождите минуту и коснитесь слова ещё раз.';
  return m;
}
const NET_HINT = 'Google не отвечает. Похоже, VPN пропускает сайт Gemini, но не адрес API generativelanguage.googleapis.com. Включите в VPN весь трафик (глобальный режим) или добавьте домен googleapis.com и повторите.';
async function gemini(prompt, outerSignal, onPartial, keyOverride, timeoutMs = 25000) {
  const key = keyOverride || getKey();
  const ctl = new AbortController(); let timedOut = false, timer = null;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs); };
  if (outerSignal) { if (outerSignal.aborted) ctl.abort(); else outerSignal.addEventListener('abort', () => ctl.abort(), { once: true }); }
  const signal = ctl.signal;
  const fail = e => { clearTimeout(timer); if (timedOut) return new Error(CLOUD ? 'Сервер перевода не ответил вовремя. Коснитесь слова ещё раз.' : NET_HINT); return e; };
  arm();
  try { return await geminiInner(prompt, signal, onPartial, key, arm); } catch (e) { throw fail(e); } finally { clearTimeout(timer); }
}
async function geminiInner(prompt, signal, onPartial, key, arm) {
  let r;
  if (CLOUD) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Сессия истекла. Обновите страницу и войдите заново.');
    const fnUrl = CFG.SUPABASE_URL.replace(/\/+$/, '') + '/functions/v1/translate?forceFunctionRegion=' + encodeURIComponent(CFG.REGION || 'eu-west-3');
    try { r = await fetch(fnUrl, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token, 'apikey': CFG.SUPABASE_KEY }, body: JSON.stringify({ prompt, model: S.model }) }); }
    catch (e) { if (e.name === 'AbortError') throw e; throw new Error('Нет связи с сервером перевода. Проверьте интернет.'); }
    arm();
    lastRegion = r.headers.get('x-lr-region') || lastRegion; lastModel = r.headers.get('x-lr-model') || lastModel;
    if (!r.ok) { const d = await r.json().catch(() => ({})); const err = new Error(d.error && d.error.code ? d.error.message : apiError(r.status, d)); if (d.error && d.error.code === 'no_key') err.needKey = true; throw err; }
    return readStream(r, onPartial, arm);
  }
  if (!key) { const e = new Error('Нужен ключ Gemini: Профиль → Ключ перевода.'); e.needKey = true; throw e; }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(S.model)}:streamGenerateContent?alt=sse`;
  const body = t => JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: Object.assign({ responseMimeType: 'application/json', temperature: 0.2 }, t ? { thinkingConfig: { thinkingBudget: 0 } } : {}) });
  const post = t => fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: body(t) });
  try { r = await post(true); if (r.status === 400) { const t = await r.clone().text(); if (!/api key/i.test(t)) r = await post(false); } }
  catch (e) { if (e.name === 'AbortError') throw e; throw new Error('Нет связи с Google (' + (e.message || 'network') + '). ' + NET_HINT); }
  arm();
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(apiError(r.status, d)); }
  return readStream(r, onPartial, arm);
}
async function readStream(r, onPartial, arm) {
  const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', acc = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break; arm();
    buf += dec.decode(value, { stream: true });
    let k; while ((k = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1);
      if (!line.startsWith('data:')) continue;
      try { const j = JSON.parse(line.slice(5)); const parts = (((j.candidates || [])[0] || {}).content || {}).parts || []; acc += parts.map(p => p.text || '').join(''); } catch (e) {}
    }
    onPartial && onPartial(partialParse(acc.replace(/^\s*```json\s*/, '')));
  }
  const txt = acc.replace(/^\s*```json\s*|```\s*$/g, '').trim();
  try { return JSON.parse(txt); } catch (e) {}
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}'); if (a >= 0 && b > a) { try { return JSON.parse(txt.slice(a, b + 1)); } catch (e) {} }
  const p = partialParse(txt); if (p.translation) return p;
  throw new Error('Модель ответила неожиданно. Коснитесь слова ещё раз.');
}

/* ================= библиотека ================= */
async function readMeta(buf, fallback) {
  const b = ePub(buf.slice(0));
  let title = fallback, author = '', cover = '';
  try { const m = await b.loaded.metadata; title = norm(m.title) || fallback; author = norm(m.creator); } catch (e) {}
  try {
    const url = await b.coverUrl();
    if (url) cover = await new Promise(res => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); const w = 180, hh = Math.round(w * img.height / img.width) || 270; c.width = w; c.height = hh; c.getContext('2d').drawImage(img, 0, 0, w, hh); try { res(c.toDataURL('image/jpeg', 0.8)); } catch (e) { res(''); } }; img.onerror = () => res(''); img.src = url; });
  } catch (e) {}
  try { await b.ready; } catch (e) {}
  try { b.destroy(); } catch (e) {}
  return { title, author, cover };
}
const COVER_COLORS = ['#7A3E2C', '#2F4858', '#4F5E2E', '#3B3A4A', '#5A3D52', '#3D4A3F', '#6E5420'];
function coverEl(b, w, hgt, fs) {
  const c = h('div', { class: 'cover', 'aria-hidden': 'true', style: `width:${w}px;height:${hgt}px;background:${COVER_COLORS[(b.title || '').length % COVER_COLORS.length]}` });
  if (b.cover) c.append(h('img', { src: b.cover, alt: '' }));
  else { c.style.padding = '7px'; c.append(h('div', { style: `font-size:${fs}px`, text: b.title }), h('div', { style: `font-size:${Math.max(7, fs - 4)}px;opacity:.85;font-family:Inter,sans-serif;font-weight:500`, text: b.author || '' })); }
  return c;
}
function minsLeftText(b) { return b.left != null ? ' · до конца главы ~' + Math.max(1, b.left) + ' мин' : ''; }
function renderLib() {
  const list = $('#bookList'); list.innerHTML = '';
  const sorted = books.slice().sort((a, b) => (b.lastRead || b.added || 0) - (a.lastRead || a.added || 0));
  const cont = sorted.find(b => b.lastRead && (b.pct || 0) < 0.995);
  const box = $('#contBox'); box.innerHTML = '';
  if (cont) {
    box.append(h('section', { class: 'card cont', 'aria-label': 'Продолжить чтение' },
      coverEl(cont, 88, 130, 13),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px;min-width:0;flex:1' },
        h('div', { style: 'font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)', text: 'Продолжить' }),
        h('div', { style: 'font-family:var(--serif);font-size:18px;font-weight:600;line-height:1.2', text: cont.title }),
        h('div', { class: 'muted', style: 'font-size:14px', text: [cont.author, cont.chapter].filter(Boolean).join(' · ') }),
        h('div', { class: 'bar', style: 'margin-top:4px' }, h('i', { style: `width:${Math.round((cont.pct || 0) * 100)}%` })),
        h('div', { class: 'muted', style: 'font-size:13px', text: Math.round((cont.pct || 0) * 100) + '%' + minsLeftText(cont) }),
        h('button', { class: 'btn primary', style: 'margin-top:auto;align-self:flex-start', onclick: () => openBook(cont) }, 'Читать'))));
  }
  if (!books.length) { list.append(h('li', { class: 'empty', style: 'display:block;border:0' }, h('div', { style: 'font-family:var(--serif);font-size:18px;color:var(--ink);margin-bottom:6px', text: 'Пока нет книг' }), 'Нажмите «+ EPUB» и выберите файл книги на английском.')); return; }
  sorted.forEach(b => {
    const pct = Math.round((b.pct || 0) * 100);
    const status = b.pct >= 0.995 ? h('div', { style: 'display:flex;align-items:center;gap:6px;font-size:13px;color:var(--accent);font-weight:600' }, ico('check', 16), 'Прочитано')
      : b.lastRead ? h('div', { style: 'display:flex;align-items:center;gap:8px' }, h('div', { class: 'bar', style: 'flex:1;height:3px' }, h('i', { style: `width:${pct}%` })), h('span', { class: 'muted', style: 'font-size:13px', text: pct + '%' }))
      : h('div', { class: 'muted', style: 'font-size:13px', text: 'Новая книга' });
    list.append(h('li', null,
      h('button', { class: 'open', onclick: () => openBook(b) }, coverEl(b, 52, 76, 8),
        h('div', { style: 'flex:1;min-width:0;display:flex;flex-direction:column;gap:4px' }, h('div', { class: 't', text: b.title }), h('div', { class: 'muted', style: 'font-size:14px', text: b.author || '' }), status)),
      h('button', { class: 'icobtn', 'aria-label': 'Удалить «' + b.title + '»', style: 'color:var(--muted)', onclick: () => delBook(b) }, ico('trash', 20))));
  });
}
async function delBook(b) {
  if (!confirm('Удалить «' + b.title + '»? Слова и заметки из неё тоже удалятся.')) return;
  await files.del(b.id);
  if (CLOUD && user) { try { await sb.storage.from('books').remove([bookPath(b)]); } catch (e) {} }
  books = books.filter(x => x.id !== b.id); words = words.filter(w => w.bookId !== b.id); notes = notes.filter(n => n.bookId !== b.id); marks = marks.filter(m => m.bookId !== b.id);
  saveBooks(); saveWords(); saveNotes(); saveMarks(); renderLib(); updBadge();
}
$('#fileIn').onchange = async e => {
  const fl = [...e.target.files]; e.target.value = '';
  for (const f of fl) {
    if (!/\.epub$/i.test(f.name) && f.type !== 'application/epub+zip') { toast('«' + f.name + '» — не EPUB'); continue; }
    toast('Добавляю «' + f.name + '»…', 30000);
    try {
      const buf = await f.arrayBuffer(); const meta = await readMeta(buf, f.name.replace(/\.epub$/i, ''));
      const id = 'b' + uid(); await files.put(id, buf);
      const nb = Object.assign({ id, added: Date.now(), pct: 0 }, meta);
      books.unshift(nb); saveBooks(); renderLib();
      if (CLOUD) { try { await uploadBook(nb, buf); toast('Добавлено: ' + meta.title); } catch (err) { toast('Книга добавлена, но не загрузилась в облако: ' + err.message, 5000); } }
      else toast('Добавлено: ' + meta.title);
    } catch (err) { toast('Не удалось прочитать файл: ' + err.message, 5000); }
  }
};
$('#catBtn').onclick = () => toast('Каталог бесплатной классики появится вместе с облаком', 3200);

/* ================= слова ================= */
function renderWords() {
  const q = norm($('#wSearch').value).toLowerCase();
  $('#wCount').textContent = words.length ? words.length + ' сохранено' : '';
  const box = $('#wGroups'); box.innerHTML = '';
  if (!words.length) { box.append(h('div', { class: 'empty' }, h('div', { style: 'font-family:var(--serif);font-size:18px;color:var(--ink);margin-bottom:6px', text: 'Пока пусто' }), 'Коснитесь слова в книге и нажмите ★ — оно появится здесь.')); return; }
  const byBook = new Map();
  words.filter(w => !q || w.w.toLowerCase().includes(q) || (w.tr || '').toLowerCase().includes(q)).forEach(w => { if (!byBook.has(w.bookId)) byBook.set(w.bookId, []); byBook.get(w.bookId).push(w); });
  for (const [bid, ws] of byBook) {
    const b = books.find(x => x.id === bid) || { title: 'Удалённая книга' };
    box.append(h('section', { class: 'wgroup' },
      h('h2', null, h('span', { 'aria-hidden': 'true', style: `width:18px;height:26px;border-radius:2px 4px 4px 2px;background:${COVER_COLORS[(b.title || '').length % COVER_COLORS.length]}` }), b.title, h('span', { style: 'font-weight:500;color:var(--muted)', text: '· ' + ws.length })),
      h('ul', { class: 'wlist' }, ws.map(w => h('li', null,
        h('div', { class: 'w' }, h('span', { style: 'font-size:16px' }, h('b', { lang: 'en', text: w.w }), ' — ' + (w.tr || '')), h('span', { class: 'ctx', lang: 'en', text: w.s || '' })),
        h('button', { class: 'icobtn', 'aria-label': 'Произнести', onclick: () => speak(w.w) }, ico('speak', 18)),
        b.id ? h('button', { class: 'icobtn', 'aria-label': 'Открыть место в книге', onclick: () => openBook(b, w.cfi) }, ico('chev', 18)) : null,
        h('button', { class: 'icobtn', 'aria-label': 'Удалить слово', style: 'color:var(--muted)', onclick: () => { words = words.filter(x => x.id !== w.id); saveWords(); renderWords(); updBadge(); } }, ico('x', 16)))))));
  }
}
$('#wSearch').oninput = renderWords;

/* ================= повторение (карточки) ================= */
const INTERVALS = [1, 3, 7, 21, 60], SWIPE = 90;
let rv = null; // { mode, queue:[id], pos, shown, got:[id], miss:[id] }
const isDue = w => (w.due || 0) <= Date.now();
const wById = id => words.find(w => w.id === id);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function startRound(mode) {
  let list;
  if (mode === 'missed') list = words.filter(w => w.missed);
  else if (mode === 'all') list = shuffle(words.slice());
  else list = words.filter(isDue).sort((a, b) => (a.due || 0) - (b.due || 0));
  rv = { mode, queue: list.slice(0, 60).map(w => w.id), pos: 0, shown: false, got: [], miss: [] };
}
let audioCtx = null;
function beep(good) {
  if (S.sound === false) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    audioCtx = audioCtx || new AC(); const ac = audioCtx, t = ac.currentTime;
    (good ? [[660, 0], [990, 0.07]] : [[240, 0], [180, 0.06]]).forEach(([f, d]) => {
      const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(good ? 0.07 : 0.06, t + d + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.16);
      o.connect(g); g.connect(ac.destination); o.start(t + d); o.stop(t + d + 0.18);
    });
  } catch (e) {}
}
function markSentence(s, word, blank) {
  const span = h('span', { lang: 'en', class: 'rv-sent' }); const i = (s || '').toLowerCase().indexOf((word || '').toLowerCase());
  if (i < 0) { span.textContent = s || ''; return span; }
  span.append(s.slice(0, i), blank ? h('span', { class: 'rv-blank', text: ' '.repeat(Math.max(6, word.length + 2)) }) : h('mark', { text: s.slice(i, i + word.length) }), s.slice(i + word.length));
  return span;
}
const ARROW_L = '<path d="M42 6C26 4 12 12 10 32"/><path d="M3 25l7 8 7-7"/>', ARROW_R = '<path d="M6 6c16-2 30 6 32 26"/><path d="M45 25l-7 8-7-7"/>';
function svgEl(inner, vb, cls) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', vb); s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls); s.innerHTML = inner; return s; }
function renderReview() {
  const box = $('#revBox'); box.innerHTML = ''; updBadge();
  const sound = h('button', { class: 'icobtn', 'aria-label': 'Звук', 'aria-pressed': String(S.sound !== false), onclick: () => { S.sound = S.sound === false; saveS(); renderReview(); toast(S.sound === false ? 'Звук выключен' : 'Звук включён', 1200); } }, svgEl(S.sound === false ? '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M16 9l5 6M21 9l-5 6"/>' : P.speak, '0 0 24 24', 'i'));
  const head = h('header', { style: 'display:flex;align-items:center;gap:8px' }, h('h1', { class: 'title', style: 'flex:1' }, 'Повторение'));
  box.append(head);
  if (!words.length) { box.append(h('div', { class: 'card', style: 'padding:22px;display:flex;flex-direction:column;gap:8px' }, h('b', { style: 'font-size:17px', text: 'Пока нечего повторять' }), h('span', { class: 'muted', text: 'Коснитесь слова в книге и нажмите ★ — оно появится здесь.' }))); return; }
  if (!rv) startRound('due');
  const total = rv.queue.length, done = rv.pos >= total;
  head.append(h('span', { class: 'muted', style: 'font-size:15px', text: total ? (done ? 'Круг пройден' : (rv.pos + 1) + ' из ' + total) : '' }), sound);
  // направление
  box.append(h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Что показывать сначала' }, [['en', 'EN → RU', 'слово'], ['ru', 'RU → EN', 'перевод'], ['mix', 'Вперемешку', 'оба']].map(([v, t, sub]) =>
    h('button', { role: 'radio', 'aria-checked': String((S.revDir || 'en') === v), style: 'min-height:46px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px', onclick: () => { S.revDir = v; saveS(); if (rv) rv.shown = false; renderReview(); } }, h('span', { text: t }), h('small', { style: 'font-size:11px;font-weight:500;color:var(--ink2)', text: sub })))));
  // режимы
  const dueN = words.filter(isDue).length, missN = words.filter(w => w.missed).length;
  const chip = (on, label, fn, dot) => h('button', { class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: fn }, dot ? h('i', { class: 'dot' }) : null, label);
  box.append(h('div', { class: 'chips' },
    chip(rv.mode === 'due', 'На сегодня · ' + dueN, () => { startRound('due'); renderReview(); }),
    chip(rv.mode === 'missed', 'Не угаданные · ' + missN, () => { if (!missN) { toast('Не угаданных пока нет'); return; } startRound('missed'); renderReview(); }, true),
    chip(rv.mode === 'all', 'Все · ' + words.length, () => { startRound('all'); renderReview(); })));
  box.append(h('div', { class: 'bar', style: 'height:6px;border-radius:3px' }, h('i', { style: `width:${total ? Math.round(Math.min(rv.pos, total) / total * 100) : 0}%` })));

  if (!total) {
    const next = words.filter(w => !isDue(w)).map(w => w.due).sort((a, b) => a - b)[0];
    box.append(h('div', { class: 'card', style: 'padding:28px 22px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center' },
      h('span', { class: 'rv-ok' }, ico('check', 34)), h('b', { style: 'font-family:var(--serif);font-size:22px', text: rv.mode === 'missed' ? 'Не угаданных нет' : 'На сегодня всё' }),
      next ? h('span', { class: 'muted', text: 'Следующее повторение: ' + new Date(next).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) }) : null,
      h('button', { class: 'btn', onclick: () => { startRound('all'); renderReview(); } }, 'Повторить все слова')));
    return;
  }
  if (done) { renderResult(box); return; }

  const w = wById(rv.queue[rv.pos]); if (!w) { rv.pos++; renderReview(); return; }
  const dir = S.revDir || 'en', ruFirst = dir === 'ru' || (dir === 'mix' && rv.pos % 2 === 1);
  const b = books.find(x => x.id === w.bookId);
  const ok = h('div', { class: 'rv-ov ok' }, svgEl('<circle cx="60" cy="60" r="52" stroke-width="4" opacity=".35"/><path d="M36 62l16 16 32-36"/>', '0 0 120 120'));
  const no = h('div', { class: 'rv-ov no' }, svgEl('<circle cx="60" cy="60" r="52" stroke-width="4" opacity=".35"/><path d="M42 42l36 36M78 42L42 78"/>', '0 0 120 120'));
  const card = h('div', { class: 'rv-card enter', role: 'button', tabindex: '0', 'aria-label': rv.shown ? 'Карточка' : 'Показать ответ' }, ok, no,
    h('span', { class: 'rv-book', text: b ? b.title : '' }));
  if (ruFirst) card.append(h('span', { class: 'rv-tr', text: w.tr || '' }), markSentence(w.s, w.w, !rv.shown));
  else card.append(h('span', { class: 'rv-word', lang: 'en', text: w.w }), markSentence(w.s, w.w, false));
  if (!rv.shown) card.append(h('span', { class: 'muted', style: 'font-size:14px', text: ruFirst ? 'Вспомните слово на английском · коснитесь, чтобы проверить' : 'Вспомните перевод · коснитесь, чтобы проверить' }));
  else {
    const back = h('div', { class: 'rv-back' },
      ruFirst ? h('span', { class: 'rv-word', lang: 'en', text: w.w }) : h('span', { class: 'rv-tr', text: w.tr || '' }),
      w.tc ? h('span', { class: 'muted', style: 'font-size:14px', text: w.tc }) : null,
      w.exp ? h('span', { style: 'font-size:14px;color:var(--ink2)', text: w.exp }) : null);
    const ex = Array.isArray(w.ex) ? w.ex[0] : w.ex; if (ex && ex.en) back.append(h('div', { class: 'sh-ex', style: 'text-align:left;margin-top:4px' }, h('div', { class: 'en', lang: 'en', text: ex.en }), h('div', { class: 'ru', text: ex.ru || '' })));
    card.append(back);
  }
  card.append(h('button', { class: 'icobtn rv-speak', 'aria-label': 'Произнести', onclick: ev => { ev.stopPropagation(); speak(w.w); } }, ico('speak', 20)));
  box.append(card);
  box.append(h('div', { class: 'rv-hints' },
    h('button', { class: 'rv-hint no', onclick: () => commit(card, false) }, svgEl(ARROW_L, '0 0 48 40'), h('span', null, h('b', null, 'Не угадал'), h('small', null, 'свайп влево'))),
    h('button', { class: 'rv-hint ok', onclick: () => commit(card, true) }, h('span', null, h('b', null, 'Угадал'), h('small', null, 'свайп вправо')), svgEl(ARROW_R, '0 0 48 40'))));
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove('enter')));
  // жесты
  let x0 = null, dx = 0, moved = false;
  const setDx = d => { dx = d; card.style.transform = `translateX(${d}px) rotate(${(d / 22).toFixed(1)}deg)`; const k = Math.min(1, Math.abs(d) / SWIPE); ok.style.opacity = d > 0 ? k : 0; no.style.opacity = d < 0 ? k : 0; ok.firstChild.style.transform = no.firstChild.style.transform = `scale(${(0.7 + 0.3 * k).toFixed(2)})`; };
  card.addEventListener('pointerdown', e => { if (e.target.closest('.rv-speak')) return; x0 = e.clientX; moved = false; card.style.transition = 'none'; try { card.setPointerCapture(e.pointerId); } catch (er) {} });
  card.addEventListener('pointermove', e => { if (x0 == null) return; const d = e.clientX - x0; if (Math.abs(d) > 6) moved = true; setDx(d); });
  const up = () => { if (x0 == null) return; x0 = null; card.style.transition = ''; if (dx > SWIPE) commit(card, true); else if (dx < -SWIPE) commit(card, false); else { setDx(0); ok.style.opacity = no.style.opacity = 0; if (!moved) { rv.shown = !rv.shown; renderReview(); } } };
  card.addEventListener('pointerup', up); card.addEventListener('pointercancel', up);
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); rv.shown = !rv.shown; renderReview(); } });
}
let committing = false;
function commit(card, good) {
  if (committing || !rv) return; committing = true;
  const w = wById(rv.queue[rv.pos]);
  beep(good); buzz(good ? 12 : 20);
  card.style.transition = 'transform .3s cubic-bezier(.3,.6,.4,1), opacity .3s ease';
  card.style.transform = `translateX(${good ? 130 : -130}%) rotate(${good ? 18 : -18}deg)`; card.style.opacity = '0';
  const ov = card.querySelector(good ? '.rv-ov.ok' : '.rv-ov.no'); if (ov) ov.style.opacity = 1;
  setTimeout(() => {
    if (w) {
      if (good) { w.box = Math.min((w.box || 0) + 1, INTERVALS.length); w.due = Date.now() + INTERVALS[w.box - 1] * DAY; w.missed = false; rv.got.push(w.id); today().got++; }
      else { w.box = 0; w.due = Date.now() + 10 * 60000; w.missed = true; rv.miss.push(w.id); }
      w.seen = Date.now(); today().rev++; LS.set('lr_days', days); saveWords();
    }
    rv.pos++; rv.shown = false; committing = false; renderReview();
  }, 280);
}
function renderResult(box) {
  const list = (ids, cls) => h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, ids.map(wById).filter(Boolean).map(w => h('div', { style: 'font-size:15px' }, h('b', { lang: 'en', text: w.w }), ' — ' + (w.tr || ''))));
  box.append(h('h2', { style: 'margin:4px 0 0;font-family:var(--serif);font-size:22px;font-weight:600', text: 'Итог круга' }),
    h('section', { class: 'card', style: 'padding:14px;display:flex;flex-direction:column;gap:8px' }, h('h3', { style: 'margin:0;font-size:14px;color:var(--accent);display:flex;gap:6px;align-items:center' }, ico('check', 18), 'Угадал · ' + rv.got.length), rv.got.length ? list(rv.got) : h('span', { class: 'muted', text: '—' })),
    h('section', { class: 'card', style: 'padding:14px;display:flex;flex-direction:column;gap:8px' }, h('h3', { style: 'margin:0;font-size:14px;color:var(--warn);display:flex;gap:8px;align-items:center' }, h('i', { class: 'dot' }), 'Не угадал · ' + rv.miss.length), rv.miss.length ? list(rv.miss) : h('span', { class: 'muted', text: 'Все слова угаданы' })));
  if (rv.miss.length) box.append(h('button', { class: 'btn primary big', onclick: () => { rv = { mode: 'missed', queue: shuffle(rv.miss.slice()), pos: 0, shown: false, got: [], miss: [] }; renderReview(); } }, 'Прогнать не угаданные · ' + rv.miss.length));
  box.append(h('button', { class: 'btn big', onclick: () => { startRound('due'); renderReview(); } }, 'Готово'));
}
document.addEventListener('keydown', e => {
  if (current !== 'Review' || !rv || rv.pos >= rv.queue.length || /INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || '')) return;
  const card = $('#revBox .rv-card'); if (!card) return;
  if (e.key === 'ArrowRight') commit(card, true); else if (e.key === 'ArrowLeft') commit(card, false);
});

/* ================= профиль ================= */
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c; };
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
function renderStats() {
  const box = $('#profStats'); if (!box) return;
  if (readAcc) { today().read += readAcc; readAcc = 0; saveDays(); }
  const { cur, best, todayOn, m } = streakInfo();
  const goal = S.goal || 10, todayMin = Math.floor(((m[dkey()] || {}).read || 0) / 60), k = Math.min(1, todayMin / goal);
  const R = 26, C = 2 * Math.PI * R;
  const ring = svgEl(`<circle cx="32" cy="32" r="${R}" fill="none" stroke="var(--line)" stroke-width="6"/><circle cx="32" cy="32" r="${R}" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(C * k).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/>`, '0 0 64 64', 'ring');
  const hero = h('div', { class: 'card st-hero' },
    h('div', { class: 'st-streak' + (todayOn ? ' on' : '') }, ico('flame', 30),
      h('div', null, h('b', { text: String(cur) }), h('span', { text: plural(cur, 'день подряд', 'дня подряд', 'дней подряд') }))),
    h('button', { class: 'st-goal', 'aria-label': 'Цель на день: ' + goal + ' минут. Изменить', onclick: pickGoal }, h('div', { class: 'ringwrap' }, ring, h('span', { text: String(todayMin) })), h('small', { text: k >= 1 ? 'цель выполнена' : 'из ' + goal + ' мин' })),
    h('p', { class: 'st-sub', text: todayOn ? (k >= 1 ? 'Сегодня всё сделано. Рекорд: ' + best + ' ' + plural(best, 'день', 'дня', 'дней') + '.' : 'Сегодня засчитано. Рекорд: ' + best + ' ' + plural(best, 'день', 'дня', 'дней') + '.') : cur ? 'Почитайте минуту или повторите слова, чтобы не прервать серию.' : 'Почитайте минуту или повторите слова — начнётся серия.' }));
  // неделя
  const list = []; const t = new Date(); t.setHours(12, 0, 0, 0); t.setDate(t.getDate() - 6);
  for (let i = 0; i < 7; i++) { const key = dkey(t); list.push({ key, wd: WD[t.getDay()], min: Math.floor(((m[key] || {}).read || 0) / 60), on: activeDay(m[key]), today: i === 6 }); t.setDate(t.getDate() + 1); }
  const wkMin = list.reduce((a, x) => a + x.min, 0), max = Math.max(goal, ...list.map(x => x.min));
  let wkRev = 0, wkSaved = 0; for (const x of list) { wkRev += (m[x.key] || {}).rev || 0; wkSaved += (m[x.key] || {}).saved || 0; }
  const week = h('section', { class: 'card st-week', 'aria-label': 'Чтение за 7 дней' },
    h('div', { class: 'st-h' }, h('b', { text: '7 дней' }), h('span', { class: 'muted', text: wkMin + ' мин чтения' })),
    h('div', { class: 'bars' }, list.map(x => h('div', { class: 'bwrap', title: x.min + ' мин' }, h('i', { style: `height:${x.min ? Math.max(4, x.min / max * 100) : 0}%` + (x.min >= goal ? ';background:var(--accent)' : '') }))),
      h('i', { class: 'goal', style: `bottom:${(goal / max * 100).toFixed(1)}%` })),
    h('div', { class: 'blabels' }, list.map(x => h('div', { class: x.today ? 'today' : '' }, h('span', { class: 'bdot' + (x.on ? ' on' : '') }), h('small', { text: x.wd })))));
  // слова
  const learned = words.filter(w => (w.box || 0) >= 3).length, learning = words.filter(w => (w.box || 0) > 0 && (w.box || 0) < 3).length, fresh = words.length - learned - learning;
  const pct = n => words.length ? (n / words.length * 100).toFixed(1) + '%' : '0';
  const tile = (n, label) => h('div', { class: 'card st-tile' }, h('b', { text: String(n) }), h('span', { text: label }));
  const wcard = h('section', { class: 'card st-words', 'aria-label': 'Слова' },
    h('div', { class: 'st-h' }, h('b', { text: 'Слова' }), h('span', { class: 'muted', text: words.length + ' в словаре' })),
    h('div', { class: 'seg3', 'aria-hidden': 'true' }, h('i', { style: 'width:' + pct(learned) + ';background:var(--accent)' }), h('i', { style: 'width:' + pct(learning) + ';background:var(--saved)' }), h('i', { style: 'width:' + pct(fresh) + ';background:var(--line2)' })),
    h('div', { class: 'leg' }, [[learned, 'выучено', 'var(--accent)'], [learning, 'учатся', 'var(--saved)'], [fresh, 'новые', 'var(--line2)']].map(([n, l, c]) => h('span', null, h('i', { style: 'background:' + c }), h('b', { text: String(n) }), ' ' + l))),
    h('p', { class: 'muted', style: 'margin:0;font-size:13px', text: 'Выученным слово считается, когда вы угадали его три раза подряд с паузами в 1, 3 и 7 дней.' }));
  box.replaceChildren(hero, h('div', { class: 'st-tiles' }, tile(wkSaved, 'новых слов за неделю'), tile(wkRev, 'карточек за неделю')), week, wcard);
}
function pickGoal() {
  openModal([h('h3', { style: 'margin:0 0 6px;font-family:var(--serif);font-size:20px', text: 'Цель на день' }), h('p', { class: 'muted', style: 'margin:0 0 14px;font-size:14px', text: 'Сколько минут читать каждый день.' }),
    h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Минут в день', style: 'grid-template-columns:repeat(5,1fr)' }, [5, 10, 15, 20, 30].map(n => h('button', { role: 'radio', 'aria-checked': String((S.goal || 10) === n), onclick: () => { S.goal = n; saveS(); closeModal(); renderProfile(); } }, n + ' мин')))]);
}
function renderProfile() {
  renderStats();
  const k = getKey();
  const row = (label, val, fn) => h('li', null, h('button', { onclick: fn, style: 'flex:1;display:flex;align-items:center;gap:12px;min-height:44px;border:0;background:transparent;text-align:left;padding:0' }, h('span', { style: 'flex:1;font-size:15px', text: label }), h('span', { class: 'muted', style: 'font-size:14px', text: val }), ico('chev', 18, 'color:var(--muted)')));
  $('#profList').replaceChildren(
    row('Цель на день', (S.goal || 10) + ' мин', pickGoal),
    row('Уровень английского', S.level || 'B1', () => { lvlReturn = 'Profile'; renderLevels(); show('Level'); }),
    row('Ключ перевода', k ? 'Gemini ••••' + k.slice(-4) : 'не задан', () => openKey('Profile')),
    row('Модель', S.model + (lastModel && lastModel !== S.model ? ' (сейчас: ' + lastModel + ')' : ''), () => { const m = prompt('Название модели Gemini', S.model); if (m && m.trim()) { S.model = m.trim(); saveS(); renderProfile(); } }),
    CLOUD && lastRegion ? h('li', null, h('span', { style: 'flex:1;font-size:15px;min-height:44px;display:flex;align-items:center', text: 'Сервер перевода' }), h('span', { class: 'muted', style: 'font-size:14px;padding-right:10px', text: (REGION_NAMES[lastRegion] || lastRegion) })) : null,
    row('Очистить кэш переводов', Object.keys(cache).length + ' шт.', () => { if (confirm('Очистить сохранённые переводы? Слова в словаре останутся.')) { for (const x in cache) delete cache[x]; LS.set('lr_cache', {}); renderProfile(); } }),
    CLOUD && user ? row('Выйти', '', async () => { if (!confirm('Выйти из аккаунта на этом устройстве?')) return; await flush(); await sb.auth.signOut(); }) : null
  );
  const note = $('#profNote');
  if (note) note.textContent = CLOUD ? (user ? 'Вы вошли как ' + (user.email || 'пользователь Google') + '. Книги, слова, закладки и настройки синхронизируются между устройствами.' : '') : 'Локальный режим: книги, слова и ключ хранятся только в этом браузере.';
}

/* ================= читалка ================= */
let book = null, rendition = null, curBook = null, navToc = [], spineChars = null, lastLoc = null, progT = null;
async function openBook(b, atCfi) {
  curBook = b; show('Reader');
  $('#loading').style.display = 'flex'; $('#rTitle').textContent = b.title;
  $('#miniCh').textContent = ''; $('#miniPct').textContent = ''; $('#bCh').textContent = ''; $('#bPct').textContent = '';
  try { if (rendition) rendition.destroy(); if (book) book.destroy(); } catch (e) {}
  rendition = null; book = null; spineChars = null; navToc = []; selCfi = null;
  let buf; try { buf = await files.get(b.id); } catch (e) {}
  if (!buf && CLOUD && user) {
    $('#loading').lastChild.textContent = 'Скачиваю книгу…';
    try { const r = await sb.storage.from('books').download(bookPath(b)); if (r.error) throw r.error; buf = await r.data.arrayBuffer(); await files.put(b.id, buf); } catch (e) { console.warn(e); }
    $('#loading').lastChild.textContent = 'Открываю книгу…';
  }
  if (!buf) { $('#loading').style.display = 'none'; toast('Файл книги не найден в этом браузере', 4000); show('Lib'); return; }
  const bk = ePub(buf); book = bk;
  rendition = book.renderTo('viewer', { width: '100%', height: '100%', flow: 'paginated', spread: 'none', allowScriptedContent: false, minSpreadWidth: 99999 });
  rendition.hooks.content.register(contents => {
    try { contents.addStylesheet(FONT_URL); } catch (e) {}
    attachInput(contents);
  });
  applyReader();
  try { await rendition.display(atCfi || b.cfi || undefined); } catch (e) { try { await rendition.display(); } catch (e2) {} }
  $('#loading').style.display = 'none';
  if (book !== bk) return;
  b.lastRead = Date.now(); saveBooks();
  // подсказка: как открыть меню (первые три раза), панели видны пару секунд
  if (!isDesk()) { const n = LS.get('lr_taphint', 0); toggleChrome(true); setTimeout(() => { if (current === 'Reader') toggleChrome(false); }, 2200);
    if (n < 3) { LS.set('lr_taphint', n + 1); tapHintT = setTimeout(() => { $('#tapHint').classList.add('on'); tapHintT = setTimeout(() => $('#tapHint').classList.remove('on'), 2600); }, 2400); } }
  rendition.on('relocated', onRelocated);
  rendition.on('rendered', (section, view) => { try { underlineSaved(view.contents); } catch (e) {} });
  rendition.on('selected', onSelectedRange);
  try { rendition.getContents().forEach(c => underlineSaved(c)); } catch (e) {}
  notes.filter(n => n.bookId === b.id && n.cfi).forEach(addQuoteMark);
  bk.loaded.navigation.then(nav => { if (book !== bk) return; navToc = flatToc(nav.toc); markChapter(lastLoc); }).catch(() => {});
  bk.ready.then(() => book === bk && bk.locations.generate(1000)).then(() => { if (book !== bk) return; buildSpineChars(); updProgress(lastLoc); }).catch(() => {});
  if (atCfi) setTimeout(() => { try { rendition.annotations.highlight(atCfi, {}, null, 'lr-flash', { fill: THEME[S.theme].sel, 'fill-opacity': '0.8' }); setTimeout(() => { try { rendition.annotations.remove(atCfi, 'highlight'); } catch (e) {} }, 1600); } catch (e) {} }, 400);
}
function flatToc(items, d = 0, out = []) { (items || []).forEach(it => { out.push({ href: it.href, label: norm(it.label), depth: d }); flatToc(it.subitems, d + 1, out); }); return out; }
const hrefBase = s => String(s || '').split('#')[0].replace(/^\.?\//, '');
function chapterFor(loc) {
  if (!loc || !navToc.length) return '';
  const href = hrefBase(loc.start.href); let best = '';
  for (const t of navToc) { const tb = hrefBase(t.href); if (tb && (href.endsWith(tb) || tb.endsWith(href))) { best = t.label; break; } }
  if (!best) { // ближайшая предыдущая глава по порядку spine
    const idx = loc.start.index; let bi = -1;
    for (const t of navToc) { const s = book.spine.get(t.href); if (s && s.index <= idx && s.index > bi) { bi = s.index; best = t.label; } }
  }
  return best;
}
let curChapter = '';
function markChapter(loc) { curChapter = chapterFor(loc); $('#miniCh').textContent = curChapter; $('#bCh').textContent = curChapter; }
function buildSpineChars() {
  spineChars = {};
  try { (book.locations._locations || []).forEach((cfi, i) => { const sp = new ePub.CFI(cfi).spinePos; (spineChars[sp] = spineChars[sp] || []).push(i); }); } catch (e) { spineChars = null; }
}
function updProgress(loc) {
  if (!loc || !book) return;
  let pct = null, left = null;
  try {
    if (book.locations.length()) {
      pct = book.locations.percentageFromCfi(loc.start.cfi);
      const i = book.locations.locationFromCfi(loc.start.cfi), arr = spineChars && spineChars[loc.start.index];
      if (arr && arr.length) { const remain = Math.max(0, arr[arr.length - 1] - i + 1); left = Math.max(1, Math.round(remain * 1000 / 5.6 / 180)); }
    }
  } catch (e) {}
  if (pct == null) { $('#miniPct').textContent = ''; $('#bPct').textContent = ''; return; }
  const d = loc.start.displayed || {}; const pg = d.total ? 'стр. ' + d.page + ' из ' + d.total + ' · ' : '';
  const txt = pg + Math.round(pct * 100) + '%' + (left != null ? ' · до конца главы ~' + left + ' мин' : '');
  $('#miniPct').textContent = txt; $('#bPct').textContent = txt; $('#miniBar i').style.width = (pct * 100).toFixed(1) + '%';
  if (!scrubbing) $('#scrub').value = Math.round(pct * 1000);
  if (curBook) { curBook.pct = pct; curBook.left = left; }
}
function onRelocated(loc) {
  act();
  lastLoc = loc; markChapter(loc); updProgress(loc); updMarkBtn();
  if (curBook) { curBook.cfi = loc.start.cfi; curBook.chapter = curChapter; curBook.lastRead = Date.now(); clearTimeout(progT); progT = setTimeout(saveBooks, 600); }
}
function applyReader() {
  applyTheme();
  if (!rendition) return;
  const T = THEME[S.theme], F = (FONTS.find(f => f.id === S.font) || FONTS[0]).css;
  rendition.themes.default({
    'html': { 'background': T.page + ' !important' },
    'body': { 'font-family': F + ' !important', 'line-height': LH[S.lh] + ' !important', 'color': T.text + ' !important', 'background': 'transparent !important', '-webkit-text-size-adjust': '100%', '-webkit-touch-callout': 'none' },
    'p, li, div, span, blockquote, td': { 'font-family': 'inherit !important', 'line-height': 'inherit !important', 'color': 'inherit !important' },
    'a': { 'color': 'inherit !important' },
    'img': { 'max-width': '100% !important', 'height': 'auto !important' },
    '::selection': { 'background': T.sel, 'color': 'inherit' }
  });
  rendition.themes.fontSize(Math.round(S.size / 16 * 100) + '%');
  try { rendition.resize(); } catch (e) {}
}
new ResizeObserver(() => { clearTimeout(window.__rz); window.__rz = setTimeout(() => { try { rendition && rendition.resize(); } catch (e) {} }, 150); }).observe($('#viewer'));

/* --- верхняя / нижняя панели --- */
const toggleChrome = force => { const on = force != null ? force : !document.body.classList.contains('chrome'); document.body.classList.toggle('chrome', on); };
$('#rBack').onclick = () => { const r = rendition, bk = book; rendition = null; book = null; saveBooks(); show('Lib'); setTimeout(() => { try { r && r.destroy(); } catch (e) {} try { bk && bk.destroy(); } catch (e) {} }, 50); };
let scrubbing = false;
$('#scrub').oninput = () => { scrubbing = true; const p = $('#scrub').value / 1000; $('#bPct').textContent = Math.round(p * 100) + '%'; };
$('#scrub').onchange = () => { scrubbing = false; if (!book || !book.locations.length()) { toast('Считаю страницы, секунду…'); return; } const cfi = book.locations.cfiFromPercentage($('#scrub').value / 1000); if (cfi) rendition.display(cfi); };
function goChapter(d) {
  if (!book || !lastLoc) return;
  if (d < 0) { const s = book.spine.get(lastLoc.start.index); const pg = lastLoc.start.displayed && lastLoc.start.displayed.page; if (s && pg > 1) { rendition.display(s.href); return; } }
  const s = book.spine.get(lastLoc.start.index + d); if (s) rendition.display(s.href); else toast(d > 0 ? 'Это последняя глава' : 'Это начало книги');
}
$('#chPrev').onclick = () => goChapter(-1); $('#chNext').onclick = () => goChapter(1);

/* --- ввод внутри страницы: тап по слову, края, свайп --- */
let pt = null;
function attachInput(contents) {
  const doc = contents.document, win = contents.window;
  doc.addEventListener('pointerdown', act, true); doc.addEventListener('keydown', act, true);
  doc.addEventListener('pointerdown', e => { pt = { x: e.clientX, y: e.clientY, sx: e.screenX, sy: e.screenY, t: Date.now(), type: e.pointerType }; }, { passive: true });
  doc.addEventListener('pointerup', e => {
    if (!pt) return; const p = pt; pt = null;
    const dx = e.screenX - p.sx, dy = e.screenY - p.sy, dt = Date.now() - p.t;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 700) { killTapHint(); closeSheet(); dx < 0 ? next() : prev(); return; }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    const sel = win.getSelection(); if (sel && !sel.isCollapsed && norm(sel.toString())) return; // выделение мышью — обработает 'selected'
    onTap(e, contents);
  });
  doc.addEventListener('keyup', keyNav);
  doc.addEventListener('contextmenu', e => { if (p_isTouch()) e.preventDefault(); });
}
const p_isTouch = () => matchMedia('(pointer:coarse)').matches;
const next = () => { buzz(4); rendition && rendition.next(); }, prev = () => { buzz(4); rendition && rendition.prev(); };
let tapHintT = null;
function killTapHint() { clearTimeout(tapHintT); $('#tapHint').classList.remove('on'); }
function onTap(e, contents) {
  killTapHint();
  const fr = contents.document.defaultView.frameElement; const vr = $('#viewer').getBoundingClientRect(); const fb = fr.getBoundingClientRect();
  const x = fb.left + e.clientX - vr.left, w = vr.width;
  const edge = Math.max(44, w * 0.12);
  if (x < edge && !isSheetOpen()) { prev(); return; }
  if (x > w - edge && !isSheetOpen()) { next(); return; }
  const wr = wordRangeAt(contents.document, e.clientX, e.clientY);
  if (!wr) { if (isSheetOpen()) { closeSheet(); return; } if (document.body.classList.contains('chrome')) toggleChrome(false); else toggleChrome(true); return; }
  toggleChrome(false);
  let range = wr, isPhrase = false;
  if (phrase && phrase.doc === contents.document && Date.now() - phrase.t < 6000 && blockOf(wr.startContainer) === phrase.block && !sameRange(wr, phrase.range)) {
    range = contents.document.createRange();
    if (wr.compareBoundaryPoints(Range.START_TO_START, phrase.range) < 0) { range.setStart(wr.startContainer, wr.startOffset); range.setEnd(phrase.range.endContainer, phrase.range.endOffset); }
    else { range.setStart(phrase.range.startContainer, phrase.range.startOffset); range.setEnd(wr.endContainer, wr.endOffset); }
    if (norm(range.toString()).length > 300) range = wr; else isPhrase = true;
  }
  buzz(8);
  handleRange(range, contents, isPhrase ? 'phrase' : 'word');
}
const sameRange = (a, b) => a.startContainer === b.startContainer && a.startOffset === b.startOffset;
const WCH = /[A-Za-zÀ-ÖØ-öø-ÿ0-9'’\-]/;
function wordRangeAt(doc, x, y) {
  let r = null;
  if (doc.caretRangeFromPoint) r = doc.caretRangeFromPoint(x, y);
  else if (doc.caretPositionFromPoint) { const p = doc.caretPositionFromPoint(x, y); if (p) { r = doc.createRange(); r.setStart(p.offsetNode, p.offset); } }
  if (!r || r.startContainer.nodeType !== 3) return null;
  const node = r.startContainer, t = node.data; let i = r.startOffset;
  if (i >= t.length || !WCH.test(t[i])) { if (i > 0 && WCH.test(t[i - 1])) i--; else return null; }
  let a = i, b = i; while (a > 0 && WCH.test(t[a - 1])) a--; while (b < t.length && WCH.test(t[b])) b++;
  while (a < b && /['’\-]/.test(t[a])) a++; while (b > a && /['’\-]/.test(t[b - 1])) b--;
  if (b <= a || !/[A-Za-zÀ-ÿ]/.test(t.slice(a, b))) return null;
  const wr = doc.createRange(); wr.setStart(node, a); wr.setEnd(node, b);
  for (const rc of wr.getClientRects()) if (x >= rc.left - 6 && x <= rc.right + 6 && y >= rc.top - 6 && y <= rc.bottom + 6) return wr;
  return null;
}
const BLOCKS = new Set(['P', 'LI', 'DIV', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'DD', 'DT', 'SECTION', 'BODY']);
function blockOf(n) { if (n.nodeType === 3) n = n.parentElement; while (n && !BLOCKS.has(n.tagName)) n = n.parentElement; return n; }
function onSelectedRange(cfiRange, contents) {
  if (p_isTouch()) return; // на телефоне работаем тапами
  const range = contents.range(cfiRange); if (!norm(range.toString())) return;
  handleRange(range, contents, 'select', cfiRange);
}

/* --- контекст и запрос перевода --- */
let phrase = null, selCfi = null, aborter = null, curCtx = null, paintRaf = 0;
function handleRange(range, contents, kind, cfiKnown) {
  const sel = norm(range.toString()); if (!sel || sel.length > 400) return;
  const blk = blockOf(range.startContainer);
  const para = norm((blk && blk.textContent) || sel);
  let idx = para.indexOf(sel); if (idx < 0) idx = Math.max(0, para.toLowerCase().indexOf(sel.toLowerCase()));
  let s = idx, e = idx + sel.length;
  while (s > 0 && !/[.!?…]["”’)]?\s$/.test(para.slice(Math.max(0, s - 3), s))) s--;
  while (e < para.length && !/[.!?…]/.test(para[e - 1] || '')) e++;
  while (e < para.length && /["”’)]/.test(para[e])) e++;
  const sentence = para.slice(s, e).trim() || sel;
  const context = para.slice(Math.max(0, idx - 700), Math.min(para.length, idx + sel.length + 700));
  const prevEl = blk && blk.previousElementSibling; const prevTxt = prevEl ? norm(prevEl.textContent).slice(-350) : '';
  let cfi = cfiKnown; try { cfi = cfi || contents.cfiFromRange(range); } catch (e) {}
  // подсветка выделенного
  try { if (selCfi) rendition.annotations.remove(selCfi, 'highlight'); } catch (e) {}
  if (cfi) { try { const T = THEME[S.theme]; rendition.annotations.highlight(cfi, {}, null, 'lr-sel', { fill: T.sel, 'fill-opacity': T.selOp }); selCfi = cfi; } catch (e) {} }
  try { contents.window.getSelection().removeAllRanges(); } catch (e) {}
  phrase = kind === 'word' ? { doc: contents.document, block: blk, range: range.cloneRange(), t: Date.now() } : null;
  curCtx = { sel, sentence, context, prev: prevTxt, cfi, kind, chapter: curChapter };
  if (kind === 'word') showHint(); else hideHint();
  translate(curCtx);
}
function buildPrompt(c) {
  const lvl = S.level || 'B1';
  return `You help a Russian-speaking learner (English level ${lvl}) read an English book and understand a selected word or phrase in context.
BOOK: "${curBook ? curBook.title : ''}"${curBook && curBook.author ? ' by ' + curBook.author : ''}${c.chapter ? ', chapter: ' + c.chapter : ''}
${c.prev ? 'Previous paragraph (end): """' + c.prev + '"""\n' : ''}Current paragraph (context): """${c.context}"""
Sentence containing the selection: """${c.sentence}"""
Selected text: """${c.sel}"""

Translate the SELECTED TEXT into Russian exactly as it is used here (given the book's setting, speaker and tone). If it is part of an idiom or phrasal verb in this sentence, translate the whole expression. Do not give the most common dictionary meaning if it differs from the meaning in this context.
Return ONLY one JSON object (no markdown), keys in EXACTLY this order:
{
 "translation": "short contextual Russian translation (this goes first!)",
 "pos": "part of speech in Russian (глагол, существительное, фразовый глагол, идиома…), or empty",
 "examples": [{"en":"short natural example with the SAME meaning, level ${lvl}","ru":"Russian translation"},{"en":"another example, different situation","ru":"Russian translation"}],
 "base_form": "dictionary form if different, or empty",
 "transcription": "IPA for a single word or short phrase, otherwise empty",
 "explanation": "1-2 short sentences in Russian: why this meaning here; mention another common meaning only if it could confuse",
 "sentence_translation": "natural Russian translation of the sentence containing the selection"
}`;
}
const cacheKey = c => (S.level || 'B1') + '|' + c.sel.toLowerCase() + '||' + c.sentence.slice(0, 220);
async function translate(c) {
  if (aborter) aborter.abort(); aborter = new AbortController(); const signal = aborter.signal;
  openSheet(false);
  const key = cacheKey(c);
  if (cache[key]) { paint(c, cache[key], true); return; }
  paint(c, {}, false);
  try {
    const res = await gemini(buildPrompt(c), signal, r => { if (signal.aborted) return; cancelAnimationFrame(paintRaf); paintRaf = requestAnimationFrame(() => { if (curCtx === c) paint(c, r, false); }); });
    cache[key] = res; const ks = Object.keys(cache); if (ks.length > 1500) ks.slice(0, 300).forEach(k => delete cache[k]); LS.set('lr_cache', cache);
    if (!signal.aborted && curCtx === c) { cancelAnimationFrame(paintRaf); paint(c, res, true); }
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (curCtx !== c) return;
    const body = $('#sheetBody'); body.innerHTML = '';
    body.append(h('div', { class: 'sh-head' }, h('h3', { lang: 'en', text: c.sel })), h('div', { class: 'err', text: e.message }),
      e.needKey ? h('button', { class: 'btn primary', onclick: () => openKey('Reader') }, 'Добавить ключ') : h('button', { class: 'btn', onclick: () => translate(c) }, 'Повторить'));
  }
}

/* --- шторка перевода --- */
const sheet = $('#sheet');
const isSheetOpen = () => sheet.classList.contains('open');
function openSheet(full) { if (isDesk()) full = true; sheet.classList.add('open'); sheet.classList.toggle('full', !!full); sheet.setAttribute('aria-hidden', 'false'); document.body.classList.add('sheet-open'); placeHint(); }
function closeSheet() {
  if (!isSheetOpen()) return;
  sheet.classList.remove('open', 'full'); sheet.setAttribute('aria-hidden', 'true'); document.body.classList.remove('sheet-open'); hideHint();
  if (aborter) aborter.abort(); phrase = null;
  try { if (selCfi && rendition) rendition.annotations.remove(selCfi, 'highlight'); } catch (e) {} selCfi = null;
}
let hintT; function showHint() { if (isDesk()) return; const el = $('#hint'); el.classList.add('on'); placeHint(); clearTimeout(hintT); hintT = setTimeout(hideHint, 4500); }
function hideHint() { $('#hint').classList.remove('on'); }
function placeHint() { requestAnimationFrame(() => { $('#hint').style.top = Math.max(60, window.innerHeight - sheet.offsetHeight - 52) + 'px'; }); }
// перетаскивание шторки
(() => {
  let y0 = null, h0 = 0;
  const start = e => { if (isDesk()) return; y0 = e.clientY; h0 = sheet.getBoundingClientRect().height; sheet.style.transition = 'none'; e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); };
  const move = e => { if (y0 == null) return; const d = e.clientY - y0; if (d > 0) sheet.style.transform = `translateY(${d}px)`; else { sheet.style.maxHeight = (h0 - d) + 'px'; sheet.style.height = (h0 - d) + 'px'; } };
  const end = e => { if (y0 == null) return; const d = e.clientY - y0; y0 = null; sheet.style.transition = ''; sheet.style.transform = ''; sheet.style.maxHeight = ''; sheet.style.height = '';
    if (Math.abs(d) < 6) { if (e.target.closest('.grab')) openSheet(!sheet.classList.contains('full')); return; }
    if (d < -40) openSheet(true); else if (d > 60) { if (sheet.classList.contains('full')) openSheet(false); else closeSheet(); } else openSheet(sheet.classList.contains('full')); };
  const grab = $('#sheetGrab');
  grab.addEventListener('pointerdown', start); grab.addEventListener('pointermove', move); grab.addEventListener('pointerup', end); grab.addEventListener('pointercancel', end);
  sheet.addEventListener('pointerdown', e => { if (e.target.closest('.sh-head') && !e.target.closest('button')) start(e); });
  sheet.addEventListener('pointermove', e => { if (y0 != null && !e.target.closest('#sheetGrab')) move(e); });
  sheet.addEventListener('pointerup', e => { if (y0 != null && !e.target.closest('#sheetGrab')) end(e); });
})();
function iconBtn(n, label, fn, cls = 'icobtn', size = 22) { return h('button', { class: cls, 'aria-label': label, onclick: ev => { ev.stopPropagation(); fn(ev); } }, ico(n, size)); }
function savedWord(c) { return words.find(w => w.bookId === (curBook && curBook.id) && w.w.toLowerCase() === c.sel.toLowerCase()); }
function paint(c, r, done) {
  const body = $('#sheetBody'); const top = body.scrollTop; body.innerHTML = '';
  const sv = savedWord(c);
  const star = h('button', { class: 'star', 'aria-label': sv ? 'Убрать из словаря' : 'В словарь', 'aria-pressed': String(!!sv), disabled: !done && !sv, onclick: () => toggleSave(c, r) }, ico('star', 22));
  body.append(h('div', { class: 'sh-head' }, h('h3', { lang: 'en', text: c.sel }), iconBtn('speak', 'Произнести', () => speak(c.sel)), h('span', { class: 'pos', text: r.pos || '' }), star));
  const meta = [r.transcription, r.base_form && r.base_form.toLowerCase() !== c.sel.toLowerCase() ? 'словарная форма: ' + r.base_form : ''].filter(Boolean).join(' · ');
  if (meta) body.append(h('div', { class: 'sh-meta full-only', text: meta }));
  body.append(r.translation ? h('div', { class: 'sh-tr', text: r.translation }) : h('div', { class: 'muted' }, h('span', { class: 'spin' }), '  Перевожу…'));
  const ex = Array.isArray(r.examples) ? r.examples.filter(x => x && x.en) : [];
  if (ex[0]) body.append(h('div', { class: 'sh-ex peek-only' }, h('div', { class: 'en', lang: 'en', text: ex[0].en }), h('div', { class: 'ru', text: ex[0].ru || '' })));
  if (r.explanation) body.append(h('div', { class: 'sh-sec full-only' }, h('h4', null, 'Почему так'), h('p', { text: r.explanation })));
  const bookP = h('p', { class: 'book', lang: 'en' }); const i = c.sentence.toLowerCase().indexOf(c.sel.toLowerCase());
  if (i >= 0) bookP.append(c.sentence.slice(0, i), h('mark', { text: c.sentence.slice(i, i + c.sel.length) }), c.sentence.slice(i + c.sel.length)); else bookP.textContent = c.sentence;
  body.append(h('div', { class: 'sh-sec full-only' }, h('h4', null, 'В книге'), bookP, r.sentence_translation ? h('p', { class: 'muted', style: 'font-size:14px;margin-top:4px', text: r.sentence_translation }) : null));
  if (ex.length) body.append(h('div', { class: 'sh-sec full-only' }, h('h4', null, 'Примеры'), h('div', { class: 'exs' }, ex.slice(0, 2).map(x => h('div', { class: 'row' }, h('div', null, h('div', { class: 'en', lang: 'en', text: x.en }), h('div', { class: 'ru', text: x.ru || '' })), iconBtn('speak', 'Произнести пример', () => speak(x.en), 'icobtn', 18))))));
  body.append(h('div', { class: 'sh-acts peek-only' },
    h('button', { class: 'btn', onclick: () => addQuote(c) }, ico('quote', 18), 'Цитата'),
    h('button', { class: 'btn', onclick: () => openNote(c) }, ico('note', 18), 'Заметка'),
    h('button', { class: 'btn dark', onclick: () => openSheet(true) }, 'Подробнее', ico('up', 16))));
  body.append(h('div', { class: 'sh-acts full-only' },
    h('button', { class: 'btn primary', disabled: !done && !sv, onclick: () => toggleSave(c, r) }, ico('star', 18, sv ? 'fill:currentColor' : ''), sv ? 'В словаре' : 'В словарь'),
    h('button', { class: 'btn sq', 'aria-label': 'Цитата', onclick: () => addQuote(c) }, ico('quote', 20)),
    h('button', { class: 'btn sq', 'aria-label': 'Заметка', onclick: () => openNote(c) }, ico('note', 20))));
  body.scrollTop = top; placeHint();
}
function toggleSave(c, r) {
  const sv = savedWord(c);
  if (sv) { words = words.filter(w => w !== sv); toast('Убрано из словаря'); }
  else { words.unshift({ id: 'w' + uid(), bookId: curBook.id, cfi: c.cfi, w: c.sel, tr: r.translation || '', pos: r.pos || '', tc: r.transcription || '', base: r.base_form || '', exp: r.explanation || '', ex: (r.examples || []).slice(0, 2), s: c.sentence, st: r.sentence_translation || '', chapter: c.chapter, t: Date.now(), box: 0, due: Date.now() }); buzz(12); toast('Добавлено в словарь'); }
  saveWords(); updBadge(); paint(c, r, true);
  try { rendition.getContents().forEach(ct => underlineSaved(ct)); } catch (e) {}
}

/* --- подчёркивание сохранённых слов во всём тексте --- */
const ulAdded = new Set();
function underlineSaved(contents) {
  if (!contents || !rendition) return;
  ulAdded.forEach(cfi => { try { rendition.annotations.remove(cfi, 'underline'); } catch (e) {} }); ulAdded.clear();
  const list = [...new Set(words.map(w => w.w.toLowerCase()).filter(w => w.length > 1 && w.length < 60))];
  if (!list.length) return;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const re = new RegExp('(^|[^A-Za-zÀ-ÿ])(' + list.sort((a, b) => b.length - a.length).map(esc).join('|') + ')(?![A-Za-zÀ-ÿ])', 'gi');
  const doc = contents.document, walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT); let n, count = 0;
    while ((n = walker.nextNode()) && count < 400) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(n.data)) && count < 400) {
      const a = m.index + m[1].length, b = a + m[2].length; const r = doc.createRange(); r.setStart(n, a); r.setEnd(n, b);
      try { const cfi = contents.cfiFromRange(r); rendition.annotations.underline(cfi, {}, null, 'lr-saved', { 'stroke-opacity': '1', 'mix-blend-mode': 'normal' }); ulAdded.add(cfi); count++; } catch (e) {}
    }
  }
}

/* --- цитаты и заметки --- */
function addQuoteMark(n) { try { rendition.annotations.highlight(n.cfi, {}, null, 'lr-quote', { fill: THEME[S.theme].quote, 'fill-opacity': '0.5' }); } catch (e) {} }
function addQuote(c, noteText) {
  const ex = notes.find(n => n.bookId === curBook.id && n.cfi === c.cfi);
  if (ex) { if (noteText != null) ex.note = noteText; saveNotes(); toast(noteText != null ? 'Заметка сохранена' : 'Цитата уже сохранена'); return; }
  const text = c.kind === 'word' ? c.sentence : c.sel;
  let cfi = c.cfi;
  // для одного слова сохраняем всё предложение как цитату — проще найти и перечитать
  if (c.kind === 'word') { try { const doc = rendition.getContents()[0]; const blk = phrase && phrase.block; if (blk && doc) { const tn = findTextRange(blk, c.sentence); if (tn) cfi = doc.cfiFromRange(tn); } } catch (e) {} }
  const n = { id: 'n' + uid(), bookId: curBook.id, cfi, text, note: noteText || '', chapter: c.chapter, pct: curBook.pct || 0, t: Date.now() };
  notes.unshift(n); saveNotes(); addQuoteMark(n); buzz(10); toast(noteText ? 'Заметка сохранена' : 'Цитата сохранена');
}
function findTextRange(blk, sentence) {
  const doc = blk.ownerDocument, walker = doc.createTreeWalker(blk, NodeFilter.SHOW_TEXT); const nodes = []; let n, full = '';
  while ((n = walker.nextNode())) { nodes.push([n, full.length]); full += n.data; }
  const target = sentence.slice(0, 40); const flat = full.replace(/\s+/g, ' ');
  if (flat !== full) return null; // сложный пробельный текст — оставляем исходный диапазон
  const i = full.indexOf(target), j = full.indexOf(sentence.slice(-20), i); if (i < 0 || j < 0) return null;
  const endPos = j + Math.min(20, sentence.length);
  const at = pos => { for (let k = nodes.length - 1; k >= 0; k--) if (nodes[k][1] <= pos) return [nodes[k][0], pos - nodes[k][1]]; return null; };
  const s = at(i), e = at(endPos); if (!s || !e) return null; const r = doc.createRange(); r.setStart(s[0], s[1]); r.setEnd(e[0], Math.min(e[1], e[0].data.length)); return r;
}
function openNote(c) {
  const ta = h('textarea', { class: 'field', rows: '4', placeholder: 'Ваша мысль, перевод, вопрос…', style: 'resize:vertical;min-height:110px' });
  openModal([
    h('h3', null, 'Заметка'),
    h('div', { class: 'qcard' }, h('div', { class: 'q', lang: 'en', text: c.kind === 'word' ? c.sentence : c.sel })),
    h('label', { class: 'vh', for: 'noteTa' }, 'Текст заметки'), Object.assign(ta, { id: 'noteTa' }),
    h('div', { style: 'display:flex;gap:8px' }, h('button', { class: 'btn', style: 'flex:1', onclick: closeModal }, 'Отмена'), h('button', { class: 'btn primary', style: 'flex:1', onclick: () => { addQuote(c, norm(ta.value)); closeModal(); } }, 'Сохранить'))
  ]);
  setTimeout(() => ta.focus(), 250);
}

/* --- закладки --- */
const CFIc = () => new ePub.CFI();
function markHere() { if (!lastLoc || !curBook) return null; const cmp = CFIc(); return marks.find(m => m.bookId === curBook.id && cmp.compare(m.cfi, lastLoc.start.cfi) >= 0 && cmp.compare(m.cfi, lastLoc.end.cfi) <= 0); }
function updMarkBtn() { const on = !!markHere(); const b = $('#rMark'); b.setAttribute('aria-pressed', String(on)); b.querySelector('svg').style.fill = on ? 'currentColor' : 'none'; b.style.color = on ? 'var(--accent)' : ''; }
$('#rMark').onclick = async () => {
  if (!lastLoc) return; const ex = markHere();
  if (ex) { marks = marks.filter(m => m !== ex); saveMarks(); updMarkBtn(); toast('Закладка убрана'); return; }
  let excerpt = ''; try { const r = await book.getRange(lastLoc.start.cfi); const blk = blockOf(r.startContainer); excerpt = norm((blk || r.startContainer).textContent).slice(0, 120); } catch (e) {}
  marks.unshift({ id: 'm' + uid(), bookId: curBook.id, cfi: lastLoc.start.cfi, excerpt, chapter: curChapter, pct: curBook.pct || 0, t: Date.now() }); saveMarks(); updMarkBtn(); buzz(10); toast('Закладка добавлена');
};

/* --- модальная шторка --- */
const modal = $('#modal'), scrim = $('#scrim');
function openModal(kids, opts = {}) { $('#modalBody').replaceChildren(...kids); modal.classList.toggle('tall', !!opts.tall); scrim.classList.toggle('clear', !!opts.clear); modal.classList.add('open'); scrim.classList.add('on'); modal.setAttribute('aria-hidden', 'false'); }
function closeModal() { modal.classList.remove('open'); scrim.classList.remove('on'); modal.setAttribute('aria-hidden', 'true'); }
scrim.onclick = closeModal;
(() => { let y0 = null; const g = modal.querySelector('.grab'); g.addEventListener('pointerdown', e => { y0 = e.clientY; g.setPointerCapture(e.pointerId); }); g.addEventListener('pointerup', e => { if (y0 != null && e.clientY - y0 > 40) closeModal(); y0 = null; }); })();

/* Aa */
function seg(opts, val, fn, label) { return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label }, opts.map(([v, t]) => h('button', { role: 'radio', 'aria-checked': String(v === val), onclick: () => fn(v) }, t))); }
function renderAa() {
  const T = { paper: ['Бумага', '#FBF8F1', '#2A2620'], sepia: ['Сепия', '#F1E4C8', '#3B2F1E'], night: ['Ночь', '#1E1D1A', '#D9D4C7'] };
  const upd = () => { saveS(); applyReader(); renderAa(); setTimeout(() => { try { rendition.getContents().forEach(c => underlineSaved(c)); } catch (e) {} }, 400); };
  $('#modalBody').replaceChildren(
    h('h3', null, 'Шрифт и вид'),
    h('div', { class: 'fonts', role: 'radiogroup', 'aria-label': 'Шрифт' }, FONTS.map(f => h('button', { role: 'radio', 'aria-checked': String(S.font === f.id), onclick: () => { S.font = f.id; upd(); } }, h('b', { style: `font-family:${f.css}` }, 'Aa'), h('small', null, f.name)))),
    h('div', { class: 'aa-row' }, h('span', null, 'Размер'),
      h('button', { class: 'btn', style: 'width:52px;padding:0', 'aria-label': 'Меньше', onclick: () => { S.size = Math.max(14, S.size - 1); upd(); } }, 'A−'),
      h('b', { style: 'flex:1;text-align:center;font-size:16px', text: S.size }),
      h('button', { class: 'btn', style: 'width:52px;padding:0;font-size:19px', 'aria-label': 'Больше', onclick: () => { S.size = Math.min(30, S.size + 1); upd(); } }, 'A+')),
    h('div', { class: 'aa-row' }, h('span', null, 'Интервал'), seg([['s', 'Плотно'], ['m', 'Обычно'], ['l', 'Свободно']], S.lh, v => { S.lh = v; upd(); }, 'Интервал')),
    h('div', { class: 'aa-row' }, h('span', null, 'Поля'), seg([['s', 'Узкие'], ['m', 'Средние'], ['l', 'Широкие']], S.margin, v => { S.margin = v; upd(); }, 'Поля')),
    h('div', { class: 'aa-row' }, h('span', null, 'Тема'), h('div', { class: 'themes', role: 'radiogroup', 'aria-label': 'Тема' }, Object.entries(T).map(([k, [t, bg, fg]]) => h('button', { role: 'radio', 'aria-checked': String(S.theme === k), style: `background:${bg};color:${fg}`, onclick: () => { S.theme = k; upd(); } }, t))))
  );
}
$('#aaBtn').onclick = () => { openModal([], { clear: true }); renderAa(); };

/* оглавление / закладки / заметки */
let tocTab = 'toc';
function renderToc() {
  const tabs = h('div', { class: 'seg', role: 'tablist' }, [['toc', 'Главы'], ['marks', 'Закладки'], ['notes', 'Заметки']].map(([v, t]) => h('button', { role: 'tab', 'aria-selected': String(tocTab === v), onclick: () => { tocTab = v; renderToc(); } }, t)));
  const kids = [tabs];
  const go = cfi => { closeModal(); toggleChrome(false); rendition.display(cfi); };
  if (tocTab === 'toc') {
    if (!navToc.length) kids.push(h('div', { class: 'empty', text: 'В этой книге нет оглавления' }));
    else kids.push(h('ul', { class: 'tlist' }, navToc.map(t => h('li', null, h('button', { onclick: () => go(t.href), style: `padding-left:${2 + t.depth * 16}px` }, h('span', { class: t.label === curChapter ? 'cur' : '', style: 'flex:1;font-size:16px', text: t.label }), t.label === curChapter ? h('small', { text: 'Вы здесь' }) : null)))));
  } else if (tocTab === 'marks') {
    const ms = marks.filter(m => m.bookId === curBook.id);
    if (!ms.length) kids.push(h('div', { class: 'empty', text: 'Закладок пока нет. Нажмите значок закладки в верхней панели.' }));
    else kids.push(h('ul', { class: 'tlist' }, ms.map(m => h('li', null, h('button', { onclick: () => go(m.cfi) }, ico('mark', 20, 'color:var(--accent)'), h('span', { class: 'sub' }, h('b', { style: 'font-size:15px', text: [m.chapter, Math.round(m.pct * 100) + '%'].filter(Boolean).join(' · ') }), h('span', { class: 'ex', lang: 'en', text: m.excerpt }), h('small', { text: new Date(m.t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) })), iconBtn('x', 'Удалить закладку', () => { marks = marks.filter(x => x !== m); saveMarks(); updMarkBtn(); renderToc(); }, 'icobtn', 16))))));
  } else {
    const ns = notes.filter(n => n.bookId === curBook.id);
    if (!ns.length) kids.push(h('div', { class: 'empty', text: 'Коснитесь слова и нажмите «Цитата» или «Заметка».' }));
    else ns.forEach(n => kids.push(h('div', { class: 'qcard' },
      h('div', { class: 'lbl' }, h('span', { text: (n.note ? 'Заметка' : 'Цитата') + (n.chapter ? ' · ' + n.chapter : '') }), iconBtn('x', 'Удалить', () => { notes = notes.filter(x => x !== n); saveNotes(); try { rendition.annotations.remove(n.cfi, 'highlight'); } catch (e) {} renderToc(); }, 'icobtn', 16)),
      h('button', { class: 'q', lang: 'en', onclick: () => go(n.cfi), text: n.text }),
      n.note ? h('div', { style: 'font-size:14px;color:var(--ink2);display:flex;gap:6px' }, ico('note', 16, 'margin-top:2px'), n.note) : null)));
  }
  $('#modalBody').replaceChildren(...kids);
}
$('#rToc').onclick = () => { openModal([], { tall: true }); renderToc(); };

/* поиск */
let searchRun = 0;
$('#rSearch').onclick = () => {
  const inp = h('input', { class: 'field', type: 'search', placeholder: 'Слово или фраза', 'aria-label': 'Поиск по книге', enterkeyhint: 'search' });
  const out = h('div'); const status = h('div', { class: 'muted', style: 'font-size:13px' });
  const run = async () => {
    const q = norm(inp.value); const my = ++searchRun; out.innerHTML = ''; if (q.length < 2) { status.textContent = ''; return; }
    status.replaceChildren(h('span', { class: 'spin' }), '  Ищу…'); let found = 0; const ul = h('ul', { class: 'tlist' }); out.append(ul);
    for (const item of book.spine.spineItems) {
      if (my !== searchRun) return;
      try { await item.load(book.load.bind(book)); const res = item.find(q); item.unload();
        res.slice(0, 40).forEach(r => { if (found >= 150) return; found++; const ex = norm(r.excerpt); const i = ex.toLowerCase().indexOf(q.toLowerCase());
          const sp = h('span', { class: 'ex', lang: 'en' }); if (i >= 0) sp.append(ex.slice(0, i), h('mark', { text: ex.slice(i, i + q.length) }), ex.slice(i + q.length)); else sp.textContent = ex;
          ul.append(h('li', null, h('button', { onclick: () => { closeModal(); rendition.display(r.cfi); } }, h('span', { class: 'sub' }, sp)))); });
      } catch (e) {}
      status.textContent = found ? 'Найдено: ' + found + '…' : 'Ищу…';
    }
    if (my === searchRun) status.textContent = found ? 'Найдено: ' + found : 'Ничего не найдено';
  };
  let t; inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 350); });
  openModal([h('h3', null, 'Поиск по книге'), inp, status, out], { tall: true });
  setTimeout(() => inp.focus(), 250);
};

/* клавиатура (компьютер) */
function keyNav(e) {
  if (current !== 'Reader' || /INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || '')) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') next();
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
  else if (e.key === 'Escape') { if (modal.classList.contains('open')) closeModal(); else closeSheet(); }
  else if ((e.key === 's' || e.key === 'ы') && curCtx && isSheetOpen()) { const r = cache[cacheKey(curCtx)]; if (r) toggleSave(curCtx, r); }
  else if ((e.key === 'p' || e.key === 'з') && curCtx && isSheetOpen()) speak(curCtx.sel);
}
document.addEventListener('keyup', keyNav);

/* ================= старт ================= */
applyTheme();
if ('serviceWorker' in navigator && /^https:|^http:\/\/localhost/.test(location.href)) navigator.serviceWorker.register('sw.js').catch(() => {});
try { speechSynthesis.getVoices(); } catch (e) {}
function nextAfterLogin() {
  if (!S.level) { lvlReturn = 'Key'; renderLevels(); show('Level'); }
  else if (!getKey() && !LS.get('lr_skipkey', false)) openKey('Lib');
  else show('Lib');
}
async function afterLogin() {
  if (!user || loggedFor === user.id) return; loggedFor = user.id;
  const prev = LS.get('lr_uid', '');
  if (prev !== user.id) {
    if (prev) { // другой аккаунт на этом устройстве — начинаем с чистого листа
      books = []; words = []; notes = []; marks = []; days = []; S = Object.assign({}, DEF); queue = {};
      for (const k of ['lr_books', 'lr_words', 'lr_notes', 'lr_marks', 'lr_days', 'lr_s', 'lr_queue', 'lr_skipkey']) localStorage.removeItem(k);
    }
    snap = EMPTY_SNAP(); LS.set('lr_uid', user.id);
    diffAll(); // книги и слова из локального режима переезжают в аккаунт
    if (!S.level) { delete queue['set|S']; snap.set = {}; } // пустые настройки нового устройства не должны затирать серверные
    LS.set('lr_queue', queue); LS.set('lr_snap', snap);
  }
  show('Lib'); $('#bookList').replaceChildren(h('li', { class: 'empty', style: 'display:block;border:0' }, h('span', { class: 'spin' }), '  Загружаю библиотеку…'));
  try { await pull(); } catch (e) { console.warn(e); toast('Нет связи с сервером — показываю сохранённое на устройстве', 4000); }
  try { const r = await sb.rpc('get_key_status'); keyLast4 = (r.data && r.data[0] && r.data[0].last4) || ''; } catch (e) {}
  applyTheme(); ensureUploads();
  nextAfterLogin();
}
$('#btnGoogle').onclick = async () => {
  $('#loginMsg').innerHTML = '';
  const r = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } } });
  if (r.error) $('#loginMsg').replaceChildren(h('div', { class: 'err', text: r.error.message }));
};
async function boot() {
  if (!CLOUD) { nextAfterLogin(); return; }
  sb.auth.onAuthStateChange((ev, sess) => {
    if (ev === 'SIGNED_OUT') { user = null; loggedFor = ''; keyLast4 = ''; show('Login'); return; }
    if (sess && sess.user && (!user || user.id !== sess.user.id)) { user = sess.user; setTimeout(afterLogin, 0); }
  });
  let session = null;
  try { session = (await sb.auth.getSession()).data.session; } catch (e) {}
  if (session) { user = session.user; await afterLogin(); return; }
  const qs = new URLSearchParams(location.search + '&' + location.hash.replace(/^#/, ''));
  show('Login');
  if (qs.get('error_description')) $('#loginMsg').replaceChildren(h('div', { class: 'err', text: 'Вход не удался: ' + qs.get('error_description') }));
  if (qs.get('code')) $('#loginMsg').replaceChildren(h('div', { class: 'muted' }, h('span', { class: 'spin' }), '  Входим…'));
}
addEventListener('online', () => flush());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
boot();
$('#keySkip').addEventListener('click', () => LS.set('lr_skipkey', true));
window.__lr = { get rendition() { return rendition; }, get book() { return book; }, S };
})();
