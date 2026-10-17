/* core.js — محاسبات خالص (بدون DOM): تقویم شمسی، شیفت‌ها، تعطیلات، موظفی و اضافه‌کار */
(function (root) {
  'use strict';

  /* ---------- تقویم جلالی (الگوریتم jalaali-js) ---------- */
  const div = (a, b) => Math.trunc(a / b);
  const mod = (a, b) => a - Math.trunc(a / b) * b;
  const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

  function jalCal(jy, withoutLeap) {
    const bl = BREAKS.length;
    const gy = jy + 621;
    let leapJ = -14, jp = BREAKS[0], jm, jump = 0, leap, n;
    if (jy < jp || jy >= BREAKS[bl - 1]) throw new Error('Invalid Jalaali year ' + jy);
    for (let i = 1; i < bl; i += 1) {
      jm = BREAKS[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    const march = 20 + leapJ - leapG;
    if (withoutLeap) return { gy, march };
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { leap, gy, march };
  }

  function g2d(gy, gm, gd) {
    let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
    d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
  }
  function d2g(jdn) {
    let j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    const i = div(mod(j, 1461), 4) * 5 + 308;
    const gd = div(mod(i, 153), 5) + 1;
    const gm = mod(div(i, 153), 12) + 1;
    const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy, gm, gd };
  }
  function j2d(jy, jm, jd) {
    const r = jalCal(jy, true);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }
  function d2j(jdn) {
    const gy = d2g(jdn).gy;
    let jy = gy - 621;
    const r = jalCal(jy, false);
    const jdn1f = g2d(gy, 3, r.march);
    let k = jdn - jdn1f, jm, jd;
    if (k >= 0) {
      if (k <= 185) {
        jm = 1 + div(k, 31);
        jd = mod(k, 31) + 1;
        return { jy, jm, jd };
      }
      k -= 186;
    } else {
      jy -= 1;
      k += 179;
      if (r.leap === 1) k += 1;
    }
    jm = 7 + div(k, 30);
    jd = mod(k, 30) + 1;
    return { jy, jm, jd };
  }
  const isLeap = (jy) => jalCal(jy, false).leap === 0;
  const monthLen = (jy, jm) => (jm <= 6 ? 31 : jm <= 11 ? 30 : isLeap(jy) ? 30 : 29);
  /** ۰ = شنبه … ۶ = جمعه */
  const weekdayOf = (jdn) => mod(jdn + 2, 7);
  function todayJdn() {
    const d = new Date();
    return g2d(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const WD_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
  const WD_FULL = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

  /* ---------- قالب‌بندی ---------- */
  const FA = '۰۱۲۳۴۵۶۷۸۹';
  const fa = (s) => String(s).replace(/\d/g, (d) => FA[d]);
  const toLatin = (s) =>
    String(s).replace(/[۰-۹]/g, (d) => FA.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const pad2 = (n) => String(n).padStart(2, '0');
  /** دقیقه → «ساعت:دقیقه» با ارقام فارسی */
  function fmtHM(min) {
    const neg = min < 0;
    const m = Math.round(Math.abs(min));
    return (neg ? '−' : '') + fa(Math.floor(m / 60)) + ':' + fa(pad2(m % 60));
  }
  /** همان فرمت با ارقام لاتین (برای خروجی فایل) */
  function fmtHMlatin(min) {
    const neg = min < 0;
    const m = Math.round(Math.abs(min));
    return (neg ? '-' : '') + Math.floor(m / 60) + ':' + pad2(m % 60);
  }
  const fmtDate = (jdn) => {
    const d = d2j(jdn);
    return fa(d.jy) + '/' + fa(pad2(d.jm)) + '/' + fa(pad2(d.jd));
  };
  const fmtDateLatin = (jdn) => {
    const d = d2j(jdn);
    return d.jy + '/' + pad2(d.jm) + '/' + pad2(d.jd);
  };
  function parseDate(str) {
    const m = /^\s*(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\s*$/.exec(toLatin(str));
    if (!m) return null;
    const jy = +m[1], jm = +m[2], jd = +m[3];
    if (jm < 1 || jm > 12 || jd < 1 || jy < 1300 || jy > 1500 || jd > monthLen(jy, jm)) return null;
    return j2d(jy, jm, jd);
  }
  const toMin = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(toLatin(hhmm || ''));
    return m ? +m[1] * 60 + +m[2] : 0;
  };

  /* ---------- پیش‌فرض‌ها ---------- */
  const SPECIAL = {
    LV: { name: 'مرخصی استحقاقی', short: 'مر', credit: true },
    LU: { name: 'مرخصی بدون حقوق', short: 'بح', credit: false },
    SK: { name: 'استعلاجی', short: 'اس', credit: true },
    RS: { name: 'استراحت', short: 'را', credit: false },
    AB: { name: 'غیبت', short: 'غ', credit: false },
  };
  const CONTRACTS = { company: 'شرکتی', t4: 'تبصره ۴', official: 'رسمی' };

  const defaultShifts = () => [
    { code: 'M', name: 'صبح', kind: 'simple', segs: [{ o: 0, s: '07:00', e: '13:30' }] },
    { code: 'A', name: 'عصر', kind: 'simple', segs: [{ o: 0, s: '13:00', e: '19:30' }] },
    { code: 'N', name: 'شب', kind: 'simple', segs: [{ o: 0, s: '19:00', e: '07:30' }] },
    { code: 'MA', name: 'صبح و عصر', kind: 'combo', refs: [{ code: 'M', o: 0 }, { code: 'A', o: 0 }] },
    { code: 'AN', name: 'عصر و شب', kind: 'combo', refs: [{ code: 'A', o: 0 }, { code: 'N', o: 0 }] },
    { code: 'NM', name: 'شب و صبحِ روز بعد', kind: 'combo', refs: [{ code: 'N', o: 0 }, { code: 'M', o: 1 }] },
    { code: 'MN', name: 'صبح و شب', kind: 'combo', refs: [{ code: 'M', o: 0 }, { code: 'N', o: 0 }] },
  ];
  const defaultHolidays = () => [
    [1, 1, 'نوروز'], [1, 2, 'نوروز'], [1, 3, 'نوروز'], [1, 4, 'نوروز'],
    [1, 12, 'روز جمهوری اسلامی'], [1, 13, 'سیزده‌بدر'],
    [3, 14, 'رحلت امام خمینی'], [3, 15, 'قیام ۱۵ خرداد'],
    [11, 22, 'پیروزی انقلاب اسلامی'], [12, 29, 'ملی شدن صنعت نفت'],
  ].map((h, i) => ({ id: 'h' + i, jy: null, jm: h[0], jd: h[1], name: h[2] }));
  const defaultSettings = () => ({
    fridayHoliday: true,
    dutyMin: 440, // ۷ ساعت و ۲۰ دقیقه
    factors: { company: 1.4, t4: 1.4, official: 1 },
    minRestH: 11,
    otCapH: 0,
  });

  /* ---------- شیفت‌ها: اجتماع بازه‌ها ---------- */
  function mergeIv(list) {
    const a = list.filter((x) => x[1] > x[0]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const out = [];
    for (const iv of a) {
      const last = out[out.length - 1];
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else out.push([iv[0], iv[1]]);
    }
    return out;
  }
  /** بازه‌های یک شیفت (دقیقه از ۰۰:۰۰ روز شروع؛ مقدار بالاتر از ۱۴۴۰ یعنی روز بعد) */
  function shiftIvs(shifts, code, depth) {
    depth = depth || 0;
    const sh = shifts.find((s) => s.code === code);
    if (!sh || depth > 3) return [];
    const all = [];
    if (sh.kind === 'combo') {
      for (const r of sh.refs || []) {
        for (const iv of shiftIvs(shifts, r.code, depth + 1)) all.push([iv[0] + (r.o || 0) * 1440, iv[1] + (r.o || 0) * 1440]);
      }
    } else {
      for (const sg of sh.segs || []) {
        const s = (sg.o || 0) * 1440 + toMin(sg.s);
        let e = (sg.o || 0) * 1440 + toMin(sg.e);
        if (e <= s) e += 1440;
        all.push([s, e]);
      }
    }
    return mergeIv(all);
  }
  const ivsMinutes = (ivs) => ivs.reduce((t, iv) => t + (iv[1] - iv[0]), 0);
  const shiftMinutes = (shifts, code) => ivsMinutes(shiftIvs(shifts, code));
  const clock = (x) => {
    const m = mod(x, 1440);
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  };
  /** متن خوانا از بازه‌های شیفت */
  function ivText(ivs) {
    return ivs
      .map((iv) => {
        const sd = Math.floor(iv[0] / 1440), ed = Math.floor((iv[1] - 1) / 1440);
        const s = clock(iv[0]) + (sd ? ' (روز بعد)' : '');
        const e = clock(iv[1]) + (ed > sd ? (ed - sd === 1 && sd === 0 ? ' (فردا)' : ' (روز بعد)') : '');
        return fa(s) + ' تا ' + fa(e);
      })
      .join('، ');
  }

  /* ---------- تعطیلات ---------- */
  function holidayInfo(S, H, jdn) {
    const d = d2j(jdn);
    for (const h of H) if (h.jm === d.jm && h.jd === d.jd && (!h.jy || h.jy === d.jy)) return { name: h.name, type: 'official' };
    if (S.fridayHoliday && weekdayOf(jdn) === 6) return { name: 'جمعه', type: 'friday' };
    return null;
  }
  function holidayMap(S, H, a, b) {
    const m = {};
    for (let j = a; j <= b; j++) m[j] = holidayInfo(S, H, j);
    return m;
  }

  /* ---------- محاسبه برای یک نفر در بازه [a, b] (شماره روز ژولیانی) ---------- */
  function computeRange(db, p, a, b, hm) {
    const S = db.settings;
    hm = hm || holidayMap(S, db.holidays, a, b);
    const mine = (db.assign && db.assign[p.id]) || {};
    const blocks = [];
    const counts = {};
    let credit = 0;
    for (const k in mine) {
      const j = +k, code = mine[k];
      const inRange = j >= a && j <= b;
      if (SPECIAL[code]) {
        if (inRange) {
          counts[code] = (counts[code] || 0) + 1;
          if (SPECIAL[code].credit && !hm[j]) credit += S.dutyMin;
        }
        continue;
      }
      if (j < a - 3 || j > b) continue;
      if (inRange) counts[code] = (counts[code] || 0) + 1;
      for (const iv of shiftIvs(db.shifts, code)) blocks.push([j * 1440 + iv[0], j * 1440 + iv[1]]);
    }
    const factor = (S.factors && S.factors[p.contract]) != null ? S.factors[p.contract] : 1;
    let actual = 0, weighted = 0, holidayMins = 0;
    for (const iv of mergeIv(blocks)) {
      for (let j = Math.floor(iv[0] / 1440); j <= Math.floor((iv[1] - 1) / 1440); j++) {
        if (j < a || j > b) continue;
        const mins = Math.min(iv[1], (j + 1) * 1440) - Math.max(iv[0], j * 1440);
        actual += mins;
        if (hm[j]) { weighted += mins * factor; holidayMins += mins; } else weighted += mins;
      }
    }
    let holCount = 0;
    for (let j = a; j <= b; j++) if (hm[j]) holCount++;
    const days = b - a + 1;
    const duty = (days - holCount) * S.dutyMin;
    weighted = Math.round(weighted * 100) / 100;
    return { days, holCount, duty, actual, weighted, holidayMins, credit, overtime: weighted + credit - duty, counts };
  }

  /* ---------- حداقل فاصله بین شیفت‌ها ---------- */
  /** نقشهٔ روز → فهرست پیام برای روزهایی که شیفت‌شان با شیفت قبل تداخل یا فاصلهٔ کم دارد */
  function restIssues(db, p) {
    const mine = (db.assign && db.assign[p.id]) || {};
    const items = [];
    for (const k in mine) {
      if (SPECIAL[mine[k]]) continue;
      const ivs = shiftIvs(db.shifts, mine[k]);
      if (!ivs.length) continue;
      const j = +k;
      items.push({ j, code: mine[k], s: j * 1440 + ivs[0][0], e: j * 1440 + ivs[ivs.length - 1][1] });
    }
    items.sort((x, y) => x.s - y.s);
    const out = {};
    const need = (db.settings.minRestH || 0) * 60;
    let maxEnd = -Infinity, prev = null;
    for (const it of items) {
      if (prev) {
        const gap = it.s - maxEnd;
        if (gap < 0) (out[it.j] = out[it.j] || []).push('تداخل با شیفت ' + prev.code + ' در ' + fmtDate(prev.j));
        else if (gap < need) (out[it.j] = out[it.j] || []).push('فاصلهٔ ' + fmtHM(gap) + ' از شیفت ' + prev.code + ' در ' + fmtDate(prev.j) + ' (حداقل ' + fa(db.settings.minRestH) + ' ساعت)');
      }
      if (it.e > maxEnd) { maxEnd = it.e; prev = it; }
    }
    return out;
  }

  /* ---------- اعتبارسنجی شیفت ---------- */
  function validateShift(draft, shifts, isNew) {
    const code = (draft.code || '').trim();
    if (!/^[A-Za-z]{1,3}$/.test(code)) return 'کد شیفت باید ۱ تا ۳ حرف انگلیسی باشد.';
    if (isNew && shifts.some((s) => s.code.toUpperCase() === code.toUpperCase())) return 'این کد قبلاً استفاده شده است.';
    if (SPECIAL[code.toUpperCase()]) return 'این کد برای وضعیت‌های ویژه (مرخصی، استعلاجی…) رزرو است.';
    if (!(draft.name || '').trim()) return 'نام شیفت را بنویسید.';
    if (draft.kind === 'combo') {
      if (!draft.refs || !draft.refs.length) return 'حداقل یک شیفت برای ترکیب انتخاب کنید.';
    } else {
      if (!draft.segs || !draft.segs.length) return 'حداقل یک بازهٔ زمانی بنویسید.';
      for (const sg of draft.segs) {
        if (!/^\d{1,2}:\d{2}$/.test(toLatin(sg.s || '')) || !/^\d{1,2}:\d{2}$/.test(toLatin(sg.e || ''))) return 'ساعت‌ها را به شکل ۰۷:۰۰ بنویسید.';
        if (toMin(sg.s) >= 1440 || toMin(sg.e) >= 1440) return 'ساعت باید کمتر از ۲۴:۰۰ باشد.';
        if (toMin(sg.s) === toMin(sg.e)) return 'شروع و پایان یکسان است.';
      }
    }
    return '';
  }

  const Core = {
    div, mod, g2d, d2g, j2d, d2j, isLeap, monthLen, weekdayOf, todayJdn,
    MONTHS, WD_SHORT, WD_FULL, FA, fa, toLatin, pad2, fmtHM, fmtHMlatin, fmtDate, fmtDateLatin, parseDate, toMin,
    SPECIAL, CONTRACTS, defaultShifts, defaultHolidays, defaultSettings,
    mergeIv, shiftIvs, ivsMinutes, shiftMinutes, ivText, holidayInfo, holidayMap, computeRange, restIssues, validateShift,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
