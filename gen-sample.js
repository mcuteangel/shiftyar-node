const C = require('./web/core.js');
const depts = [
  { id: 'dsamp1', name: 'اورژانس', color: '#e0573f' },
  { id: 'dsamp2', name: 'داخلی', color: '#2f7dd1' },
  { id: 'dsamp3', name: 'جراحی', color: '#2e9e7a' },
];
const P = [
  ['علی', 'رضایی', '1001', 'company', 'dsamp1'], ['مریم', 'کریمی', '1002', 't4', 'dsamp1'], ['حسین', 'احمدی', '1003', 'official', 'dsamp1'],
  ['زهرا', 'موسوی', '2001', 'company', 'dsamp2'], ['رضا', 'محمدی', '2002', 't4', 'dsamp2'], ['نرگس', 'حسینی', '2003', 'official', 'dsamp2'],
  ['امیر', 'جعفری', '3001', 'company', 'dsamp3'], ['سمیرا', 'صادقی', '3002', 't4', 'dsamp3'], ['کاوه', 'نیکخواه', '3003', 'official', 'dsamp3'],
].map((p, i) => ({ id: 'psamp' + (i + 1), first: p[0], last: p[1], code: p[2], phone: '', contract: p[3], deptId: p[4] }));
const cfg = { v: 1, settings: C.defaultSettings(), depts, people: P, shifts: C.defaultShifts(), holidays: C.defaultHolidays(), sample: true };
const a = C.j2d(1405, 7, 1), len = 30, cycle = ['M', 'A', 'N', 'RS'];
const assign = {};
P.forEach((p, i) => {
  assign[p.id] = {};
  for (let d = 0; d < len; d++) assign[p.id][a + d] = cycle[(d + i) % 4];
});
// مرخصی، استعلاجی، غیبت و یک تداخل عمدی (شب و بعد صبح) برای نمایش هشدار
for (let d = 9; d <= 11; d++) assign.psamp4[a + d] = 'LV';
for (let d = 14; d <= 15; d++) assign.psamp6[a + d] = 'SK';
assign.psamp5[a + 18] = 'AB';
assign.psamp8[a + 19] = 'N'; assign.psamp8[a + 20] = 'M';
assign.psamp2[a + 5] = 'MA'; assign.psamp3[a + 6] = 'NM'; delete assign.psamp3[a + 7];
const m = {};
for (const pid in assign) for (const j in assign[pid]) m[pid + ':' + (j - a + 1)] = assign[pid][j];
const db = { settings: cfg.settings, holidays: cfg.holidays, shifts: cfg.shifts, assign };
const warns = P.map((p) => ({ n: p.first, w: Object.keys(C.restIssues(db, p)).map((j) => j - a + 1) })).filter((x) => x.w.length);
console.error('warnings:', JSON.stringify(warns));
require('fs').writeFileSync('sample/sample-config.json', JSON.stringify(cfg));
require('fs').writeFileSync('sample/sample-month.json', JSON.stringify({ m }));
console.error('cfg bytes', JSON.stringify(cfg).length, 'month bytes', JSON.stringify({ m }).length, 'keys', Object.keys(m).length);
