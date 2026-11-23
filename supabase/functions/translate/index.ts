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
  "Access-Control-Expose-Headers": "x-lr-region, x-lr-model, server-timing",
  "Access-Control-Max-Age": "7200", // браузер не повторяет проверочный OPTIONS перед каждым переводом
  "Timing-Allow-Origin": "*",
};
const REGION = Deno.env.get("SB_REGION") ?? "";
const DAILY_LIMIT = Number(Deno.env.get("DAILY_LIMIT") ?? "1500");
const MAX_PROMPT = 16000;

// Запасные модели: когда у одной кончился бесплатный лимит (429), пробуем следующую.
// Список берём у Google для этого ключа (кэш на 6 часов), лёгкие «lite» — первыми.
const modelCache = new Map<string, { at: number; list: string[] }>();
// какой вариант настроек (номер в variantOrder) подошёл каждой модели (чтобы не перебирать каждый раз)
const goodVariant = new Map<string, number>();
// модели, у которых кончился лимит: не дёргаем, пока Google не начнёт принимать их снова
type Why = "day" | "minute" | "busy";
const exhausted = new Map<string, { until: number; why: Why }>();
const outOf = (key: string, m: string) => { const e = exhausted.get(key.slice(-8) + "|" + m); return e && e.until > Date.now() ? e : null; };
// дневные лимиты Google сбрасываются в полночь по тихоокеанскому времени
function msToPacificMidnight(): number {
  const t = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
  const [h, m, s] = t.split(":").map(Number);
  return (86400 - (h * 3600 + m * 60 + s)) * 1000;
}
// По ответу 429: дневной лимит — до сброса, иначе на срок, который назвал Google (или минуту)
function markOut(key: string, m: string, text: string) {
  const daily = /PerDay/i.test(text);
  const sec = Number((text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) ?? [])[1] ?? 60);
  const ms = daily ? msToPacificMidnight() + 60_000 : Math.min(Math.max(sec, 5), 300) * 1000;
  exhausted.set(key.slice(-8) + "|" + m, { until: Date.now() + ms, why: daily ? "day" : "minute" });
}
// модель перегружена у Google или молчит: полминуты её не ждём
const markBusy = (key: string, m: string) => exhausted.set(key.slice(-8) + "|" + m, { until: Date.now() + 30_000, why: "busy" });
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
  if (list.length) modelCache.set(key, { at: Date.now(), list }); // неудачу не запоминаем
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

  // замеры шагов — в заголовке Server-Timing (видны в браузере: Network → Timing)
  const timing: string[] = [];
  const t00 = performance.now();
  const timed = async <T>(name: string, p: PromiseLike<T>, desc?: (v: T) => string): Promise<T> => {
    const t = performance.now(); const v = await p;
    timing.push(name + ";dur=" + Math.round(performance.now() - t) + (desc ? ';desc="' + desc(v) + '"' : ""));
    return v;
  };

  // 1. кто спрашивает
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u, error: ue } = await timed("auth", admin.auth.getUser(token));
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

  // 3. ключ пользователя и дневной счётчик — одновременно
  const [{ data: sec }, { data: cnt }] = await timed("db", Promise.all([
    admin.from("user_secrets").select("api_key").eq("user_id", uid).maybeSingle(),
    admin.rpc("bump_usage", { p_user: uid }),
  ]));
  if (!sec?.api_key) return fail(412, "Сначала добавьте ключ Gemini: Профиль → Ключ перевода.", "no_key");

  // 4. дневной лимит
  if (typeof cnt === "number" && cnt > DAILY_LIMIT) return fail(429, "Дневной лимит переводов исчерпан. Попробуйте завтра.", "daily");

  // 5. запрос к Gemini (стриминг) с переключением моделей при исчерпании лимита
  const urlFor = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:streamGenerateContent?alt=sse`;
  // Разные модели принимают разные настройки. Пробуем от «быстрой» к «самой простой»,
  // переходя к следующему варианту только при ошибке 400 (недопустимый параметр).
  // «low» нужен моделям без «minimal» (gemini-3.8-flash): иначе они думают на уровне medium.
  const JSON_OUT = { responseMimeType: "application/json", temperature: 0.2 };
  const VARIANTS: Record<string, unknown>[] = [
    { ...JSON_OUT, thinkingConfig: { thinkingBudget: 0 } },
    { ...JSON_OUT, thinkingConfig: { thinkingLevel: "minimal" } },
    { ...JSON_OUT, thinkingConfig: { thinkingLevel: "low" } },
    { ...JSON_OUT },
    { temperature: 0.2 },
    {},
  ];
  // с Gemini 3 раздумья задаются уровнем, раньше — бюджетом
  const variantOrder = (m: string) => m === "gemini-3.8-flash" ? [2, 1, 0, 3, 4, 5]
    : Number((m.match(/^gemini-(\d+)/) ?? [])[1] ?? 0) >= 3 ? [1, 2, 0, 3, 4, 5]
    : [0, 1, 2, 3, 4, 5];
  const body = (v: number) => JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: VARIANTS[v] });
  // ждём начала ответа: основную модель 7 с, запасные 10 с; молчание считаем перегрузкой (504)
  const call = async (m: string, v: number) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), m === model ? 7000 : 10000);
    try {
      return await fetch(urlFor(m), {
        method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": sec.api_key }, body: body(v),
      });
    } catch { return new Response("", { status: 504 }); } finally { clearTimeout(timer); }
  };
  const tryModel = async (m: string) => {
    const vs = variantOrder(m);
    const send = (i: number) => timed("gemini", call(m, vs[i]), (x) => m + " v" + vs[i] + " " + x.status);
    let i = goodVariant.get(m) ?? 0;
    let r = await send(i);
    while (r.status === 400 && i < vs.length - 1) {
      const t = await r.text().catch(() => "");
      if (/api key/i.test(t)) return new Response(t, { status: 400 });
      i++; r = await send(i);
    }
    if (r.ok) goodVariant.set(m, i);
    return r;
  };

  const key = sec.api_key;
  let used = model, tried = 0;
  const saw = new Set<Why>();
  const skip = (m: string) => { const o = outOf(key, m); if (o) saw.add(o.why); return !!o; };
  // один заход на модель; null — лимит, перегрузка или нет такой модели, пробуем следующую
  const attempt = async (m: string): Promise<Response | null> => {
    tried++;
    const res = await tryModel(m);
    if (res.status === 429) { markOut(key, m, await res.text().catch(() => "")); skip(m); return null; }
    if (res.status >= 500) { await res.body?.cancel(); markBusy(key, m); skip(m); return null; }
    if (res.status === 404) { await res.body?.cancel(); return null; }
    used = m; return res;
  };
  let r: Response | null = skip(model) ? null : await attempt(model);
  // запасные модели (и их список у Google) нужны, только если основная не ответила
  if (!r) {
    for (const m of await timed("models", fallbackModels(key))) {
      if (m === model || skip(m)) continue;
      if (tried >= 6 || performance.now() - t00 > 14_000) break; // сайт ждёт ответа не дольше 25 с
      r = await attempt(m);
      if (r) break;
    }
  }
  if (!r && tried === 0) r = await attempt(model); // все отмечены исчерпанными — проверяем основную ещё раз
  if (!r) {
    if (!saw.size) return fail(404, "Модель «" + model + "» не найдена. Смените модель в профиле.", "model");
    if (saw.has("busy")) return fail(503, "Модели Google сейчас перегружены. Коснитесь слова ещё раз через полминуты.", "busy");
    return saw.has("day")
      ? fail(429, "Бесплатный лимит Google на сегодня исчерпан для всех доступных моделей. Попробуйте позже или завтра.", "quota")
      : fail(429, "Слишком много переводов подряд. Подождите минуту и коснитесь слова ещё раз.", "quota");
  }
  timing.push("total;dur=" + Math.round(performance.now() - t00));
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return new Response(text, { status: r.status, headers: { ...CORS, "Content-Type": "application/json", "x-lr-region": REGION } });
  }
  return new Response(r.body, {
    status: 200,
    headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "x-lr-region": REGION, "x-lr-model": used, "Server-Timing": timing.join(", ") },
  });
});
