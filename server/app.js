'use strict';
/* سرور HTTP شیفت‌یار: API + فایل‌های ایستا. بدون وابستگی بیرونی. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Core = require('../web/core.js');
const DBM = require('./db.js');
const Auth = require('./auth.js');

const WEB_DIR = path.join(__dirname, '..', 'web');
const MAX_BODY = 2 * 1024 * 1024;
const SESSION_MS = 7 * 24 * 3600 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DAY_MIN = 2400000, DAY_MAX = 2600000;
const ROLES = ['admin', 'manager', 'staff'];

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const bad = (m) => new HttpError(400, m);

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/fonts.css': ['fonts.css', 'text/css; charset=utf-8'],
  '/core.js': ['core.js', 'text/javascript; charset=utf-8'],
  '/ui.js': ['ui.js', 'text/javascript; charset=utf-8'],
  '/export.js': ['export.js', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};
const FONT_RE = /^\/fonts\/[A-Za-z0-9._-]+\.woff2$/;

function createApp(opts = {}) {
  const cfg = Object.assign({
    dbPath: process.env.DB_PATH || path.join(process.cwd(), 'data', 'shiftyar.db'),
    cookieSecure: process.env.COOKIE_SECURE === '1',
    trustProxy: process.env.TRUST_PROXY === '1',
    adminCode: process.env.ADMIN_CODE || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    log: (m) => console.log(m),
  }, opts);
  const db = DBM.open(cfg.dbPath);
  const loginByCode = new Auth.Limiter(5, 15 * 60 * 1000);
  const loginByIp = new Auth.Limiter(40, 15 * 60 * 1000);
  const sweeper = setInterval(() => {
    loginByCode.sweep(); loginByIp.sweep();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  }, 10 * 60 * 1000);
  sweeper.unref();

  /* ---------- کمک‌ها ---------- */
  const now = () => Date.now();
  const q = (sql) => db.prepare(sql);
  const placeholders = (n) => Array(n).fill('?').join(',');
  const persName = (p) => `${p.first || ''} ${p.last || ''}`.trim() || 'بدون نام';
  /** بخش‌های یک نفر (اصلی + فرعی)؛ هم ردیف دیتابیس (dept_id/extra_depts) و هم شیء پیکربندی (deptId/extraDeptIds) را می‌فهمد */
  const parseExtraDepts = (v) => {
    if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x);
    if (typeof v === 'string') { try { const a = JSON.parse(v); return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : []; } catch (_) { return []; } }
    return [];
  };
  const deptsOf = (x) => {
    if (!x) return [];
    const out = [];
    const main = x.dept_id !== undefined ? (x.dept_id || '') : (x.deptId || '');
    if (main) out.push(main);
    for (const d of parseExtraDepts(x.extra_depts !== undefined ? x.extra_depts : x.extraDeptIds)) if (!out.includes(d)) out.push(d);
    return out;
  };
  const codeLabel = (c) => (!c ? 'خالی' : Core.SPECIAL[c] ? Core.SPECIAL[c].name : c);
  const toLatin = (s) => Core.toLatin(String(s == null ? '' : s));

  function str(v, max, label, required) {
    if (v == null) v = '';
    if (typeof v !== 'string') throw bad(`${label} نامعتبر است.`);
    v = v.trim();
    if (v.length > max) throw bad(`${label} بیش از ${max} نویسه است.`);
    if (required && !v) throw bad(`${label} را بنویسید.`);
    return v;
  }
  const intIn = (v, lo, hi, label) => {
    if (!Number.isInteger(v) || v < lo || v > hi) throw bad(`${label} نامعتبر است.`);
    return v;
  };
  function writeLog(user, text) {
    q('INSERT INTO log(ts, user_id, who, text) VALUES(?, ?, ?, ?)').run(now(), user ? user.id : null, user ? (user.display || user.code) : 'سیستم', text);
  }

  /* ---------- کاربران و نشست ---------- */
  function userRow(id) { return q('SELECT * FROM users WHERE id = ?').get(id); }
  function loadUser(row) {
    const deptIds = q('SELECT dept_id FROM user_depts WHERE user_id = ?').all(row.id).map((r) => r.dept_id);
    return {
      id: row.id, code: row.code, role: row.role, personId: row.person_id || null, display: row.display,
      active: !!row.active, mustChange: !!row.must_change, deptIds,
    };
  }
  /** شناسهٔ پرسنلی که کاربر می‌تواند ببیند / ویرایش کند؛ null یعنی همه.
   * مدیر بخش، فردی را می‌بیند که بخش اصلی یا یکی از بخش‌های فرعی‌اش در بخش‌های مدیر باشد.
   * توجه: write اینجا فقط عضویت در سطح نفر است؛ writeAssign برای هر خانه، بخشِ خانه را هم جداگانه بررسی می‌کند. */
  function scope(user) {
    if (user.role === 'admin') return { read: null, write: null };
    const mine = new Set();
    if (user.role === 'manager' && user.deptIds.length) {
      const wanted = new Set(user.deptIds);
      for (const r of q('SELECT id, dept_id, extra_depts FROM people').all()) {
        if (deptsOf(r).some((d) => wanted.has(d))) mine.add(r.id);
      }
    }
    const write = user.role === 'manager' ? new Set(mine) : new Set();
    if (user.personId) mine.add(user.personId);
    return { read: mine, write };
  }
  function parseCookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }
  function sessionUser(req) {
    const tok = parseCookies(req).sid;
    if (!tok || tok.length > 100) return null;
    const h = Auth.hashToken(tok);
    const s = q('SELECT * FROM sessions WHERE token_hash = ?').get(h);
    if (!s || s.expires_at < now()) return null;
    const row = userRow(s.user_id);
    if (!row || !row.active) return null;
    if (s.expires_at - now() < SESSION_MS - 24 * 3600 * 1000) q('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(now() + SESSION_MS, h);
    return Object.assign(loadUser(row), { _tokenHash: h });
  }
  const cookieHeader = (value, maxAge) =>
    `sid=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${cfg.cookieSecure ? '; Secure' : ''}`;
  function clientIp(req) {
    if (cfg.trustProxy) {
      const x = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (x) return x;
    }
    return req.socket.remoteAddress || '?';
  }
  function validatePassword(pw, code) {
    if (typeof pw !== 'string' || pw.length < 8) throw bad('گذرواژه باید حداقل ۸ نویسه باشد.');
    if (pw.length > 128) throw bad('گذرواژه بیش از حد طولانی است.');
    if (code && pw.toLowerCase() === String(code).toLowerCase()) throw bad('گذرواژه نباید با کد کاربری یکی باشد.');
  }
  function adminCount() { return q("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND active = 1").get().c; }

  /** اولین اجرا: ساخت ادمین اولیه */
  async function bootstrap() {
    if (q('SELECT COUNT(*) c FROM users').get().c > 0) return null;
    const pw = cfg.adminPassword || Auth.tempPassword(14);
    validatePassword(pw, cfg.adminCode);
    const hash = await Auth.hashPassword(pw);
    q('INSERT INTO users(code, pass_hash, role, display, active, must_change, created_at) VALUES(?, ?, ?, ?, 1, 1, ?)')
      .run(cfg.adminCode, hash, 'admin', 'مدیر سیستم', now());
    writeLog(null, `ساخت حساب مدیر اولیه (${cfg.adminCode})`);
    if (!cfg.adminPassword) {
      cfg.log('==============================================================');
      cfg.log(` حساب مدیر ساخته شد.  کد: ${cfg.adminCode}   گذرواژهٔ موقت: ${pw}`);
      cfg.log(' این گذرواژه فقط یک بار نمایش داده می‌شود و در اولین ورود باید عوض شود.');
      cfg.log('==============================================================');
    }
    return pw;
  }

  /* ---------- پیکربندی ---------- */
  function loadConfig(user) {
    const sc = scope(user);
    let depts = q('SELECT id, name, color FROM depts ORDER BY pos, name').all().map((d) => ({ id: d.id, name: d.name, color: d.color }));
    let people = q('SELECT id, first, last, code, phone, contract, dept_id, extra_depts, work_type, office_pattern_id FROM people ORDER BY pos, last, first').all()
      .map((p) => ({ id: p.id, first: p.first, last: p.last, code: p.code, phone: p.phone, contract: p.contract, deptId: p.dept_id || '', extraDeptIds: parseExtraDepts(p.extra_depts), workType: p.work_type || 'rotating', officePatternId: p.office_pattern_id || '' }));
    if (user.role !== 'admin') {
      people = people.filter((p) => sc.read.has(p.id));
      const keep = new Set();
      for (const p of people) for (const d of deptsOf(p)) keep.add(d);
      for (const id of user.deptIds) keep.add(id);
      depts = depts.filter((d) => keep.has(d.id));
    }
    return {
      settings: DBM.getMeta(db, 'settings', Core.defaultSettings()),
      depts, people,
      shifts: q('SELECT body FROM shifts ORDER BY pos, code').all().map((r) => JSON.parse(r.body)),
      holidays: q('SELECT id, jy, jm, jd, name FROM holidays ORDER BY jm, jd').all().map((h) => ({ id: h.id, jy: h.jy, jm: h.jm, jd: h.jd, name: h.name })),
      sample: false,
    };
  }

  function validateCfg(c) {
    if (!c || typeof c !== 'object') throw bad('پیکربندی نامعتبر است.');
    const out = {};
    // بخش‌ها
    if (!Array.isArray(c.depts) || c.depts.length > 200) throw bad('فهرست بخش‌ها نامعتبر است.');
    const deptIds = new Set();
    out.depts = c.depts.map((d) => {
      if (!d || !ID_RE.test(d.id || '') || deptIds.has(d.id)) throw bad('شناسهٔ بخش نامعتبر یا تکراری است.');
      deptIds.add(d.id);
      if (!COLOR_RE.test(d.color || '')) throw bad('رنگ بخش نامعتبر است.');
      return { id: d.id, name: str(d.name, 60, 'نام بخش', true), color: d.color.toLowerCase() };
    });
    // پرسنل
    if (!Array.isArray(c.people) || c.people.length > 5000) throw bad('فهرست پرسنل نامعتبر است.');
    const pids = new Set(), codes = new Set();
    out.people = c.people.map((p) => {
      if (!p || !ID_RE.test(p.id || '') || pids.has(p.id)) throw bad('شناسهٔ پرسنل نامعتبر یا تکراری است.');
      pids.add(p.id);
      const first = str(p.first, 60, 'نام'), last = str(p.last, 60, 'نام خانوادگی');
      if (!first && !last) throw bad('نام پرسنل را بنویسید.');
      const code = toLatin(str(p.code, 30, 'کد پرسنلی'));
      if (code && !/^[A-Za-z0-9_-]+$/.test(code)) throw bad('کد پرسنلی فقط می‌تواند حرف و عدد لاتین باشد.');
      if (code) {
        if (codes.has(code.toLowerCase())) throw bad(`کد پرسنلی ${code} تکراری است.`);
        codes.add(code.toLowerCase());
      }
      if (!Core.CONTRACTS[p.contract]) throw bad('نوع قرارداد نامعتبر است.');
      const deptId = p.deptId || '';
      if (deptId && !deptIds.has(deptId)) throw bad('بخش انتخاب‌شده وجود ندارد.');
      // بخش‌های فرعی: فقط بخش‌های موجود، بدون تکرار و بدون تکرارِ بخش اصلی
      if (p.extraDeptIds !== undefined && !Array.isArray(p.extraDeptIds)) throw bad('فهرست بخش‌های فرعی نامعتبر است.');
      const extraDeptIds = [];
      for (const d of (p.extraDeptIds || [])) {
        if (typeof d !== 'string' || !deptIds.has(d)) throw bad('بخش فرعی انتخاب‌شده وجود ندارد.');
        if (d === deptId || extraDeptIds.includes(d)) throw bad('بخش فرعی تکراری یا برابر با بخش اصلی است.');
        extraDeptIds.push(d);
      }
      const workType = p.workType === 'office' ? 'office' : 'rotating';
      const officePatternId = str(p.officePatternId, 40, 'الگوی اداری') || '';
      return { id: p.id, first, last, code, phone: toLatin(str(p.phone, 30, 'شمارهٔ تماس')), contract: p.contract, deptId, extraDeptIds, workType, officePatternId };
    });
    // شیفت‌ها
    if (!Array.isArray(c.shifts) || !c.shifts.length || c.shifts.length > 60) throw bad('فهرست شیفت‌ها نامعتبر است.');
    const scodes = new Set();
    for (const s of c.shifts) {
      const code = String((s && s.code) || '').trim();
      if (scodes.has(code.toLowerCase())) throw bad(`کد شیفت ${code} تکراری است.`);
      scodes.add(code.toLowerCase());
    }
    out.shifts = c.shifts.map((s) => {
      const draft = Object.assign({}, s, { code: String(s.code || '').trim(), name: String(s.name || '').trim() });
      const err = Core.validateShift(draft, c.shifts.filter((x) => x !== s), false);
      if (err) throw bad(`شیفت ${draft.code}: ${err}`);
      if (draft.name.length > 60) throw bad('نام شیفت بیش از حد طولانی است.');
      if (draft.kind === 'combo') {
        if (draft.refs.length > 10) throw bad('ترکیب شیفت بیش از حد بزرگ است.');
        return {
          code: draft.code, name: draft.name, kind: 'combo',
          refs: draft.refs.map((r) => {
            const t = c.shifts.find((x) => x.code === r.code);
            if (!t) throw bad(`شیفت ${draft.code}: شیفت ${r.code} که در ترکیب آمده وجود ندارد.`);
            if (t.kind === 'combo' || r.code === draft.code) throw bad(`شیفت ${draft.code}: ترکیب فقط از شیفت‌های ساده ممکن است.`);
            if (r.o !== 0 && r.o !== 1) throw bad('روز نسبی نامعتبر است.');
            return { code: r.code, o: r.o };
          }),
        };
      }
      if (draft.segs.length > 6) throw bad('تعداد بازه‌ها بیش از حد است.');
      const res = {
        code: draft.code, name: draft.name, kind: 'simple',
        segs: draft.segs.map((g) => {
          if (g.o !== 0 && g.o !== 1) throw bad('روز نسبی نامعتبر است.');
          const pad = (t) => toLatin(t).padStart(5, '0');
          return { o: g.o, s: pad(g.s), e: pad(g.e) };
        }),
      };
      if (draft.isOffice) res.isOffice = true;
      if (draft.officePattern) res.officePattern = draft.officePattern;
      return res;
    });
    // تعطیلات
    if (!Array.isArray(c.holidays) || c.holidays.length > 500) throw bad('فهرست تعطیلات نامعتبر است.');
    const hids = new Set();
    out.holidays = c.holidays.map((h) => {
      if (!h || !ID_RE.test(h.id || '') || hids.has(h.id)) throw bad('شناسهٔ تعطیلی نامعتبر یا تکراری است.');
      hids.add(h.id);
      const jy = h.jy == null ? null : intIn(h.jy, 1300, 1500, 'سال تعطیلی');
      return { id: h.id, jy, jm: intIn(h.jm, 1, 12, 'ماه تعطیلی'), jd: intIn(h.jd, 1, 31, 'روز تعطیلی'), name: str(h.name, 60, 'نام مناسبت', true) };
    });
    // تنظیمات
    const S = c.settings || {};
    const num = (v, lo, hi, label) => { if (typeof v !== 'number' || !isFinite(v) || v < lo || v > hi) throw bad(`${label} نامعتبر است.`); return v; };
    out.settings = {
      fridayHoliday: !!S.fridayHoliday,
      dutyMin: intIn(S.dutyMin, 60, 1440, 'موظفی روزانه'),
      factors: {
        company: num(S.factors && S.factors.company, 1, 3, 'ضریب شرکتی'),
        t4: num(S.factors && S.factors.t4, 1, 3, 'ضریب تبصره ۴'),
        official: num(S.factors && S.factors.official, 1, 3, 'ضریب رسمی'),
      },
      minRestH: num(S.minRestH, 0, 48, 'حداقل استراحت'),
      otCapH: num(S.otCapH, 0, 500, 'سقف اضافه‌کار'),
      officePatterns: Array.isArray(S.officePatterns) ? S.officePatterns : Core.defaultOfficePatterns(),
    };
    return out;
  }

  function syncConfig(user, c) {
    return DBM.tx(db, () => {
      const stats = {};
      // شیفت‌های حذف‌شده نباید در برنامه‌ها استفاده شده باشند
      const keep = new Set(c.shifts.map((s) => s.code));
      for (const r of q('SELECT DISTINCT code FROM assign').all()) {
        if (!Core.SPECIAL[r.code] && !keep.has(r.code)) throw new HttpError(409, `شیفت ${r.code} در برنامه‌ها استفاده شده و حذف نمی‌شود.`);
      }
      // بخش‌ها
      const dIns = q('INSERT INTO depts(id, name, color, pos) VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, pos = excluded.pos');
      c.depts.forEach((d, i) => dIns.run(d.id, d.name, d.color, i));
      // پرسنل (کد پرسنلی تکراری هنگام جابه‌جایی ممکن است موقتاً برخورد کند؛ ابتدا خالی می‌شود)
      const existing = new Map(q('SELECT id, code FROM people').all().map((r) => [r.id, r.code]));
      const newIds = new Set(c.people.map((p) => p.id));
      for (const [id] of existing) if (!newIds.has(id)) q('DELETE FROM people WHERE id = ?').run(id);
      q("UPDATE people SET code = ''").run();
      const pIns = q('INSERT INTO people(id, first, last, code, phone, contract, dept_id, extra_depts, work_type, office_pattern_id, pos) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET first = excluded.first, last = excluded.last, code = excluded.code, phone = excluded.phone, contract = excluded.contract, dept_id = excluded.dept_id, extra_depts = excluded.extra_depts, work_type = excluded.work_type, office_pattern_id = excluded.office_pattern_id, pos = excluded.pos');
      c.people.forEach((p, i) => pIns.run(p.id, p.first, p.last, p.code, p.phone, p.contract, p.deptId || null, JSON.stringify(p.extraDeptIds || []), p.workType || 'rotating', p.officePatternId || null, i));
      const keepD = new Set(c.depts.map((d) => d.id));
      for (const r of q('SELECT id FROM depts').all()) if (!keepD.has(r.id)) q('DELETE FROM depts WHERE id = ?').run(r.id);
      // عضویتِ بخش که از نفر گرفته شده (نه حذفِ کلِ بخش — آن با FK=SET NULL
      // انجام شد): خانه‌های صریحِ آن بخش به بخش اصلی برمی‌گردند (NULL)
      for (const p of c.people) {
        const allowed = new Set([p.deptId, ...(p.extraDeptIds || [])].filter(Boolean));
        for (const r of q('SELECT DISTINCT dept_id FROM assign WHERE person_id = ? AND dept_id IS NOT NULL').all(p.id)) {
          if (!allowed.has(r.dept_id)) q('UPDATE assign SET dept_id = NULL WHERE person_id = ? AND dept_id = ?').run(p.id, r.dept_id);
        }
      }
      // شیفت‌ها و تعطیلات
      q('DELETE FROM shifts').run();
      const sIns = q('INSERT INTO shifts(code, body, pos) VALUES(?, ?, ?)');
      c.shifts.forEach((s, i) => sIns.run(s.code, JSON.stringify(s), i));
      q('DELETE FROM holidays').run();
      const hIns = q('INSERT INTO holidays(id, jy, jm, jd, name) VALUES(?, ?, ?, ?, ?)');
      c.holidays.forEach((h) => hIns.run(h.id, h.jy, h.jm, h.jd, h.name));
      DBM.setMeta(db, 'settings', c.settings);
      // حساب‌هایی که کدشان با کد پرسنلی هم‌نام بود دست نمی‌خورد؛ فقط نام نمایشی به‌روز می‌شود
      for (const p of c.people) q("UPDATE users SET display = ? WHERE person_id = ? AND role <> 'admin'").run(persName(p), p.id);
      const version = DBM.bumpMeta(db, 'cfg_version');
      stats.people = c.people.length; stats.depts = c.depts.length;
      writeLog(user, `ذخیرهٔ پیکربندی (${stats.people} پرسنل، ${stats.depts} بخش، ${c.shifts.length} شیفت، ${c.holidays.length} تعطیلی)`);
      return version;
    });
  }

  /* ---------- برنامه‌ها ---------- */
  /** بخشِ مؤثر یک خانه: بخشِ صریحِ خانه، وگرنه بخش اصلی نفر (خانه‌های قدیمی) */
  const effectiveCellDept = (person, row) => (row && row.dept_id) || (person && (person.dept_id || '')) || '';
  function readAssign(user, a, b) {
    const sc = scope(user);
    const out = {}, outDept = {};
    const people = new Map(q('SELECT id, dept_id, extra_depts FROM people').all().map((r) => [r.id, r]));
    for (const r of q('SELECT person_id, day, code, dept_id FROM assign WHERE day BETWEEN ? AND ?').all(a, b)) {
      if (sc.read && !sc.read.has(r.person_id)) continue;
      // مدیر بخش، فقط خانه‌های بخش‌های خودش را می‌بیند (نه خانه‌های بخش دیگرِ همان فرد)
      if (user.role === 'manager' && !user.deptIds.includes(effectiveCellDept(people.get(r.person_id), r))) continue;
      (out[r.person_id] = out[r.person_id] || {})[r.day] = r.code;
      if (r.dept_id) (outDept[r.person_id] = outDept[r.person_id] || {})[r.day] = r.dept_id;
    }
    return { assign: out, assignDept: outDept };
  }
  function writeAssign(user, changes) {
    if (!Array.isArray(changes) || !changes.length) throw bad('تغییری ارسال نشده است.');
    if (changes.length > 3000) throw bad('تعداد تغییرها بیش از حد است.');
    const sc = scope(user);
    const codes = new Set(q('SELECT code FROM shifts').all().map((r) => r.code));
    const deptSet = new Set(q('SELECT id FROM depts').all().map((r) => r.id));
    const people = new Map();
    for (const ch of changes) {
      if (!ch || typeof ch.pid !== 'string' || !ID_RE.test(ch.pid)) throw bad('شناسهٔ پرسنل نامعتبر است.');
      intIn(ch.j, DAY_MIN, DAY_MAX, 'تاریخ');
      if (ch.code !== null && (typeof ch.code !== 'string' || !(codes.has(ch.code) || Core.SPECIAL[ch.code]))) throw bad('کد شیفت نامعتبر است.');
      if (!people.has(ch.pid)) {
        const p = q('SELECT id, first, last, dept_id, extra_depts FROM people WHERE id = ?').get(ch.pid);
        if (!p) throw bad('پرسنل پیدا نشد.');
        people.set(ch.pid, p);
      }
      const person = people.get(ch.pid);
      const personDepts = deptsOf(person);
      const old = q('SELECT code, dept_id FROM assign WHERE person_id = ? AND day = ?').get(ch.pid, ch.j);
      const oldDept = effectiveCellDept(person, old);
      // بخشِ خانه پس از تغییر: deptId صریح (null یعنی بخش اصلی)، وگرنه بخشِ فعلی خانه
      const newDept = ch.code === null ? oldDept : (ch.deptId !== undefined ? (ch.deptId || person.dept_id || '') : oldDept);
      if (ch.deptId !== undefined && ch.deptId !== null && ch.deptId !== '') {
        if (!deptSet.has(ch.deptId)) throw bad('بخش انتخاب‌شده وجود ندارد.');
        if (!personDepts.includes(ch.deptId)) throw bad('بخش انتخاب‌شده برای این فرد نیست.');
      }
      if (sc.write) {
        if (!sc.write.has(ch.pid)) throw new HttpError(403, 'اجازهٔ تغییر برنامهٔ این فرد را ندارید.');
        // سطح خانه: مدیر فقط خانه‌های بخش‌های خودش را می‌نویسد؛ جابه‌جاییِ بخشِ یک خانه
        // از بخشی که مدیرش نیست هم ممنوع است (هر دو سر باید در بخش‌های مدیر باشد)
        if (!user.deptIds.includes(newDept) || (ch.deptId !== undefined && ch.code !== null && oldDept !== newDept && old && !user.deptIds.includes(oldDept))) {
          throw new HttpError(403, 'اجازهٔ تغییر برنامهٔ این بخش را ندارید.');
        }
      }
      // ذخیرهٔ تنک: بخش اصلی به‌صورت NULL ذخیره می‌شود تا خانه‌های قدیمی و
      // خانه‌های بخش اصلی یکسان باشند (NULL یعنی «بخش اصلی نفر»)
      const mainDept = person.dept_id || '';
      ch._newDeptId = (ch.code === null || !newDept || newDept === mainDept) ? null : newDept;
      ch._oldDept = oldDept;
    }
    return DBM.tx(db, () => {
      const get = q('SELECT code, dept_id FROM assign WHERE person_id = ? AND day = ?');
      const up = q('INSERT INTO assign(person_id, day, code, dept_id) VALUES(?, ?, ?, ?) ON CONFLICT(person_id, day) DO UPDATE SET code = excluded.code, dept_id = excluded.dept_id');
      const del = q('DELETE FROM assign WHERE person_id = ? AND day = ?');
      const done = [];
      for (const ch of changes) {
        const old = get.get(ch.pid, ch.j);
        const oldCode = old ? old.code : null;
        const oldDeptId = old ? (old.dept_id || null) : null;
        if (oldCode === ch.code && oldDeptId === ch._newDeptId) continue;
        if (ch.code) up.run(ch.pid, ch.j, ch.code, ch._newDeptId); else del.run(ch.pid, ch.j);
        done.push({ pid: ch.pid, j: ch.j, old: oldCode, nw: ch.code });
      }
      if (!done.length) return { rev: DBM.getMeta(db, 'assign_rev', 1), applied: 0 };
      const rev = DBM.bumpMeta(db, 'assign_rev');
      if (done.length === 1) {
        const d = done[0];
        writeLog(user, `${persName(people.get(d.pid))} — ${Core.fmtDate(d.j)}: ${codeLabel(d.old)} ← ${codeLabel(d.nw)}`);
      } else {
        const names = new Set(done.map((d) => d.pid));
        writeLog(user, `${Core.fa(done.length)} خانه برای ${Core.fa(names.size)} نفر تغییر کرد`);
      }
      return { rev, applied: done.length };
    });
  }

  /* ---------- مدیریت کاربران ---------- */
  function publicUser(row) {
    const u = loadUser(row);
    const p = row.person_id ? q('SELECT first, last FROM people WHERE id = ?').get(row.person_id) : null;
    return Object.assign(u, { personName: p ? persName(p) : '', createdAt: row.created_at });
  }
  function checkUserFields(body, forCreate) {
    const out = {};
    if (forCreate || body.code !== undefined) {
      out.code = toLatin(str(body.code, 30, 'کد کاربری', true));
      if (!/^[A-Za-z0-9_.-]+$/.test(out.code)) throw bad('کد کاربری فقط می‌تواند حرف و عدد لاتین باشد.');
    }
    if (forCreate || body.role !== undefined) {
      if (!ROLES.includes(body.role)) throw bad('نقش نامعتبر است.');
      out.role = body.role;
    }
    if (body.display !== undefined) out.display = str(body.display, 60, 'نام نمایشی');
    if (body.deptIds !== undefined) {
      if (!Array.isArray(body.deptIds) || body.deptIds.length > 200) throw bad('فهرست بخش‌ها نامعتبر است.');
      for (const id of body.deptIds) if (typeof id !== 'string' || !q('SELECT 1 FROM depts WHERE id = ?').get(id)) throw bad('بخش انتخاب‌شده وجود ندارد.');
      out.deptIds = Array.from(new Set(body.deptIds));
    }
    if (body.personId !== undefined && body.personId !== null && body.personId !== '') {
      if (typeof body.personId !== 'string' || !q('SELECT 1 FROM people WHERE id = ?').get(body.personId)) throw bad('پرسنل انتخاب‌شده وجود ندارد.');
      out.personId = body.personId;
    } else if (body.personId !== undefined) out.personId = null;
    return out;
  }
  function setUserDepts(userId, deptIds) {
    q('DELETE FROM user_depts WHERE user_id = ?').run(userId);
    const ins = q('INSERT INTO user_depts(user_id, dept_id) VALUES(?, ?)');
    for (const d of deptIds) ins.run(userId, d);
  }

  /* ---------- مسیرها ---------- */
  const routes = [];
  const route = (method, pattern, access, handler) => routes.push({ method, re: new RegExp('^' + pattern + '$'), access, handler });

  route('GET', '/api/health', 'none', () => ({ ok: true }));

  route('POST', '/api/login', 'none', async (ctx) => {
    const code = str(ctx.body.code, 60, 'کد', true), pw = ctx.body.password;
    if (typeof pw !== 'string' || !pw || pw.length > 200) throw bad('گذرواژه را بنویسید.');
    const ip = clientIp(ctx.req), key = ip + '|' + code.toLowerCase();
    const wait = Math.max(loginByCode.retryAfter(key), loginByIp.retryAfter(ip));
    if (wait) throw new HttpError(429, `تلاش‌های ناموفق زیاد بود. ${Core.fa(Math.ceil(wait / 60))} دقیقهٔ دیگر دوباره امتحان کنید.`, { retryAfter: wait });
    const row = q('SELECT * FROM users WHERE code = ?').get(toLatin(code));
    let ok = false;
    if (row && row.active) ok = await Auth.verifyPassword(pw, row.pass_hash);
    else await Auth.dummyVerify(pw);
    if (!ok) {
      loginByCode.fail(key); loginByIp.fail(ip);
      throw new HttpError(401, 'کد یا گذرواژه درست نیست.');
    }
    loginByCode.reset(key);
    const tok = Auth.newToken();
    q('INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)').run(Auth.hashToken(tok), row.id, now(), now() + SESSION_MS);
    ctx.setCookie = cookieHeader(tok, SESSION_MS / 1000);
    return { user: loadUser(row) };
  });
  route('POST', '/api/logout', 'user', (ctx) => {
    q('DELETE FROM sessions WHERE token_hash = ?').run(ctx.user._tokenHash);
    ctx.setCookie = cookieHeader('', 0);
    return { ok: true };
  });
  /** وضعیت نشست بدون خطای 401؛ صفحه با آن می‌فهمد روی سرور شیفت‌یار است و ورود لازم است یا نه */
  route('GET', '/api/session', 'none', (ctx) => {
    const u = sessionUser(ctx.req);
    return { app: 'shiftyar', user: u ? publicUserBrief(u) : null };
  });
  route('GET', '/api/me', 'user', (ctx) => ({ user: publicUserBrief(ctx.user) }));
  const publicUserBrief = (u) => ({ id: u.id, code: u.code, role: u.role, personId: u.personId, display: u.display, mustChange: u.mustChange, deptIds: u.deptIds });

  route('POST', '/api/password', 'user', async (ctx) => {
    const row = userRow(ctx.user.id);
    if (!(await Auth.verifyPassword(String(ctx.body.current || ''), row.pass_hash))) throw new HttpError(403, 'گذرواژهٔ فعلی درست نیست.');
    validatePassword(ctx.body.next, row.code);
    if (ctx.body.next === ctx.body.current) throw bad('گذرواژهٔ جدید باید با قبلی فرق کند.');
    const hash = await Auth.hashPassword(ctx.body.next);
    DBM.tx(db, () => {
      q('UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?').run(hash, row.id);
      q('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(row.id, ctx.user._tokenHash);
      writeLog(ctx.user, 'تغییر گذرواژه');
    });
    return { ok: true };
  });

  route('GET', '/api/config', 'full', (ctx) => ({
    version: DBM.getMeta(db, 'cfg_version', 1), rev: DBM.getMeta(db, 'assign_rev', 1), cfg: loadConfig(ctx.user),
  }));
  route('PUT', '/api/config', 'admin', (ctx) => {
    const base = ctx.body.version;
    const cur = DBM.getMeta(db, 'cfg_version', 1);
    if (base !== cur) throw new HttpError(409, 'پیکربندی در این فاصله توسط شخص دیگری تغییر کرده است.', { version: cur });
    const clean = validateCfg(ctx.body.cfg);
    return { version: syncConfig(ctx.user, clean) };
  });

  route('GET', '/api/rev', 'full', (ctx) => ({ rev: DBM.getMeta(db, 'assign_rev', 1), version: DBM.getMeta(db, 'cfg_version', 1), reqRev: DBM.getMeta(db, 'req_rev', 0), todo: todoCount(ctx.user) }));
  route('GET', '/api/assign', 'full', (ctx) => {
    const a = parseInt(ctx.url.searchParams.get('from'), 10), b = parseInt(ctx.url.searchParams.get('to'), 10);
    intIn(a, DAY_MIN, DAY_MAX, 'تاریخ شروع'); intIn(b, DAY_MIN, DAY_MAX, 'تاریخ پایان');
    if (b < a || b - a > 400) throw bad('بازهٔ تاریخ نامعتبر است.');
    const ra = readAssign(ctx.user, a, b);
    return { rev: DBM.getMeta(db, 'assign_rev', 1), assign: ra.assign, assignDept: ra.assignDept };
  });
  route('POST', '/api/assign', 'manager', (ctx) => writeAssign(ctx.user, ctx.body.changes));

  /* ---------- درخواست‌ها: مرخصی و جابه‌جایی شیفت ---------- */
  const LEAVE_CODES = ['LV', 'LU', 'SK'];
  const OPEN = ['pending', 'peer', 'manager'];
  const personRow = (id) => {
    const r = q('SELECT id, first, last, dept_id, extra_depts FROM people WHERE id = ?').get(id);
    return r ? Object.assign(r, { extraDeptIds: parseExtraDepts(r.extra_depts) }) : r;
  };
  const touchReq = () => DBM.bumpMeta(db, 'req_rev');
  const assignCode = (pid, d) => { const r = q('SELECT code FROM assign WHERE person_id = ? AND day = ?').get(pid, d); return r ? r.code : null; };
  /** بخشِ مؤثر خانهٔ یک فرد در یک روز (بخشِ صریحِ خانه، وگرنه بخش اصلی) */
  const assignDeptOf = (pid, d) => {
    const p = personRow(pid);
    if (!p) return '';
    const r = q('SELECT dept_id FROM assign WHERE person_id = ? AND day = ?').get(pid, d);
    return (r && r.dept_id) || p.dept_id || '';
  };

  /** مدیر سیستم همه؛ مدیر بخش فقط افراد بخش‌های خودش و نه درخواست خودش.
   *  مرخصی سطحِ نفر است (تأییدش شیفت‌های همهٔ بخش‌ها را رونویسی می‌کند)، پس
   *  تأییدِ مرخصی فقط با مدیرِ بخشِ اصلیِ نفر است، نه مدیرِ بخشِ فرعی.
   *  جابه‌جایی همین محافظت را از بازبینیِ planSwap هنگام تأیید می‌گیرد. */
  function canApprove(user, r) {
    if (user.role === 'admin') return true;
    if (user.role !== 'manager' || r.person_id === user.personId) return false;
    const w = scope(user).write;
    if (!w.has(r.person_id) || (r.peer_id && !w.has(r.peer_id))) return false;
    if (r.kind === 'leave') {
      const p = personRow(r.person_id);
      return !!p && !!p.dept_id && user.deptIds.includes(p.dept_id);
    }
    return true;
  }
  function actionsFor(user, r) {
    const out = [];
    if (!OPEN.includes(r.status)) return out;
    if (user.personId && r.person_id === user.personId) out.push('cancel');
    if (r.kind === 'swap' && r.status === 'peer' && user.personId && r.peer_id === user.personId) out.push('accept', 'decline');
    if ((r.status === 'pending' || r.status === 'manager') && canApprove(user, r)) out.push('approve', 'reject');
    return out;
  }
  const REQ_SELECT = `SELECT r.*, p.first pf, p.last pl, e.first ef, e.last el FROM requests r
    JOIN people p ON p.id = r.person_id LEFT JOIN people e ON e.id = r.peer_id`;
  function serializeReq(user, r) {
    return {
      id: r.id, kind: r.kind, status: r.status, personId: r.person_id, personName: persName({ first: r.pf, last: r.pl }),
      peerId: r.peer_id || null, peerName: r.peer_id ? persName({ first: r.ef, last: r.el }) : '',
      code: r.leave_code || null, d1: r.d1, d2: r.d2, note: r.note, reply: r.reply, createdAt: r.created_at,
      decidedBy: r.decided_by, decidedAt: r.decided_at, actions: actionsFor(user, r),
    };
  }
  function visibleRequests(user, limit) {
    let rows;
    if (user.role === 'admin') rows = q(`${REQ_SELECT} ORDER BY r.id DESC LIMIT ?`).all(limit);
    else {
      const ids = new Set(scope(user).write);
      if (user.personId) ids.add(user.personId);
      if (!ids.size) return [];
      const arr = Array.from(ids);
      const ph = placeholders(arr.length);
      rows = q(`${REQ_SELECT} WHERE r.person_id IN (${ph}) OR r.peer_id IN (${ph}) ORDER BY r.id DESC LIMIT ?`).all(...arr, ...arr, limit);
    }
    return rows.filter((r) => user.role === 'admin' || r.person_id === user.personId || r.peer_id === user.personId || canApprove(user, r) || (user.role === 'manager' && scope(user).write.has(r.person_id)));
  }
  function todoCount(user) {
    let n = 0;
    for (const r of visibleRequests(user, 500)) if (actionsFor(user, r).some((a) => a !== 'cancel')) n++;
    return n;
  }
  const getReq = (user, id) => { const r = q(`${REQ_SELECT} WHERE r.id = ?`).get(id); return r ? serializeReq(user, r) : null; };

  /** برنامهٔ جابه‌جایی را بازبینی می‌کند و فهرست نوشتن‌ها را برمی‌گرداند؛ در صورت ناممکن بودن bad پرتاب می‌کند */
  function planSwap(aId, bId, d1, d2) {
    const A = personRow(aId), B = personRow(bId);
    if (!A || !B) throw bad('فرد پیدا نشد.');
    const aName = persName(A), bName = persName(B);
    const isWork = (c) => !!c && !Core.SPECIAL[c];
    const free = (c) => !c || c === 'RS';
    const aC = assignCode(aId, d1), bC = assignCode(bId, d2);
    if (!isWork(aC)) throw bad(`${aName} در ${Core.fmtDate(d1)} شیفت کاری ندارد.`);
    if (!isWork(bC)) throw bad(`${bName} در ${Core.fmtDate(d2)} شیفت کاری ندارد.`);
    // صلاحیت جابه‌جایی بر اساس بخشِ خانه‌هاست، نه بخش اصلی: هرکس باید عضوِ
    // بخشِ شیفتی باشد که قرار است بگیرد (بخش اصلی یا فرعی)
    const aDept = assignDeptOf(aId, d1), bDept = assignDeptOf(bId, d2);
    if (!deptsOf(B).includes(aDept) || !deptsOf(A).includes(bDept)) throw bad('جابه‌جایی فقط با همکارِ هم‌بخش ممکن است.');
    if (d1 === d2) {
      if (aC === bC) throw bad('هر دو شیفت یکسان‌اند و جابه‌جایی لازم نیست.');
      // بخش با شیفت جابه‌جا می‌شود: هر خانه بخشِ شیفتِ گرفته‌شده را می‌گیرد
      return [[aId, d1, bC, bDept], [bId, d1, aC, aDept]];
    }
    if (!free(assignCode(aId, d2))) throw bad(`${aName} در ${Core.fmtDate(d2)} خودش شیفت یا مرخصی دارد.`);
    if (!free(assignCode(bId, d1))) throw bad(`${bName} در ${Core.fmtDate(d1)} خودش شیفت یا مرخصی دارد.`);
    return [[aId, d1, null], [bId, d1, aC, aDept], [bId, d2, null], [aId, d2, bC, bDept]];
  }
  function applyWrites(writes) {
    const up = q('INSERT INTO assign(person_id, day, code, dept_id) VALUES(?, ?, ?, ?) ON CONFLICT(person_id, day) DO UPDATE SET code = excluded.code, dept_id = excluded.dept_id');
    const del = q('DELETE FROM assign WHERE person_id = ? AND day = ?');
    for (const w of writes) {
      const [pid, d, code] = w;
      if (!code) { del.run(pid, d); continue; }
      // بخشِ صریح (جابه‌جایی) وگرنه بخشِ خانهٔ قبلی همان روز (مرخصی)، وگرنه بخش اصلی (NULL)
      let deptId = w.length > 3 ? w[3] : null;
      if (deptId === undefined) {
        const old = q('SELECT dept_id FROM assign WHERE person_id = ? AND day = ?').get(pid, d);
        deptId = old ? old.dept_id : null;
      }
      // ذخیرهٔ تنک: بخشِ برابر با بخش اصلیِ گیرنده هم NULL می‌شود
      if (deptId) {
        const prow = q('SELECT dept_id FROM people WHERE id = ?').get(pid);
        if (prow && prow.dept_id === deptId) deptId = null;
      }
      up.run(pid, d, code, deptId || null);
    }
    DBM.bumpMeta(db, 'assign_rev');
  }

  route('GET', '/api/peers', 'user', (ctx) => {
    if (!ctx.user.personId) return { peers: [] };
    const me = personRow(ctx.user.personId);
    const myDepts = deptsOf(me);
    if (!me || !myDepts.length) return { peers: [] };
    // همکار یعنی کسی که دست‌کم در یک بخش (اصلی یا فرعی) با من مشترک است
    const peers = q('SELECT id, first, last, dept_id, extra_depts FROM people WHERE id <> ?').all(me.id)
      .filter((p) => deptsOf(p).some((d) => myDepts.includes(d)))
      .sort((x, y) => (x.last || '').localeCompare(y.last || '') || (x.first || '').localeCompare(y.first || ''));
    return { peers: peers.map((p) => ({ id: p.id, name: persName(p) })) };
  });
  route('GET', '/api/requests', 'user', (ctx) => ({
    requests: visibleRequests(ctx.user, 300).map((r) => serializeReq(ctx.user, r)),
    reqRev: DBM.getMeta(db, 'req_rev', 0),
  }));
  route('POST', '/api/requests', 'user', (ctx) => {
    const user = ctx.user;
    if (!user.personId) throw bad('حساب شما به فردی در فهرست پرسنل وصل نیست. از مدیر سیستم بخواهید آن را وصل کند.');
    const b = ctx.body, today = Core.todayJdn(), note = str(b.note, 300, 'توضیح');
    const me = personRow(user.personId);
    if (!me) throw bad('فرد پیدا نشد.');
    let id;
    if (b.kind === 'leave') {
      if (!LEAVE_CODES.includes(b.code)) throw bad('نوع مرخصی نامعتبر است.');
      const from = intIn(b.from, today - 31, today + 366, 'تاریخ شروع');
      const to = intIn(b.to, from, from + 400, 'تاریخ پایان');
      if (to - from > 59) throw bad('هر درخواست مرخصی حداکثر ۶۰ روز است.');
      if (q("SELECT 1 FROM requests WHERE kind = 'leave' AND person_id = ? AND status IN ('pending','approved') AND d1 <= ? AND d2 >= ?").get(me.id, to, from)) {
        throw bad('در این بازه قبلاً درخواست مرخصی ثبت کرده‌اید.');
      }
      id = DBM.tx(db, () => {
        const r = q("INSERT INTO requests(kind, person_id, leave_code, d1, d2, note, status, created_at, updated_at) VALUES('leave', ?, ?, ?, ?, ?, 'pending', ?, ?)").run(me.id, b.code, from, to, note, now(), now());
        touchReq();
        writeLog(user, `درخواست ${Core.SPECIAL[b.code].name}: ${persName(me)} از ${Core.fmtDate(from)} تا ${Core.fmtDate(to)}`);
        return r.lastInsertRowid;
      });
    } else if (b.kind === 'swap') {
      if (typeof b.peerId !== 'string') throw bad('همکار را انتخاب کنید.');
      const peer = personRow(b.peerId);
      if (!peer || peer.id === me.id) throw bad('همکار انتخاب‌شده نامعتبر است.');
      // صلاحیت هم‌بخشی را planSwap بر اساس بخشِ خانه‌های درگیر بررسی می‌کند
      const d1 = intIn(b.d1, today - 1, today + 366, 'روز شیفت شما');
      const d2 = intIn(b.d2, today - 1, today + 366, 'روز شیفت همکار');
      planSwap(me.id, peer.id, d1, d2);
      const dup = q("SELECT 1 FROM requests WHERE kind = 'swap' AND status IN ('peer','manager') AND ((person_id = ? AND peer_id = ? AND d1 = ? AND d2 = ?) OR (person_id = ? AND peer_id = ? AND d1 = ? AND d2 = ?))")
        .get(me.id, peer.id, d1, d2, peer.id, me.id, d2, d1);
      if (dup) throw bad('همین جابه‌جایی قبلاً درخواست شده است.');
      id = DBM.tx(db, () => {
        const r = q("INSERT INTO requests(kind, person_id, peer_id, d1, d2, note, status, created_at, updated_at) VALUES('swap', ?, ?, ?, ?, ?, 'peer', ?, ?)").run(me.id, peer.id, d1, d2, note, now(), now());
        touchReq();
        writeLog(user, `درخواست جابه‌جایی شیفت: ${persName(me)} (${Core.fmtDate(d1)}) با ${persName(peer)} (${Core.fmtDate(d2)})`);
        return r.lastInsertRowid;
      });
    } else throw bad('نوع درخواست نامعتبر است.');
    return { request: getReq(user, id) };
  });
  route('POST', '/api/requests/(\\d+)/respond', 'user', (ctx) => {
    const id = +ctx.params[0];
    const action = ctx.body.action;
    const reply = str(ctx.body.reply, 300, 'پاسخ');
    if (!['accept', 'decline', 'approve', 'reject', 'cancel'].includes(action)) throw bad('اقدام نامعتبر است.');
    if (!q('SELECT 1 FROM requests WHERE id = ?').get(id)) throw new HttpError(404, 'درخواست پیدا نشد.');
    const who = ctx.user.display || ctx.user.code;
    DBM.tx(db, () => {
      const r = q('SELECT * FROM requests WHERE id = ?').get(id);
      if (!actionsFor(ctx.user, r).includes(action)) throw new HttpError(403, 'این اقدام برای شما یا در وضعیت فعلی درخواست ممکن نیست.');
      const A = personRow(r.person_id), B = r.peer_id ? personRow(r.peer_id) : null;
      const label = r.kind === 'leave' ? `${Core.SPECIAL[r.leave_code].name} ${persName(A)} (${Core.fmtDate(r.d1)} تا ${Core.fmtDate(r.d2)})` : `جابه‌جایی ${persName(A)} و ${persName(B)}`;
      const set = (status, extra) => {
        q('UPDATE requests SET status = ?, reply = ?, updated_at = ?, decided_by = ?, decided_at = ? WHERE id = ?')
          .run(status, extra ? reply : r.reply, now(), extra ? who : r.decided_by, extra ? now() : r.decided_at, id);
      };
      if (action === 'cancel') { set('cancelled', false); writeLog(ctx.user, `لغو درخواست: ${label}`); }
      else if (action === 'decline') { set('declined', true); writeLog(ctx.user, `عدم پذیرش جابه‌جایی: ${label}`); }
      else if (action === 'accept') { set('manager', false); writeLog(ctx.user, `پذیرش همکار: ${label}`); }
      else if (action === 'reject') { set('rejected', true); writeLog(ctx.user, `رد درخواست: ${label}`); }
      else {
        if (r.kind === 'leave') {
          const writes = [];
          for (let d = r.d1; d <= r.d2; d++) writes.push([r.person_id, d, r.leave_code]);
          applyWrites(writes);
        } else {
          let plan;
          try { plan = planSwap(r.person_id, r.peer_id, r.d1, r.d2); }
          catch (e) {
            if (e instanceof HttpError && e.status === 400) throw new HttpError(409, 'تأیید ممکن نیست چون برنامه از زمان درخواست تغییر کرده است: ' + e.message);
            throw e;
          }
          applyWrites(plan);
        }
        set('approved', true);
        writeLog(ctx.user, `تأیید درخواست و اعمال روی برنامه: ${label}`);
      }
      touchReq();
    });
    return { request: getReq(ctx.user, id) };
  });

  /* ---------- ترجیحات و درخواست روز برای برنامه‌ریزی خودکار ---------- */
  const OT_KINDS = ['none', 'normal', 'more'];
  const canEditPrefs = (user, pid) => user.role === 'admin' || (user.personId && user.personId === pid) || (user.role === 'manager' && scope(user).write.has(pid));
  const wishRow = (r) => ({ id: r.id, pid: r.person_id, j: r.day, kind: r.kind, code: r.code || null, note: r.note });
  route('GET', '/api/prefs', 'user', (ctx) => {
    const sc = scope(ctx.user), prefs = {};
    for (const r of q('SELECT person_id, data FROM prefs').all()) {
      if (sc.read && !sc.read.has(r.person_id)) continue;
      try { prefs[r.person_id] = JSON.parse(r.data); } catch (_) { /* نادیده */ }
    }
    const wishes = q('SELECT * FROM wishes ORDER BY day, id').all().filter((r) => !sc.read || sc.read.has(r.person_id)).map(wishRow);
    return { prefs, wishes };
  });
  route('PUT', '/api/prefs/([A-Za-z0-9_-]+)', 'user', (ctx) => {
    const pid = ctx.params[0];
    const p = personRow(pid);
    if (!p) throw new HttpError(404, 'فرد پیدا نشد.');
    if (!canEditPrefs(ctx.user, pid)) throw new HttpError(403, 'اجازهٔ ویرایش ترجیحات این فرد را ندارید.');
    const b = ctx.body, out = { shift: {}, ot: 'normal' };
    if (b.ot !== undefined) { if (!OT_KINDS.includes(b.ot)) throw bad('گزینهٔ اضافه‌کار نامعتبر است.'); out.ot = b.ot; }
    const codes = new Set(q('SELECT code FROM shifts').all().map((r) => r.code));
    for (const [c, w] of Object.entries(b.shift && typeof b.shift === 'object' ? b.shift : {})) {
      if (!codes.has(c)) throw bad('کد شیفت نامعتبر است.');
      const n = intIn(w, -2, 2, 'اولویت شیفت');
      if (n) out.shift[c] = n;
    }
    DBM.tx(db, () => {
      q('INSERT INTO prefs(person_id, data) VALUES(?, ?) ON CONFLICT(person_id) DO UPDATE SET data = excluded.data').run(pid, JSON.stringify(out));
      writeLog(ctx.user, `ترجیحات برنامه‌ریزی ${persName(p)} ثبت شد`);
    });
    return { prefs: out };
  });
  route('POST', '/api/wishes', 'user', (ctx) => {
    const b = ctx.body, pid = typeof b.pid === 'string' && b.pid ? b.pid : ctx.user.personId;
    const p = pid && personRow(pid);
    if (!p) throw bad('فرد مشخص نیست.');
    if (!canEditPrefs(ctx.user, pid)) throw new HttpError(403, 'اجازهٔ ثبت درخواست برای این فرد را ندارید.');
    if (!['want', 'off', 'avoid'].includes(b.kind)) throw bad('نوع درخواست نامعتبر است.');
    const today = Core.todayJdn(), day = intIn(b.day, today - 1, today + 400, 'روز');
    let code = '';
    if (b.kind !== 'off' && b.code) {
      if (typeof b.code !== 'string' || !q('SELECT 1 FROM shifts WHERE code = ?').get(b.code)) throw bad('کد شیفت نامعتبر است.');
      code = b.code;
    }
    if (b.kind === 'want' && !code) throw bad('شیفت مورد نظر را انتخاب کنید.');
    const note = str(b.note, 200, 'توضیح');
    if (q('SELECT COUNT(*) n FROM wishes WHERE person_id = ?').get(pid).n >= 100) throw bad('حداکثر ۱۰۰ درخواست برای هر نفر.');
    if (q('SELECT 1 FROM wishes WHERE person_id = ? AND day = ? AND kind = ? AND code = ?').get(pid, day, b.kind, code)) throw bad('این درخواست قبلاً ثبت شده است.');
    const id = DBM.tx(db, () => {
      const r = q('INSERT INTO wishes(person_id, day, kind, code, note, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(pid, day, b.kind, code, note, now());
      writeLog(ctx.user, `درخواست روز برای برنامه‌ریزی: ${persName(p)} — ${Core.fmtDate(day)} (${{ want: 'می‌خواهد', off: 'آف', avoid: 'نمی‌خواهد' }[b.kind]}${code ? ' ' + code : ''})`);
      return r.lastInsertRowid;
    });
    return { wish: wishRow(q('SELECT * FROM wishes WHERE id = ?').get(id)) };
  });
  route('DELETE', '/api/wishes/(\\d+)', 'user', (ctx) => {
    const r = q('SELECT * FROM wishes WHERE id = ?').get(+ctx.params[0]);
    if (!r) throw new HttpError(404, 'درخواست پیدا نشد.');
    if (!canEditPrefs(ctx.user, r.person_id)) throw new HttpError(403, 'اجازهٔ حذف ندارید.');
    q('DELETE FROM wishes WHERE id = ?').run(r.id);
    return { ok: true };
  });

  route('GET', '/api/log', 'admin', (ctx) => {
    const n = Math.min(500, Math.max(1, parseInt(ctx.url.searchParams.get('limit'), 10) || 100));
    return { items: q('SELECT ts, who, text FROM log ORDER BY id DESC LIMIT ?').all(n).map((r) => ({ t: r.ts, who: r.who, x: r.text })) };
  });

  route('GET', '/api/users', 'admin', () => ({ users: q('SELECT * FROM users ORDER BY role, code').all().map(publicUser) }));
  route('POST', '/api/users', 'admin', async (ctx) => {
    const f = checkUserFields(ctx.body, true);
    if (f.role !== 'admin' && !f.personId) throw bad('برای این نقش باید یک فرد از فهرست پرسنل انتخاب شود.');
    if (q('SELECT 1 FROM users WHERE code = ?').get(f.code)) throw bad('این کد کاربری قبلاً استفاده شده است.');
    if (f.personId && q('SELECT 1 FROM users WHERE person_id = ?').get(f.personId)) throw bad('این فرد قبلاً حساب کاربری دارد.');
    let pw = ctx.body.password, temp = false;
    if (pw) validatePassword(pw, f.code); else { pw = Auth.tempPassword(); temp = true; }
    const hash = await Auth.hashPassword(pw);
    const p = f.personId ? q('SELECT first, last FROM people WHERE id = ?').get(f.personId) : null;
    const id = DBM.tx(db, () => {
      const r = q('INSERT INTO users(code, pass_hash, role, person_id, display, active, must_change, created_at) VALUES(?, ?, ?, ?, ?, 1, 1, ?)')
        .run(f.code, hash, f.role, f.personId || null, f.display || (p ? persName(p) : f.code), now());
      if (f.role === 'manager' && f.deptIds) setUserDepts(r.lastInsertRowid, f.deptIds);
      writeLog(ctx.user, `ساخت حساب کاربری ${f.code} (${f.role})`);
      return r.lastInsertRowid;
    });
    return { user: publicUser(userRow(id)), tempPassword: temp ? pw : undefined };
  });
  route('POST', '/api/users/provision', 'admin', async (ctx) => {
    const rows = q("SELECT p.id, p.first, p.last, p.code FROM people p WHERE p.code <> '' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.person_id = p.id) AND NOT EXISTS (SELECT 1 FROM users u2 WHERE u2.code = p.code COLLATE NOCASE)").all();
    const created = [];
    for (const p of rows) {
      const pw = Auth.tempPassword();
      const hash = await Auth.hashPassword(pw);
      q('INSERT INTO users(code, pass_hash, role, person_id, display, active, must_change, created_at) VALUES(?, ?, ?, ?, ?, 1, 1, ?)')
        .run(p.code, hash, 'staff', p.id, persName(p), now());
      created.push({ code: p.code, name: persName(p), tempPassword: pw });
    }
    if (created.length) writeLog(ctx.user, `ساخت گروهی ${Core.fa(created.length)} حساب پرسنل`);
    return { created };
  });
  route('PATCH', '/api/users/(\\d+)', 'admin', (ctx) => {
    const id = +ctx.params[0];
    const row = userRow(id);
    if (!row) throw new HttpError(404, 'کاربر پیدا نشد.');
    const f = checkUserFields(ctx.body, false);
    const isSelf = id === ctx.user.id;
    const newRole = f.role || row.role;
    const newActive = ctx.body.active === undefined ? !!row.active : !!ctx.body.active;
    if (isSelf && (newRole !== row.role || !newActive)) throw bad('نقش یا فعال‌بودن حساب خودتان را نمی‌توانید تغییر دهید.');
    if (row.role === 'admin' && row.active && (newRole !== 'admin' || !newActive) && adminCount() <= 1) throw bad('حداقل یک مدیر فعال باید باقی بماند.');
    const personId = f.personId === undefined ? row.person_id : f.personId;
    if (newRole !== 'admin' && !personId) throw bad('برای این نقش باید یک فرد از فهرست پرسنل انتخاب شود.');
    if (f.personId && q('SELECT 1 FROM users WHERE person_id = ? AND id <> ?').get(f.personId, id)) throw bad('این فرد قبلاً حساب کاربری دارد.');
    if (f.code && q('SELECT 1 FROM users WHERE code = ? AND id <> ?').get(f.code, id)) throw bad('این کد کاربری قبلاً استفاده شده است.');
    DBM.tx(db, () => {
      q('UPDATE users SET code = ?, role = ?, person_id = ?, display = ?, active = ? WHERE id = ?')
        .run(f.code || row.code, newRole, personId || null, f.display === undefined ? row.display : f.display, newActive ? 1 : 0, id);
      if (f.deptIds) setUserDepts(id, f.deptIds);
      if (newRole !== 'manager') q('DELETE FROM user_depts WHERE user_id = ?').run(id);
      if (!newActive || newRole !== row.role) q('DELETE FROM sessions WHERE user_id = ?').run(id);
      writeLog(ctx.user, `ویرایش حساب ${f.code || row.code}`);
    });
    return { user: publicUser(userRow(id)) };
  });
  route('POST', '/api/users/(\\d+)/reset', 'admin', async (ctx) => {
    const id = +ctx.params[0];
    const row = userRow(id);
    if (!row) throw new HttpError(404, 'کاربر پیدا نشد.');
    const pw = Auth.tempPassword();
    const hash = await Auth.hashPassword(pw);
    DBM.tx(db, () => {
      q('UPDATE users SET pass_hash = ?, must_change = 1 WHERE id = ?').run(hash, id);
      q('DELETE FROM sessions WHERE user_id = ?').run(id);
      writeLog(ctx.user, `بازنشانی گذرواژهٔ ${row.code}`);
    });
    return { tempPassword: pw };
  });
  route('DELETE', '/api/users/(\\d+)', 'admin', (ctx) => {
    const id = +ctx.params[0];
    const row = userRow(id);
    if (!row) throw new HttpError(404, 'کاربر پیدا نشد.');
    if (id === ctx.user.id) throw bad('حساب خودتان را نمی‌توانید حذف کنید.');
    if (row.role === 'admin' && row.active && adminCount() <= 1) throw bad('حداقل یک مدیر فعال باید باقی بماند.');
    DBM.tx(db, () => { q('DELETE FROM users WHERE id = ?').run(id); writeLog(ctx.user, `حذف حساب ${row.code}`); });
    return { ok: true };
  });

  /* ---------- پردازش درخواست ---------- */
  const SEC_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  };
  function send(res, status, body, headers) {
    res.writeHead(status, Object.assign({}, SEC_HEADERS, headers));
    res.end(body);
  }
  function sendJson(res, status, obj, extra) {
    send(res, status, JSON.stringify(obj), Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra));
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new HttpError(413, 'حجم درخواست بیش از حد است.')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!size) return resolve({});
        try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {}); }
        catch (_) { reject(bad('بدنهٔ درخواست JSON معتبر نیست.')); }
      });
      req.on('error', reject);
    });
  }
  const rank = { none: 0, user: 1, full: 1, manager: 2, admin: 3 };
  const roleRank = { staff: 1, manager: 2, admin: 3 };

  async function api(req, res, url) {
    const route_ = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!route_) {
      if (routes.some((r) => r.re.test(url.pathname))) throw new HttpError(405, 'روش درخواست مجاز نیست.');
      throw new HttpError(404, 'پیدا نشد.');
    }
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    if (mutating) {
      // دفاع در برابر CSRF: هدر سفارشی (بدون CORS قابل ارسال از سایت دیگر نیست) + بررسی Origin + نوع محتوا
      if (req.headers['x-requested-with'] !== 'shiftyar') throw new HttpError(403, 'درخواست نامعتبر است.');
      const origin = req.headers.origin;
      if (origin) {
        let ok = false;
        try { ok = new URL(origin).host === req.headers.host; } catch (_) { ok = false; }
        if (!ok) throw new HttpError(403, 'درخواست از منبع نامعتبر است.');
      }
      const ct = String(req.headers['content-type'] || '');
      if (req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined && !ct.startsWith('application/json')) throw new HttpError(415, 'نوع محتوا باید JSON باشد.');
    }
    const ctx = { req, res, url, params: url.pathname.match(route_.re).slice(1), body: {}, user: null, setCookie: null };
    if (route_.access !== 'none') {
      ctx.user = sessionUser(req);
      if (!ctx.user) throw new HttpError(401, 'ابتدا وارد شوید.');
      const need = rank[route_.access];
      if (need >= 2 && roleRank[ctx.user.role] < need) throw new HttpError(403, 'دسترسی ندارید.');
      // کاربری که باید گذرواژه را عوض کند فقط به چند مسیر دسترسی دارد
      if (ctx.user.mustChange && !['/api/me', '/api/password', '/api/logout'].includes(url.pathname)) throw new HttpError(403, 'ابتدا گذرواژه را عوض کنید.', { mustChange: true });
    }
    if (mutating) ctx.body = await readBody(req);
    const result = await route_.handler(ctx);
    sendJson(res, 200, result, ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : undefined);
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'روش درخواست مجاز نیست.');
    let file, type;
    const s = STATIC[url.pathname];
    if (s) { [file, type] = s; }
    else if (FONT_RE.test(url.pathname)) { file = url.pathname.slice(1); type = 'font/woff2'; }
    else throw new HttpError(404, 'پیدا نشد.');
    const full = path.join(WEB_DIR, file);
    if (!full.startsWith(WEB_DIR + path.sep)) throw new HttpError(404, 'پیدا نشد.');
    let st;
    try { st = fs.statSync(full); } catch (_) { throw new HttpError(404, 'پیدا نشد.'); }
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = { 'Content-Type': type, 'ETag': etag, 'Cache-Control': file.startsWith('fonts/') ? 'public, max-age=604800, immutable' : 'no-cache' };
    if (req.headers['if-none-match'] === etag) return send(res, 304, '', headers);
    send(res, 200, req.method === 'HEAD' ? '' : fs.readFileSync(full), headers);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else serveStatic(req, res, url);
    } catch (e) {
      if (e instanceof HttpError) {
        const extra = e.extra || {};
        const headers = extra.retryAfter ? { 'Retry-After': String(extra.retryAfter) } : undefined;
        if (!res.headersSent) sendJson(res, e.status, Object.assign({ error: e.message }, extra), headers);
      } else {
        cfg.log('خطای داخلی: ' + (e && e.stack || e));
        if (!res.headersSent) sendJson(res, 500, { error: 'خطای داخلی سرور.' });
      }
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;

  return {
    server, db, bootstrap,
    close() { clearInterval(sweeper); return new Promise((r) => server.close(() => { try { db.close(); } catch (_) { /* ignore */ } r(); })); },
  };
}

module.exports = { createApp };
