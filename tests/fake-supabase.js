// Поддельный Supabase для тестов: вход, таблица items, rpc и журнал ошибок живут в памяти теста.
// Несколько «устройств» (контекстов браузера) работают с одной общей базой — так проверяется синхронизация.
const REF = 'cbxhdemmwxzmksuthzue';
const HOST = `https://${REF}.supabase.co`;
const USER = { id: '11111111-2222-3333-4444-555555555555', email: 'test@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' }, user_metadata: {} };

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = Math.floor(Date.now() / 1000) + 3600 * 24 * 365;
const JWT = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: USER.id, email: USER.email, role: 'authenticated', aud: 'authenticated', exp: EXP }) + '.c2ln';
const SESSION = { access_token: JWT, token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: EXP, refresh_token: 'fake-refresh', user: USER };

class FakeDB {
  constructor() { this.rows = new Map(); this.clock = Date.now(); this.log = []; this.errors = []; this.reject = null; this.down = false; }
  now() { this.clock += 1000; return new Date(this.clock).toISOString(); } // время ставит «сервер», как триггер в schema.sql
  put(kind, id, data, deleted = false, at) { this.rows.set(kind + '|' + id, { kind, id, data, deleted, updated_at: at || this.now() }); }
  get(kind, id) { const r = this.rows.get(kind + '|' + id); return r && !r.deleted ? r.data : null; }
  list(kind) { return [...this.rows.values()].filter(r => r.kind === kind && !r.deleted).map(r => r.data); }
}

// подключить базу к странице. В localStorage кладётся сессия — сайт считает, что вход уже выполнен
async function attach(context, db, { loggedIn = true } = {}) {
  if (loggedIn) await context.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(SESSION)]);
  await context.route(HOST + '/**', async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
    if (db.down) return route.abort('internetdisconnected');
    db.log.push(m + ' ' + p + url.search);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
    if (m === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p.startsWith('/auth/v1/user')) return json(USER);
    if (p.startsWith('/auth/v1/token')) return json(SESSION);
    if (p.startsWith('/auth/v1/')) return json({});
    if (p === '/rest/v1/rpc/get_key_status') return json([{ last4: 'test' }]);
    if (p === '/rest/v1/errors') { db.errors.push(...JSON.parse(req.postData() || '[]')); return route.fulfill({ status: 201, body: '' }); }
    if (p === '/rest/v1/items' && m === 'GET') {
      let rows = [...db.rows.values()];
      const gt = url.searchParams.get('updated_at'); if (gt && gt.startsWith('gt.')) { const t = Date.parse(gt.slice(3)); rows = rows.filter(r => Date.parse(r.updated_at) > t); }
      rows.sort((a, b) => (a.kind + a.id < b.kind + b.id ? -1 : 1));
      const off = Number(url.searchParams.get('offset') || 0), lim = Number(url.searchParams.get('limit') || 1000);
      return json(rows.slice(off, off + lim).map(r => JSON.parse(JSON.stringify(r))));
    }
    if (p === '/rest/v1/items' && m === 'POST') {
      const body = JSON.parse(req.postData() || '[]'); const list = Array.isArray(body) ? body : [body];
      if (db.reject && list.some(r => db.reject(r))) return json({ code: '23514', message: 'new row for relation "items" violates check constraint "items_kind_check"' }, 400);
      for (const r of list) db.put(r.kind, r.id, r.data, r.deleted);
      if (url.searchParams.get('select')) return json(list.map(r => { const x = db.rows.get(r.kind + '|' + r.id); return { kind: x.kind, id: x.id, updated_at: x.updated_at }; }), 201);
      return route.fulfill({ status: 201, body: '' });
    }
    return json({ message: 'not mocked: ' + m + ' ' + p }, 404);
  });
}

module.exports = { FakeDB, attach, USER, REF };
