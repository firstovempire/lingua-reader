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
  "Access-Control-Expose-Headers": "x-lr-region",
};
const REGION = Deno.env.get("SB_REGION") ?? "";
const DAILY_LIMIT = Number(Deno.env.get("DAILY_LIMIT") ?? "1500");
const MAX_PROMPT = 16000;

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

  // 5. запрос к Gemini (стриминг)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const body = (noThinking: boolean) => JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2, ...(noThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
  });
  const call = (noThinking: boolean) => fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": sec.api_key }, body: body(noThinking),
  });

  let r = await call(true);
  if (r.status === 400) {
    const t = await r.clone().text();
    if (/thinking/i.test(t)) r = await call(false);
  }
  if (!r.ok) {
    const text = await r.text();
    return new Response(text, { status: r.status, headers: { ...CORS, "Content-Type": "application/json", "x-lr-region": REGION } });
  }
  return new Response(r.body, {
    status: 200,
    headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "x-lr-region": REGION },
  });
});
