// Синхронизация между устройствами на поддельном сервере (tests/fake-supabase.js).
const { test, expect } = require('@playwright/test');
const { FakeDB, attach, USER } = require('./fake-supabase');

const PHONE = { width: 390, height: 664 };
const T0 = Date.UTC(2026, 10, 20);

// «устройство»: отдельный браузерный контекст со своим localStorage; seed кладётся только при первом открытии
async function device(browser, db, seed = {}) {
  const context = await browser.newContext({ viewport: PHONE, serviceWorkers: 'block' });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await attach(context, db);
  await context.addInitScript(seed => {
    if (localStorage.getItem('__seeded')) return;
    localStorage.setItem('__seeded', '1');
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
  }, seed);
  const page = await context.newPage();
  page.on('pageerror', e => { throw e; });
  return { context, page };
}
async function openLib(page) {
  await page.goto('/');
  await expect(page.locator('#sLib')).toHaveClass(/on/);
  await expect(page.locator('#bookList')).not.toContainText('Загружаю библиотеку');
}
const ls = (page, k) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), k);
const book = (id, extra) => Object.assign({ id, title: 'Book ' + id, author: 'Author', added: T0, pct: 0 }, extra);
const word = (id, extra) => Object.assign({ id, bookId: 'b1', w: 'word' + id, tr: 'слово', s: 'A word' + id + ' here.', t: T0, box: 0, due: T0 }, extra);
const LEVEL = { level: 'B1' };

test('книги и слова переходят с одного устройства на другое', async ({ browser }) => {
  const db = new FakeDB();
  const a = await device(browser, db, { lr_s: LEVEL, lr_books: [book('b1', { lastRead: T0 + 5, pct: 0.3, cfi: 'epubcfi(/6/4!/4/2)' })], lr_words: [word('w1')] });
  await openLib(a.page);
  await expect.poll(() => db.get('book', 'b1')).not.toBeNull();
  await expect.poll(() => db.get('word', 'w1')).not.toBeNull();

  const b = await device(browser, db, { lr_s: LEVEL });
  await openLib(b.page);
  await expect(b.page.locator('#contBox')).toContainText('Book b1');
  expect((await ls(b.page, 'lr_words')).map(w => w.id)).toEqual(['w1']);
  expect((await ls(b.page, 'lr_books'))[0].cfi).toBe('epubcfi(/6/4!/4/2)');
});

test('старое устройство не затирает более свежее с другого', async ({ browser }) => {
  const db = new FakeDB();
  db.put('book', 'b1', book('b1', { lastRead: T0 + 2000, cfi: 'NEW', pct: 0.8 }));
  db.put('word', 'w1', word('w1', { box: 3, seen: T0 + 2000 }));
  db.put('set', 'S', LEVEL);
  // телефон давно не открывали: в очереди старые записи (без времени, как до исправления)
  const oldBook = book('b1', { lastRead: T0 + 1000, cfi: 'OLD', pct: 0.2 }), oldWord = word('w1', { box: 0, seen: T0 + 1000 });
  const b = await device(browser, db, {
    lr_uid: USER.id, lr_s: LEVEL, lr_books: [oldBook], lr_words: [oldWord],
    lr_queue: { 'book|b1': { kind: 'book', id: 'b1', data: oldBook }, 'word|w1': { kind: 'word', id: 'w1', data: oldWord } },
    lr_snap: { book: { b1: JSON.stringify(oldBook) }, word: { w1: JSON.stringify(oldWord) }, note: {}, mark: {}, day: {}, set: {} },
  });
  await openLib(b.page);
  await expect.poll(async () => (await ls(b.page, 'lr_books'))[0].cfi).toBe('NEW');
  expect((await ls(b.page, 'lr_words'))[0].box).toBe(3);
  await b.page.waitForTimeout(2000); // даём уйти всему, что ушло бы
  expect(db.get('book', 'b1').cfi).toBe('NEW');
  expect(db.get('word', 'w1').box).toBe(3);
});

test('если сервер не принимает один вид данных, остальные всё равно уходят', async ({ browser }) => {
  const db = new FakeDB();
  db.reject = r => r.kind === 'day'; // как было, пока база не знала статистику по дням
  const a = await device(browser, db, { lr_s: LEVEL, lr_books: [book('b1')], lr_days: [{ id: '2026-11-20_dev', date: '2026-11-20', read: 120 }] });
  await openLib(a.page);
  await expect.poll(() => db.get('book', 'b1')).not.toBeNull();
  await a.page.locator('#tabbar button[data-go=Profile]').click();
  await expect(a.page.locator('#syncVal')).toContainText('ошибка');
  await expect.poll(() => db.errors.length, { timeout: 15000 }).toBeGreaterThan(0); // и ошибка попала в журнал
});

test('при возвращении забирается только изменённое', async ({ browser }) => {
  const db = new FakeDB();
  db.put('set', 'S', LEVEL);
  db.put('book', 'b1', book('b1'));
  const a = await device(browser, db, { lr_s: LEVEL });
  await openLib(a.page);
  db.put('word', 'w2', word('w2')); // добавлено на другом устройстве
  db.log.length = 0;
  await a.page.evaluate(() => dispatchEvent(new Event('online')));
  await expect.poll(async () => ((await ls(a.page, 'lr_words')) || []).map(w => w.id)).toEqual(['w2']);
  expect(db.log.some(l => /GET \/rest\/v1\/items\?.*updated_at=gt\./.test(l))).toBe(true);
  expect((await ls(a.page, 'lr_books')).map(b => b.id)).toEqual(['b1']); // остальное на месте
});

test('без интернета: табличка, всё копится, со связью уходит', async ({ browser }) => {
  const db = new FakeDB();
  db.put('set', 'S', LEVEL);
  db.put('book', 'b1', book('b1'));
  const a = await device(browser, db, { lr_s: LEVEL });
  await openLib(a.page);
  await expect(a.page.locator('#netBar')).not.toHaveClass(/on/);

  db.down = true; await a.context.setOffline(true);
  await expect(a.page.locator('#netBar')).toHaveClass(/on/);
  // меняем цель на день в профиле
  await a.page.locator('#tabbar button[data-go=Profile]').click();
  await a.page.getByRole('button', { name: /Цель на день/ }).first().click();
  await a.page.getByRole('radio', { name: '20 мин' }).click();
  await expect(a.page.locator('#syncVal')).toContainText('нет сети');

  // перезапуск, когда сервер недоступен (сама страница в тестах без офлайн-кэша): открывается библиотека с сохранённым
  await a.context.setOffline(false);
  await a.page.reload();
  await expect(a.page.locator('#sLib')).toHaveClass(/on/);
  await expect(a.page.locator('#netBar')).toHaveClass(/on/);
  await expect(a.page.locator('#bookList')).toContainText('Book b1');

  db.down = false; await a.page.evaluate(() => dispatchEvent(new Event('online')));
  await expect.poll(() => (db.get('set', 'S') || {}).goal, { timeout: 15000 }).toBe(20);
  await expect(a.page.locator('#netBar')).not.toHaveClass(/on/);
});

test('часы телефона отстают на 10 минут — его правки всё равно доходят', async ({ browser }) => {
  const db = new FakeDB();
  db.put('set', 'S', LEVEL);
  db.put('book', 'b1', book('b1'));
  const a = await device(browser, db, { lr_s: LEVEL });
  await a.context.addInitScript(() => { const real = Date.now; Date.now = () => real() - 600000; });
  await openLib(a.page);
  await a.page.reload(); await expect(a.page.locator('#sLib')).toHaveClass(/on/); // теперь с отстающими часами
  await a.page.locator('#tabbar button[data-go=Profile]').click();
  await a.page.getByRole('button', { name: /Цель на день/ }).first().click();
  await a.page.getByRole('radio', { name: '30 мин' }).click();
  await expect.poll(() => (db.get('set', 'S') || {}).goal).toBe(30);
  await a.page.evaluate(() => dispatchEvent(new Event('online'))); // повторная сверка не откатывает правку
  await a.page.waitForTimeout(1500);
  expect(db.get('set', 'S').goal).toBe(30);
  expect((await ls(a.page, 'lr_s')).goal).toBe(30);
});

for (const serverLater of [true, false]) {
  test('слово повторили на двух устройствах без связи: остаётся более позднее (' + (serverLater ? 'другое' : 'это') + ' устройство)', async ({ browser }) => {
    const db = new FakeDB();
    db.put('set', 'S', LEVEL);
    db.put('word', 'w1', word('w1'));
    const a = await device(browser, db, { lr_s: LEVEL });
    await openLib(a.page);
    db.down = true; await a.context.setOffline(true);
    await a.page.locator('#tabbar button[data-go=Review]').click();
    await a.page.locator('.rv-hint.ok').click(); // «Угадал» на этом устройстве: box 1
    await expect.poll(async () => (await ls(a.page, 'lr_words'))[0].box).toBe(1);
    // на другом устройстве то же слово повторили дважды — позже или раньше этого
    db.put('word', 'w1', word('w1', { box: 2, seen: Date.now() + (serverLater ? 60000 : -60000) }));
    db.down = false; await a.context.setOffline(false);
    await a.page.evaluate(() => dispatchEvent(new Event('online')));
    const want = serverLater ? 2 : 1;
    await expect.poll(async () => (await ls(a.page, 'lr_words'))[0].box).toBe(want);
    await expect.poll(() => db.get('word', 'w1').box).toBe(want);
  });
}

test('правка во время медленной отправки не теряется', async ({ browser }) => {
  const db = new FakeDB();
  db.put('set', 'S', LEVEL);
  const a = await device(browser, db, { lr_s: LEVEL });
  await openLib(a.page);
  await a.page.locator('#tabbar button[data-go=Profile]').click();
  db.slowPost = 2500;
  await a.page.getByRole('button', { name: /Цель на день/ }).first().click();
  await a.page.getByRole('radio', { name: '20 мин' }).click();
  await expect.poll(() => db.log.filter(l => l.startsWith('POST /rest/v1/items')).length).toBeGreaterThan(0); // первая отправка в пути
  await a.page.getByRole('button', { name: /Цель на день/ }).first().click();
  await a.page.getByRole('radio', { name: '30 мин' }).click();
  db.slowPost = 0;
  await expect.poll(() => (db.get('set', 'S') || {}).goal, { timeout: 15000 }).toBe(30);
  // возвращение на вкладку: сверка с сервером не откатывает правку
  await a.page.evaluate(() => { dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await a.page.waitForTimeout(1500);
  expect((await ls(a.page, 'lr_s')).goal).toBe(30);
  expect(await a.page.evaluate(() => Object.keys(window.__lr.queue).length)).toBe(0);
});
