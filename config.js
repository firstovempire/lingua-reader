// Два значения из Supabase → Project Settings → API (или «Connect»):
//   SUPABASE_URL — Project URL, вида https://abcdxyz.supabase.co
//   SUPABASE_KEY — публичный ключ: «publishable» (sb_publishable_…) или «anon».
// Публичный ключ безопасен: доступ к данным закрыт правилами базы (RLS).
// Если оставить пустым — сайт работает в локальном режиме (без входа, ключ в браузере, нужен VPN).
window.LR_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_KEY: "",
  REGION: "eu-west-3" // Париж: отсюда сервер ходит в Google
};
