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

console.log(results.join('\n'));
