// Edge Function «translate» — прокси к Google Gemini.
// Сайт вызывает её с ?forceFunctionRegion=eu-west-3, поэтому она работает в Париже,
// и Google видит французский адрес. Ключ пользователя берётся из базы и в браузер не уходит.
//
// Деплой: Supabase → Edge Functions → Deploy a new function → Via Editor → имя: translate
// вставить этот файл целиком → Deploy. Затем в настройках функции ВЫКЛЮЧИТЬ «Verify JWT»
// (вход пользователя функция проверяет сама, строкой ниже).
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-lr-region, x-lr-model",
};
const REGION = Deno.env.get("SB_REGION") ?? "";
const DAILY_LIMIT = Number(Deno.env.get("DAILY_LIMIT") ?? "1500");
const MAX_PROMPT = 16000;

// Запасные модели: когда у одной кончился бесплатный лимит (429), пробуем следующую.
// Список берём у Google для этого ключа (кэш на 6 часов), лёгкие «lite» — первыми.
const modelCache = new Map<string, { at: number; list: string[] }>();
// какой вариант настроек подошёл каждой модели (чтобы не перебирать каждый раз)
const goodVariant = new Map<string, number>();
// модели, у которых недавно кончился лимит: не дёргаем их 30 минут
const exhausted = new Map<string, number>();
const isOut = (key: string, m: string) => (exhausted.get(key.slice(-8) + '|' + m) ?? 0) > Date.now();
const markOut = (key: string, m: string) => exhausted.set(key.slice(-8) + '|' + m, Date.now() + 30 * 60_000);
async function fallbackModels(key: string): Promise<string[]> {
  const hit = modelCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.list;
  let list: string[] = [];
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
    if (r.ok) {
      const j = await r.json();
      list = (j.models ?? [])
        .filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((m: any) => String(m.name).replace(/^models\//, ""))
        .filter((n: string) => /flash/i.test(n) && !/(image|audio|tts|live|preview-tts|embedding|exp)/i.test(n));
      const score = (n: string) => (/lite/i.test(n) ? 0 : 1) * 100 - (parseFloat((n.match(/(\d+(\.\d+)?)/) ?? ["0"])[0]) || 0);
      list.sort((a, b) => score(a) - score(b));
    }
  } catch { /* без списка — работаем только с основной моделью */ }
  modelCache.set(key, { at: Date.now(), list });
  return list;
}

const fail = (status: number, message: string, code = "") =>
  new Response(JSON.stringify({ error: { message, code } }), {
    status, headers: { ...CORS, "Content-Type": "application/json", "x-lr-region": REGION },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail(405, "Method not allowed");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // 1. кто спрашивает
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u, error: ue } = await admin.auth.getUser(token);
  if (ue || !u?.user) return fail(401, "Сессия истекла. Обновите страницу и войдите заново.", "auth");
  const uid = u.user.id;

  // 2. что спрашивает
  let prompt = "", model = "gemini-3.8-flash";
  try {
    const b = await req.json();
    prompt = String(b.prompt ?? "");
    if (typeof b.model === "string" && /^[a-z0-9.\-]{3,60}$/i.test(b.model)) model = b.model;
  } catch { /* пусто */ }
  if (!prompt) return fail(400, "Пустой запрос");
  if (prompt.length > MAX_PROMPT) return fail(400, "Слишком длинный запрос");

  // 3. ключ пользователя
  const { data: sec } = await admin.from("user_secrets").select("api_key").eq("user_id", uid).maybeSingle();
  if (!sec?.api_key) return fail(412, "Сначала добавьте ключ Gemini: Профиль → Ключ перевода.", "no_key");

  // 4. дневной лимит
  const { data: cnt } = await admin.rpc("bump_usage", { p_user: uid });
  if (typeof cnt === "number" && cnt > DAILY_LIMIT) return fail(429, "Дневной лимит переводов исчерпан. Попробуйте завтра.", "daily");

  // 5. запрос к Gemini (стриминг) с переключением моделей при исчерпании лимита
  const urlFor = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:streamGenerateContent?alt=sse`;
  // Разные модели принимают разные настройки. Пробуем от «быстрой» к «самой простой»,
  // переходя к следующему варианту только при ошибке 400 (недопустимый параметр).
  const VARIANTS: Record<string, unknown>[] = [
    { responseMimeType: "application/json", temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } },
    { responseMimeType: "application/json", temperature: 0.2, thinkingConfig: { thinkingLevel: "minimal" } },
    { responseMimeType: "application/json", temperature: 0.2 },
    { temperature: 0.2 },
    {},
  ];
  const body = (v: number) => JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: VARIANTS[v] });
  const call = (m: string, v: number) => fetch(urlFor(m), {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": sec.api_key }, body: body(v),
  });
  const tryModel = async (m: string) => {
    let v = goodVariant.get(m) ?? 0;
    let r = await call(m, v);
    while (r.status === 400 && v < VARIANTS.length - 1) {
      const t = await r.text().catch(() => "");
      if (/api key/i.test(t)) return new Response(t, { status: 400 });
      v++; r = await call(m, v);
    }
    if (r.ok) goodVariant.set(m, v);
    return r;
  };

  const key = sec.api_key;
  const order = [model, ...(await fallbackModels(key)).filter((m) => m !== model)];
  let used = model, r: Response | null = null, tried = 0;
  for (const m of order) {
    if (isOut(key, m) && m !== order[order.length - 1]) continue;
    if (tried++ >= 6) break;
    const res = await tryModel(m);
    if (res.status === 429 || res.status === 404) { if (res.status === 429) markOut(key, m); r = r ?? res; if (!res.bodyUsed) await res.body?.cancel(); continue; }
    r = res; used = m; break;
  }
  if (!r) r = await tryModel(model);
  if (!r.ok) {
    if (r.status === 429) return fail(429, "Бесплатный лимит Google на сегодня исчерпан для всех доступных моделей. Попробуйте позже или завтра.", "quota");
    if (r.status === 404) return fail(404, "Модель «" + model + "» не найдена. Смените модель в профиле.", "model");
    const text = await r.text().catch(() => "");
    return new Response(text, { status: r.status, headers: { ...CORS, "Content-Type": "application/json", "x-lr-region": REGION } });
  }
  return new Response(r.body, {
    status: 200,
    headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "x-lr-region": REGION, "x-lr-model": used },
  });
});
