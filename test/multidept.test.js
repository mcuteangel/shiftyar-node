'use strict';
/* Issue #19: one person, multiple departments (main + secondary), per-shift department. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app.js');
const Core = require('../web/core.js');

let app, base, admin, mgrB, staff1, staff3, cfg, ver;
const T = Core.todayJdn();
const D = (jm, jd) => Core.j2d(1405, jm, jd);

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
const assignDeptOf = async (c, pid, d) => (await c.get(`/api/assign?from=${d}&to=${d}`)).data.assignDept?.[pid]?.[d] ?? null;
const assignCodeOf = async (c, pid, d) => (await c.get(`/api/assign?from=${d}&to=${d}`)).data.assign?.[pid]?.[d] ?? null;

test.before(async () => {
  app = createApp({ dbPath: ':memory:', adminCode: 'admin', adminPassword: 'Admin#pass1', log: () => {} });
  await app.bootstrap();
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.server.address().port;
  admin = await loginAs('admin', 'Admin#pass1');
  const g = await admin.get('/api/config');
  // p1: main d1, secondary d2. p2: main d2. p3: main d1, secondary d2.
  const people = [
    { id: 'p1', first: 'الف', last: 'یک', code: '1', phone: '', contract: 'company', deptId: 'd1', extraDeptIds: ['d2'] },
    { id: 'p2', first: 'ب', last: 'دو', code: '2', phone: '', contract: 'company', deptId: 'd2', extraDeptIds: [] },
    { id: 'p3', first: 'ج', last: 'سه', code: '3', phone: '', contract: 'company', deptId: 'd1', extraDeptIds: ['d2'] },
  ];
  cfg = Object.assign({}, g.data.cfg, { depts: [{ id: 'd1', name: 'اورژانس', color: '#e0573f' }, { id: 'd2', name: 'داخلی', color: '#2f7dd1' }], people });
  let r = await admin.put('/api/config', { version: g.data.version, cfg });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  ver = r.data.version;
  const mkUser = async (code, role, pid, deptIds) => {
    const x = await admin.post('/api/users', { code, role, personId: pid, deptIds, password: 'Pass#word123' });
    assert.equal(x.status, 200, JSON.stringify(x.data));
  };
  await mkUser('mgrB', 'manager', 'p2', ['d2']);
  await mkUser('s1', 'staff', 'p1');
  await mkUser('s3', 'staff', 'p3');
  mgrB = await loginAs('mgrB', 'Pass#word123');
  staff1 = await loginAs('s1', 'Pass#word123');
  staff3 = await loginAs('s3', 'Pass#word123');
  const cur = await admin.get('/api/config');
  cfg = cur.data.cfg; ver = cur.data.version;
});
test.after(async () => { await app.close(); });

test('پیکربندی: بخش فرعی ناموجود یا برابر با اصلی رد می‌شود؛ معتبر ذخیره می‌شود', async () => {
  const bad1 = Object.assign({}, cfg, { people: cfg.people.map((p) => (p.id === 'p1' ? Object.assign({}, p, { extraDeptIds: ['dX'] }) : p)) });
  assert.equal((await admin.put('/api/config', { version: ver, cfg: bad1 })).status, 400, 'بخش ناموجود');
  const bad2 = Object.assign({}, cfg, { people: cfg.people.map((p) => (p.id === 'p1' ? Object.assign({}, p, { extraDeptIds: ['d1'] }) : p)) });
  assert.equal((await admin.put('/api/config', { version: ver, cfg: bad2 })).status, 400, 'تکرار بخش اصلی');
  const bad3 = Object.assign({}, cfg, { people: cfg.people.map((p) => (p.id === 'p1' ? Object.assign({}, p, { extraDeptIds: ['d2', 'd2'] }) : p)) });
  assert.equal((await admin.put('/api/config', { version: ver, cfg: bad3 })).status, 400, 'تکرار بخش فرعی');
  const r = await admin.get('/api/config');
  assert.deepEqual(r.data.cfg.people.find((p) => p.id === 'p1').extraDeptIds, ['d2']);
  assert.deepEqual(r.data.cfg.people.find((p) => p.id === 'p2').extraDeptIds, []);
});

test('مدیر بخش فرعی: فرد را می‌بیند، فقط خانه‌های همان بخش را می‌نویسد', async () => {
  let r = await mgrB.get('/api/config');
  assert.deepEqual(r.data.cfg.people.map((p) => p.id).sort(), ['p1', 'p2', 'p3'], 'عضو فرعی هم دیده می‌شود');
  // نوشتن در بخش فرعی مجاز است
  r = await mgrB.post('/api/assign', { changes: [{ pid: 'p1', j: D(7, 5), code: 'M', deptId: 'd2' }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await assignDeptOf(admin, 'p1', D(7, 5)), 'd2');
  // نوشتن در بخش اصلیِ فرد (که مدیرش نیست) ممنوع است
  r = await mgrB.post('/api/assign', { changes: [{ pid: 'p1', j: D(7, 6), code: 'M', deptId: 'd1' }] });
  assert.equal(r.status, 403, JSON.stringify(r.data));
  assert.equal(await assignCodeOf(admin, 'p1', D(7, 6)), null, 'تغییر ردشده اثری ندارد');
  // بخشِ عضونبودن هم 400 است، نه 403
  r = await mgrB.post('/api/assign', { changes: [{ pid: 'p2', j: D(7, 6), code: 'M', deptId: 'd1' }] });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  // خواندن: مدیر بخش فرعی فقط خانه‌های همان بخش را می‌بیند
  await admin.post('/api/assign', { changes: [{ pid: 'p1', j: D(7, 7), code: 'A', deptId: 'd1' }] });
  r = await mgrB.get(`/api/assign?from=${D(7, 1)}&to=${D(7, 31)}`);
  assert.equal(r.data.assign.p1[D(7, 5)], 'M', 'خانهٔ بخش فرعی دیده می‌شود');
  assert.equal(r.data.assign.p1[D(7, 7)], undefined, 'خانهٔ بخش دیگر دیده نمی‌شود');
  // جابه‌جاییِ بخشِ خانه از بخشی که مدیرش نیست ممنوع است
  r = await mgrB.post('/api/assign', { changes: [{ pid: 'p1', j: D(7, 7), code: 'A', deptId: 'd2' }] });
  assert.equal(r.status, 403, JSON.stringify(r.data));
});

test('خانهٔ بدون بخشِ صریح، بخش اصلی است (سازگاری با دادهٔ قدیمی)', async () => {
  await admin.post('/api/assign', { changes: [{ pid: 'p1', j: D(7, 8), code: 'M' }] });
  assert.equal(await assignDeptOf(admin, 'p1', D(7, 8)), null, 'بخش صریحی ذخیره نشده');
  // مدیر بخش فرعی این خانه را نمی‌بیند چون بخشِ مؤثرش اصلی است
  const r = await mgrB.get(`/api/assign?from=${D(7, 8)}&to=${D(7, 8)}`);
  assert.equal(r.data.assign.p1, undefined);
});

test('جابه‌جایی: همکارِ بخش فرعی پذیرفته می‌شود و بخش با شیفت جابه‌جا می‌شود', async () => {
  const day = T + 40;
  await admin.post('/api/assign', { changes: [
    { pid: 'p1', j: day, code: 'M', deptId: 'd2' },
    { pid: 'p3', j: day, code: 'A', deptId: 'd1' },
  ] });
  assert.deepEqual((await staff1.get('/api/peers')).data.peers.map((p) => p.id).sort(), ['p2', 'p3'], 'همکار بخش فرعی در فهرست همکاران است');
  let r = await staff1.post('/api/requests', { kind: 'swap', peerId: 'p3', d1: day, d2: day });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = r.data.request.id;
  r = await staff3.post(`/api/requests/${id}/respond`, { action: 'accept', reply: '' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await mgrB.post(`/api/requests/${id}/respond`, { action: 'approve', reply: '' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await assignCodeOf(admin, 'p1', day), 'A');
  // شیفتِ گرفته‌شده بخش d1 را آورده که بخش اصلیِ p1 است، پس به‌صورت تنک (NULL) ذخیره می‌شود
  assert.equal(await assignDeptOf(admin, 'p1', day), null);
  assert.equal(await assignCodeOf(admin, 'p3', day), 'M');
  assert.equal(await assignDeptOf(admin, 'p3', day), 'd2', 'شیفتِ گرفته‌شده بخشِ خودش را آورده (بخش فرعیِ p3)');
});

test('حذف بخش: از بخش‌های فرعی می‌رود و خانه‌هایش به بخش اصلی برمی‌گردند', async () => {
  const day = D(7, 5); // خانهٔ d2 از تست مدیر
  assert.equal(await assignCodeOf(admin, 'p1', day), 'M');
  const next = Object.assign({}, cfg, {
    depts: [{ id: 'd1', name: 'اورژانس', color: '#e0573f' }],
    people: cfg.people.map((p) => Object.assign({}, p, {
      deptId: p.deptId === 'd2' ? '' : p.deptId,
      extraDeptIds: (p.extraDeptIds || []).filter((d) => d !== 'd2'),
    })),
  });
  const cur = await admin.get('/api/config');
  const r = await admin.put('/api/config', { version: cur.data.version, cfg: next });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(await assignCodeOf(admin, 'p1', day), 'M', 'شیفت حفظ شده');
  assert.equal(await assignDeptOf(admin, 'p1', day), null, 'بخشِ خانه به اصلی برگشته (NULL)');
  const after = await admin.get('/api/config');
  assert.deepEqual(after.data.cfg.people.find((p) => p.id === 'p1').extraDeptIds, []);
  cfg = after.data.cfg; ver = after.data.version;
});
