// Описание внешних имён для проверки типов (`npm run types`). На работу сайта не влияет: браузер этот файл не загружает.
declare const ePub: any; // lib/epub.min.js

interface Window {
  LR_CONFIG: { SUPABASE_URL?: string; SUPABASE_KEY?: string; REGION?: string }; // config.js
  supabase: any; // lib/supabase.js
  webkitAudioContext: typeof AudioContext; // старый Safari
  __rz: any; // таймер пересчёта раскладки книги
  __lr: any; // отладка в консоли
}

// дополнительные поля ошибок, которые сайт передаёт между функциями
interface Error {
  code?: string; // код ошибки от сервера перевода (no_key, quota, busy, offline…)
  needKey?: boolean; // показать кнопку «Добавить ключ»
  retry?: boolean; // ответ оборвался — можно спросить ещё раз
}
