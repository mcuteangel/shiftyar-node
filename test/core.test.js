const C = require('../web/core.js');
const assert = require('assert');
const results = [];
function t(name, fn) {
  try { fn(); results.push('PASS  ' + name); }
  catch (e) { results.push('FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

t('تاریخ امروز: ۲۵ مهر ۱۴۰۵ = ۲۰۲۶-۱۰-۱۷', () => {
  const j = C.g2d(2026, 10, 17);
  assert.deepStrictEqual(C.d2j(j), { jy: 1405, jm: 7, jd: 25 });
  assert.strictEqual(C.j2d(1405, 7, 25), j);
});
t('روز هفته: ۱۷ اکتبر ۲۰۲۶ شنبه است', () => assert.strictEqual(C.weekdayOf(C.g2d(2026, 10, 17)), 0));
t('نوروز ۱۴۰۵ = ۲۱ مارس ۲۰۲۶', () => assert.strictEqual(C.j2d(1405, 1, 1), C.g2d(2026, 3, 21)));
t('طول ماه‌ها و سال کبیسه', () => {
  assert.strictEqual(C.monthLen(1403, 12), 30);
  assert.strictEqual(C.monthLen(1404, 12), 29);
  assert.strictEqual(C.monthLen(1405, 12), 29);
  assert.strictEqual(C.monthLen(1408, 12), 30);
  assert.strictEqual(C.monthLen(1405, 6), 31);
  assert.strictEqual(C.monthLen(1405, 7), 30);
});
t('رفت‌وبرگشت تاریخ برای ۵ سال', () => {
  for (let j = C.j2d(1402, 1, 1); j < C.j2d(1407, 1, 1); j++) {
    const d = C.d2j(j);
    assert.strictEqual(C.j2d(d.jy, d.jm, d.jd), j);
  }
});
t('ساعت شیفت‌ها (اجتماع بازه‌ها)', () => {
  const sh = C.defaultShifts();
  const m = (c) => C.shiftMinutes(sh, c) / 60;
  assert.strictEqual(m('M'), 6.5);
  assert.strictEqual(m('A'), 6.5);
  assert.strictEqual(m('N'), 12.5);
  assert.strictEqual(m('MA'), 12.5);
  assert.strictEqual(m('AN'), 18.5);
  assert.strictEqual(m('NM'), 18.5);
  assert.strictEqual(m('MN'), 19);
});
t('موظفی مهر ۱۴۰۵: ۳۰ روز، ۴ جمعه → ۲۶×۷:۲۰ = ۱۹۰:۴۰', () => {
  const db = { settings: C.defaultSettings(), holidays: C.defaultHolidays(), shifts: C.defaultShifts(), assign: {} };
  const a = C.j2d(1405, 7, 1), b = a + 29;
  const r = C.computeRange(db, { id: 'x', contract: 'company' }, a, b);
  assert.strictEqual(r.holCount, 4);
  assert.strictEqual(r.duty, 26 * 440);
  assert.strictEqual(C.fmtHMlatin(r.duty), '190:40');
});
t('شیفت شب پنجشنبه→جمعه: ساعت‌های جمعه با ضریب ۱.۴ (شرکتی)', () => {
  const thu = C.j2d(1405, 7, 2); // ۲ مهر = پنجشنبه (۱ مهر = چهارشنبه)
  assert.strictEqual(C.weekdayOf(thu), 5);
  const mk = (contract) => ({
    db: { settings: C.defaultSettings(), holidays: C.defaultHolidays(), shifts: C.defaultShifts(), assign: { p: { [thu]: 'N' } } },
    p: { id: 'p', contract },
  });
  const a = C.j2d(1405, 7, 1), b = a + 29;
  let x = mk('company'); let r = C.computeRange(x.db, x.p, a, b);
  assert.strictEqual(r.actual, 750);
  near(r.weighted, 300 + 450 * 1.4);
  x = mk('official'); r = C.computeRange(x.db, x.p, a, b);
  near(r.weighted, 750);
});
t('شیفت شب روز آخر ماه: فقط بخش داخل ماه شمرده می‌شود', () => {
  const last = C.j2d(1405, 7, 30);
  const db = { settings: C.defaultSettings(), holidays: C.defaultHolidays(), shifts: C.defaultShifts(), assign: { p: { [last]: 'N' } } };
  const a = C.j2d(1405, 7, 1), b = a + 29;
  const r = C.computeRange(db, { id: 'p', contract: 'company' }, a, b);
  assert.strictEqual(r.actual, 300);
  // و بخش ۷:۳۰ صبح روز اول آبان در ماه بعد حساب می‌شود
  const a2 = b + 1, b2 = a2 + 29;
  const r2 = C.computeRange(db, { id: 'p', contract: 'company' }, a2, b2);
  assert.strictEqual(r2.actual, 450);
});
t('هم‌پوشانی ۳۰ دقیقه‌ای N و M فردا فقط یک‌بار شمرده می‌شود', () => {
  const d1 = C.j2d(1405, 7, 5), d2 = d1 + 1;
  const db = { settings: C.defaultSettings(), holidays: C.defaultHolidays(), shifts: C.defaultShifts(), assign: { p: { [d1]: 'N', [d2]: 'M' } } };
  const a = C.j2d(1405, 7, 1), b = a + 29;
  const r = C.computeRange(db, { id: 'p', contract: 'official' }, a, b);
  assert.strictEqual(r.actual, 750 + 390 - 30);
});
t('مرخصی: روز کاری ۷:۲۰ اعتبار؛ در جمعه اعتبار ندارد؛ بدون حقوق اعتبار ندارد', () => {
  const wed = C.j2d(1405, 7, 1), fri = C.j2d(1405, 7, 3), thu = wed + 1;
  assert.strictEqual(C.weekdayOf(fri), 6);
  const db = { settings: C.defaultSettings(), holidays: C.defaultHolidays(), shifts: C.defaultShifts(), assign: { p: { [wed]: 'LV', [fri]: 'LV', [thu]: 'LU', [thu + 5]: 'SK' } } };
  const a = C.j2d(1405, 7, 1), b = a + 29;
  const r = C.computeRange(db, { id: 'p', contract: 'company' }, a, b);
  assert.strictEqual(r.credit, 2 * 440);
  assert.strictEqual(r.counts.LV, 2);
  assert.strictEqual(r.counts.LU, 1);
});
t('اضافه‌کار = وزنی + اعتبار − موظفی', () => {
  const a = C.j2d(1405, 7, 1), b = a + 29;
  const assign = { p: {} };
  for (let i = 0; i < 20; i++) assign.p[a + i] = i % 7 === 2 ? 'RS' : 'M';
  const db = { settings: C.defaultSettings(), holidays: C.defaultHolidays(), shifts: C.defaultShifts(), assign };
  const r = C.computeRange(db, { id: 'p', contract: 'official' }, a, b);
  near(r.overtime, r.weighted + r.credit - r.duty);
});
t('تعطیل رسمی ثابت: ۱۴ خرداد', () => {
  const S = C.defaultSettings(), H = C.defaultHolidays();
  const j = C.j2d(1405, 3, 14);
  assert.strictEqual(C.holidayInfo(S, H, j).type, 'official');
});
t('جمعه تعطیل نباشد → موظفی بیشتر', () => {
  const S = C.defaultSettings(); S.fridayHoliday = false;
  const db = { settings: S, holidays: C.defaultHolidays(), shifts: C.defaultShifts(), assign: {} };
  const a = C.j2d(1405, 7, 1);
  const r = C.computeRange(db, { id: 'x', contract: 'company' }, a, a + 29);
  assert.strictEqual(r.duty, 30 * 440);
});
t('تعطیلات سالانهٔ مخصوص یک سال', () => {
  const S = C.defaultSettings(), H = C.defaultHolidays();
  H.push({ id: 'z', jy: 1405, jm: 4, jd: 5, name: 'عاشورا' });
  assert.ok(C.holidayInfo(S, H, C.j2d(1405, 4, 5)));
  assert.ok(!C.holidayInfo(S, H, C.j2d(1406, 4, 5)) || C.weekdayOf(C.j2d(1406, 4, 5)) === 6);
});
t('حداقل استراحت: N بعد M روز بعد تداخل؛ N بعد A روز بعد فاصلهٔ کم؛ N بعد N بدون هشدار', () => {
  const d = C.j2d(1405, 7, 5);
  const mk = (a2) => ({ settings: C.defaultSettings(), holidays: [], shifts: C.defaultShifts(), assign: { p: a2 } });
  let iss = C.restIssues(mk({ [d]: 'N', [d + 1]: 'M' }), { id: 'p' });
  assert.ok(iss[d + 1] && /تداخل/.test(iss[d + 1][0]));
  iss = C.restIssues(mk({ [d]: 'N', [d + 1]: 'A' }), { id: 'p' });
  assert.ok(iss[d + 1] && /فاصله/.test(iss[d + 1][0]));
  iss = C.restIssues(mk({ [d]: 'N', [d + 1]: 'N' }), { id: 'p' });
  assert.ok(!iss[d + 1]);
  iss = C.restIssues(mk({ [d]: 'M', [d + 1]: 'A', [d + 2]: 'N' }), { id: 'p' });
  assert.deepStrictEqual(Object.keys(iss), []);
});
t('اعتبارسنجی شیفت سفارشی', () => {
  const sh = C.defaultShifts();
  assert.ok(C.validateShift({ code: 'M', name: 'x', kind: 'simple', segs: [{ s: '07:00', e: '09:00' }] }, sh, true));
  assert.ok(C.validateShift({ code: 'LV', name: 'x', kind: 'simple', segs: [{ s: '07:00', e: '09:00' }] }, sh, true));
  assert.strictEqual(C.validateShift({ code: 'X', name: 'x', kind: 'simple', segs: [{ s: '08:00', e: '12:00' }] }, sh, true), '');
});
t('تبدیل رشته تاریخ و ارقام فارسی', () => {
  assert.strictEqual(C.parseDate('۱۴۰۵/۰۷/۲۵'), C.j2d(1405, 7, 25));
  assert.strictEqual(C.parseDate('1405/12/30'), null);
  assert.strictEqual(C.fmtHM(440), '۷:۲۰');
});

function mkDb(n, assign) {
  const people = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, first: 'x', last: 'y' + i, contract: i % 2 ? 't4' : 'official' }));
  return { shifts: C.defaultShifts(), holidays: [], settings: C.defaultSettings(), people, assign: assign || {} };
}
t('پیشنهاد خودکار: نیاز هر روز پر می‌شود و قیدها رعایت می‌شوند', () => {
  const db = mkDb(8);
  const a = C.j2d(1405, 8, 1), b = a + 29;
  const r = C.suggestSchedule(db, { people: db.people.map((p) => p.id), a, b, need: { M: 2, A: 2, N: 1 }, maxConsec: 6, capMin: 20 * 60 });
  assert.strictEqual(r.unfilled.length, 0, JSON.stringify(r.unfilled.slice(0, 3)));
  assert.strictEqual(r.changes.length, 30 * 5);
  // اعمال و بررسی فاصلهٔ استراحت و حداکثر روز پیاپی
  for (const c of r.changes) (db.assign[c.pid] = db.assign[c.pid] || {})[c.j] = c.code;
  for (const p of db.people) {
    assert.deepStrictEqual(C.restIssues(db, p), {}, 'فاصلهٔ بین شیفت‌ها ' + p.id);
    let run = 0;
    for (let j = a; j <= b; j++) { run = db.assign[p.id] && db.assign[p.id][j] ? run + 1 : 0; assert.ok(run <= 6, 'روز پیاپی ' + p.id); }
  }
  // تراز بار: اختلاف کارکرد بین افراد کم است
  const loads = r.summary.map((x) => x.load);
  assert.ok(Math.max(...loads) - Math.min(...loads) < 2 * 750, 'تراز بار: ' + loads.join(','));
});
t('پیشنهاد خودکار: خانه‌های پرشده و مرخصی دست‌نخورده می‌ماند و کمبود گزارش می‌شود', () => {
  const a = C.j2d(1405, 8, 1);
  const db = mkDb(2, { p0: { [a]: 'LV', [a + 1]: 'A' } });
  const r = C.suggestSchedule(db, { people: ['p0', 'p1'], a, b: a + 3, need: { M: 2 }, maxConsec: 6, capMin: 100 * 60 });
  assert.ok(!r.changes.some((c) => c.pid === 'p0' && (c.j === a || c.j === a + 1)), 'p0 دست‌نخورده');
  assert.ok(r.unfilled.some((u) => u.j === a && u.code === 'M' && u.missing === 1), 'روز اول فقط یک نفر در دسترس است');
  const d = C.suggestSchedule(db, { people: ['p0', 'p1'], a, b: a + 3, need: { M: 1 }, maxConsec: 6, capMin: 0 });
  assert.ok(d.changes.length <= 4);
});
t('پیشنهاد خودکار: سقف اضافه‌کار', () => {
  const db = mkDb(1), a = C.j2d(1405, 8, 1);
  const r = C.suggestSchedule(db, { people: ['p0'], a, b: a + 29, need: { M: 1 }, maxConsec: 30, capMin: 0 });
  const total = r.summary[0].load;
  assert.ok(total <= r.summary[0].target, 'از موظفی نمی‌گذرد: ' + total + ' ' + r.summary[0].target);
  assert.ok(r.unfilled.length > 0);
});

t('پیشنهاد خودکار هوشمند: درخواست روز، آف، ترجیح شیفت و اضافه‌کار', () => {
  const a = C.j2d(1405, 8, 1), b = a + 29, ids = (db) => db.people.map((p) => p.id);
  const run = (extra) => { const db = mkDb(6); return { db, r: C.suggestSchedule(db, Object.assign({ people: ids(db), a, b, need: { M: 1, A: 1, N: 1 }, maxConsec: 6, capMin: 20 * 60 }, extra)) }; };
  const at = (r, pid, j) => (r.changes.find((c) => c.pid === pid && c.j === j) || {}).code;
  // want
  let { r } = run({ wishes: [{ pid: 'p3', j: a + 9, kind: 'want', code: 'N' }] });
  assert.strictEqual(at(r, 'p3', a + 9), 'N');
  assert.ok(r.wishReport[0].ok);
  // off: هیچ شیفتی در آن روز
  ({ r } = run({ wishes: [{ pid: 'p1', j: a + 4, kind: 'off' }, { pid: 'p1', j: a + 5, kind: 'off' }] }));
  assert.ok(!at(r, 'p1', a + 4) && !at(r, 'p1', a + 5));
  assert.ok(r.wishReport.every((x) => x.ok));
  // ترجیح شیفت: کسی که شب نمی‌خواهد کمتر شب بگیرد
  const count = (r, pid, code) => r.changes.filter((c) => c.pid === pid && c.code === code).length;
  const base = run({}).r, pref = run({ prefs: { p0: { shift: { N: -2, A: 2 } } } }).r;
  assert.ok(count(pref, 'p0', 'N') < count(base, 'p0', 'N') || count(base, 'p0', 'N') === 0, `شب: ${count(base, 'p0', 'N')} → ${count(pref, 'p0', 'N')}`);
  assert.ok(count(pref, 'p0', 'A') >= count(base, 'p0', 'A'));
  // اضافه‌کار بیشتر / هیچ
  const load = (r, pid) => r.summary.find((x) => x.pid === pid).load;
  const more = run({ prefs: { p1: { ot: 'more' } }, capMin: 40 * 60 }).r, none = run({ prefs: { p1: { ot: 'none' } } }).r;
  assert.ok(load(more, 'p1') > load(none, 'p1'), `${load(more, 'p1')} > ${load(none, 'p1')}`);
  assert.ok(load(none, 'p1') <= none.summary[0].target, 'بدون اضافه‌کار از موظفی نمی‌گذرد');
  // avoid سخت نیست ولی در صورت وجود جایگزین رعایت می‌شود
  ({ r } = run({ wishes: [{ pid: 'p2', j: a + 2, kind: 'avoid', code: 'N' }] }));
  assert.notStrictEqual(at(r, 'p2', a + 2), 'N');
  // want ناممکن (روز پرشده) گزارش می‌شود
  const db2 = mkDb(2, { p0: { [a]: 'M' } });
  const r2 = C.suggestSchedule(db2, { people: ['p0', 'p1'], a, b: a + 2, need: {}, wishes: [{ pid: 'p0', j: a, kind: 'want', code: 'A' }] });
  assert.strictEqual(r2.wishReport[0].ok, false);
});

console.log(results.join('\n'));
