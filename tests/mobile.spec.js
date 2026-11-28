// Вёрстка на телефонах: с учётом панелей браузера видимая высота ~550–740 px.
// Проверяем, что главное помещается, ничего не уезжает вбок и не прячется под нижнее меню.
const { test, expect } = require('@playwright/test');
const { FakeDB, attach } = require('./fake-supabase');

const SIZES = [{ width: 375, height: 553 }, { width: 390, height: 664 }, { width: 430, height: 740 }];
const T0 = Date.UTC(2026, 10, 20);
const SEED = {
  lr_s: { level: 'B1' },
  lr_books: [{ id: 'cat-jane-austen_pride-and-prejudice', cat: 'jane-austen_pride-and-prejudice', title: 'Pride and Prejudice', author: 'Jane Austen', cover: 'catalog/covers/jane-austen_pride-and-prejudice.jpg', added: T0, pct: 0.23, lastRead: T0 + 1, up: true }],
  lr_words: [{ id: 'w1', bookId: 'cat-jane-austen_pride-and-prejudice', w: 'countenance', tr: 'выражение лица', s: 'Her countenance was a picture of calm.', t: T0, box: 0, due: T0 }],
};

async function phone(browser, size, { loggedIn = true, seed = SEED } = {}) {
  const db = new FakeDB();
  const context = await browser.newContext({ viewport: size, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await attach(context, db, { loggedIn });
  await context.addInitScript(seed => { if (localStorage.getItem('__seeded')) return; localStorage.setItem('__seeded', '1'); for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v)); }, seed);
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  return { page, db, errors };
}
const box = (page, sel) => page.locator(sel).first().boundingBox();
async function noSideScroll(page) {
  const over = await page.evaluate(() => [...document.querySelectorAll('.screen.on, .screen.on .scroll')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.id || e.className));
  expect(over, 'что-то уезжает вбок').toEqual([]);
}

for (const size of SIZES) {
  const name = size.width + '×' + size.height;

  test('вход помещается целиком ' + name, async ({ browser }, info) => {
    const { page, errors } = await phone(browser, size, { loggedIn: false });
    await page.goto('/');
    await expect(page.locator('#sLogin')).toHaveClass(/on/);
    const b = await box(page, '#btnGoogle');
    expect(b.y + b.height, 'кнопка входа видна').toBeLessThanOrEqual(size.height);
    const last = await box(page, '.lg-rep');
    expect(last.y + last.height, 'третий шаг не под кнопкой').toBeLessThanOrEqual(b.y + 2);
    await noSideScroll(page);
    await info.attach('вход ' + name, { body: await page.screenshot(), contentType: 'image/png' });
    expect(errors).toEqual([]);
  });

  test('уровень и ключ помещаются ' + name, async ({ browser }, info) => {
    const { page, errors } = await phone(browser, size, { seed: { lr_s: {} } });
    await page.goto('/');
    await expect(page.locator('#sLevel')).toHaveClass(/on/);
    const next = await box(page, '#lvlNext');
    expect(next.y + next.height, 'кнопка «Дальше» видна').toBeLessThanOrEqual(size.height);
    await noSideScroll(page);
    await info.attach('уровень ' + name, { body: await page.screenshot(), contentType: 'image/png' });
    await page.locator('#lvlNext').click();
    await expect(page.locator('#sKey')).toHaveClass(/on/);
    await noSideScroll(page);
    await info.attach('ключ ' + name, { body: await page.screenshot(), contentType: 'image/png' });
    expect(errors).toEqual([]);
  });

  test('вкладки ' + name, async ({ browser }, info) => {
    const { page, errors } = await phone(browser, size);
    await page.goto('/');
    await expect(page.locator('#sLib')).toHaveClass(/on/);
    const bar = await box(page, '#tabbar');
    expect(bar.y + bar.height).toBeLessThanOrEqual(size.height + 1);
    for (const tab of ['Lib', 'Words', 'Review', 'Profile']) {
      await page.locator(`#tabbar button[data-go=${tab}]`).click();
      await expect(page.locator('#s' + tab)).toHaveClass(/on/);
      await noSideScroll(page);
      if (tab === 'Review') {
        const hints = await box(page, '.rv-hints');
        expect(hints.y + hints.height, 'подсказки «Угадал/Не угадал» над нижним меню').toBeLessThanOrEqual(bar.y + 1);
      }
      await info.attach(tab + ' ' + name, { body: await page.screenshot(), contentType: 'image/png' });
    }
    expect(errors).toEqual([]);
  });
}

test('сохранённые переводы переезжают из localStorage в IndexedDB', async ({ browser }) => {
  const { page } = await phone(browser, SIZES[1], { seed: Object.assign({}, SEED, { lr_cache: { 'B1|countenance||Her countenance': { translation: 'выражение лица', _ok: 1, _v: 2 } } }) });
  await page.goto('/');
  await expect(page.locator('#sLib')).toHaveClass(/on/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lr_cache'))).toBeNull();
  await page.locator('#tabbar button[data-go=Profile]').click();
  await expect(page.locator('#profList')).toContainText('1 шт.');
  // и переживает перезапуск
  await page.reload(); await page.locator('#tabbar button[data-go=Profile]').click();
  await expect(page.locator('#profList')).toContainText('1 шт.');
});

test('книга из каталога открывается в читалке', async ({ browser }) => {
  const { page, errors } = await phone(browser, SIZES[1]);
  await page.goto('/');
  await page.locator('#contBox button', { hasText: 'Читать' }).click();
  await expect(page.locator('#sReader')).toHaveClass(/on/);
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30000 });
  const frame = page.frameLocator('#viewer iframe').first();
  await expect(frame.locator('body')).toContainText(/\w{3,}/, { timeout: 15000 });
  await page.locator('#rBack').click({ force: true }).catch(() => {});
  expect(errors).toEqual([]);
});

test('первое чтение: подсказка «коснитесь слова», после касания исчезает', async ({ browser }, info) => {
  const { page, errors } = await phone(browser, SIZES[0], { seed: Object.assign({}, SEED, { lr_words: [] }) });
  await page.goto('/');
  await page.locator('#contBox button', { hasText: 'Читать' }).click();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30000 });
  await expect(page.locator('#wordHint')).toHaveClass(/on/);
  const hint = await box(page, '#wordHint');
  expect(hint.x, 'не обрезана слева').toBeGreaterThanOrEqual(0);
  expect(hint.x + hint.width, 'не обрезана справа').toBeLessThanOrEqual(SIZES[0].width);
  await info.attach('подсказка', { body: await page.screenshot(), contentType: 'image/png' });
  // касание первого слова текста: координаты внутри iframe + положение самого iframe
  const fr = page.locator('#viewer iframe').first(); await expect(fr).toBeVisible();
  const ib = await fr.boundingBox();
  const pt = await page.frames().find(f => f !== page.mainFrame()).evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: n => /[A-Za-z]{4,}/.test(n.data) ? 1 : 2 });
    for (let n; (n = w.nextNode());) { const i = n.data.search(/[A-Za-z]{4,}/), r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 3); const b = r.getBoundingClientRect(); if (b.width && b.left >= 0 && b.left < innerWidth) return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }
  });
  await page.touchscreen.tap(ib.x + pt.x, ib.y + pt.y);
  await expect(page.locator('#wordHint')).not.toHaveClass(/on/);
  expect(await page.evaluate(() => localStorage.getItem('lr_tried'))).toBe('true');
  expect(errors).toEqual([]);
});

test('повреждённая книга: понятное сообщение и назад в библиотеку', async ({ browser }) => {
  const { page } = await phone(browser, SIZES[1], { seed: Object.assign({}, SEED, { lr_books: [{ id: 'bad1', title: 'Broken', author: 'X', added: T0, pct: 0, lastRead: T0 + 5, up: true }] }) });
  await page.goto('/');
  await expect(page.locator('#sLib')).toHaveClass(/on/);
  await page.evaluate(() => new Promise((ok, no) => { const r = indexedDB.open('lr-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => { try { const db = r.result; const st = 'f'; const tx = db.transaction(st, 'readwrite'); tx.objectStore(st).put(new TextEncoder().encode('not a zip at all').buffer, 'bad1'); tx.oncomplete = ok; tx.onerror = no; } catch (e) { no(e); } }; r.onerror = no; }));
  await page.locator('#contBox button', { hasText: 'Читать' }).click();
  await expect(page.locator('#toast')).toContainText(/не удалось открыть книгу/i, { timeout: 20000 });
  await expect(page.locator('#sLib')).toHaveClass(/on/);
});

test('слова: состояние повторения и выгрузка словаря файлом', async ({ browser }) => {
  const { page, errors } = await phone(browser, { width: 1000, height: 740 });
  await page.goto('/');
  await page.locator('#tabbar button[data-go=Words], [data-go=Words]').first().click();
  await expect(page.locator('#sWords')).toHaveClass(/on/);
  await expect(page.locator('.wst').first()).toHaveText('пора повторить');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#wExport').click()]);
  expect(dl.suggestedFilename()).toMatch(/^lingua-slova-\d{4}-\d{2}-\d{2}\.txt$/);
  const txt = require('fs').readFileSync(await dl.path(), 'utf8');
  expect(txt).toContain('#separator:tab');
  expect(txt).toContain('countenance\tвыражение лица');
  expect(txt).toContain('Pride and Prejudice');
  expect(errors).toEqual([]);
});

test('карточка: предложение только на обороте, касание по нему не переворачивает', async ({ browser }) => {
  const { page, errors } = await phone(browser, SIZES[1]);
  await page.addInitScript(() => { window.__said = []; speechSynthesis.speak = u => window.__said.push(u.text); });
  await page.goto('/');
  await page.locator('#tabbar button[data-go=Review]').click();
  const card = page.locator('.rv-card');
  await expect(card).toContainText('countenance');
  await expect(card.locator('.rv-sent')).toHaveCount(0);
  await card.click();
  await expect(card.locator('.rv-sent')).toContainText('picture of calm');
  await card.locator('.rv-sbtn').click();
  await expect(card.locator('.rv-sent')).toBeVisible(); // остались на обороте
  expect(await page.evaluate(() => window.__said)).toEqual(['Her countenance was a picture of calm.']);
  expect(errors).toEqual([]);
});

test('слова из словаря подчёркнуты в книге, с формами и по состоянию', async ({ browser }) => {
  const now = Date.now(), id = 'cat-jane-austen_pride-and-prejudice';
  const { page, errors } = await phone(browser, SIZES[1], { seed: Object.assign({}, SEED, { lr_tried: true, lr_words: [
    { id: 'a', bookId: id, w: 'acknowledge', tr: 'признавать', t: T0, box: 1, due: now + 3 * 864e5 }, // форма acknowledged
    { id: 'b', bookId: id, w: 'fortune', tr: 'состояние', t: T0, box: 1, seen: T0, due: now - 1000 }, // пора повторить
    { id: 'd', bookId: id, w: 'possession', tr: 'владение', t: now, box: 0, due: now }, // только что сохранили — «учу»
    { id: 'c', bookId: id, w: 'truth', tr: 'истина', t: T0, box: 5, due: now + 60 * 864e5 }] }) });
  await page.goto('/');
  await page.locator('#contBox button', { hasText: 'Читать' }).click();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30000 });
  await expect(page.locator('#viewer g.lr-saved').first()).toBeAttached({ timeout: 10000 });
  await expect(page.locator('#viewer g.lr-due').first()).toBeAttached();
  await expect(page.locator('#viewer g.lr-known').first()).toBeAttached();
  const fortunes = ((await page.frameLocator('#viewer iframe').first().locator('body').textContent()).match(/fortunes?/gi) || []).length;
  expect(await page.locator('#viewer g.lr-due').count(), 'оранжевым только fortune, не новое possession').toBe(fortunes);
  expect(errors).toEqual([]);
});

test('вечером читалка предлагает ночную тему, «Да» включает её', async ({ browser }) => {
  const { page, errors } = await phone(browser, SIZES[1], { seed: Object.assign({}, SEED, { lr_tried: true }) });
  const d = new Date(); d.setHours(22, 30, 0, 0);
  await page.clock.install({ time: d });
  await page.goto('/');
  await page.locator('#contBox button', { hasText: 'Читать' }).click();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30000 });
  await page.clock.runFor(7000);
  await expect(page.locator('#askBar')).toHaveClass(/on/);
  await expect(page.locator('#askBar')).toContainText('ночную тему');
  await page.locator('#askBar .ab-yes').click();
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'night');
  // второй раз за вечер не спрашиваем
  expect(await page.evaluate(() => localStorage.getItem('lr_themeask'))).toBeTruthy();
  expect(errors).toEqual([]);
});

test('библиотека: «Пора повторить» запускает круг из 5 карточек', async ({ browser }, info) => {
  const ws = Array.from({ length: 7 }, (_, i) => ({ id: 'q' + i, bookId: 'cat-jane-austen_pride-and-prejudice', w: 'word' + i, tr: 'слово', s: 'A word' + i + '.', t: T0, box: 1, seen: T0, due: T0 }));
  const { page, errors } = await phone(browser, SIZES[0], { seed: Object.assign({}, SEED, { lr_words: ws }) });
  await page.goto('/');
  const q = page.locator('#contBox .card.quick');
  await expect(q).toContainText('Пора повторить'); await expect(q).toContainText('7 слов · начнём с 5');
  await info.attach('библиотека', { body: await page.screenshot(), contentType: 'image/png' });
  await q.getByRole('button', { name: 'Начать' }).click();
  await expect(page.locator('#sReview')).toHaveClass(/on/);
  await expect(page.locator('#revBox header')).toContainText('1 из 5');
  expect(errors).toEqual([]);
});
