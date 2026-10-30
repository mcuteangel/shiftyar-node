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
  const CONTRACTS = { company: 'شرکتی', t4: 'تبصره ۴', official: 'رسمی', peymani: 'پیمانی', t3: 'تبصره ۳' };
  const WORK_TYPES = { rotating: 'شیفت در گردش', office: 'اداری' };

  const defaultOfficePatterns = () => [
    {
      id: 'off_std',
      name: 'اداری پیش‌فرض (شنبه تا چهارشنبه ۷:۳۰ تا ۱۴:۱۵، پنجشنبه ۷:۳۰ تا ۱۳:۲۰)',
      days: {
        0: { active: true, s: '07:30', e: '14:15' }, // شنبه
        1: { active: true, s: '07:30', e: '14:15' }, // یکشنبه
        2: { active: true, s: '07:30', e: '14:15' }, // دوشنبه
        3: { active: true, s: '07:30', e: '14:15' }, // سه‌شنبه
        4: { active: true, s: '07:30', e: '14:15' }, // چهارشنبه
        5: { active: true, s: '07:30', e: '13:20' }, // پنجشنبه
        6: { active: false, s: '07:30', e: '14:15' }, // جمعه
      },
    },
  ];

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
    factors: { company: 1.4, t4: 1.4, official: 1, peymani: 1, t3: 1 }, // پیمانی و تبصره ۳ مثل رسمی مشمول قانون مدیریت خدمات کشوری، نه قانون کار (#9)
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
  /** بررسی اینکه آیا یک شیفت اداری است */
  function isOfficeShift(shifts, code) {
    const s = shifts && shifts.find((x) => x.code === code);
    return !!(s && s.isOffice);
  }

  /** ساعات کاری الگو برای یک روز هفته (wd: 0=شنبه تا 6=جمعه) */
  function officePatternDay(pattern, wd) {
    if (!pattern || !pattern.days) return null;
    const d = pattern.days[wd] || pattern.days[String(wd)];
    return (d && d.active) ? d : null;
  }

  /** بازه‌های دقیقه برای روز کاری اداری بر اساس الگو */
  function officePatternIvs(pattern, wd) {
    const d = officePatternDay(pattern, wd);
    if (!d || !d.s || !d.e) return [];
    const s = toMin(d.s), e = toMin(d.e);
    return e > s ? [[s, e]] : [];
  }

  /** بازه‌های یک شیفت (دقیقه از ۰۰:۰۰ روز شروع؛ مقدار بالاتر از ۱۴۴۰ یعنی روز بعد) */
  function shiftIvs(shifts, code, depth) {
    depth = depth || 0;
    const sh = shifts.find((s) => s.code === code);
    if (!sh || depth > 3) return [];
    if (sh.isOffice && sh.officePattern) {
      // اگر شیفت اختصاصی اداری باشد، به عنوان بازه پیش‌فرض شنبه تا چهارشنبه یا اولین بازه فعال استفاده می‌شود
      const wd = sh.officePattern.days;
      if (wd) {
        for (let i = 0; i <= 6; i++) {
          const d = wd[i] || wd[String(i)];
          if (d && d.active && d.s && d.e) {
            const s = toMin(d.s), e = toMin(d.e);
            if (e > s) return [[s, e]];
          }
        }
      }
    }
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
        return '\u202B' + fa(s) + ' تا ' + fa(e) + '\u202C';
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

  /* ---------- بخش‌ها: بخش اصلی + بخش‌های فرعی، و بخشِ هر خانهٔ شیفت ---------- */
  /** فهرست بخش‌های یک نفر: بخش اصلی اول، سپس بخش‌های فرعی (بدون تکرار و خالی) */
  function personDepts(p) {
    const out = [];
    if (p) {
      if (p.deptId) out.push(p.deptId);
      for (const d of (p.extraDeptIds || [])) if (d && !out.includes(d)) out.push(d);
    }
    return out;
  }
  /** بخشِ یک خانهٔ شیفت: بخشِ صریحِ خانه، وگرنه بخش اصلی نفر (خانه‌های قدیمی) */
  function cellDept(db, p, j) {
    const explicit = db.assignDept && db.assignDept[p.id] && db.assignDept[p.id][j];
    return explicit || (p && p.deptId) || '';
  }

  /* ---------- محاسبه برای یک نفر در بازه [a, b] (شماره روز ژولیانی) ---------- */
  function findOfficePattern(db, p) {
    if (p.workType !== 'office') return null;
    const patterns = (db.settings && db.settings.officePatterns) || defaultOfficePatterns();
    if (p.officePatternId) {
      const found = patterns.find((pt) => pt.id === p.officePatternId);
      if (found) return found;
    }
    return patterns[0] || defaultOfficePatterns()[0];
  }

  function computeRange(db, p, a, b, hm) {
    const S = db.settings;
    hm = hm || holidayMap(S, db.holidays, a, b);
    const mine = (db.assign && db.assign[p.id]) || {};
    const blocks = [];
    const counts = {};
    let credit = 0;
    const isOff = p.workType === 'office';
    const offPat = isOff ? findOfficePattern(db, p) : null;

    for (const k in mine) {
      const j = +k, code = mine[k];
      const inRange = j >= a && j <= b;
      const wd = weekdayOf(j);
      let dayStandardDuty = S.dutyMin;
      if (isOff && offPat) {
        const ivs = officePatternIvs(offPat, wd);
        dayStandardDuty = ivsMinutes(ivs);
      }
      if (SPECIAL[code]) {
        if (inRange) {
          counts[code] = (counts[code] || 0) + 1;
          if (SPECIAL[code].credit && !hm[j]) credit += dayStandardDuty;
        }
        continue;
      }
      if (j < a - 3 || j > b) continue;
      if (inRange) counts[code] = (counts[code] || 0) + 1;
      // اگر پرسنل اداری باشد، شیفت‌های عادی روزانه هم بر اساس ساعات اداری همان روز محاسبه می‌شوند مگر اینکه شیفت عصر/شب یا خاص باشد
      const sh = (db.shifts || []).find((s) => s.code === code);
      if (isOff && offPat && (code === 'OF' || code === 'M' || (sh && sh.isOffice))) {
        const ivs = officePatternIvs(offPat, wd);
        for (const iv of ivs) blocks.push([j * 1440 + iv[0], j * 1440 + iv[1]]);
      } else {
        for (const iv of shiftIvs(db.shifts, code)) blocks.push([j * 1440 + iv[0], j * 1440 + iv[1]]);
      }
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
    let duty = 0;
    for (let j = a; j <= b; j++) {
      if (hm[j]) {
        holCount++;
      } else if (isOff && offPat) {
        const wd = weekdayOf(j);
        duty += ivsMinutes(officePatternIvs(offPat, wd));
      }
    }
    const days = b - a + 1;
    if (!isOff || !offPat) {
      duty = (days - holCount) * S.dutyMin;
    }
    weighted = Math.round(weighted * 100) / 100;
    return { days, holCount, duty, actual, weighted, holidayMins, credit, overtime: weighted + credit - duty, counts };
  }

  /**
   * تفکیک کارکرد یک نفر در بازه بر اساس بخشِ خانهٔ شیفت (نه بخشِ نفر).
   * خروجی: { deptId: { actual, weighted, credit, counts } }؛ موظفی (duty) سطحِ
   * نفر است و اینجا تقسیم نمی‌شود، پس در خروجی نیست. بازه‌های هر بخش جداگانه
   * اجتماع می‌شوند؛ شیفتی که از نیمه‌شب می‌گذرد به بخشِ روزِ شروعش می‌رسد.
   */
  function computeDeptSplit(db, p, a, b, hm) {
    const S = db.settings;
    hm = hm || holidayMap(S, db.holidays, a, b);
    const mine = (db.assign && db.assign[p.id]) || {};
    const isOff = p.workType === 'office';
    const offPat = isOff ? findOfficePattern(db, p) : null;
    const factor = (S.factors && S.factors[p.contract]) != null ? S.factors[p.contract] : 1;
    const split = {};
    const slot = (d) => (split[d] = split[d] || { actual: 0, weighted: 0, credit: 0, counts: {} });
    const blocksByDept = {};
    for (const k in mine) {
      const j = +k, code = mine[k];
      const inRange = j >= a && j <= b;
      const d = cellDept(db, p, j);
      let dayStandardDuty = S.dutyMin;
      if (isOff && offPat) dayStandardDuty = ivsMinutes(officePatternIvs(offPat, weekdayOf(j)));
      if (SPECIAL[code]) {
        if (inRange) {
          const s = slot(d);
          s.counts[code] = (s.counts[code] || 0) + 1;
          if (SPECIAL[code].credit && !hm[j]) s.credit += dayStandardDuty;
        }
        continue;
      }
      if (j < a - 3 || j > b) continue;
      if (inRange) { const s = slot(d); s.counts[code] = (s.counts[code] || 0) + 1; }
      const sh = (db.shifts || []).find((s) => s.code === code);
      let ivs;
      if (isOff && offPat && (code === 'OF' || code === 'M' || (sh && sh.isOffice))) ivs = officePatternIvs(offPat, weekdayOf(j));
      else ivs = shiftIvs(db.shifts, code);
      const list = (blocksByDept[d] = blocksByDept[d] || []);
      for (const iv of ivs) list.push([j * 1440 + iv[0], j * 1440 + iv[1]]);
    }
    for (const d in blocksByDept) {
      const s = slot(d);
      for (const iv of mergeIv(blocksByDept[d])) {
        for (let j = Math.floor(iv[0] / 1440); j <= Math.floor((iv[1] - 1) / 1440); j++) {
          if (j < a || j > b) continue;
          const mins = Math.min(iv[1], (j + 1) * 1440) - Math.max(iv[0], j * 1440);
          s.actual += mins;
          s.weighted += hm[j] ? mins * factor : mins;
        }
      }
      s.weighted = Math.round(s.weighted * 100) / 100;
    }
    return split;
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


  /* ---------- پیشنهاد خودکار برنامه ---------- */
  /**
   * خانه‌های خالی را با شیفت پر می‌کند؛ هیچ خانهٔ پرشده‌ای را تغییر نمی‌دهد.
   * o: { people: [id], a, b, need: {کد شیفت: تعداد در هر روز}, maxConsec, capMin,
   *      prefs: {pid: {shift: {کد: -2..2}, ot: 'none'|'normal'|'more'}},
   *      wishes: [{pid, j, kind: 'want'|'off'|'avoid', code}] }
   * wantها اول و در صورت امکان اعمال می‌شوند؛ offها قید سخت‌اند؛ avoid و ترجیح شیفت و اضافه‌کار امتیازی (نرم) هستند.
   * خروجی: { changes, unfilled: [{j, code, missing}], summary: [{pid, load, target}], wishReport: [{pid, j, kind, code, ok}] }
   * قیدها: حداقل فاصلهٔ بین شیفت‌ها، حداکثر روز کاریِ پشت‌سرهم، سقف اضافه‌کار؛ تراز بار با کمترین کارکرد نسبت به موظفی.
   */
  /** خانه‌هایی که «پاک‌کردن ماه» باید پاک کند: خانه‌های پرِ بازه، یا فقط
   *  خانه‌هایی که بخششان برابرِ dept است (dept خالی یعنی همهٔ بخش‌ها) */
  function clearMonthCells(db, peopleIds, a, b, dept) {
    const out = [];
    const people = new Map((db.people || []).map((p) => [p.id, p]));
    for (const pid of (peopleIds || [])) {
      const mine = (db.assign && db.assign[pid]) || {};
      const p = people.get(pid);
      for (let j = a; j <= b; j++) {
        if (!mine[j]) continue;
        if (dept && cellDept(db, p, j) !== dept) continue;
        out.push([pid, j]);
      }
    }
    return out;
  }

  function suggestSchedule(db, o) {
    const S = db.settings, shifts = db.shifts;
    const hm = holidayMap(S, db.holidays, o.a, o.b);
    const restMin = (S.minRestH || 0) * 60;
    const maxConsec = o.maxConsec > 0 ? o.maxConsec : 6;
    const days = o.b - o.a + 1;
    let holN = 0; for (let j = o.a; j <= o.b; j++) if (hm[j]) holN++;
    const target = (days - holN) * S.dutyMin;
    const prefs = o.prefs || {};
    const STEP = 180, MORE_EXTRA = 480;
    const capFor = (pid) => {
      const ot = (prefs[pid] || {}).ot;
      if (ot === 'none') return 0;
      if (o.capMin == null) return ot === 'more' ? MORE_EXTRA : null;
      return o.capMin + (ot === 'more' ? MORE_EXTRA : 0);
    };
    const wishes = (o.wishes || []).filter((w) => w.j >= o.a && w.j <= o.b);
    const offSet = new Set(), avoid = new Map();
    for (const w of wishes) {
      if (w.kind === 'off') offSet.add(w.pid + '|' + w.j);
      else if (w.kind === 'avoid') avoid.set(w.pid + '|' + w.j + '|' + (w.code || '*'), 1);
    }
    const people = (o.people || []).map((id) => db.people.find((p) => p.id === id)).filter(Boolean);
    const work = {}, load = {}, cnt = {}, workDept = {};
    // بخشِ خانه در حین پیشنهاد: خانه‌های ساخته‌شده بخشِ اجرای مشخص را می‌گیرند،
    // وگرنه بخشِ خانه از دادهٔ موجود خوانده می‌شود (cellDept)
    const deptOf = (p, j) => (workDept[p.id] && workDept[p.id][j]) || cellDept(db, p, j);
    const isWork = (c) => !!c && !SPECIAL[c];
    const iv = {};
    const info = (code) => {
      if (!iv[code]) { const x = shiftIvs(shifts, code); iv[code] = x.length ? { s: x[0][0], e: x[x.length - 1][1], m: ivsMinutes(x) } : null; }
      return iv[code];
    };
    const minutesOn = (p, j, code) => {
      const x = info(code); if (!x) return 0;
      const f = hm[j] && S.factors ? (S.factors[p.contract] || 1) : 1;
      return x.m * f;
    };
    for (const p of people) {
      work[p.id] = Object.assign({}, (db.assign && db.assign[p.id]) || {});
      load[p.id] = 0; cnt[p.id] = {};
      for (let j = o.a; j <= o.b; j++) {
        const c = work[p.id][j];
        if (isWork(c)) { load[p.id] += minutesOn(p, j, c); cnt[p.id][c] = (cnt[p.id][c] || 0) + 1; }
        else if (c && SPECIAL[c].credit && !hm[j]) load[p.id] += S.dutyMin;
      }
    }
    const fits = (pid, j, code) => {
      const mine = work[pid], x = info(code);
      if (!x) return false;
      const s0 = j * 1440 + x.s, e0 = j * 1440 + x.e;
      for (let k = j - 3; k <= j + 3; k++) {
        if (k === j || !isWork(mine[k])) continue;
        const y = info(mine[k]); if (!y) continue;
        const ns = k * 1440 + y.s, ne = k * 1440 + y.e;
        const gap = k < j ? s0 - ne : ns - e0;
        if (gap < restMin) return false;
      }
      let run = 1;
      for (let k = j - 1; isWork(mine[k]); k--) run++;
      for (let k = j + 1; isWork(mine[k]); k++) run++;
      return run <= maxConsec;
    };
    const codes = Object.keys(o.need || {}).filter((c) => o.need[c] > 0 && info(c)).sort((x, y) => info(y).m - info(x).m);
    const changes = [], unfilled = [];
    const place = (p, j, code) => {
      work[p.id][j] = code; load[p.id] += minutesOn(p, j, code);
      cnt[p.id][code] = (cnt[p.id][code] || 0) + 1;
      // اگر برنامه برای یک بخش مشخص محاسبه می‌شود، خانه‌های ساخته‌شده همان بخش را می‌گیرند
      if (o.dept) (workDept[p.id] = workDept[p.id] || {})[j] = o.dept;
      changes.push(o.dept ? { pid: p.id, j, code, deptId: o.dept } : { pid: p.id, j, code });
    };
    // درخواست‌های «این شیفت را می‌خواهم» اول و تا جای ممکن اعمال می‌شوند
    for (const w of wishes.filter((x) => x.kind === 'want').sort((x, y) => x.j - y.j)) {
      const p = people.find((q) => q.id === w.pid);
      if (p && info(w.code) && !work[p.id][w.j] && !offSet.has(p.id + '|' + w.j) && fits(p.id, w.j, w.code)) place(p, w.j, w.code);
    }
    for (let j = o.a; j <= o.b; j++) {
      const cover = {};
      // در اجرای یک بخش، فقط شیفت‌های همان بخش پوشش حساب می‌شوند؛ شیفتِ بخشِ
      // دیگر در همان روز، نیازِ این بخش را برآورده نمی‌کند (بارِ موظفی اما سطحِ نفر می‌ماند)
      for (const p of people) { const c = work[p.id][j]; if (isWork(c) && (!o.dept || deptOf(p, j) === o.dept)) cover[c] = (cover[c] || 0) + 1; }
      for (const code of codes) {
        let missing = o.need[code] - (cover[code] || 0);
        while (missing > 0) {
          let best = null, bs = null;
          for (let i = 0; i < people.length; i++) {
            const p = people[i];
            if (work[p.id][j] || offSet.has(p.id + '|' + j)) continue;
            const m = minutesOn(p, j, code);
            const cp = capFor(p.id);
            if (cp != null && load[p.id] + m > target + cp) continue;
            if (!fits(p.id, j, code)) continue;
            const pf = prefs[p.id] || {};
            let bias = -((pf.shift || {})[code] || 0) * STEP;
            if (pf.ot === 'more') bias -= MORE_EXTRA;
            if (avoid.has(p.id + '|' + j + '|' + code) || avoid.has(p.id + '|' + j + '|*')) bias += 100000;
            const sc = [load[p.id] + bias, cnt[p.id][code] || 0, i];
            if (!bs || sc[0] < bs[0] || (sc[0] === bs[0] && (sc[1] < bs[1] || (sc[1] === bs[1] && sc[2] < bs[2])))) { best = p; bs = sc; }
          }
          if (!best) { unfilled.push({ j, code, missing }); break; }
          place(best, j, code);
          missing--;
        }
      }
    }
    const wishReport = wishes.map((w) => {
      const c = work[w.pid] ? work[w.pid][w.j] : undefined;
      const ok = w.kind === 'want' ? c === w.code : w.kind === 'off' ? !isWork(c) : !(c && (w.code ? c === w.code : isWork(c)));
      return { pid: w.pid, j: w.j, kind: w.kind, code: w.code || null, ok };
    });
    return { changes, unfilled, summary: people.map((p) => ({ pid: p.id, load: Math.round(load[p.id]), target })), wishReport };
  }

  /** پر کردن خودکار شیفت برای پرسنل اداری در یک بازه زمانی */
  function autoAssignOffice(db, o) {
    // نمایِ یک بخش (#21): فقط پرسنل اداریِ همان بخش (اصلی یا فرعی) و تگِ بخشِ نما روی خانه‌های جدید —
    // هم‌سو با پیشنهاد خودکار؛ بدون dept رفتار پیشین حفظ می‌شود (همهٔ پرسنل، بخشِ اصلی)
    let people = (db.people || []).filter((p) => p.workType === 'office');
    if (o.dept) people = people.filter((p) => personDepts(p).includes(o.dept));
    const S = db.settings;
    const hm = holidayMap(S, db.holidays, o.a, o.b);
    const assign = db.assign || {};
    const officeShifts = (db.shifts || []).filter((s) => s.isOffice);
    // جایگزین M فقط وقتی معتبر است که M واقعاً در فهرست شیفت‌ها باشد؛
    // وگرنه هیچ کد اداری معتبری وجود ندارد و تغییری صادر نمی‌شود تا
    // سرور کل بچ را با ۴۰۰ رد نکند (نیت‌پیک CodeAnt روی PR #45).
    const shiftCodes = new Set((db.shifts || []).map((s) => s.code));
    const defaultOffCode = officeShifts.length ? officeShifts[0].code : (shiftCodes.has('M') ? 'M' : null);
    const changes = [];

    for (const p of people) {
      const offPat = findOfficePattern(db, p);
      if (!offPat) continue;
      const mine = assign[p.id] || {};
      for (let j = o.a; j <= o.b; j++) {
        // اگر قبلاً شیفت یا وضعیتی داشته باشد دست نمی‌زنیم
        if (mine[j]) continue;
        // اگر تعطیل رسمی یا جمعه باشد شیفت اداری ندارد
        if (hm[j]) continue;
        const wd = weekdayOf(j);
        const dayCfg = officePatternDay(offPat, wd);
        if (dayCfg && dayCfg.active) {
          // انتخاب کد شیفت اختصاصی الگو یا کد پیش‌فرض اداری
          let code = defaultOffCode;
          if (offPat.shiftCode) code = offPat.shiftCode;
          else {
            const match = officeShifts.find((s) => s.officePattern && s.officePattern.id === offPat.id);
            if (match) code = match.code;
          }
          // کد نامعتبر/تهی هرگز صادر نمی‌شود؛ وگرنه سرور کل بچ را رد می‌کند
          if (code) {
            const ch = { pid: p.id, j, code };
            if (o.dept) ch.deptId = o.dept;
            changes.push(ch);
          }
        }
      }
    }
    return changes;
  }

  const Core = {
    div, mod, g2d, d2g, j2d, d2j, isLeap, monthLen, weekdayOf, todayJdn,
    MONTHS, WD_SHORT, WD_FULL, FA, fa, toLatin, pad2, fmtHM, fmtHMlatin, fmtDate, fmtDateLatin, parseDate, toMin,
    SPECIAL, CONTRACTS, WORK_TYPES, defaultOfficePatterns, defaultShifts, defaultHolidays, defaultSettings,
    mergeIv, isOfficeShift, officePatternDay, officePatternIvs, findOfficePattern, autoAssignOffice,
    shiftIvs, ivsMinutes, shiftMinutes, ivText, holidayInfo, holidayMap, computeRange, computeDeptSplit, personDepts, cellDept, restIssues, validateShift, suggestSchedule, clearMonthCells,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
