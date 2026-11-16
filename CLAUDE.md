# Lingua Reader — заметки для Claude

Читалка английских EPUB с переводом по контексту (Gemini). PWA для владельца и друзей, в основном iPhone.

## Как устроено
- Статический сайт без сборки: `index.html` (вся вёрстка и CSS), `app.js` (вся логика), `sw.js` (кэш), `config.js` (публичные ключи Supabase).
- Библиотеки лежат в `lib/` (epub.js 0.3.93, JSZip, supabase-js) — не обновлять без причины.
- Хостинг: Netlify, автодеплой из ветки `main`. Для PR Netlify делает deploy preview.
- Бэкенд: Supabase (проект `cbxhdemmwxzmksuthzue`): Google-вход, таблица `items` (синхронизация), `user_secrets` (ключи Gemini), бакет `books`. Схема — `supabase/schema.sql`.
- Перевод: Edge Function `supabase/functions/translate` (регион Париж, `eu-west-3`, потому что Gemini не работает из России). Деплоится GitHub Action при изменениях в `supabase/functions/**` в `main`.
- Каталог классики: `catalog/` (EPUB из Standard Ebooks, только public domain в США и РФ).

## Правила работы
- Каждая задача — отдельная ветка и Pull request; в `main` напрямую не пушить. Проверять на deploy preview с iPhone.
- После любых изменений в `app.js`/`index.html` поднимать версию кэша в `sw.js` (`lingua-vNN`).
- Никогда не коммитить секреты: ключ Gemini, service_role, Client secret Google, токены. Публичны только `SUPABASE_URL` и publishable-ключ.
- Главная платформа — iPhone Safari и Яндекс Браузер на телефоне. Касания в книге идут через touch-события внутри iframe; скрипты книги вырезаются хуком `spine.hooks.content`.
- Интерфейс и комментарии — на русском. Стиль «бумага», линейные иконки, без эмодзи.
- Проверять синтаксис: `node -e "new Function(require('fs').readFileSync('app.js','utf8'))"`.
