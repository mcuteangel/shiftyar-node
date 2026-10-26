'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app.js');
const Core = require('../web/core.js');

const PW = 'Admin#pass1';
let app, base;

test.before(async () => {
  app = createApp({ dbPath: ':memory:', adminCode: 'admin', adminPassword: PW, log: () => {} });
  await app.bootstrap();
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.server.address().port;
});
test.after(async () => { await app.close(); });

/** کلاینت ساده با کوکی */
function client() {
  let cookie = '';
  const c = {
    async req(method, path, body, extraHeaders) {
      const headers = Object.assign({ 'X-Requested-With': 'shiftyar' }, extraHeaders);
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (cookie) headers.Cookie = cookie;
      const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0].replace(/^sid=$/, '');
      let data = null;
      try { data = await res.json(); } catch (_) { /* ignore */ }
      return { status: res.status, data, headers: res.headers };
    },
    get: (p) => c.req('GET', p),
    post: (p, b) => c.req('POST', p, b === undefined ? {} : b),
    put: (p, b) => c.req('PUT', p, b),
    patch: (p, b) => c.req('PATCH', p, b),
    del: (p) => c.req('DELETE', p),
  };
  return c;
}
async function loginAs(code, pw, newPw) {
  const c = client();
  const r = await c.post('/api/login', { code, password: pw });
  assert.equal(r.status, 200, `login ${code}: ${JSON.stringify(r.data)}`);
  if (r.data.user.mustChange) {
    const p = await c.post('/api/password', { current: pw, next: newPw || 'Changed#pass9' });
    assert.equal(p.status, 200, JSON.stringify(p.data));
  }
  return c;
}

let admin, mgr, staffA, staffB, staffC, cfg, ver;
const D = (jm, jd) => Core.j2d(1405, jm, jd);

test('ورود: گذرواژهٔ غلط، کوکی امن، اجبار به تغییر گذرواژه', async () => {
  const c = client();
  let r = await c.post('/api/login', { code: 'admin', password: 'wrong-pass-1' });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'کد یا گذرواژه درست نیست.');
  r = await c.post('/api/login', { code: 'nobody', password: 'wrong-pass-1' });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'کد یا گذرواژه درست نیست.', 'پیام برای کاربر ناموجود هم یکسان است');
  r = await c.post('/api/login', { code: 'admin', password: PW });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.mustChange, true);
  const sc = r.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Strict/);
  r = await c.get('/api/config');
  assert.equal(r.status, 403, 'تا تغییر گذرواژه به داده دسترسی نیست');
  assert.equal(r.data.mustChange, true);
  r = await c.post('/api/password', { current: PW, next: 'short' });
  assert.equal(r.status, 400);
  r = await c.post('/api/password', { current: 'bad-current-1', next: 'Admin#pass2' });
  assert.equal(r.status, 403);
  r = await c.post('/api/password', { current: PW, next: 'Admin#pass2' });
  assert.equal(r.status, 200);
  r = await c.get('/api/config');
  assert.equal(r.status, 200);
  admin = c;
  cfg = r.data.cfg; ver = r.data.version;
  assert.equal(cfg.shifts.length, 7, 'شیفت‌های پیش‌فرض');
  assert.equal(cfg.people.length, 0);
});

test('CSRF: هدر سفارشی، Origin و نوع محتوا', async () => {
  const c = await loginAs('admin', 'Admin#pass2');
  const raw = async (headers, body) => {
    const res = await fetch(base + '/api/logout', { method: 'POST', headers: Object.assign({ Cookie: 'sid=x' }, headers), body });
    return res.status;
  };
  assert.equal(await raw({ 'Content-Type': 'application/json' }, '{}'), 403, 'بدون X-Requested-With');
  assert.equal(await raw({ 'X-Requested-With': 'shiftyar', 'Content-Type': 'application/json', Origin: 'https://evil.example' }, '{}'), 403, 'Origin بیگانه');
  assert.equal(await raw({ 'X-Requested-With': 'shiftyar', 'Content-Type': 'text/plain' }, '{}'), 415, 'نوع محتوای نامعتبر');
  assert.equal((await c.get('/api/me')).status, 200);
});

test('پیکربندی: ساخت بخش و پرسنل، تداخل نسخه، اعتبارسنجی', async () => {
  const people = [
    ['علی', 'رضایی', '1001', 'company', 'd1'], ['مریم', 'کریمی', '1002', 't4', 'd1'],
    ['زهرا', 'موسوی', '2001', 'official', 'd2'], ['رضا', 'محمدی', '2002', 'company', 'd2'],
  ].map((p, i) => ({ id: 'p' + (i + 1), first: p[0], last: p[1], code: p[2], phone: '', contract: p[3], deptId: p[4] }));
  const next = Object.assign({}, cfg, { depts: [{ id: 'd1', name: 'اورژانس', color: '#e0573f' }, { id: 'd2', name: 'داخلی', color: '#2f7dd1' }], people });
  let r = await admin.put('/api/config', { version: ver - 1, cfg: next });
  assert.equal(r.status, 409, 'نسخهٔ قدیمی');
  r = await admin.put('/api/config', { version: ver, cfg: Object.assign({}, next, { depts: [{ id: 'd1', name: 'x', color: 'red' }] }) });
  assert.equal(r.status, 400, 'رنگ نامعتبر');
  r = await admin.put('/api/config', { version: ver, cfg: Object.assign({}, next, { people: people.map((p) => Object.assign({}, p, { code: '1001' })) }) });
  assert.equal(r.status, 400, 'کد پرسنلی تکراری');
  r = await admin.put('/api/config', { version: ver, cfg: Object.assign({}, next, { people: people.map((p, i) => i ? p : Object.assign({}, p, { code: 'a b' })) }) });
  assert.equal(r.status, 400, 'کد پرسنلی با فاصله');
  r = await admin.put('/api/config', { version: ver, cfg: next });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  ver = r.data.version;
  r = await admin.get('/api/config');
  assert.equal(r.data.cfg.people.length, 4);
  assert.equal(r.data.cfg.people[0].deptId, 'd1');
  cfg = r.data.cfg;
});

test('حساب‌ها: ساخت مدیر بخش و پرسنل، ساخت گروهی، خطاها', async () => {
  let r = await admin.post('/api/users', { code: 'mgr1', role: 'manager', personId: 'p3', deptIds: ['d2'], password: 'Mgr#pass123' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.deptIds[0], 'd2');
  r = await admin.post('/api/users', { code: 'mgr1', role: 'staff', personId: 'p1' });
  assert.equal(r.status, 400, 'کد تکراری');
  r = await admin.post('/api/users', { code: 'x1', role: 'staff' });
  assert.equal(r.status, 400, 'پرسنل لازم است');
  r = await admin.post('/api/users', { code: 'x1', role: 'staff', personId: 'p3' });
  assert.equal(r.status, 400, 'فرد قبلاً حساب دارد');
  r = await admin.post('/api/users', { code: 'x2', role: 'god', personId: 'p1' });
  assert.equal(r.status, 400, 'نقش نامعتبر');
  r = await admin.post('/api/users', { code: 'staffA', role: 'staff', personId: 'p1' });
  assert.equal(r.status, 200);
  assert.match(r.data.tempPassword, /^[A-Za-z0-9]{10}$/);
  const tmpA = r.data.tempPassword;
  r = await admin.post('/api/users/provision');
  assert.equal(r.status, 200);
  const codes = r.data.created.map((x) => x.code).sort();
  assert.deepEqual(codes, ['1002', '2002'], 'فقط افراد بدون حساب و دارای کد');
  const pwB = r.data.created.find((x) => x.code === '2002').tempPassword;
  const pwC = r.data.created.find((x) => x.code === '1002').tempPassword;
  mgr = await loginAs('mgr1', 'Mgr#pass123');
  staffA = await loginAs('staffA', tmpA);
  staffB = await loginAs('2002', pwB);
  staffC = await loginAs('1002', pwC);
});

test('نقش‌ها: پرسنل فقط داده و برنامهٔ خودش را می‌بیند', async () => {
  let r = await staffA.get('/api/config');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.cfg.people.map((p) => p.id), ['p1']);
  assert.deepEqual(r.data.cfg.depts.map((d) => d.id), ['d1']);
  assert.equal(r.data.cfg.shifts.length, 7, 'شیفت‌ها برای محاسبه لازم است');
  r = await staffA.put('/api/config', { version: 1, cfg: {} });
  assert.equal(r.status, 403);
  r = await staffA.get('/api/users');
  assert.equal(r.status, 403);
  r = await staffA.get('/api/log');
  assert.equal(r.status, 403);
  r = await staffA.post('/api/assign', { changes: [{ pid: 'p1', j: D(7, 5), code: 'M' }] });
  assert.equal(r.status, 403, 'پرسنل حتی برای خودش نمی‌تواند برنامه را عوض کند');
});

test('برنامه: مدیر بخش فقط در بخش خودش، ادمین همه‌جا', async () => {
  let r = await mgr.post('/api/assign', { changes: [{ pid: 'p4', j: D(7, 5), code: 'N' }, { pid: 'p3', j: D(7, 6), code: 'A' }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.applied, 2);
  r = await mgr.post('/api/assign', { changes: [{ pid: 'p4', j: D(7, 7), code: 'M' }, { pid: 'p1', j: D(7, 7), code: 'M' }] });
  assert.equal(r.status, 403, 'p1 در بخش دیگری است');
  r = await mgr.get(`/api/assign?from=${D(7, 1)}&to=${D(7, 30)}`);
  assert.deepEqual(Object.keys(r.data.assign).sort(), ['p3', 'p4']);
  assert.equal(r.data.assign.p4[D(7, 7)], undefined, 'درخواست رد‌شده هیچ اثری نداشته (اتمیک)');
  r = await admin.post('/api/assign', { changes: [{ pid: 'p1', j: D(7, 5), code: 'LV' }, { pid: 'p2', j: D(7, 5), code: 'SK' }] });
  assert.equal(r.status, 200);
  r = await staffA.get(`/api/assign?from=${D(7, 1)}&to=${D(7, 30)}`);
  assert.deepEqual(Object.keys(r.data.assign), ['p1']);
  assert.equal(r.data.assign.p1[D(7, 5)], 'LV');
  r = await staffB.get(`/api/assign?from=${D(7, 1)}&to=${D(7, 30)}`);
  assert.deepEqual(Object.keys(r.data.assign), ['p4'], 'پرسنل برنامهٔ همکاران را نمی‌بیند');
});

test('برنامه: اعتبارسنجی، بازنویسی، حذف و شماره‌ی نسخه', async () => {
  const j = D(8, 3);
  let r = await admin.post('/api/assign', { changes: [{ pid: 'p1', j, code: 'ZZ' }] });
  assert.equal(r.status, 400, 'کد ناموجود');
  r = await admin.post('/api/assign', { changes: [{ pid: 'p1', j: 5, code: 'M' }] });
  assert.equal(r.status, 400, 'تاریخ نامعتبر');
  r = await admin.post('/api/assign', { changes: [{ pid: 'nope', j, code: 'M' }] });
  assert.equal(r.status, 400, 'پرسنل ناموجود');
  r = await admin.post('/api/assign', { changes: [] });
  assert.equal(r.status, 400);
  const rev0 = (await admin.get('/api/rev')).data.rev;
  r = await admin.post('/api/assign', { changes: [{ pid: 'p1', j, code: 'M' }] });
  assert.equal(r.data.rev, rev0 + 1);
  r = await admin.post('/api/assign', { changes: [{ pid: 'p1', j, code: 'M' }] });
  assert.equal(r.data.applied, 0, 'بدون تغییر');
  assert.equal(r.data.rev, rev0 + 1);
  await admin.post('/api/assign', { changes: [{ pid: 'p1', j, code: 'N' }] });
  r = await admin.get(`/api/assign?from=${j}&to=${j}`);
  assert.equal(r.data.assign.p1[j], 'N');
  await admin.post('/api/assign', { changes: [{ pid: 'p1', j, code: null }] });
  r = await admin.get(`/api/assign?from=${j}&to=${j}`);
  assert.equal(r.data.assign.p1, undefined);
  r = await admin.get(`/api/assign?from=${j}&to=${j + 1000}`);
  assert.equal(r.status, 400, 'بازهٔ بیش از حد');
});

test('پیکربندی: حذف شیفتِ در حال استفاده ممکن نیست؛ مدیر بخش نمی‌تواند پیکربندی بنویسد', async () => {
  let r = await mgr.put('/api/config', { version: ver, cfg });
  assert.equal(r.status, 403);
  r = await admin.get('/api/config');
  cfg = r.data.cfg; ver = r.data.version;
  const withoutRefs = Object.assign({}, cfg, { shifts: cfg.shifts.filter((s) => s.code !== 'N') });
  r = await admin.put('/api/config', { version: ver, cfg: withoutRefs });
  assert.equal(r.status, 400, 'ترکیب‌ها هنوز به N اشاره می‌کنند');
  const without = Object.assign({}, cfg, { shifts: cfg.shifts.filter((s) => !['N', 'AN', 'NM', 'MN'].includes(s.code)) });
  r = await admin.put('/api/config', { version: ver, cfg: without });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /N/);
  // حذف پرسنل نباید بی‌صدا حساب، درخواست‌ها و سابقهٔ برنامه را از بین ببرد (#13)
  const fewer = Object.assign({}, cfg, { people: cfg.people.filter((p) => p.id !== 'p2') });
  r = await admin.put('/api/config', { version: ver, cfg: fewer });
  assert.equal(r.status, 409, 'فرد دارای حساب و سابقه حذف نمی‌شود');
  assert.match(r.data.error, /مریم کریمی/);
  assert.match(r.data.error, /حساب کاربری/);
  assert.match(r.data.error, /سابقهٔ برنامه/);
  r = await admin.get('/api/config');
  assert.equal(r.data.version, ver, 'پیکربندی دست نخورد');
  assert.ok(r.data.cfg.people.some((p) => p.id === 'p2'), 'فرد باقی ماند');
  r = await admin.get(`/api/assign?from=${D(7, 1)}&to=${D(7, 30)}`);
  assert.equal(r.data.assign.p2[D(7, 5)], 'SK', 'برنامه‌اش باقی ماند');
  r = await admin.get('/api/users');
  const acct = r.data.users.find((u) => u.code === '1002');
  assert.ok(acct, 'حسابش باقی ماند');
  r = await staffC.get('/api/me');
  assert.equal(r.status, 200, 'نشستش هم معتبر ماند');
  // فقط حساب حذف شود: هنوز سابقهٔ برنامه مانع است و پیام دیگر از حساب نمی‌گوید
  r = await admin.del('/api/users/' + acct.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await admin.put('/api/config', { version: ver, cfg: fewer });
  assert.equal(r.status, 409);
  assert.doesNotMatch(r.data.error, /حساب کاربری/);
  assert.match(r.data.error, /سابقهٔ برنامه/);
  // پس از پاک‌کردن برنامه‌اش، حذف انجام می‌شود
  r = await admin.post('/api/assign', { changes: [{ pid: 'p2', j: D(7, 5), code: null }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await admin.put('/api/config', { version: ver, cfg: fewer });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  ver = r.data.version;
  r = await admin.get('/api/config');
  assert.ok(!r.data.cfg.people.some((p) => p.id === 'p2'));
});

test('مدیریت حساب: آخرین مدیر، غیرفعال‌سازی، بازنشانی', async () => {
  const me = (await admin.get('/api/me')).data.user;
  let r = await admin.patch('/api/users/' + me.id, { active: false });
  assert.equal(r.status, 400);
  r = await admin.patch('/api/users/' + me.id, { role: 'staff' });
  assert.equal(r.status, 400);
  r = await admin.del('/api/users/' + me.id);
  assert.equal(r.status, 400);
  const users = (await admin.get('/api/users')).data.users;
  const a = users.find((u) => u.code === 'staffA');
  r = await admin.post(`/api/users/${a.id}/reset`);
  assert.equal(r.status, 200);
  assert.equal((await staffA.get('/api/me')).status, 401, 'پس از بازنشانی نشست قبلی بسته می‌شود');
  const c = client();
  assert.equal((await c.post('/api/login', { code: 'staffA', password: 'Changed#pass9' })).status, 401, 'گذرواژهٔ قبلی دیگر کار نمی‌کند');
  const login = await c.post('/api/login', { code: 'staffA', password: r.data.tempPassword });
  assert.equal(login.data.user.mustChange, true);
  r = await admin.patch('/api/users/' + a.id, { active: false });
  assert.equal(r.status, 200);
  assert.equal((await c.get('/api/me')).status, 401, 'غیرفعال‌سازی نشست را می‌بندد');
  assert.equal((await client().post('/api/login', { code: 'staffA', password: 'whatever-123' })).status, 401);
  r = await admin.patch('/api/users/' + a.id, { role: 'manager', active: true, deptIds: ['d1'] });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'manager');
  r = await admin.patch('/api/users/' + a.id, { role: 'staff', personId: '' });
  assert.equal(r.status, 400, 'نقش پرسنل بدون فرد مجاز نیست');
});

test('گزارش تغییرات فقط برای مدیر و شامل نام کاربر', async () => {
  const r = await admin.get('/api/log?limit=50');
  assert.equal(r.status, 200);
  assert.ok(r.data.items.length > 5);
  assert.ok(r.data.items.some((l) => /←/.test(l.x) && l.who));
  assert.ok(!JSON.stringify(r.data).includes('pass_hash'));
});

test('محدودیت تلاش ورود', async () => {
  const c = client();
  let last;
  for (let i = 0; i < 5; i++) last = await c.post('/api/login', { code: 'victim', password: 'wrong-pass-' + i });
  assert.equal(last.status, 401);
  last = await c.post('/api/login', { code: 'victim', password: 'wrong-pass-x' });
  assert.equal(last.status, 429);
  assert.ok(+last.headers.get('retry-after') > 0);
  // حتی گذرواژهٔ درست برای همان کد در این بازه بسته است
  last = await c.post('/api/login', { code: 'victim', password: 'anything-123' });
  assert.equal(last.status, 429);
});

test('فایل‌های ایستا: هدرهای امنیتی و جلوگیری از مسیرهای ناخواسته', async () => {
  let res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  for (const p of ['/server/app.js', '/data/shiftyar.db', '/../package.json', '/fonts/../server/app.js', '/%2e%2e/server/db.js', '/web/ui.js', '/shell.html']) {
    res = await fetch(base + p);
    assert.equal(res.status, 404, p);
  }
  res = await fetch(base + '/core.js');
  assert.equal(res.status, 200);
  res = await fetch(base + '/api/nothing');
  assert.equal(res.status, 404);
  res = await fetch(base + '/api/config');
  assert.equal(res.status, 401);
});

test('هم‌زمانی: دو ویرایش هم‌زمان روی خانه‌های متفاوت هر دو می‌مانند', async () => {
  const j1 = D(9, 2), j2 = D(9, 3);
  const [a, b] = await Promise.all([
    admin.post('/api/assign', { changes: [{ pid: 'p1', j: j1, code: 'M' }] }),
    mgr.post('/api/assign', { changes: [{ pid: 'p4', j: j2, code: 'A' }] }),
  ]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const r = await admin.get(`/api/assign?from=${j1}&to=${j2}`);
  assert.equal(r.data.assign.p1[j1], 'M');
  assert.equal(r.data.assign.p4[j2], 'A');
});
