'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app.js');
const Core = require('../web/core.js');

let app, base, admin, mgr1, mgr2, sA, sB, sC, sD;
const T = Core.todayJdn();

function client() {
  let cookie = '';
  const c = {
    async req(method, path, body) {
      const headers = { 'X-Requested-With': 'shiftyar' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (cookie) headers.Cookie = cookie;
      const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      let data = null; try { data = await res.json(); } catch (_) { /* */ }
      return { status: res.status, data };
    },
    get: (p) => c.req('GET', p),
    post: (p, b) => c.req('POST', p, b === undefined ? {} : b),
    put: (p, b) => c.req('PUT', p, b),
  };
  return c;
}
async function loginAs(code, pw) {
  const c = client();
  let r = await c.post('/api/login', { code, password: pw });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  if (r.data.user.mustChange) { r = await c.post('/api/password', { current: pw, next: 'Changed#pass9' }); assert.equal(r.status, 200); }
  return c;
}
const respond = (c, id, action, reply) => c.post(`/api/requests/${id}/respond`, { action, reply });
const assignOf = async (pid, d) => (await admin.get(`/api/assign?from=${d}&to=${d}`)).data.assign?.[pid]?.[d] ?? null;
const setA = (changes) => admin.post('/api/assign', { changes });

test.before(async () => {
  app = createApp({ dbPath: ':memory:', adminCode: 'admin', adminPassword: 'Admin#pass1', log: () => {} });
  await app.bootstrap();
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.server.address().port;
  admin = await loginAs('admin', 'Admin#pass1');
  const g = await admin.get('/api/config');
  const mk = (id, f, l, code, dept) => ({ id, first: f, last: l, code, phone: '', contract: 'company', deptId: dept });
  const people = [mk('p1', 'الف', 'یک', '1', 'd1'), mk('p2', 'ب', 'دو', '2', 'd1'), mk('p3', 'مدیر', 'اول', '3', 'd1'),
    mk('p4', 'ج', 'سه', '4', 'd2'), mk('p5', 'مدیر', 'دوم', '5', 'd2')];
  const cfg = Object.assign({}, g.data.cfg, { depts: [{ id: 'd1', name: 'اورژانس', color: '#e0573f' }, { id: 'd2', name: 'داخلی', color: '#2f7dd1' }], people });
  let r = await admin.put('/api/config', { version: g.data.version, cfg });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const mkUser = async (code, role, pid, deptIds) => {
    const x = await admin.post('/api/users', { code, role, personId: pid, deptIds, password: 'Pass#word123' });
    assert.equal(x.status, 200, JSON.stringify(x.data));
  };
  await mkUser('m1', 'manager', 'p3', ['d1']); await mkUser('m2', 'manager', 'p5', ['d2']);
  await mkUser('sa', 'staff', 'p1'); await mkUser('sb', 'staff', 'p2'); await mkUser('sd', 'staff', 'p4');
  mgr1 = await loginAs('m1', 'Pass#word123'); mgr2 = await loginAs('m2', 'Pass#word123');
  sA = await loginAs('sa', 'Pass#word123'); sB = await loginAs('sb', 'Pass#word123'); sD = await loginAs('sd', 'Pass#word123');
});
test.after(async () => { await app.close(); });

test('مرخصی: اعتبارسنجی، دید، تأیید و اعمال روی برنامه', async () => {
  await setA([{ pid: 'p1', j: T + 10, code: 'M' }]);
  let r = await sA.post('/api/requests', { kind: 'leave', code: 'XX', from: T + 10, to: T + 11 });
  assert.equal(r.status, 400, 'نوع نامعتبر');
  r = await sA.post('/api/requests', { kind: 'leave', code: 'LV', from: T + 12, to: T + 10 });
  assert.equal(r.status, 400, 'پایان قبل از شروع');
  r = await sA.post('/api/requests', { kind: 'leave', code: 'LV', from: T + 10, to: T + 90 });
  assert.equal(r.status, 400, 'بیش از ۶۰ روز');
  r = await sA.post('/api/requests', { kind: 'leave', code: 'LV', from: T + 10, to: T + 11, note: 'سفر' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = r.data.request.id;
  assert.deepEqual(r.data.request.actions, ['cancel']);
  r = await sA.post('/api/requests', { kind: 'leave', code: 'SK', from: T + 11, to: T + 12 });
  assert.equal(r.status, 400, 'هم‌پوشانی');
  // دید
  assert.equal((await sB.get('/api/requests')).data.requests.length, 0, 'همکار نمی‌بیند');
  assert.equal((await mgr2.get('/api/requests')).data.requests.length, 0, 'مدیر بخش دیگر نمی‌بیند');
  assert.equal((await mgr1.get('/api/requests')).data.requests.length, 1);
  assert.equal((await mgr1.get('/api/rev')).data.todo, 1);
  // اقدام ممنوع
  assert.equal((await respond(sA, id, 'approve')).status, 403, 'خود فرد');
  assert.equal((await respond(sB, id, 'approve')).status, 403, 'همکار');
  assert.equal((await respond(mgr2, id, 'approve')).status, 403, 'مدیر بخش دیگر');
  // تأیید
  r = await respond(mgr1, id, 'approve', 'موافقم');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.request.status, 'approved');
  assert.equal(await assignOf('p1', T + 10), 'LV', 'روی شیفت قبلی نوشته می‌شود');
  assert.equal(await assignOf('p1', T + 11), 'LV');
  assert.equal((await respond(mgr1, id, 'approve')).status, 403, 'دوباره ممکن نیست');
});

test('مرخصی: رد و لغو', async () => {
  let r = await sB.post('/api/requests', { kind: 'leave', code: 'LU', from: T + 20, to: T + 20 });
  const id = r.data.request.id;
  r = await respond(mgr1, id, 'reject', 'کمبود نیرو');
  assert.equal(r.data.request.status, 'rejected');
  assert.equal(r.data.request.reply, 'کمبود نیرو');
  assert.equal(await assignOf('p2', T + 20), null);
  r = await sB.post('/api/requests', { kind: 'leave', code: 'LU', from: T + 20, to: T + 20 });
  r = await respond(sB, r.data.request.id, 'cancel');
  assert.equal(r.data.request.status, 'cancelled');
});

test('جابه‌جایی: هم‌روز، بین‌روز، رد توسط همکار، بازبینی هنگام تأیید', async () => {
  await setA([{ pid: 'p1', j: T + 30, code: 'M' }, { pid: 'p2', j: T + 30, code: 'N' }, { pid: 'p1', j: T + 31, code: 'A' }, { pid: 'p2', j: T + 33, code: 'M' }]);
  assert.deepEqual((await sA.get('/api/peers')).data.peers.map((p) => p.id).sort(), ['p2', 'p3']);
  let r = await sA.post('/api/requests', { kind: 'swap', peerId: 'p4', d1: T + 30, d2: T + 30 });
  assert.equal(r.status, 400, 'بخش دیگر');
  r = await sA.post('/api/requests', { kind: 'swap', peerId: 'p2', d1: T + 32, d2: T + 30 });
  assert.equal(r.status, 400, 'شیفت ندارد');
  r = await sA.post('/api/requests', { kind: 'swap', peerId: 'p2', d1: T + 31, d2: T + 33 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cross = r.data.request.id;
  r = await sA.post('/api/requests', { kind: 'swap', peerId: 'p2', d1: T + 30, d2: T + 30 });
  assert.equal(r.status, 200);
  const same = r.data.request.id;
  // مدیر قبل از همکار نمی‌تواند تأیید کند
  assert.equal((await respond(mgr1, same, 'approve')).status, 403);
  assert.equal((await respond(sA, same, 'accept')).status, 403, 'درخواست‌دهنده نمی‌پذیرد');
  assert.equal((await sB.get('/api/rev')).data.todo, 2);
  r = await respond(sB, same, 'accept');
  assert.equal(r.data.request.status, 'manager');
  r = await respond(mgr1, same, 'approve');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await assignOf('p1', T + 30), 'N');
  assert.equal(await assignOf('p2', T + 30), 'M');
  // بین‌روز: برنامه بین درخواست و تأیید عوض می‌شود → ۴۰۹
  await respond(sB, cross, 'accept');
  await setA([{ pid: 'p1', j: T + 33, code: 'A' }]);
  r = await respond(mgr1, cross, 'approve');
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(await assignOf('p1', T + 31), 'A', 'چیزی تغییر نکرده');
  await setA([{ pid: 'p1', j: T + 33, code: null }]);
  r = await respond(mgr1, cross, 'approve');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await assignOf('p1', T + 31), null);
  assert.equal(await assignOf('p2', T + 31), 'A');
  assert.equal(await assignOf('p2', T + 33), null);
  assert.equal(await assignOf('p1', T + 33), 'M');
});

test('جابه‌جایی: عدم پذیرش همکار، مدیر خودش و ورودی نامعتبر', async () => {
  await setA([{ pid: 'p1', j: T + 40, code: 'M' }, { pid: 'p2', j: T + 40, code: 'A' }, { pid: 'p3', j: T + 40, code: 'N' }]);
  let r = await sA.post('/api/requests', { kind: 'swap', peerId: 'p2', d1: T + 40, d2: T + 40 });
  r = await respond(sB, r.data.request.id, 'decline', 'نمی‌توانم');
  assert.equal(r.data.request.status, 'declined');
  assert.equal(await assignOf('p1', T + 40), 'M');
  // مدیر اول (p3) با p1 جابه‌جایی می‌خواهد؛ خودش نمی‌تواند تأیید کند، مدیر سیستم می‌تواند
  r = await mgr1.post('/api/requests', { kind: 'swap', peerId: 'p1', d1: T + 40, d2: T + 40 });
  const id = r.data.request.id;
  await respond(sA, id, 'accept');
  assert.equal((await respond(mgr1, id, 'approve')).status, 403);
  assert.equal((await respond(admin, id, 'approve')).status, 200);
  assert.equal(await assignOf('p3', T + 40), 'M');
  assert.equal((await sD.post('/api/requests', { kind: 'bad' })).status, 400);
  assert.equal((await admin.post('/api/requests', { kind: 'leave', code: 'LV', from: T, to: T })).status, 400, 'ادمین بدون فرد');
  assert.equal((await respond(sA, 99999, 'cancel')).status, 404);
  assert.equal((await respond(sA, 1, 'explode')).status, 400);
  const rev = (await sA.get('/api/rev')).data;
  assert.ok(rev.reqRev > 0);
});

test('ترجیحات و درخواست روز: ثبت، دسترسی و اعتبارسنجی', async () => {
  let r = await sA.put('/api/prefs/p1', { ot: 'more', shift: { N: -2, A: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.prefs, { shift: { N: -2, A: 1 }, ot: 'more' });
  assert.equal((await sA.put('/api/prefs/p2', { ot: 'none' })).status, 403, 'پرسنل برای همکار نمی‌تواند');
  assert.equal((await mgr2.put('/api/prefs/p1', { ot: 'none' })).status, 403, 'مدیر بخش دیگر نمی‌تواند');
  assert.equal((await mgr1.put('/api/prefs/p2', { ot: 'none', shift: { M: 2 } })).status, 200, 'مدیر بخش می‌تواند');
  assert.equal((await sA.put('/api/prefs/p1', { ot: 'lots' })).status, 400);
  assert.equal((await sA.put('/api/prefs/p1', { shift: { ZZ: 1 } })).status, 400);
  assert.equal((await sA.put('/api/prefs/p1', { shift: { M: 5 } })).status, 400);

  r = await sA.post('/api/wishes', { day: T + 8, kind: 'want', code: 'N', note: 'امتحان' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = r.data.wish.id;
  assert.equal((await sA.post('/api/wishes', { day: T + 8, kind: 'want', code: 'N' })).status, 400, 'تکراری');
  assert.equal((await sA.post('/api/wishes', { day: T + 8, kind: 'want' })).status, 400, 'want بدون شیفت');
  assert.equal((await sA.post('/api/wishes', { day: T + 900, kind: 'off' })).status, 400, 'خیلی دور');
  assert.equal((await sA.post('/api/wishes', { pid: 'p2', day: T + 9, kind: 'off' })).status, 403);
  assert.equal((await mgr1.post('/api/wishes', { pid: 'p2', day: T + 9, kind: 'off' })).status, 200);
  assert.equal((await sD.post('/api/wishes', { day: T + 9, kind: 'avoid', code: 'N' })).status, 200);

  let g = (await sA.get('/api/prefs')).data;
  assert.deepEqual(Object.keys(g.prefs), ['p1'], 'پرسنل فقط مال خودش را می‌بیند');
  assert.deepEqual(g.wishes.map((w) => w.pid), ['p1']);
  g = (await mgr1.get('/api/prefs')).data;
  assert.deepEqual(Object.keys(g.prefs).sort(), ['p1', 'p2'], 'مدیر بخش اول: فقط بخش خودش');
  assert.ok(!g.wishes.some((w) => w.pid === 'p4'));
  assert.equal((await admin.get('/api/prefs')).data.wishes.length, 3);

  assert.equal((await sB.req('DELETE', `/api/wishes/${id}`)).status, 403);
  assert.equal((await sA.req('DELETE', `/api/wishes/${id}`)).status, 200);
  assert.equal((await sA.req('DELETE', `/api/wishes/${id}`)).status, 404);
});

test('حذف پرسنل دارای درخواست رد می‌شود و درخواست‌ها می‌مانند (#13)', async () => {
  const g = (await admin.get('/api/config')).data;
  const before = (await admin.get('/api/requests')).data;
  const mine = before.requests.filter((x) => x.personId === 'p1' || x.peerId === 'p1');
  assert.ok(mine.length > 0, 'p1 در تست‌های قبلی درخواست دارد');
  const fewer = Object.assign({}, g.cfg, { people: g.cfg.people.filter((p) => p.id !== 'p1') });
  const r = await admin.put('/api/config', { version: g.version, cfg: fewer });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.match(r.data.error, /درخواست ثبت‌شده/);
  assert.ok((await admin.get('/api/config')).data.cfg.people.some((p) => p.id === 'p1'));
  const after = (await admin.get('/api/requests')).data;
  const mine2 = after.requests.filter((x) => x.personId === 'p1' || x.peerId === 'p1');
  assert.equal(mine2.length, mine.length, 'درخواست‌ها حذف نشدند');
});
