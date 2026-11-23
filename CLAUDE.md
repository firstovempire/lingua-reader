# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Lingua Reader — заметки для Claude

Читалка английских EPUB с переводом по контексту (Gemini). PWA для владельца и друзей, в основном iPhone.

## Команды
Сборки, линтера, тестов и `package.json` нет.

- Синтаксис: `node -e "new Function(require('fs').readFileSync('app.js','utf8'))"`.
- Локальный запуск: `python -m http.server 8765 --bind 127.0.0.1` и открыть `http://localhost:8765` (service worker регистрируется только на https и `http://localhost`).
- Без облака: временно опустошить `SUPABASE_URL` в `config.js` (не коммитить) — включится локальный режим без входа, ключ Gemini в браузере, запросы идут прямо в Google.
- Отладка в консоли: `window.__lr` (`rendition`, `book`, `S`).

## Как устроено
- Статический сайт без сборки: `index.html` (вся вёрстка и CSS), `app.js` (вся логика, один IIFE, разделы отмечены `/* ===== … ===== */`), `sw.js` (кэш), `config.js` (публичные ключи Supabase).
- Библиотеки лежат в `lib/` (epub.js 0.3.93, JSZip, supabase-js) — не обновлять без причины.
- Хостинг: Netlify (`linguaread`), автодеплой из ветки `main`. Для PR Netlify делает deploy preview (без входа в Netlify может отвечать 401). `main` публикуется ещё и на GitHub Pages в подпапке `/lingua-reader/`, поэтому все пути — только относительные.
- Бэкенд: Supabase (проект `cbxhdemmwxzmksuthzue`): Google-вход, таблица `items` (синхронизация), `user_secrets` (ключи Gemini), бакет `books`. Схема — `supabase/schema.sql`, применяется вручную через SQL Editor и должна оставаться повторно запускаемой.
- Перевод: Edge Function `supabase/functions/translate` (регион Париж, `eu-west-3`, потому что Gemini не работает из России). Деплоится GitHub Action при изменениях в `supabase/functions/**` в `main`. Verify JWT выключен намеренно: функция сама проверяет пользователя.
- Каталог классики: `catalog/` (EPUB из Standard Ebooks, только public domain в США и РФ). Список — `catalog.json`, обложки — `covers/<id>.jpg`. `build.py` завязан на пути чужой машины (`/home/claude/...`) и здесь как есть не запустится.
- `README.md` — инструкция по первичной настройке (вход Google, Supabase, типовые ошибки); её раздел про ручную выкладку в Netlify устарел.

## Архитектура `app.js`
- **Два режима.** `CLOUD` истинно, если заполнен `config.js`. Любая правка входа, ключа или перевода должна работать в обеих ветках (`CLOUD` и локальной).
- **Экраны.** `show(name)` переключает `<section>` `#s<Name>` из `SCREENS` и вызывает нужный `render*`. DOM строится хелпером `h()`, иконки — `ico()` из набора путей `P`.
- **Данные.** Массивы `books`, `words`, `notes`, `marks`, `days` и настройки `S` живут в памяти и `localStorage` (`lr_*`). Файлы книг и посчитанные страницы (`<id>#loc1000`) — в IndexedDB (`files`).
- **Синхронизация.** Менять данные и вызывать `saveBooks()`/`saveWords()`/…: они пишут в `LS` и через `schedule()` → `diffAll()` сравнивают состояние со снимком `snap`, складывают разницу в `queue`, а `flush()` отправляет её в `items`. `pull()` берёт серверное состояние и накладывает неотправленную очередь. Удаление — это `deleted: true`, а не удаление строки. Записям нужен `id`.
- **Новый вид данных** нужно добавить в `KARR`, `EMPTY_SNAP`, `by` и присваивания внутри `pull()`, очистку при смене аккаунта в `afterLogin()` и в `check (kind in …)` в `schema.sql`.
- **Статистика `days`**: строка на день и устройство (`YYYY-MM-DD_<dev>`), чтобы устройства не перетирали друг друга.
- **Источник файла книги**: IndexedDB → для книг каталога (`b.cat`) файл с сайта → иначе бакет `books` (`<user_id>/<book_id>.epub`). Книги каталога в бакет не загружаются.
- **Запуск без связи**: `boot()` и `afterLogin()` обёрнуты в `withTimeout`; если сервер не отвечает, а `lr_uid` есть — `offlineStart()`.

## Перевод от касания до карточки
`attachInput` (внутри iframe) → `onTap` → `wordRangeAt` → `handleRange` (предложение, абзац, хвост предыдущего абзаца, CFI) → `translate` → `gemini()` → `paint`/`paintBubble`. Второе слово в том же абзаце в течение 3 с (`PHRASE_MS`) превращает выбор во фразу.

- Ответ — поток SSE с одним JSON. `partialParse` вытаскивает поля до конца потока, поэтому порядок ключей в `buildPrompt` важен (`translation` первым); новое строковое поле добавлять и туда, и в список `partialParse`.
- Телефон показывает шторку `#sheet` (сверху, если слово в нижней половине), компьютер — пузырь `#bubble`; поля вне iframe обрабатывает отдельный код рядом с `attachInput`.
- Кэш переводов `lr_cache` зависит от уровня, выделения и предложения. При смене формата промпта старые записи остаются.
- Функция `translate` при 400 перебирает `VARIANTS` настроек, при 429/404 — запасные flash-модели ключа. Фактическая модель и регион приходят в `x-lr-model`/`x-lr-region`. Ошибки с `code` показываются пользователю как есть, `no_key` ведёт к вводу ключа. Промпт — до 16000 символов.

## Правила работы
- Каждая задача — отдельная ветка и Pull request; в `main` напрямую не пушить. Проверять на deploy preview с iPhone.
- После любых изменений в `app.js`/`index.html` поднимать версию кэша в `sw.js` (`lingua-vNN`). Новые файлы оболочки добавлять в `SHELL`.
- Никогда не коммитить секреты: ключ Gemini, service_role, Client secret Google, токены. Публичны только `SUPABASE_URL` и publishable-ключ.
- Главная платформа — iPhone Safari и Яндекс Браузер на телефоне. Касания в книге идут через touch-события внутри iframe; скрипты книги вырезаются хуком `spine.hooks.content`. Этот хук обязателен: без `allowScriptedContent: true` Safari не передаёт касания в iframe, а с ним скрипты книги разрешены.
- Читалка работает в двух режимах: `S.flow` `paged` и `scroll`; жесты проверять в обоих.
- Интерфейс и комментарии — на русском. Стиль «бумага», линейные иконки, без эмодзи.
