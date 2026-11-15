# Lingua Reader — облачная версия (сервер перевода в Париже)

Как это работает: телефон → ваш сайт → Supabase (вход, база, файлы книг) → функция `translate`
в Париже → Google Gemini. Google видит французский адрес, поэтому **VPN не нужен** ни вам, ни друзьям.
Ключ Gemini хранится на сервере, браузер его не видит.

Всё бесплатно. Займёт около 30 минут один раз. Делайте по порядку.

---

## 1. Проект Supabase (5 мин)
1. Зайдите на **supabase.com** → Sign in (можно через GitHub) → **New project**.
2. Имя любое, пароль базы сохраните, **Region: Europe (Frankfurt или Paris)** → Create.
3. Подождите, пока проект создастся (1–2 минуты).

**Проверка, что Supabase открывается из России без VPN** (важно!):
выключите VPN и откройте `https://ВАШ-ПРОЕКТ.supabase.co/rest/v1/` (адрес — в Project Settings → API).
Должен быстро появиться короткий текст с ошибкой про ключ — это нормально, значит, доступ есть.
Если страница грузится бесконечно — напишите мне, сделаем обход.

## 2. База (2 мин)
**SQL Editor → New query** → вставьте весь файл `supabase/schema.sql` → **Run**. Должно быть «Success».

## 3. Функция перевода (5 мин)
1. **Edge Functions → Deploy a new function → Via Editor**.
2. Имя строго: `translate`.
3. Удалите пример и вставьте весь файл `supabase/functions/translate/index.ts` → **Deploy**.
4. Откройте функцию → **Settings / Details** → выключите **Verify JWT** (вход функция проверяет сама) → Save.

## 4. Вход через Google (10 мин)
1. Supabase → **Authentication → Sign In / Providers → Google** → включите.
   Скопируйте оттуда **Callback URL** (вида `https://….supabase.co/auth/v1/callback`).
2. Откройте **console.cloud.google.com** → создайте проект (например, `lingua-reader`).
3. **Google Auth Platform** (или APIs & Services → OAuth consent screen):
   - Branding: название `Lingua Reader`, ваша почта.
   - Audience: **External**, статус **Testing**, в **Test users** добавьте свой gmail и gmail друзей (до 100).
4. **Clients → Create client → Web application**:
   - Authorized redirect URIs → вставьте **Callback URL** из пункта 1.
   - Create → скопируйте **Client ID** и **Client secret**.
5. Вернитесь в Supabase → Google → вставьте Client ID и Client secret → **Save**.

## 5. Адрес проекта в `config.js` (1 мин)
Supabase → **Project Settings → API** (или кнопка **Connect**):
- **Project URL** → в `SUPABASE_URL`
- публичный ключ **publishable** (`sb_publishable_…`) или **anon** → в `SUPABASE_KEY`

Это публичный ключ, его можно класть на сайт: данные закрыты правилами базы.
**Не используйте** `service_role` / `secret` ключ.

## 6. Выложить сайт (3 мин)
1. Откройте **app.netlify.com/drop**, войдите (можно через GitHub или почту).
2. Перетащите **всю папку** `reader-10-cloud-paris` → получите адрес `https://….netlify.app`.
   (Чтобы адрес не менялся при обновлениях: Site configuration → Change site name, например `lingua-reader`.)
3. Обновлять потом так: Deploys → перетащить папку ещё раз.

## 7. Связать адрес сайта с Supabase (1 мин)
Supabase → **Authentication → URL Configuration**:
- **Site URL** = адрес сайта (`https://lingua-reader.netlify.app`)
- **Redirect URLs** → Add → тот же адрес.

## 8. Проверка
Телефон → откройте сайт в Safari → **Войти через Google** → уровень → ключ Gemini → «Проверить».
Должно появиться «Ключ работает · сервер: Париж». Дальше: «+ EPUB» и читать.
На экран «Домой»: Поделиться → На экран «Домой».

---

## Если что-то не так
| Что видите | Что сделать |
|---|---|
| `redirect_uri_mismatch` при входе | Callback URL из Supabase должен точь-в-точь стоять в Google → Clients → Authorized redirect URIs |
| «Доступ заблокирован: приложение не прошло проверку» | Добавьте этот gmail в Google → Audience → Test users |
| После входа снова экран входа | Supabase → URL Configuration: Site URL и Redirect URLs = адрес сайта |
| «Сессия истекла» при переводе | Выключите Verify JWT у функции `translate` |
| «Сначала добавьте ключ Gemini» | Профиль → Ключ перевода |
| Книга не загружается в облако | Запустите `schema.sql` целиком ещё раз |

## Что важно знать
- Как владелец проекта вы видите ключи друзей в таблице `user_secrets` в панели Supabase. Их браузеры — не видят.
- Бесплатный проект Supabase засыпает после недели без активности: зайдите в панель и нажмите **Restore**.
- Хранилище бесплатного Supabase — 1 ГБ на всех, книга до 50 МБ. Обычный EPUB весит 0,3–3 МБ.
- Лимит: 1500 переводов на человека в день (меняется в Edge Functions → Secrets → `DAILY_LIMIT`).
- Если `config.js` пустой — сайт работает в локальном режиме, как версия 9.
