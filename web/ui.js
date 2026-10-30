/* ui.js — رابط کاربری و ذخیره‌سازی شیفت‌یار */
'use strict';
const {
  MONTHS, WD_SHORT, WD_FULL, SPECIAL, CONTRACTS, WORK_TYPES, fa, toLatin, fmtHM, fmtHMlatin, fmtDate, fmtDateLatin, parseDate, toMin,
  j2d, d2j, monthLen, weekdayOf, todayJdn, shiftIvs, shiftMinutes, ivsMinutes, ivText, holidayInfo, holidayMap,
  computeRange, restIssues, validateShift, pad2, defaultOfficePatterns, findOfficePattern, autoAssignOffice, officePatternIvs,
} = Core;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p) => p + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-3);
const N = (t) => `<span class="num">${t}</span>`;
const hmH = (min) => N(fmtHM(min));
const NO_COLOR = '#8a94a6';

/* ---------- کاربر و نقش (فقط در حالت سرور) ---------- */
const ME = { user: null };
const ROLE_NAMES = { admin: 'مدیر سیستم', manager: 'مدیر بخش', staff: 'پرسنل' };
const isServer = () => Store.mode === 'server';
const role = () => (isServer() && ME.user ? ME.user.role : 'admin');
const canConfig = () => role() === 'admin';
const canEdit = () => role() !== 'staff';

/* ---------- داده ---------- */
const DB = { cfg: null, assign: {}, assignDept: {}, log: [] };
const ui = {
  tab: 'sched', jy: 1405, jm: 1, dept: 'all', paintDept: '', brush: 'M', pcalPerson: '', editPerson: null, shiftDraft: null,
  shiftTab: 'hospital', editOfficePattern: null, editMode: false,
  rep: { from: null, to: null, dept: 'all' }, undo: [], ctx: null,
};

function defaultCfg() {
  return { settings: Core.defaultSettings(), depts: [], people: [], shifts: Core.defaultShifts(), holidays: Core.defaultHolidays(), sample: false };
}
function normalizeCfg(c) {
  const d = defaultCfg();
  c = c || {};
  const s = Object.assign({}, d.settings, c.settings || {});
  s.factors = Object.assign({}, d.settings.factors, (c.settings || {}).factors || {});
  const depts = Array.isArray(c.depts) ? c.depts : [];
  const deptIds = new Set(depts.map((x) => x.id));
  const people = (Array.isArray(c.people) ? c.people : []).map((p) => {
    const extra = (Array.isArray(p.extraDeptIds) ? p.extraDeptIds : [])
      .filter((x) => typeof x === 'string' && deptIds.has(x) && x !== p.deptId);
    return Object.assign({}, p, { extraDeptIds: Array.from(new Set(extra)) });
  });
  return {
    settings: s,
    depts,
    people,
    shifts: Array.isArray(c.shifts) && c.shifts.length ? c.shifts : d.shifts,
    holidays: Array.isArray(c.holidays) ? c.holidays : d.holidays,
    sample: !!c.sample,
  };
}
/** بخش‌های فرعیِ ذخیره‌شده در پشتیبان را اعتبارسنجی می‌کند: بخشِ ناموجود یا غیرعضو حذف می‌شود (خانه به بخش اصلی برمی‌گردد) */
function sanitizeAssignDept(cfg, assignDept) {
  const out = {};
  const deptIds = new Set((cfg.depts || []).map((x) => x.id));
  const byId = new Map((cfg.people || []).map((p) => [p.id, p]));
  for (const pid in (assignDept || {})) {
    const p = byId.get(pid); if (!p) continue;
    const allowed = new Set([p.deptId, ...(p.extraDeptIds || [])].filter(Boolean));
    for (const j in assignDept[pid]) {
      const d = assignDept[pid][j];
      if (d && deptIds.has(d) && allowed.has(d)) (out[pid] = out[pid] || {})[+j] = d;
    }
  }
  return out;
}
const dbv = () => ({ settings: DB.cfg.settings, holidays: DB.cfg.holidays, shifts: DB.cfg.shifts, assign: DB.assign, assignDept: DB.assignDept, people: DB.cfg.people });
const person = (id) => DB.cfg.people.find((p) => p.id === id);
const dept = (id) => DB.cfg.depts.find((d) => d.id === id);
const pname = (p) => `${p.first || ''} ${p.last || ''}`.trim() || 'بدون نام';
const deptColor = (p) => (dept(p.deptId) || {}).color || NO_COLOR;
/** بخش‌های یک نفر: اصلی + فرعی */
const personDepts = (p) => (p ? [p.deptId, ...(p.extraDeptIds || [])].filter(Boolean).filter((d, i, a) => a.indexOf(d) === i) : []);
const belongsToDept = (p, deptId) => personDepts(p).includes(deptId);
/** بخشِ یک خانه: بخشِ صریحِ خانه، وگرنه بخش اصلی نفر */
const cellDept = (pid, j) => {
  const p = person(pid);
  return ((DB.assignDept[pid] || {})[j]) || (p ? p.deptId : '') || '';
};
const cellColor = (pid, j) => (dept(cellDept(pid, j)) || {}).color || NO_COLOR;
/** نام بخش‌های درگیر در بازه برای یک نفر (برای ستون بخش در گزارش) */
const personDeptNames = (p, split) => {
  const ids = split ? Object.keys(split) : [];
  const names = ids.map((id) => (dept(id) || {}).name).filter(Boolean);
  if (names.length) return names.join('، ');
  return (dept(p.deptId) || {}).name || '—';
};
const shiftOf = (code) => DB.cfg.shifts.find((s) => s.code === code);
const codeLabel = (c) => (!c ? 'خالی' : SPECIAL[c] ? SPECIAL[c].name : c);
const monthId = (jy, jm) => jy + '-' + pad2(jm);

/* ---------- ذخیره‌سازی ---------- */
const Store = {
  mode: 'none', db: null, dl: null, loaded: new Set(), status: 'saved', err: '',
  dirty: { cfg: false, log: false, months: new Set() }, timer: null, busy: false, again: false,

  pending: new Map(), cfgVersion: 0, rev: 0, pollTimer: null,

  /** تماس با API سرور؛ خطا را با {status, message} پرتاب می‌کند */
  async api(method, path, body) {
    const opt = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'shiftyar' } };
    if (method !== 'GET') { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body === undefined ? {} : body); }
    let res;
    try { res = await fetch(path, opt); } catch (e) { throw { status: 0, message: 'ارتباط با سرور برقرار نشد.' }; }
    let data = null;
    try { data = await res.json(); } catch (e) { /* بدون بدنه */ }
    if (!res.ok) {
      if (res.status === 401 && path !== '/api/login') sessionLost();
      throw { status: res.status, message: (data && data.error) || 'خطا در ارتباط با سرور.', data };
    }
    return data;
  },
  /** آیا همین صفحه را یک سرور شیفت‌یار سرو کرده است؟ */
  async probeServer() {
    if (!/^https?:$/.test(location.protocol)) return false;
    try {
      const res = await fetch('/api/session', { credentials: 'same-origin', headers: { 'X-Requested-With': 'shiftyar' } });
      if (res.status !== 200) return false;
      const data = await res.json();
      if (!data || data.app !== 'shiftyar') return false;
      if (data.user) ME.user = data.user;
      return true;
    } catch (e) { return false; }
  },
  async loadConfigServer() {
    const r = await this.api('GET', '/api/config');
    DB.cfg = normalizeCfg(r.cfg);
    this.cfgVersion = r.version; this.rev = r.rev;
    this.loaded = new Set(); DB.assign = {}; DB.assignDept = {};
  },
  applyRange(a, b, assign, assignDept) {
    for (const pid in DB.assign) for (const k in DB.assign[pid]) { const j = +k; if (j >= a && j <= b) delete DB.assign[pid][k]; }
    for (const pid in DB.assignDept) for (const k in DB.assignDept[pid]) { const j = +k; if (j >= a && j <= b) delete DB.assignDept[pid][k]; }
    for (const pid in assign) for (const j in assign[pid]) (DB.assign[pid] = DB.assign[pid] || {})[+j] = assign[pid][j];
    for (const pid in (assignDept || {})) for (const j in assignDept[pid]) (DB.assignDept[pid] = DB.assignDept[pid] || {})[+j] = assignDept[pid][j];
  },
  startPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.poll(), 15000);
  },
  async poll() {
    if (!ME.user || document.hidden || this.busy || this.pending.size || this.dirty.cfg || painting) return;
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    try {
      const r = await this.api('GET', '/api/rev');
      const badgeChanged = r.todo !== reqState.todo;
      reqState.todo = r.todo || 0;
      const reqChanged = r.reqRev !== reqState.rev;
      const schedTab = ['sched', 'pcal', 'rep'].includes(ui.tab);
      const dataChanged = r.rev !== this.rev || r.version !== this.cfgVersion;
      if (!(schedTab && dataChanged) && !(ui.tab === 'req' && reqChanged) && !badgeChanged) return;
      const keepTab = ui.tab;
      if (schedTab && dataChanged) {
        if (r.version !== this.cfgVersion) await this.loadConfigServer();
        this.rev = r.rev; this.loaded = new Set();
      } else if (r.rev !== this.rev) { this.rev = r.rev; this.loaded = new Set(); }
      if (ui.tab === keepTab) await render();
    } catch (e) { /* در دور بعد دوباره */ }
  },

  async init() {
    try {
      if (window.claude && typeof window.claude.use === 'function') {
        this.db = await window.claude.use('db');
        this.dl = await window.claude.use('downloads');
      }
    } catch (e) { this.db = null; }
    if (!this.db && !window.claude && await this.probeServer()) {
      this.mode = 'server';
      DB.cfg = defaultCfg();
      if (ME.user && !ME.user.mustChange) {
        try { await this.enterApp(); } catch (e) { ME.user = null; loginMsg = e.message; }
      }
    } else if (this.db) {
      this.mode = 'db';
      try {
        const [c, l] = await Promise.all([this.db.doc('app/config').get(), this.db.doc('app/log').get()]);
        DB.cfg = c.exists ? normalizeCfg(c.data()) : defaultCfg();
        DB.log = l.exists ? (l.data().items || []) : [];
      } catch (e) { this.fail(e); DB.cfg = defaultCfg(); }
    } else {
      this.mode = 'local';
      DB.cfg = defaultCfg();
      try {
        const raw = localStorage.getItem('shiftyar.v1');
        if (raw) { const o = JSON.parse(raw); DB.cfg = normalizeCfg(o.cfg); DB.assign = o.assign || {}; DB.assignDept = sanitizeAssignDept(DB.cfg, o.assignDept); DB.log = o.log || []; }
      } catch (e) { /* خالی */ }
    }
  },
  /** بعد از ورود موفق: بارگذاری پیکربندی و شروع بررسی دوره‌ای */
  async enterApp() {
    await this.loadConfigServer();
    if (ME.user.role === 'staff' && DB.cfg.people[0]) ui.pcalPerson = DB.cfg.people[0].id;
    try { const r = await this.api('GET', '/api/rev'); reqState.todo = r.todo || 0; reqState.rev = r.reqRev; } catch (e) { /* نشان درخواست‌ها بعداً به‌روز می‌شود */ }
    this.startPolling();
  },
  async ensureMonth(jy, jm) {
    if (this.mode === 'server') {
      const id = monthId(jy, jm);
      if (this.loaded.has(id)) return;
      const a = j2d(jy, jm, 1), b = a + monthLen(jy, jm) - 1;
      try {
        const r = await this.api('GET', `/api/assign?from=${a}&to=${b}`);
        this.applyRange(a, b, r.assign, r.assignDept);
        this.loaded.add(id);
      } catch (e) { this.fail(e); }
      return;
    }
    if (this.mode !== 'db') return;
    const id = monthId(jy, jm);
    if (this.loaded.has(id)) return;
    try {
      const s = await this.db.doc('assign/' + id).get();
      if (s.exists) this.mergeMonth(jy, jm, (s.data() || {}).m || {}, (s.data() || {}).d || {});
      this.loaded.add(id);
    } catch (e) { this.fail(e); }
  },
  mergeMonth(jy, jm, m, d) {
    const a = j2d(jy, jm, 1);
    for (const k in m) {
      const i = k.lastIndexOf(':');
      const pid = k.slice(0, i), dd = +k.slice(i + 1);
      (DB.assign[pid] = DB.assign[pid] || {})[a + dd - 1] = m[k];
    }
    // بخشِ خانه‌ها: خانهٔ بدون کد، بخشِ صریح هم ندارد
    if (d) for (const k in d) {
      const i = k.lastIndexOf(':');
      const pid = k.slice(0, i), dd = +k.slice(i + 1), j = a + dd - 1;
      if ((DB.assign[pid] || {})[j]) (DB.assignDept[pid] = DB.assignDept[pid] || {})[j] = d[k];
      else if (DB.assignDept[pid]) delete DB.assignDept[pid][j];
    }
  },
  async ensureRange(a, b) {
    if (this.mode !== 'db' && this.mode !== 'server') return;
    let { jy, jm } = d2j(a - 3);
    const end = d2j(b);
    while (jy < end.jy || (jy === end.jy && jm <= end.jm)) {
      await this.ensureMonth(jy, jm);
      jm++; if (jm > 12) { jm = 1; jy++; }
    }
  },
  async loadAll() {
    if (this.mode !== 'db') return;
    try {
      const snap = await this.db.collection('assign').get();
      for (const d of snap.docs) {
        if (this.loaded.has(d.id)) continue;
        const m = /^(\d{4})-(\d{2})$/.exec(d.id);
        if (m) { this.mergeMonth(+m[1], +m[2], (d.data() || {}).m || {}, (d.data() || {}).d || {}); this.loaded.add(d.id); }
      }
    } catch (e) { this.fail(e); }
  },
  touchMonth(j) { if (this.mode === 'server') return; const d = d2j(j); this.dirty.months.add(monthId(d.jy, d.jm)); this.schedule(); },
  touchCell(pid, j, code, deptId) { this.pending.set(pid + ':' + j, { pid, j, code: code || null, deptId: deptId === undefined ? null : deptId }); this.schedule(); },
  touchCfg() { if (this.mode === 'server' && !canConfig()) return; this.dirty.cfg = true; this.schedule(); },
  touchLog() { if (this.mode === 'server') return; this.dirty.log = true; this.schedule(); },
  monthDoc(jy, jm) {
    const a = j2d(jy, jm, 1), b = a + monthLen(jy, jm) - 1, m = {}, d = {};
    for (const pid in DB.assign) {
      const mine = DB.assign[pid];
      for (let j = a; j <= b; j++) if (mine[j]) {
        m[pid + ':' + (j - a + 1)] = mine[j];
        const cd = (DB.assignDept[pid] || {})[j];
        if (cd) d[pid + ':' + (j - a + 1)] = cd;
      }
    }
    return { m, d };
  },
  setStatus(s) {
    this.status = s;
    const el = $('#savestate');
    if (el) { el.className = 'save ' + s; el.lastElementChild.textContent = this.statusText(); }
  },
  statusText() {
    if (this.status === 'saving') return 'در حال ذخیره…';
    if (this.status === 'error') return 'ذخیره نشد' + (this.err ? ': ' + this.err : '');
    return this.mode === 'db' || this.mode === 'server' ? 'ذخیره شد' : 'ذخیره در همین مرورگر';
  },
  fail(e) { this.err = (e && (e.message || e.code)) || 'خطا'; this.setStatus('error'); },
  schedule() { clearTimeout(this.timer); this.setStatus('saving'); this.timer = setTimeout(() => this.flush(), 500); },
  async flushServer() {
    let reloadMsg = '';
    try {
      if (this.dirty.cfg) {
        this.dirty.cfg = false;
        try {
          const r = await this.api('PUT', '/api/config', { version: this.cfgVersion, cfg: DB.cfg });
          this.cfgVersion = r.version;
        } catch (e) {
          if (e.status === 0) { this.dirty.cfg = true; throw e; }
          if (e.status === 409 && e.data && e.data.blockers) {
            // حذف مسدودشده (#13): تعارض نسخه نیست؛ فقط همان فرد از سرور برمی‌گردد و ویرایش‌های محلی دیگر حفظ می‌شوند
            this.dirty.cfg = true;
            try {
              const cur = await this.api('GET', '/api/config');
              const people = normalizeCfg(cur.cfg).people;
              const idx = people.findIndex((p) => p.id === e.data.personId);
              if (idx >= 0 && !DB.cfg.people.some((p) => p.id === e.data.personId)) {
                DB.cfg.people.splice(Math.min(idx, DB.cfg.people.length), 0, people[idx]);
              }
            } catch (_) { /* برگرداندن نشد؛ پیام خطا کافی است */ }
            reloadMsg = e.message;
          } else if (e.status === 400 || e.status === 409 || e.status === 403) {
            reloadMsg = e.message + ' آخرین اطلاعات سرور بارگذاری شد.';
            await this.loadConfigServer();
          } else throw e;
        }
      }
      if (this.pending.size) {
        const list = Array.from(this.pending.values());
        this.pending = new Map();
        for (let i = 0; i < list.length; i += 1500) {
          const chunk = list.slice(i, i + 1500);
          try {
            const r = await this.api('POST', '/api/assign', { changes: chunk });
            if (!r.applied || r.rev === this.rev + 1) this.rev = r.rev;
          } catch (e) {
            if (e.status === 0) { chunk.forEach((c) => { const k = c.pid + ':' + c.j; if (!this.pending.has(k)) this.pending.set(k, c); }); throw e; }
            if (e.status === 400 || e.status === 403) {
              reloadMsg = e.message + ' تغییرها اعمال نشد.';
              this.loaded = new Set(); DB.assign = {}; DB.assignDept = {};
            } else throw e;
          }
        }
      }
      if (this.dirty.cfg) { this.err = reloadMsg; this.setStatus('error'); }
      else { this.err = ''; this.setStatus('saved'); }
    } catch (e) {
      if (!ME.user) return;
      this.fail(e);
      if (e.status === 0) setTimeout(() => { if (ME.user && (this.pending.size || this.dirty.cfg)) this.schedule(); }, 5000);
      return;
    }
    if (reloadMsg) { await render(); flash(reloadMsg, false); }
  },
  async flush() {
    if (this.busy) { this.again = true; return; }
    if (this.mode === 'server') {
      this.busy = true;
      try { await this.flushServer(); } finally { this.busy = false; if (this.again) { this.again = false; this.flush(); } }
      return;
    }
    this.busy = true;
    const d = this.dirty;
    const cfg = d.cfg, log = d.log, months = Array.from(d.months);
    d.cfg = false; d.log = false; d.months = new Set();
    try {
      if (this.mode === 'local') {
        localStorage.setItem('shiftyar.v1', JSON.stringify({ cfg: DB.cfg, assign: DB.assign, assignDept: DB.assignDept, log: DB.log }));
      } else if (this.mode === 'db') {
        if (cfg) await this.db.doc('app/config').set(Object.assign({ v: 1 }, DB.cfg));
        for (const id of months) {
          if (!this.loaded.has(id)) continue;
          const [y, m] = id.split('-').map(Number);
          await this.db.doc('assign/' + id).set(this.monthDoc(y, m));
        }
        if (log) await this.db.doc('app/log').set({ items: DB.log });
      }
      this.err = '';
      this.setStatus('saved');
    } catch (e) {
      if (cfg) d.cfg = true; if (log) d.log = true; months.forEach((x) => d.months.add(x));
      this.fail(e);
    } finally {
      this.busy = false;
      if (this.again) { this.again = false; this.flush(); }
    }
  },
  /** جایگزینی کل داده‌ها (بازیابی پشتیبان یا پاک‌سازی) */
  async replaceAll(cfg, assign, assignDept, log) {
    await this.loadAll();
    const oldIds = Array.from(this.loaded);
    DB.cfg = cfg; DB.assign = assign; DB.assignDept = sanitizeAssignDept(cfg, assignDept); DB.log = log;
    const newIds = new Set();
    for (const pid in assign) for (const j in assign[pid]) { const d = d2j(+j); newIds.add(monthId(d.jy, d.jm)); }
    if (this.mode === 'db') {
      for (const id of oldIds) if (!newIds.has(id)) { try { await this.db.doc('assign/' + id).delete(); } catch (e) { this.fail(e); } }
      this.loaded = new Set(newIds);
    }
    this.dirty.cfg = true; this.dirty.log = true; this.dirty.months = new Set(newIds);
    this.schedule();
  },
};

/* ---------- عملیات روی داده ---------- */
function logEv(text) {
  if (isServer()) return; // سرور خودش با نام کاربر ثبت می‌کند
  DB.log.unshift({ t: Date.now(), x: text });
  if (DB.log.length > 200) DB.log.length = 200;
  Store.touchLog();
}
/**
 * ثبت یک خانهٔ شیفت. deptId بخشِ خانه پس از تغییر است؛ اگر داده نشود، بخشِ
 * فعلی خانه (یا بخش اصلی برای خانهٔ تازه) حفظ می‌شود. بخشِ خانه فقط به‌صورت
 * صریح ذخیره می‌شود وقتی با بخش اصلی فرق کند؛ نبودِ ورودی یعنی «بخش اصلی».
 */
function setAssign(pid, j, code, stroke, deptId) {
  if (!canEdit()) return false;
  const p = person(pid);
  const mine = (DB.assign[pid] = DB.assign[pid] || {});
  const deptMap = (DB.assignDept[pid] = DB.assignDept[pid] || {});
  const old = mine[j];
  const oldDept = deptMap[j] || (p ? p.deptId : '') || '';
  const nwDept = code ? (deptId !== undefined ? (deptId || '') : oldDept) : '';
  if (old === code || (!old && !code)) {
    // کد عوض نشده ولی بخشِ خانه عوض شده (تغییرِ فقطِ بخش) هم یک تغییر است
    if (!(code && oldDept !== nwDept)) return false;
  }
  if (code) mine[j] = code; else delete mine[j];
  if (code && nwDept && nwDept !== (p ? p.deptId : '')) deptMap[j] = nwDept; else delete deptMap[j];
  if (stroke) stroke.push({ pid, j, old, nw: code, oldDept, nwDept });
  if (isServer()) Store.touchCell(pid, j, code, code ? (nwDept || null) : null); else Store.touchMonth(j);
  return true;
}
function finishStroke(stroke, label) {
  if (!stroke || !stroke.length) return;
  ui.undo.push(stroke);
  if (ui.undo.length > 50) ui.undo.shift();
  if (stroke.length === 1) {
    const s = stroke[0], p = person(s.pid);
    logEv(`${p ? pname(p) : '؟'} — ${fmtDate(s.j)}: ${codeLabel(s.old)} ← ${codeLabel(s.nw)}`);
  } else logEv(`${fa(stroke.length)} خانه تغییر کرد (${label || 'قلم'})`);
  const btn = $('[data-act="undo"]'); if (btn) btn.disabled = false;
}

/* ---------- نمایش‌های مشترک ---------- */
function monthInfo() { const a = j2d(ui.jy, ui.jm, 1), len = monthLen(ui.jy, ui.jm); return { a, len, b: a + len - 1 }; }
function chipHtml(code, color, deptName) {
  if (!code) return '';
  const suffix = deptName ? ` · ${deptName}` : '';
  if (SPECIAL[code]) return `<span class="c sp ${code}" style="--dc:${esc(color)}" title="${esc(SPECIAL[code].name + suffix)}">${SPECIAL[code].short}</span>`;
  const sh = shiftOf(code);
  return `<span class="c" style="--dc:${esc(color)}" title="${esc((sh ? sh.name : code) + suffix)}">${esc(code)}</span>`;
}
function sortedPeople() {
  const di = (p) => { const i = DB.cfg.depts.findIndex((d) => d.id === p.deptId); return i < 0 ? 999 : i; };
  return DB.cfg.people.slice().sort((x, y) => di(x) - di(y) || (x.last || '').localeCompare(y.last || '', 'fa') || (x.first || '').localeCompare(y.first || '', 'fa'));
}
function visiblePeople() {
  let ps = sortedPeople();
  if (ui.dept === 'none') ps = ps.filter((p) => !personDepts(p).length);
  else if (ui.dept !== 'all') ps = ps.filter((p) => belongsToDept(p, ui.dept));
  return ps;
}
/** بخشِ قلم: بخشِ انتخاب‌شده برای نقاشی، وگرنه بخشِ نمای فعلی، وگرنه بخش اصلی نفر.
 * در حالت سرور، مدیر بخش فقط بخش‌هایی را می‌تواند بنویسد که مدیرشان است، پس
 * پیش‌فرض به اولین بخشِ مشترکِ نفر و مدیر می‌رسد تا نقاشی بی‌جهت 403 نگیرد. */
function paintDeptFor(p) {
  const mine = (isServer() && ME.user && ME.user.role === 'manager') ? (ME.user.deptIds || []) : null;
  const ok = (d) => belongsToDept(p, d) && (!mine || mine.includes(d));
  if (ui.paintDept && ok(ui.paintDept)) return ui.paintDept;
  if (ui.dept !== 'all' && ui.dept !== 'none' && ok(ui.dept)) return ui.dept;
  if (mine) { const shared = personDepts(p).find((d) => mine.includes(d)); if (shared) return shared; }
  return p.deptId || '';
}
const paintDeptSelect = (id) => `<label class="f">بخش شیفت<select id="${id}">
  <option value=""${!ui.paintDept ? ' selected' : ''}>خودکار (بخش نما / اصلی)</option>
  ${DB.cfg.depts.map((d) => `<option value="${esc(d.id)}"${ui.paintDept === d.id ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}
  </select></label>`;
function brushBar() {
  const sh = DB.cfg.shifts;
  const b = (k, big, small) => `<button type="button" data-brush="${esc(k)}" aria-pressed="${ui.brush === k}"><b>${big}</b><small>${small}</small></button>`;
  return `<div class="brush" role="group" aria-label="قلم رنگ‌آمیزی"><span class="lab">قلم:</span>
    ${sh.map((s) => b(s.code, esc(s.code), hmH(shiftMinutes(sh, s.code)))).join('')}
    <span class="gap"></span>
    ${Object.keys(SPECIAL).map((k) => b(k, SPECIAL[k].short, SPECIAL[k].name)).join('')}
    <span class="gap"></span>${b('ERASE', 'پاک‌کن', '')}</div>`;
}
function monthNav(extra) {
  return `<div class="bar"><div class="month-nav">
    <button class="btn" data-act="mprev" aria-label="ماه قبل">›</button>
    <span class="lab">${MONTHS[ui.jm - 1]} ${fa(ui.jy)}</span>
    <button class="btn" data-act="mnext" aria-label="ماه بعد">‹</button>
    <button class="btn sm" data-act="mtoday">این ماه</button></div>${extra || ''}</div>`;
}
const deptSelect = (id, val, withNone) => `<select id="${id}">
  <option value="all"${val === 'all' ? ' selected' : ''}>همهٔ بخش‌ها</option>
  ${DB.cfg.depts.map((d) => `<option value="${esc(d.id)}"${val === d.id ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}
  ${withNone ? `<option value="none"${val === 'none' ? ' selected' : ''}>بدون بخش</option>` : ''}</select>`;

/* ---------- تب: برنامه شیفت ---------- */
function rowHtml(p, ctx) {
  const { a, len, b, hm, T } = ctx;
  const mine = DB.assign[p.id] || {};
  const iss = restIssues(dbv(), p);
  const color = deptColor(p);
  let cells = '';
  for (let i = 0; i < len; i++) {
    const j = a + i;
    const cd = cellDept(p.id, j);
    // در نمای یک بخش، خانه‌های بخش‌های دیگر قفل‌اند: رنگِ بخشِ خودشان را دارند و نقاشی نمی‌شوند
    const locked = ui.tab === 'sched' && ui.dept !== 'all' && ui.dept !== 'none' && mine[j] && cd !== ui.dept;
    const dName = cd && cd !== p.deptId ? (dept(cd) || {}).name : '';
    cells += `<td class="cell${hm[j] ? ' hol' : ''}${iss[j] ? ' warn' : ''}${locked ? ' locked' : ''}" data-pid="${p.id}" data-j="${j}" tabindex="-1" role="button" aria-label="${esc(pname(p))}، ${fa(i + 1)} ${MONTHS[ui.jm - 1]}"${iss[j] ? ` title="${esc(iss[j].join(' / '))}"` : ''}>${chipHtml(mine[j], cellColor(p.id, j), dName)}</td>`;
  }
  const r = computeRange(dbv(), p, a, b, hm);
  const ot = r.overtime;
  const cap = DB.cfg.settings.otCapH * 60;
  const over = cap > 0 && ot > cap;
  const wtTag = p.workType === 'office' ? ' · اداری' : '';
  return `<tr data-pid="${p.id}"><th class="nm" scope="row" style="--dc:${esc(color)}"><b>${esc(pname(p))}</b><small>${esc(p.code || '')}${p.code ? ' · ' : ''}${CONTRACTS[p.contract] || ''}${wtTag}</small></th>${cells}
    <td class="sum">${hmH(r.duty)}</td><td class="sum">${hmH(r.weighted + r.credit)}</td>
    <td class="sum ot ${ot < 0 ? 'neg' : ot > 0 ? 'pos' : ''}"${over ? ' title="بیش از سقف اضافه‌کار"' : ''}>${hmH(ot)}${over ? ' ⚠' : ''}</td></tr>`;
}
function warnList(ps, ctx) {
  const items = [];
  for (const p of ps) {
    const iss = restIssues(dbv(), p);
    for (const k in iss) { const j = +k; if (j >= ctx.a && j <= ctx.b) items.push({ j, text: `${pname(p)} — ${fmtDate(j)}: ${iss[k][0]}` }); }
  }
  items.sort((x, y) => x.j - y.j);
  return items;
}
function sideHtml(ps, ctx) {
  const w = warnList(ps, ctx);
  const holN = ctx.holCount;
  const stats = `<div class="note">موظفی این ماه برای هر نفر: ${hmH((ctx.len - holN) * DB.cfg.settings.dutyMin)} (${N(fa(ctx.len - holN))} روز کاری از ${N(fa(ctx.len))} روز؛ ${N(fa(holN))} روز تعطیل)</div>`;
  const wl = w.length
    ? `<details class="warns" open><summary>${N(fa(w.length))} هشدار فاصلهٔ بین شیفت‌ها</summary><ul>${w.slice(0, 80).map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul></details>`
    : `<div class="note">هشداری برای فاصلهٔ بین شیفت‌ها نیست.</div>`;
  return stats + wl;
}
function viewSched() {
  const { a, len, b } = monthInfo();
  const hm = holidayMap(DB.cfg.settings, DB.cfg.holidays, a, b);
  let holCount = 0; for (let j = a; j <= b; j++) if (hm[j]) holCount++;
  const ctx = (ui.ctx = { a, len, b, hm, T: todayJdn(), holCount });
  const ps = visiblePeople();
  const sampleBar = DB.cfg.sample ? `<div class="msg">داده‌های این صفحه نمونه‌اند. وقتی آمادهٔ ثبت اطلاعات واقعی بودید، <button class="btn sm danger" data-act="clearsample" data-confirm="مطمئنید؟ همهٔ پرسنل، بخش‌ها و برنامه‌ها پاک می‌شوند">پاک‌کردن پرسنل و برنامه</button></div>` : '';
  let head = '<th class="nm">پرسنل</th>';
  for (let i = 0; i < len; i++) {
    const j = a + i;
    head += `<th class="${hm[j] ? 'hol' : ''}${j === ctx.T ? ' today' : ''}" title="${hm[j] ? esc(hm[j].name) : ''}">${fa(i + 1)}<small>${WD_SHORT[weekdayOf(j)]}</small></th>`;
  }
  head += '<th class="sum">موظفی</th><th class="sum">کارکرد</th><th class="sum">اضافه / کسر</th>';
  let body = '', lastDept = null;
  for (const p of ps) {
    if (ui.dept === 'all' && p.deptId !== lastDept) {
      lastDept = p.deptId;
      const d = dept(p.deptId);
      body += `<tr class="grp"><td colspan="${len + 4}" style="--dc:${esc(d ? d.color : NO_COLOR)}">${esc(d ? d.name : 'بدون بخش')}</td></tr>`;
    }
    body += rowHtml(p, ctx);
  }
  const legend = `<div class="legend">${DB.cfg.shifts.map((s) => `<span><span class="c" style="--dc:${NO_COLOR}">${esc(s.code)}</span>${esc(s.name)} ${hmH(shiftMinutes(DB.cfg.shifts, s.code))}</span>`).join('')}</div>`;
  const editBtn = canEdit()
    ? `<button class="btn ${ui.editMode ? 'primary' : ''}" data-act="toggleedit" style="display:inline-flex;align-items:center;gap:6px">
        <span>${ui.editMode ? '🔒 قفل و اتمام ویرایش' : '✏️ فعال‌سازی ویرایش شیفت‌ها'}</span>
      </button>`
    : '';
  const clearConfirm = (ui.dept !== 'all' && ui.dept !== 'none' && dept(ui.dept))
    ? `برنامهٔ این ماه در بخش ${esc(dept(ui.dept).name)} پاک شود؟`
    : 'برنامهٔ این ماه پاک شود؟';
  const editControls = (canEdit() && ui.editMode)
    ? `<div class="panel">${brushBar()}
        <div class="bar" style="flex-wrap:wrap;gap:6px">
          <button class="btn" data-act="undo"${ui.undo.length ? '' : ' disabled'}>بازگردانی آخرین تغییر</button>
          ${paintDeptSelect('paint-dept')}
          <label class="rows"><span class="note">کپی الگو از</span>
            <select id="copy-src"><option value="7">۷ روز قبل (هفتگی)</option><option value="14">۱۴ روز قبل</option><option value="28">۲۸ روز قبل</option><option value="pm">همان تاریخِ ماه قبل</option></select></label>
          <button class="btn" data-act="copypat" data-confirm="خانه‌های این ماه رونویسی می‌شوند. تأیید؟">اعمال</button>
          <span class="sp"></span>
          <button class="btn" data-act="autoassignoffice" title="پر کردن خودکار روزهای کاری اداری مطابق الگوی هر فرد">تکمیل خودکار اداری</button>
          <button class="btn" data-act="autoopen">پیشنهاد خودکار شیفت</button>
          <button class="btn danger" data-act="clearmonth" data-confirm="${clearConfirm}">پاک‌کردن ماه</button>
        </div>
        <div class="note">حالت ویرایش فعال است: با انتخاب قلم می‌توانید روی خانه‌ها کلیک کنید یا بکشید. پس از اتمام کار، دکمهٔ «قفل ویرایش» را بزنید.</div>
      </div>`
    : '';
  return `${sampleBar}
    ${monthNav(`<span class="sp"></span>${deptSelect('f-dept', ui.dept, true)}<span class="sp"></span>${editBtn}${exportBtns('sched')}`)}
    ${editControls}
    ${autoState.open && canEdit() && ui.editMode ? autoPanel() : ''}
    ${ps.length ? `<div class="rwrap"><table class="roster" id="roster"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
      : `<div class="panel empty"><b>هنوز پرسنلی در این نما نیست</b><span>از تب «پرسنل» نفرات را اضافه کنید، سپس اینجا شیفت‌ها را بکشید.</span><button class="btn primary" data-tab="people">رفتن به پرسنل</button></div>`}
    ${legend}<div id="side" class="rows" style="flex-direction:column;align-items:stretch;gap:8px">${sideHtml(ps, ctx)}</div>`;
}
let sideQueued = false;
function refreshSide() {
  if (sideQueued) return;
  sideQueued = true;
  requestAnimationFrame(() => { sideQueued = false; const el = $('#side'); if (el && ui.ctx && ui.tab === 'sched') el.innerHTML = sideHtml(visiblePeople(), ui.ctx); });
}
function refreshRow(pid) {
  const p = person(pid), tr = $(`tr[data-pid="${pid}"]`);
  if (p && tr && ui.ctx) {
    const t = document.createElement('tbody');
    t.innerHTML = rowHtml(p, ui.ctx);
    tr.replaceWith(t.firstElementChild);
  }
  refreshSide();
}

/* ---------- تب: تقویم فرد ---------- */
function viewPcal() {
  const ps = sortedPeople();
  if (!ps.length) {
    return canConfig() || !isServer()
      ? `<div class="panel empty"><b>پرسنلی ثبت نشده</b><button class="btn primary" data-tab="people">افزودن پرسنل</button></div>`
      : `<div class="panel empty"><b>حساب شما به هیچ فردی در فهرست پرسنل وصل نشده است</b><span>از مدیر سیستم بخواهید حساب شما را به نام خودتان وصل کند.</span></div>`;
  }
  if (!person(ui.pcalPerson)) ui.pcalPerson = ps[0].id;
  const picker = ps.length > 1
    ? `<select id="pcal-person" aria-label="فرد">${ps.map((p) => `<option value="${p.id}"${p.id === ui.pcalPerson ? ' selected' : ''}>${esc(pname(p))}</option>`).join('')}</select>`
    : `<b>${esc(pname(ps[0]))}</b>`;
  const editBtn = canEdit()
    ? `<button class="btn ${ui.editMode ? 'primary' : ''}" data-act="toggleedit" style="display:inline-flex;align-items:center;gap:6px">
        <span>${ui.editMode ? '🔒 قفل و اتمام ویرایش' : '✏️ فعال‌سازی ویرایش شیفت‌ها'}</span>
      </button>`
    : '';
  return `${monthNav(`<span class="sp"></span>${picker}<span class="sp"></span>${editBtn}`)}
    <div class="panel">${canEdit() && ui.editMode ? brushBar() + `<div class="bar" style="flex-wrap:wrap;gap:6px">${paintDeptSelect('paint-dept-pcal')}</div>` : ''}<div id="pcal-body">${pcalBody()}</div></div>`;
}
function pcalBody() {
  const p = person(ui.pcalPerson); if (!p) return '';
  const { a, len, b } = monthInfo();
  const hm = holidayMap(DB.cfg.settings, DB.cfg.holidays, a, b);
  const mine = DB.assign[p.id] || {};
  const iss = restIssues(dbv(), p);
  const r = computeRange(dbv(), p, a, b, hm);
  const T = todayJdn(), color = deptColor(p);
  let h = WD_FULL.map((w) => `<div class="wh">${w}</div>`).join('');
  for (let i = 0; i < weekdayOf(a); i++) h += '<div class="pc-day blank"></div>';
  for (let i = 0; i < len; i++) {
    const j = a + i;
    const cd = cellDept(p.id, j);
    const dName = cd && cd !== p.deptId ? (dept(cd) || {}).name : '';
    h += `<div class="pc-day cell${hm[j] ? ' hol' : ''}${j === T ? ' today' : ''}${iss[j] ? ' warn' : ''}${canEdit() ? '' : ' ro'}" data-pid="${p.id}" data-j="${j}"${canEdit() ? ' role="button" tabindex="0"' : ''}${iss[j] ? ` title="${esc(iss[j].join(' / '))}"` : ''}><div class="d"><span>${fa(i + 1)}</span>${hm[j] ? `<em>${esc(hm[j].name)}</em>` : ''}</div>${chipHtml(mine[j], cellColor(p.id, j), dName)}</div>`;
  }
  const ot = r.overtime;
  const st = (l, v, cls) => `<div class="stat ${cls || ''}"><small>${l}</small><b>${hmH(v)}</b></div>`;
  return `<div class="stats">${st('موظفی ماه', r.duty)}${st('کارکرد واقعی', r.actual)}${st('کارکرد با ضریب تعطیلی', r.weighted)}${st('اعتبار مرخصی/استعلاجی', r.credit)}${st(ot < 0 ? 'کسری' : 'اضافه‌کار', ot, ot < 0 ? 'neg' : ot > 0 ? 'pos' : '')}</div>
    <div class="pcal">${h}</div>`;
}
function refreshPcal() { const el = $('#pcal-body'); if (el) el.innerHTML = pcalBody(); }

/* ---------- تب: پرسنل ---------- */
function viewPeople() {
  const e = person(ui.editPerson) || {};
  const ps = sortedPeople();
  const patterns = (DB.cfg.settings && DB.cfg.settings.officePatterns) || defaultOfficePatterns();
  const curWorkType = e.workType || 'rotating';
  const form = `<form class="panel" id="f-person" autocomplete="off">
    <h2>${e.id ? 'ویرایش پرسنل' : 'افزودن پرسنل'}</h2>
    <div class="formgrid">
      <label class="f">نام<input type="text" name="first" required value="${esc(e.first)}"></label>
      <label class="f">نام خانوادگی<input type="text" name="last" required value="${esc(e.last)}"></label>
      <label class="f">کد پرسنلی<input type="text" name="code" dir="ltr" value="${esc(e.code)}"></label>
      <label class="f">شمارهٔ تماس<input type="tel" name="phone" dir="ltr" value="${esc(e.phone)}"></label>
      <label class="f">نوع خدمت<select name="workType" id="p-work-type">${Object.keys(WORK_TYPES).map((k) => `<option value="${k}"${curWorkType === k ? ' selected' : ''}>${WORK_TYPES[k]}</option>`).join('')}</select></label>
      <label class="f" id="f-off-pat" style="${curWorkType === 'office' ? '' : 'display:none'}">الگوی کاری اداری<select name="officePatternId">${patterns.map((pt) => `<option value="${esc(pt.id)}"${(e.officePatternId || patterns[0].id) === pt.id ? ' selected' : ''}>${esc(pt.name)}</option>`).join('')}</select></label>
      <label class="f">نوع قرارداد<select name="contract">${Object.keys(CONTRACTS).map((k) => `<option value="${k}"${(e.contract || 'company') === k ? ' selected' : ''}>${CONTRACTS[k]}</option>`).join('')}</select></label>
      <label class="f">بخش اصلی<select name="deptId"><option value="">بدون بخش</option>${DB.cfg.depts.map((d) => `<option value="${esc(d.id)}"${e.deptId === d.id ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
    </div>
    <fieldset style="border:1px solid var(--line);border-radius:6px;padding:8px 12px">
      <legend class="note">بخش‌های فرعی (این فرد در این بخش‌ها هم شیفت می‌دهد)</legend>
      <div class="rows">${DB.cfg.depts.map((d) => `<label class="chk"><input type="checkbox" name="extraDept" value="${esc(d.id)}"${(e.extraDeptIds || []).includes(d.id) ? ' checked' : ''}><span class="dot" style="--dc:${esc(d.color)}"></span>${esc(d.name)}</label>`).join('') || '<span class="note">هنوز بخشی تعریف نشده است.</span>'}</div>
    </fieldset>
    <div class="bar"><button class="btn primary" type="submit">${e.id ? 'ذخیرهٔ تغییرات' : 'افزودن'}</button>${e.id ? '<button class="btn" type="button" data-act="cancelperson">انصراف</button>' : ''}<span id="f-person-msg"></span></div>
    ${DB.cfg.depts.length ? '' : '<div class="note">برای دسته‌بندی با رنگ، ابتدا از تب «بخش‌ها» بخش بسازید.</div>'}
  </form>`;
  const list = ps.length
    ? `<div class="tw"><table class="t"><thead><tr><th>کد</th><th>نام</th><th>بخش</th><th>نوع خدمت</th><th>قرارداد</th><th>تماس</th><th></th></tr></thead><tbody>
      ${ps.map((p) => {
        const isOff = p.workType === 'office';
        const pat = isOff ? (patterns.find((x) => x.id === p.officePatternId) || patterns[0]) : null;
        const wtLabel = isOff ? `<span class="pill" style="background:#e0f2fe;color:#0369a1;border-color:#bae6fd" title="${esc(pat ? pat.name : '')}">اداری</span>` : '<span class="pill">در گردش</span>';
        const deptCell = personDepts(p).map((id) => { const d = dept(id); return d ? `<span class="dot" style="--dc:${esc(d.color)}"></span>${esc(d.name)}` : ''; }).filter(Boolean).join('، ') || '—';
        return `<tr><td>${esc(p.code || '—')}</td><td>${esc(pname(p))}</td><td>${deptCell}</td><td>${wtLabel}</td><td><span class="pill">${CONTRACTS[p.contract] || ''}</span></td><td dir="ltr" style="text-align:right">${esc(p.phone || '—')}</td>
        <td><button class="btn sm" data-act="editperson" data-id="${p.id}">ویرایش</button> <button class="btn sm danger" data-act="delperson" data-id="${p.id}" data-confirm="${isServer() ? 'حذف شود؟ اگر حساب کاربری، درخواست، ترجیحات، خواسته یا سابقهٔ برنامه داشته باشد حذف نمی‌شود' : 'حذف با همهٔ برنامه‌هایش؟ قابل بازگشت نیست'}">حذف</button></td></tr>`;
      }).join('')}
      </tbody></table></div>`
    : `<div class="panel empty"><b>پرسنلی ثبت نشده</b><span>فرم بالا را پر کنید.</span></div>`;
  return `<div class="split">${form}<div style="display:flex;flex-direction:column;gap:10px;min-width:0"><h2>${N(fa(ps.length))} نفر</h2>${list}</div></div>`;
}

/* ---------- تب: بخش‌ها ---------- */
const PALETTE = ['#e0573f', '#2f7dd1', '#2e9e7a', '#8b5cd6', '#d9a21b', '#d6479b', '#4a8c9f', '#7a8450'];
function viewDepts() {
  const rows = DB.cfg.depts.map((d) => {
    const n = DB.cfg.people.filter((p) => belongsToDept(p, d.id)).length;
    return `<tr><td><input type="color" data-dcolor="${esc(d.id)}" value="${esc(d.color)}" aria-label="رنگ ${esc(d.name)}"></td>
      <td><input type="text" data-dname="${esc(d.id)}" value="${esc(d.name)}" aria-label="نام بخش"></td><td>${N(fa(n))} نفر</td>
      <td><button class="btn sm danger" data-act="deldept" data-id="${esc(d.id)}" data-confirm="حذف بخش؟">حذف</button></td></tr>`;
  }).join('');
  return `<div class="split"><form class="panel" id="f-dept" autocomplete="off"><h2>بخش جدید</h2>
    <div class="formgrid"><label class="f">نام بخش<input type="text" name="name" required placeholder="مثلاً اورژانس"></label>
    <label class="f">رنگ<input type="color" name="color" value="${PALETTE[DB.cfg.depts.length % PALETTE.length]}"></label></div>
    <div class="bar"><button class="btn primary" type="submit">افزودن بخش</button></div>
    <div class="note">رنگ هر بخش در تقویم روی نوار کنار نام و خانه‌های شیفت پرسنل آن بخش دیده می‌شود. تعداد بخش‌ها محدود نیست.</div></form>
    <div style="min-width:0">${DB.cfg.depts.length ? `<div class="tw"><table class="t"><thead><tr><th>رنگ</th><th>نام</th><th>پرسنل</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="panel empty"><b>هنوز بخشی نیست</b></div>'}</div></div>`;
}

/* ---------- تب: شیفت‌ها ---------- */
function viewShifts() {
  const isOffTab = ui.shiftTab === 'office';
  const subnav = `<div class="bar" style="margin-bottom:12px;border-bottom:1px solid var(--bd);padding-bottom:8px">
    <button class="btn${!isOffTab ? ' primary' : ''}" data-act="shifttab" data-sub="hospital">شیفت‌های بیمارستانی و در گردش</button>
    <button class="btn${isOffTab ? ' primary' : ''}" data-act="shifttab" data-sub="office">الگوهای شیفت اداری</button>
  </div>`;
  return subnav + (isOffTab ? viewOfficePatterns() : viewHospitalShifts());
}

function viewHospitalShifts() {
  const sh = DB.cfg.shifts;
  const rows = sh.map((s) => {
    const ivs = shiftIvs(sh, s.code);
    return `<tr><td><b>${esc(s.code)}</b></td><td>${esc(s.name)}</td><td>${s.kind === 'combo' ? 'ترکیبی' : 'ساده'}</td><td dir="rtl">${ivText(ivs)}</td><td class="n">${hmH(ivsMinutes(ivs))}</td>
      <td><button class="btn sm" data-act="editshift" data-id="${esc(s.code)}">ویرایش</button> <button class="btn sm danger" data-act="delshift" data-id="${esc(s.code)}" data-confirm="حذف شیفت؟">حذف</button></td></tr>`;
  }).join('');
  const d = ui.shiftDraft;
  let editor = `<div class="panel empty"><span>برای ساخت شیفت دلخواه:</span><button class="btn primary" data-act="newshift">شیفت جدید</button></div>`;
  if (d) {
    const simples = sh.filter((s) => s.kind !== 'combo' && s.code !== d.orig);
    const segRows = (d.segs || []).map((g, i) => `<div class="seg-row">
      <label class="f">از ساعت<input type="text" dir="ltr" size="6" data-sg="${i}:s" value="${esc(g.s)}" inputmode="numeric"></label>
      <label class="f">تا ساعت<input type="text" dir="ltr" size="6" data-sg="${i}:e" value="${esc(g.e)}" inputmode="numeric"></label>
      <label class="f">شروع در<select data-sg="${i}:o"><option value="0"${!g.o ? ' selected' : ''}>همان روز</option><option value="1"${g.o === 1 ? ' selected' : ''}>روز بعد</option></select></label>
      <button class="btn sm danger" type="button" data-act="rmseg" data-i="${i}">حذف</button></div>`).join('');
    const refRows = (d.refs || []).map((r, i) => `<div class="seg-row">
      <label class="f">شیفت<select data-rf="${i}:code">${simples.map((s) => `<option value="${esc(s.code)}"${r.code === s.code ? ' selected' : ''}>${esc(s.code)} — ${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f">در<select data-rf="${i}:o"><option value="0"${!r.o ? ' selected' : ''}>همان روز</option><option value="1"${r.o === 1 ? ' selected' : ''}>روز بعد</option></select></label>
      <button class="btn sm danger" type="button" data-act="rmref" data-i="${i}">حذف</button></div>`).join('');
    editor = `<form class="panel" id="f-shift" autocomplete="off"><h2>${d.orig ? 'ویرایش شیفت ' + esc(d.orig) : 'شیفت جدید'}</h2>
      <div class="formgrid">
        <label class="f">کد (۱ تا ۳ حرف انگلیسی)<input type="text" dir="ltr" maxlength="3" data-sd="code" value="${esc(d.code)}"${d.orig ? ' readonly' : ''}></label>
        <label class="f">نام<input type="text" data-sd="name" value="${esc(d.name)}"></label>
        <label class="f">نوع<select data-sd="kind"><option value="simple"${d.kind !== 'combo' ? ' selected' : ''}>ساده (بازهٔ زمانی)</option><option value="combo"${d.kind === 'combo' ? ' selected' : ''}>ترکیبی (از شیفت‌های ساده)</option></select></label>
      </div>
      ${d.kind === 'combo' ? `${refRows}<div><button class="btn sm" type="button" data-act="addref">+ افزودن شیفت به ترکیب</button></div>`
        : `${segRows}<div><button class="btn sm" type="button" data-act="addseg">+ افزودن بازهٔ زمانی</button></div>`}
      <div class="note">اگر ساعت پایان از شروع کمتر باشد، شیفت از نیمه‌شب می‌گذرد. بازه‌های هم‌پوشان فقط یک‌بار شمرده می‌شوند.</div>
      <div id="sd-prev" class="note"></div><div id="f-shift-msg"></div>
      <div class="bar"><button class="btn primary" type="submit">ذخیره</button><button class="btn" type="button" data-act="cancelshift">انصراف</button></div></form>`;
  }
  return `<div class="tw"><table class="t"><thead><tr><th>کد</th><th>نام</th><th>نوع</th><th>بازه‌ها</th><th class="n">مدت</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${editor}`;
}

function viewOfficePatterns() {
  const patterns = (DB.cfg.settings && DB.cfg.settings.officePatterns) || defaultOfficePatterns();
  const d = ui.editOfficePattern;
  const listRows = patterns.map((p) => {
    const summary = [0, 1, 2, 3, 4, 5, 6].map((wd) => {
      const day = p.days[wd] || p.days[String(wd)];
      if (!day || !day.active) return `${WD_SHORT[wd]}: تعطیل`;
      return `${WD_SHORT[wd]}: \u202B${fa(day.s)} تا ${fa(day.e)}\u202C`;
    }).join(' | ');
    return `<tr><td><b>${esc(p.name)}</b></td><td dir="rtl" style="font-size:12px">${esc(summary)}</td>
      <td><button class="btn sm" data-act="editoffpat" data-id="${esc(p.id)}">ویرایش</button> ${patterns.length > 1 ? `<button class="btn sm danger" data-act="deloffpat" data-id="${esc(p.id)}" data-confirm="حذف این الگوی اداری؟">حذف</button>` : ''}</td></tr>`;
  }).join('');

  let editor = `<div class="panel empty"><span>برای ساخت الگوی ساعات کاری اداری جدید:</span><button class="btn primary" data-act="newoffpat">الگوی اداری جدید</button></div>`;
  if (d) {
    const dayRows = [0, 1, 2, 3, 4, 5, 6].map((wd) => {
      const cur = (d.days && (d.days[wd] || d.days[String(wd)])) || { active: wd !== 6, s: '07:30', e: '14:15' };
      return `<tr data-wd="${wd}">
        <td><b>${WD_FULL[wd]}</b></td>
        <td><label class="chk" style="margin:0"><input type="checkbox" data-opd="${wd}:active"${cur.active ? ' checked' : ''}> روز کاری</label></td>
        <td><input type="text" dir="ltr" size="6" data-opd="${wd}:s" value="${esc(cur.s)}" ${!cur.active ? 'disabled' : ''} inputmode="numeric"></td>
        <td><input type="text" dir="ltr" size="6" data-opd="${wd}:e" value="${esc(cur.e)}" ${!cur.active ? 'disabled' : ''} inputmode="numeric"></td>
      </tr>`;
    }).join('');

    editor = `<form class="panel" id="f-offpat" autocomplete="off">
      <h2>${d.origId ? 'ویرایش الگوی اداری' : 'الگوی اداری جدید'}</h2>
      <div class="formgrid">
        <label class="f" style="grid-column:1/-1">نام الگو (مثلاً: پاییز و زمستان ۷ تا ۱۳، یا پیش‌فرض استاندارد)<input type="text" name="name" id="offpat-name" required value="${esc(d.name)}"></label>
      </div>

      <div class="panel" style="background:var(--surface2);padding:10px;border-radius:6px;gap:8px">
        <div style="font-weight:600;font-size:13px">⚡ تنظیم سریع (اعمال به همه روزها):</div>
        <div class="bar" style="flex-wrap:wrap;gap:8px">
          <label class="rows"><span class="note">از ساعت:</span><input type="text" id="quick-off-s" dir="ltr" size="6" value="07:00" inputmode="numeric"></label>
          <label class="rows"><span class="note">تا ساعت:</span><input type="text" id="quick-off-e" dir="ltr" size="6" value="13:00" inputmode="numeric"></label>
          <button class="btn sm" type="button" data-act="applyquickall">اعمال به همه (شنبه تا پنجشنبه)</button>
          <button class="btn sm" type="button" data-act="applyquick5d">اعمال به شنبه تا چهارشنبه (پنجشنبه تعطیل)</button>
        </div>
      </div>

      <div class="tw" style="margin:10px 0">
        <table class="t"><thead><tr><th>روز هفته</th><th>وضعیت</th><th>از ساعت</th><th>تا ساعت</th></tr></thead>
        <tbody>${dayRows}</tbody></table>
      </div>
      <div class="note">می‌توانید ساعت هر روز هفته را مستقلاً تنظیم کنید یا با ابزار «تنظیم سریع» بالا با یک کلیک ساعت دلخواه را برای روزها پر کنید.</div>
      <div id="f-offpat-msg"></div>
      <div class="bar"><button class="btn primary" type="submit">ذخیرهٔ الگو</button><button class="btn" type="button" data-act="canceloffpat">انصراف</button></div>
    </form>`;
  }

  return `<div class="tw"><table class="t"><thead><tr><th>نام الگو</th><th>برنامهٔ روزهای هفته</th><th></th></tr></thead><tbody>${listRows}</tbody></table></div>${editor}`;
}
function shiftDraftPreview() {
  const d = ui.shiftDraft, el = $('#sd-prev'); if (!d || !el) return;
  const tmp = Object.assign({}, d, { code: d.code || 'TMP' });
  const list = DB.cfg.shifts.filter((s) => s.code !== tmp.code).concat([tmp]);
  const ivs = shiftIvs(list, tmp.code);
  el.innerHTML = ivs.length ? `مدت محاسبه‌شده: ${hmH(ivsMinutes(ivs))} (${N(ivText(ivs))})` : '';
}

/* ---------- تب: تعطیلات ---------- */
function viewHol() {
  const S = DB.cfg.settings;
  const sorted = DB.cfg.holidays.slice().sort((x, y) => x.jm - y.jm || x.jd - y.jd);
  const year = ui.jy;
  const yearList = [];
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= monthLen(year, m); d++) {
    const j = j2d(year, m, d), info = holidayInfo(S, DB.cfg.holidays, j);
    if (info && info.type === 'official') yearList.push({ j, name: info.name });
  }
  return `<div class="panel"><label class="chk"><input type="checkbox" data-set="fridayHoliday"${S.fridayHoliday ? ' checked' : ''}> جمعه‌ها تعطیل رسمی‌اند (از موظفی کم می‌شوند و ضریب تعطیلی می‌گیرند)</label>
    <div class="note">تعطیلی از ساعت ۰۰:۰۰ بامداد تا ۲۴:۰۰ همان روز حساب می‌شود. تعطیلات ثابت شمسی از قبل ثبت شده‌اند؛ مناسبت‌های قمری (تاسوعا، عاشورا، عید فطر و…) هر سال تغییر می‌کنند و باید با تقویم رسمی همان سال اضافه شوند.</div></div>
    <div class="split"><form class="panel" id="f-hol" autocomplete="off"><h2>افزودن تعطیلی</h2>
      <div class="formgrid"><label class="f">ماه<select name="jm">${MONTHS.map((m, i) => `<option value="${i + 1}"${i + 1 === ui.jm ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="f">روز<input type="number" name="jd" min="1" max="31" required></label>
      <label class="f">نام مناسبت<input type="text" name="name" required></label></div>
      <label class="chk"><input type="checkbox" name="every"> هر سال تکرار شود (برای مناسبت‌های ثابت شمسی)</label>
      <label class="f" style="max-width:140px">اگر تکرار نمی‌شود، سال<input type="number" name="jy" value="${year}"></label>
      <div class="bar"><button class="btn primary" type="submit">افزودن</button><span id="f-hol-msg"></span></div></form>
      <div style="display:flex;flex-direction:column;gap:12px;min-width:0">
        <h2>تعطیلات رسمی سال ${N(fa(year))} (بدون جمعه‌ها)</h2>
        <div class="tw"><table class="t"><thead><tr><th>تاریخ</th><th>روز</th><th>مناسبت</th></tr></thead><tbody>
        ${yearList.map((x) => `<tr><td>${N(fmtDate(x.j))}</td><td>${WD_FULL[weekdayOf(x.j)]}</td><td>${esc(x.name)}</td></tr>`).join('') || '<tr><td colspan="3">موردی نیست</td></tr>'}</tbody></table></div>
        <h2>فهرست تعریف‌شده</h2>
        <div class="tw"><table class="t"><thead><tr><th>تاریخ</th><th>مناسبت</th><th>تکرار</th><th></th></tr></thead><tbody>
        ${sorted.map((h) => `<tr><td>${fa(h.jd)} ${MONTHS[h.jm - 1]}</td><td>${esc(h.name)}</td><td>${h.jy ? 'فقط ' + fa(h.jy) : 'هر سال'}</td><td><button class="btn sm danger" data-act="delhol" data-id="${esc(h.id)}">حذف</button></td></tr>`).join('')}</tbody></table></div>
      </div></div>`;
}

/* ---------- تب: گزارش‌ها ---------- */
const repDept = () => { const el = $('#rep-dept'); return el ? el.value : 'all'; };
function repRange() {
  const { a, b } = monthInfo();
  if (ui.rep.from == null) { ui.rep.from = a; ui.rep.to = b; }
  return { from: ui.rep.from, to: ui.rep.to };
}
/**
 * گزارش: هر ردیف هم جمعِ کل نفر (r) را دارد و هم تفکیک بر اساس بخشِ خانه (split).
 * وقتی یک بخش مشخص انتخاب شده باشد، slice همان بخش است و ستون‌های ساعتی همان
 * برش را نشان می‌دهند؛ موظفی و اضافه/کسر سطحِ نفرند و برای برشِ یک بخش تعریف
 * نمی‌شوند، پس در آن حالت «—» می‌شوند. در نمای «همه» ردیف‌ها جمعِ کل‌اند و
 * جدولِ «برنامهٔ کلی بخش‌ها» بر اساس بخشِ خانه جمع می‌شود.
 */
function buildReport() {
  const { from, to } = repRange();
  const hm = holidayMap(DB.cfg.settings, DB.cfg.holidays, from, to);
  let ps = sortedPeople();
  if (ui.rep.dept === 'none') ps = ps.filter((p) => !personDepts(p).length);
  else if (ui.rep.dept !== 'all') ps = ps.filter((p) => belongsToDept(p, ui.rep.dept));
  const rows = ps.map((p) => {
    const r = computeRange(dbv(), p, from, to, hm);
    const split = Core.computeDeptSplit(dbv(), p, from, to, hm);
    const slice = (ui.rep.dept !== 'all' && ui.rep.dept !== 'none')
      ? (split[ui.rep.dept] || { actual: 0, weighted: 0, credit: 0, counts: {} })
      : null;
    return { p, r, split, slice };
  });
  const used = new Set();
  rows.forEach((x) => Object.keys((x.slice || x.r).counts).forEach((k) => used.add(k)));
  const shiftCols = DB.cfg.shifts.map((s) => s.code).filter((c) => used.has(c));
  const spCols = Object.keys(SPECIAL).filter((c) => used.has(c));
  return { from, to, rows, shiftCols, spCols, hm };
}
/** مقادیر نمایشی یک ردیف گزارش: برشِ بخش، یا جمعِ کل */
const repVals = (x) => x.slice || x.r;
const repDuty = (x) => (x.slice ? null : x.r.duty);
const repOvertime = (x) => (x.slice ? null : x.r.overtime);
const hmOrDash = (v) => (v == null ? '—' : hmH(v));
function viewRep() {
  const R = buildReport();
  const cap = DB.cfg.settings.otCapH * 60;
  const days = R.to - R.from + 1;
  const tot = { duty: 0, actual: 0, weighted: 0, credit: 0, overtime: 0 };
  const sliced = R.rows.some((x) => x.slice);
  R.rows.forEach((x) => {
    const v = repVals(x);
    tot.actual += v.actual; tot.weighted += v.weighted; tot.credit += v.credit;
    if (!x.slice) { tot.duty += x.r.duty; tot.overtime += x.r.overtime; }
  });
  const head = `<th>کد</th><th>نام</th><th>بخش</th><th>نوع خدمت</th><th>قرارداد</th><th class="n">موظفی</th><th class="n">کارکرد واقعی</th><th class="n">با ضریب</th><th class="n">اعتبار مرخصی</th><th class="n">اضافه / کسر</th>
    ${R.shiftCols.map((c) => `<th class="n">${esc(c)}</th>`).join('')}${R.spCols.map((c) => `<th class="n">${SPECIAL[c].name}</th>`).join('')}`;
  const body = R.rows.map((x) => {
    const { p } = x, v = repVals(x), duty = repDuty(x), ot = repOvertime(x);
    const deptCell = ui.rep.dept !== 'all' && ui.rep.dept !== 'none'
      ? ((dept(ui.rep.dept) || {}).name || '—')
      : personDeptNames(p, x.split);
    return `<tr><td>${esc(p.code || '—')}</td><td>${esc(pname(p))}</td><td>${esc(deptCell)}</td><td>${p.workType === 'office' ? '<span class="pill" style="background:#e0f2fe;color:#0369a1;border-color:#bae6fd">اداری</span>' : '<span class="pill">در گردش</span>'}</td><td>${CONTRACTS[p.contract] || ''}</td>
    <td class="n">${hmOrDash(duty)}</td><td class="n">${hmH(v.actual)}</td><td class="n">${hmH(v.weighted)}</td><td class="n">${hmH(v.credit)}</td>
    <td class="n" style="${ot != null && ot < 0 ? 'color:var(--hol-ink)' : ot != null && cap > 0 && ot > cap ? 'color:var(--warn);font-weight:700' : ''}">${hmOrDash(ot)}</td>
    ${R.shiftCols.map((c) => `<td class="n">${v.counts[c] ? fa(v.counts[c]) : '·'}</td>`).join('')}${R.spCols.map((c) => `<td class="n">${v.counts[c] ? fa(v.counts[c]) : '·'}</td>`).join('')}</tr>`;
  }).join('');
  const foot = `<tr><td colspan="5">جمع</td><td class="n">${sliced ? '—' : hmH(tot.duty)}</td><td class="n">${hmH(tot.actual)}</td><td class="n">${hmH(tot.weighted)}</td><td class="n">${hmH(tot.credit)}</td><td class="n">${sliced ? '—' : hmH(tot.overtime)}</td><td colspan="${R.shiftCols.length + R.spCols.length}"></td></tr>`;
  // جمع‌بندی بخش‌ها بر اساس بخشِ خانهٔ شیفت (نه بخشِ نفر)؛ «نفر» یعنی نفراتِ متمایزِ دارای شیفت در آن بخش
  const groups = {};
  R.rows.forEach((x) => {
    for (const k in x.split) {
      const s = x.split[k];
      const g = (groups[k] = groups[k] || { persons: new Set(), actual: 0, weighted: 0, credit: 0, counts: {} });
      g.persons.add(x.p.id); g.actual += s.actual; g.weighted += s.weighted; g.credit += s.credit;
      for (const c in s.counts) g.counts[c] = (g.counts[c] || 0) + s.counts[c];
    }
  });
  const gRows = Object.keys(groups).map((k) => {
    const g = groups[k], d = dept(k);
    return `<tr><td>${d ? `<span class="dot" style="--dc:${esc(d.color)}"></span>${esc(d.name)}` : 'بدون بخش'}</td><td class="n">${N(fa(g.persons.size))}</td><td class="n">${hmH(g.actual)}</td><td class="n">${hmH(g.weighted)}</td><td class="n">${hmH(g.credit)}</td>
      ${R.shiftCols.map((c) => `<td class="n">${g.counts[c] ? fa(g.counts[c]) : '·'}</td>`).join('')}</tr>`;
  }).join('');
  return `<div class="panel"><div class="bar">
      <label class="f">از تاریخ<input type="text" id="rep-from" data-dp dir="ltr" size="11" value="${fmtDateLatin(R.from)}"></label>
      <label class="f">تا تاریخ<input type="text" id="rep-to" data-dp dir="ltr" size="11" value="${fmtDateLatin(R.to)}"></label>
      ${role() === 'staff' ? '' : `<label class="f">بخش${deptSelect('rep-dept', ui.rep.dept, true)}</label>`}
      <button class="btn primary" data-act="repgo" style="align-self:flex-end">نمایش</button>
      <span class="sp"></span>
      <button class="btn sm" data-act="repmonth" style="align-self:flex-end">ماهِ انتخاب‌شده</button>
      <button class="btn sm" data-act="repweek" style="align-self:flex-end">هفتهٔ جاری</button>
      <button class="btn sm" data-act="reptoday" style="align-self:flex-end">امروز</button>
      <span class="rows" style="align-self:flex-end;gap:6px">${exportBtns('rep')}<button class="btn" data-act="repcsv">CSV</button></span></div>
    <div class="note">بازه: ${N(fmtDate(R.from))} تا ${N(fmtDate(R.to))} (${N(fa(days))} روز). موظفی هر نفر برای این بازه: ${hmH((days - Object.values(R.hm).filter(Boolean).length) * DB.cfg.settings.dutyMin)}.
    ${sliced ? 'در نمای یک بخش، ستون‌های ساعتی فقط همان بخش را نشان می‌دهند؛ موظفی و اضافه/کسر سطحِ نفرند و خط تیره می‌شوند.' : ''}
    تاریخ را به شکل ۱۴۰۵/۰۷/۲۵ بنویسید.</div><div id="rep-msg"></div></div>
    ${R.rows.length ? `<div class="tw"><table class="t"><thead><tr>${head}</tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>
      <h2>برنامهٔ کلی بخش‌ها</h2>
      <div class="tw"><table class="t"><thead><tr><th>بخش</th><th class="n">نفر</th><th class="n">کارکرد واقعی</th><th class="n">با ضریب</th><th class="n">اعتبار مرخصی</th>${R.shiftCols.map((c) => `<th class="n">تعداد ${esc(c)}</th>`).join('')}</tr></thead><tbody>${gRows}</tbody></table></div>
      <div class="note">جمع‌بندی بخش‌ها بر اساس بخشِ هر شیفت است، نه بخشِ نفر؛ موظفی و اضافه/کسر فقط در سطح نفر معنا دارند و در این جدول نمی‌آیند.</div>`
      : '<div class="panel empty"><b>پرسنلی برای گزارش نیست</b></div>'}`;
}
function csvText() {
  const R = buildReport();
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const h = ['کد پرسنلی', 'نام', 'بخش', 'قرارداد', 'موظفی', 'کارکرد واقعی', 'کارکرد با ضریب', 'اعتبار مرخصی', 'اضافه/کسر', 'اضافه/کسر (ساعت اعشاری)']
    .concat(R.shiftCols.map((c) => 'تعداد ' + c)).concat(R.spCols.map((c) => SPECIAL[c].name));
  const lines = [h.map(q).join(',')];
  const fml = (v) => (v == null ? '' : fmtHMlatin(v));
  R.rows.forEach((x) => {
    const { p } = x, v = repVals(x), duty = repDuty(x), ot = repOvertime(x);
    const deptCell = ui.rep.dept !== 'all' && ui.rep.dept !== 'none' ? ((dept(ui.rep.dept) || {}).name || '') : personDeptNames(p, x.split);
    lines.push([p.code || '', pname(p), deptCell, CONTRACTS[p.contract] || '', fml(duty), fmtHMlatin(v.actual), fmtHMlatin(v.weighted), fmtHMlatin(v.credit), fml(ot), ot == null ? '' : (ot / 60).toFixed(2)]
      .concat(R.shiftCols.map((c) => v.counts[c] || 0)).concat(R.spCols.map((c) => v.counts[c] || 0)).map(q).join(','));
  });
  return { name: `report-${fmtDateLatin(R.from).replace(/\//g, '')}-${fmtDateLatin(R.to).replace(/\//g, '')}.csv`, text: '﻿' + lines.join('\r\n') };
}

/* ---------- خروجی Excel و چاپ/PDF ---------- */
const hrs = (m) => Math.round(m / 60 * 100) / 100;
function xlsxReport() {
  const R = buildReport();
  const hd = (t, s) => ({ v: t, s: s == null ? 1 : s });
  const head = ['کد پرسنلی', 'نام', 'بخش', 'قرارداد', 'موظفی (ساعت)', 'کارکرد واقعی (ساعت)', 'با ضریب (ساعت)', 'اعتبار مرخصی (ساعت)', 'اضافه/کسر (ساعت)']
    .concat(R.shiftCols.map((c) => 'تعداد ' + c)).concat(R.spCols.map((c) => SPECIAL[c].name)).map((t) => hd(t));
  const rows = [head];
  const tot = [0, 0, 0, 0, 0];
  const sliced = R.rows.some((x) => x.slice);
  R.rows.forEach((x) => {
    const { p } = x, v = repVals(x), duty = repDuty(x), ot = repOvertime(x);
    const deptCell = ui.rep.dept !== 'all' && ui.rep.dept !== 'none' ? ((dept(ui.rep.dept) || {}).name || '') : personDeptNames(p, x.split);
    const vals = [duty, v.actual, v.weighted, v.credit, ot];
    vals.forEach((val, i) => { if (val != null) tot[i] += val; });
    rows.push([p.code || '', pname(p), deptCell, CONTRACTS[p.contract] || ''].concat(vals.map((val) => (val == null ? '' : hrs(val))))
      .concat(R.shiftCols.map((c) => ({ v: v.counts[c] || 0, s: 3 }))).concat(R.spCols.map((c) => ({ v: v.counts[c] || 0, s: 3 }))));
  });
  rows.push([hd('جمع', 6), '', '', ''].concat(tot.map((x, i) => ({ v: sliced && (i === 0 || i === 4) ? '' : hrs(x), s: 6 }))));
  const sheets = [{ name: 'گزارش', rows, widths: [12, 22, 16, 11, 13, 15, 13, 15, 14].concat(R.shiftCols.concat(R.spCols).map(() => 10)), freeze: { rows: 1, cols: 2 } }];
  sheets.push({ name: 'راهنما', rows: [[hd('بازه')], [`${fmtDateLatin(R.from)} تا ${fmtDateLatin(R.to)}`], [''], [hd('توضیح')], ['ستون‌های زمانی بر حسب ساعت اعشاری‌اند (۷:۲۰ = ۷٫۳۳). «با ضریب» شامل ضریب تعطیلی قراردادها است.']], widths: [70], freeze: { rows: 0, cols: 0 } });
  return { name: `report-${fmtDateLatin(R.from).replace(/\//g, '')}-${fmtDateLatin(R.to).replace(/\//g, '')}.xlsx`, data: Exporter.xlsx(sheets) };
}
function xlsxRoster() {
  const { a, len, b } = monthInfo();
  const hm = holidayMap(DB.cfg.settings, DB.cfg.holidays, a, b);
  const ps = visiblePeople();
  const hd = (t, s) => ({ v: t, s: s == null ? 1 : s });
  const head = [hd('کد'), hd('نام'), hd('بخش')];
  for (let i = 0; i < len; i++) head.push(hd(`${i + 1}\n${WD_SHORT[weekdayOf(a + i)]}`, hm[a + i] ? 4 : 1));
  head.push(hd('موظفی (ساعت)'), hd('کارکرد (ساعت)'), hd('اضافه/کسر (ساعت)'));
  const rows = [head];
  for (const p of ps) {
    const mine = DB.assign[p.id] || {}, r = computeRange(dbv(), p, a, b, hm);
    const split = Core.computeDeptSplit(dbv(), p, a, b, hm);
    const row = [p.code || '', pname(p), personDeptNames(p, split)];
    for (let i = 0; i < len; i++) {
      const c = mine[a + i];
      row.push({ v: c ? (SPECIAL[c] ? SPECIAL[c].short : c) : '', s: hm[a + i] ? 5 : 3 });
    }
    row.push(hrs(r.duty), hrs(r.weighted + r.credit), hrs(r.overtime));
    rows.push(row);
  }
  const legend = [[''], [hd('راهنما')]].concat(DB.cfg.shifts.map((s) => [s.code, s.name]), Object.keys(SPECIAL).map((k) => [SPECIAL[k].short, SPECIAL[k].name]));
  const sheet = { name: `${MONTHS[ui.jm - 1]} ${ui.jy}`, rows: rows.concat(legend), widths: [10, 22, 14].concat(Array(len).fill(4.5), [12, 12, 14]), freeze: { rows: 1, cols: 2 } };
  return { name: `roster-${ui.jy}-${String(ui.jm).padStart(2, '0')}.xlsx`, data: Exporter.xlsx([sheet]) };
}
/** چاپ همان نمای روی صفحه؛ در پنجرهٔ چاپ مرورگر گزینهٔ «ذخیره به‌صورت PDF» را انتخاب کنید */
function printView(title, sub, sourceEls, isRoster) {
  const old = $('#printarea'); if (old) old.remove();
  const box = document.createElement('div'); box.id = 'printarea';
  box.innerHTML = `<h1>${esc(title)}</h1><div class="psub">${sub}</div>`;
  for (const el of sourceEls) {
    const clone = el.cloneNode(true);
    // حذف قطعی عناصر اضافی (کد، قرارداد، اداری و...) از ساختار DOM در حالت چاپ
    clone.querySelectorAll('th.nm small').forEach((sm) => sm.remove());
    if (isRoster) {
      // در جدول تقویم، ستون‌های محاسباتی (موظفی، کارکرد، اضافه/کسر) چاپ نمی‌شوند
      clone.querySelectorAll('.sum').forEach((td) => td.remove());
      // اصلاح colspan ردیف بخش‌ها متناسب با حذف ۳ ستون محاسباتی
      clone.querySelectorAll('tr.grp td').forEach((td) => {
        const c = parseInt(td.getAttribute('colspan'), 10);
        if (c > 3) td.setAttribute('colspan', String(c - 3));
      });
    }
    box.appendChild(clone);
  }
  document.body.appendChild(box);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); box.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { try { window.print(); } catch (e) { done(); } }, 50);
}
const exportBtns = (kind) => `<button class="btn" data-act="${kind}xlsx">خروجی Excel (xlsx)</button><button class="btn" data-act="${kind}print">PDF / چاپ</button>`;

/* ---------- انتخابگر تاریخ شمسی ---------- */
const DP = { el: null, input: null, jy: 0, jm: 0 };
function dpClose() { if (DP.el) { DP.el.remove(); DP.el = null; DP.input = null; } }
function dpHtml() {
  const first = j2d(DP.jy, DP.jm, 1), len = monthLen(DP.jy, DP.jm), cur = parseDate(DP.input.value), T = todayJdn();
  let hm = {};
  try { hm = holidayMap(DB.cfg.settings, DB.cfg.holidays, first, first + len - 1); } catch (e) { /* بدون تعطیلی */ }
  let cells = '';
  for (let i = 0; i < weekdayOf(first); i++) cells += '<span></span>';
  for (let d = 1; d <= len; d++) {
    const j = first + d - 1;
    cells += `<button type="button" class="dpd${hm[j] ? ' hol' : ''}${j === T ? ' today' : ''}${j === cur ? ' sel' : ''}" data-dpj="${j}"${hm[j] ? ` title="${esc(hm[j].name)}"` : ''}>${fa(d)}</button>`;
  }
  return `<div class="dph"><button type="button" class="btn sm" data-dpm="-12" aria-label="سال قبل">«</button><button type="button" class="btn sm" data-dpm="-1" aria-label="ماه قبل">›</button>
    <b>${MONTHS[DP.jm - 1]} ${fa(DP.jy)}</b>
    <button type="button" class="btn sm" data-dpm="1" aria-label="ماه بعد">‹</button><button type="button" class="btn sm" data-dpm="12" aria-label="سال بعد">»</button></div>
    <div class="dpg">${WD_SHORT.map((w) => `<i>${w}</i>`).join('')}${cells}</div>
    <div class="dpf"><button type="button" class="btn sm" data-dpj="${T}">امروز</button><button type="button" class="btn sm" data-dpx="1">بستن</button></div>`;
}
function dpPlace() {
  const r = DP.input.getBoundingClientRect(), w = 288;
  DP.el.style.top = (r.bottom + window.scrollY + 4) + 'px';
  DP.el.style.left = (Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + window.scrollX) + 'px';
}
function dpOpen(input) {
  dpClose();
  const x = d2j(parseDate(input.value) || todayJdn());
  DP.input = input; DP.jy = x.jy; DP.jm = x.jm;
  DP.el = document.createElement('div'); DP.el.id = 'dp'; DP.el.setAttribute('role', 'dialog'); DP.el.setAttribute('aria-label', 'انتخاب تاریخ');
  DP.el.innerHTML = dpHtml();
  document.body.appendChild(DP.el); dpPlace();
}
document.addEventListener('click', (e) => {
  const inp = e.target.closest('input[data-dp]');
  if (inp) { if (!(DP.el && DP.input === inp)) dpOpen(inp); return; }
  if (!DP.el) return;
  const b = e.target.closest('#dp button');
  if (!b) { if (!e.target.closest('#dp')) dpClose(); return; }
  if (b.dataset.dpx) return dpClose();
  if (b.dataset.dpm) {
    const m = DP.jy * 12 + (DP.jm - 1) + +b.dataset.dpm;
    DP.jy = Math.floor(m / 12); DP.jm = (m % 12) + 1;
    DP.el.innerHTML = dpHtml(); return;
  }
  if (b.dataset.dpj) {
    const inp2 = DP.input; inp2.value = fmtDateLatin(+b.dataset.dpj);
    inp2.dispatchEvent(new Event('input', { bubbles: true })); inp2.dispatchEvent(new Event('change', { bubbles: true }));
    dpClose();
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && DP.el) dpClose(); });
window.addEventListener('resize', () => { if (DP.el) dpPlace(); });

/* ---------- پیشنهاد خودکار برنامه ---------- */
const autoState = { open: false, need: {}, maxConsec: 6, capH: null, result: null, msg: '' };
function simpleShifts() { return DB.cfg.shifts.filter((s) => s.kind !== 'combo'); }
function autoDefaults() {
  if (autoState.capH == null) autoState.capH = DB.cfg.settings.otCapH > 0 ? DB.cfg.settings.otCapH : 12;
  for (const s of simpleShifts()) if (autoState.need[s.code] == null) autoState.need[s.code] = ['M', 'A', 'N'].includes(s.code) ? 1 : 0;
}
function autoPanel() {
  autoDefaults();
  const ps = visiblePeople();
  const fields = simpleShifts().map((s) => `<label class="f">${esc(s.code)} — ${esc(s.name)}<input type="number" min="0" max="50" data-need="${esc(s.code)}" value="${autoState.need[s.code]}" dir="ltr"></label>`).join('');
  let res = '';
  const R = autoState.result;
  if (R) {
    const { a, b } = monthInfo();
    const byP = new Map(R.summary.map((x) => [x.pid, x]));
    const added = {}; R.changes.forEach((c) => { added[c.pid] = (added[c.pid] || 0) + 1; });
    const un = R.unfilled.slice(0, 40).map((u) => `<li>${N(fmtDate(u.j))}: شیفت ${esc(u.code)} — ${N(fa(u.missing))} نفر کم است</li>`).join('');
    res = `<div class="note">${N(fa(R.changes.length))} خانه پیشنهاد شد${R.unfilled.length ? `؛ ${N(fa(R.unfilled.length))} مورد کمبود (به‌دلیل فاصلهٔ استراحت، روز کاریِ پیاپی یا سقف اضافه‌کار)` : '؛ همهٔ نیازها پوشش داده شد'}.</div>
      ${wishBlock(R)}
      ${un ? `<details class="warns"><summary>کمبودها</summary><ul>${un}</ul></details>` : ''}
      <div class="tw"><table class="t"><thead><tr><th>نام</th><th class="n">شیفت جدید</th><th class="n">کارکرد پس از اعمال</th><th class="n">موظفی</th><th class="n">اضافه / کسر</th></tr></thead><tbody>${ps.map((p) => {
    const x = byP.get(p.id); if (!x) return '';
    return `<tr><td>${esc(pname(p))}</td><td class="n">${N(fa(added[p.id] || 0))}</td><td class="n">${hmH(x.load)}</td><td class="n">${hmH(x.target)}</td><td class="n">${hmH(x.load - x.target)}</td></tr>`;
  }).join('')}</tbody></table></div>
      <div class="bar"><button class="btn primary" data-act="autoapply"${R.changes.length ? '' : ' disabled'}>اعمال روی برنامه</button><span class="note">قابل بازگردانی با «بازگردانی آخرین تغییر».</span></div>`;
  }
  return `<div class="panel" id="autopanel"><h2>پیشنهاد خودکار برنامهٔ ${MONTHS[ui.jm - 1]} ${fa(ui.jy)}</h2>
    <div class="note">فقط خانه‌های خالیِ افراد نمای فعلی پر می‌شود؛ شیفت‌ها و مرخصی‌های ثبت‌شده دست نمی‌خورند و در پوشش هر روز حساب می‌شوند. تعداد نفرِ لازم در هر روز برای هر شیفت را بنویسید.</div>
    <div class="rows" style="gap:12px;flex-wrap:wrap">${fields}
      <label class="f">حداکثر روز کاری پشت‌سرهم<input type="number" min="1" max="31" id="auto-consec" value="${autoState.maxConsec}" dir="ltr"></label>
      <label class="f">سقف اضافه‌کار هر نفر (ساعت)<input type="number" min="0" max="200" id="auto-cap" value="${autoState.capH}" dir="ltr"></label></div>
    ${isServer() ? `<label class="rows"><input type="checkbox" id="auto-prefs"${autoState.usePrefs === false ? '' : ' checked'}> <span>لحاظ کردن ترجیحات و درخواست روزهای پرسنل (تب «ترجیحات»)</span></label>` : ''}
    ${autoState.msg ? `<div class="msg${/اضافه شد/.test(autoState.msg) ? ' ok' : ''}">${esc(autoState.msg)}</div>` : ''}
    <div class="bar"><button class="btn primary" data-act="autorun">محاسبهٔ پیشنهاد</button><button class="btn" data-act="autoclose">بستن</button>
      <span class="note">حداقل فاصلهٔ بین شیفت‌ها: ${N(fa(DB.cfg.settings.minRestH))} ساعت (تنظیمات)</span></div>${res}</div>`;
}
function wishBlock(R) {
  const w = R.wishReport || [];
  if (!w.length) return '';
  const bad = w.filter((x) => !x.ok), ok = w.length - bad.length;
  const line = (x) => { const p = person(x.pid); return `<li>${esc(p ? pname(p) : '؟')} — ${N(fmtDate(x.j))}: ${WISH_KIND[x.kind]}${x.code ? ' (' + esc(x.code) + ')' : ''}</li>`; };
  return `<div class="note">${N(fa(ok))} از ${N(fa(w.length))} درخواست روز رعایت شد.</div>${bad.length ? `<details class="warns" open><summary>${N(fa(bad.length))} درخواست رعایت نشد</summary><ul>${bad.map(line).join('')}</ul></details>` : ''}`;
}
async function autoRun() {
  autoState.msg = '';
  if (ui.dept === 'all' && DB.cfg.depts.length > 1) { autoState.msg = 'ابتدا بالای صفحه یک بخش را انتخاب کنید تا پیشنهاد فقط برای همان بخش محاسبه شود.'; autoState.result = null; return; }
  for (const el of $$('[data-need]')) autoState.need[el.dataset.need] = Math.max(0, Math.min(50, parseInt(toLatin(el.value), 10) || 0));
  autoState.maxConsec = Math.max(1, Math.min(31, parseInt(toLatin($('#auto-consec').value), 10) || 6));
  autoState.capH = Math.max(0, Math.min(200, parseFloat(toLatin($('#auto-cap').value)) || 0));
  const { a, b } = monthInfo();
  if ($('#auto-prefs')) autoState.usePrefs = $('#auto-prefs').checked;
  let prefs, wishes;
  if (isServer() && autoState.usePrefs) { await loadPrefs(); prefs = prefsState.prefs; wishes = prefsState.wishes; }
  autoState.result = Core.suggestSchedule(dbv(), { people: visiblePeople().map((p) => p.id), a, b, need: autoState.need, maxConsec: autoState.maxConsec, capMin: Math.round(autoState.capH * 60), prefs, wishes, dept: (ui.dept !== 'all' && ui.dept !== 'none') ? ui.dept : undefined });
  if (!autoState.result.changes.length && !autoState.result.unfilled.length) autoState.msg = 'نیازی تعریف نشده یا همهٔ خانه‌ها پر است.';
}

/* ---------- تب: تنظیمات و پشتیبان ---------- */
function viewSet() {
  const S = DB.cfg.settings;
  const logRows = DB.log.slice(0, 100).map((l) => {
    const d = new Date(l.t);
    const j = d2j(Core.g2d(d.getFullYear(), d.getMonth() + 1, d.getDate()));
    return `<tr><td>${N(fa(j.jy + '/' + pad2(j.jm) + '/' + pad2(j.jd) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())))}</td>${isServer() ? `<td>${esc(l.who || '')}</td>` : ''}<td>${esc(l.x)}</td></tr>`;
  }).join('');
  const logPanel = `<div class="panel"><h2>گزارش تغییرات</h2>${logRows ? `<div class="tw" style="max-height:340px;overflow:auto"><table class="t"><thead><tr><th>زمان</th>${isServer() ? '<th>کاربر</th>' : ''}<th>تغییر</th></tr></thead><tbody>${logRows}</tbody></table></div>` : '<div class="note">هنوز تغییری ثبت نشده است.</div>'}</div>`;
  const tail = isServer()
    ? `<div class="panel"><h2>پشتیبان‌گیری</h2><div class="note">اطلاعات در پایگاه‌دادهٔ SQLite روی سرور نگه‌داری می‌شود. برای پشتیبان‌گیری از پوشهٔ <span class="num">data</span> (فایل <span class="num">shiftyar.db</span>) نسخه بگیرید؛ راهنمای کامل در README آمده است.</div></div>${logPanel}`
    : `<div class="panel"><h2>پشتیبان‌گیری</h2>
      <div class="bar"><button class="btn" data-act="backup">ذخیرهٔ فایل پشتیبان (JSON)</button>
      <label class="btn" style="display:inline-flex;align-items:center;cursor:pointer">بازیابی از فایل<input type="file" id="restore-file" accept=".json,application/json" hidden></label></div>
      <div class="note">${Store.mode === 'db' ? 'اطلاعات در فضای ذخیرهٔ همین برنامه نگه‌داری می‌شود. با این حال گاهی فایل پشتیبان بگیرید.' : 'ذخیرهٔ دائمی در این نما در دسترس نیست و اطلاعات فقط در همین مرورگر می‌ماند. حتماً فایل پشتیبان بگیرید.'}</div>
      <div id="set-msg"></div></div>${logPanel}
    <div class="panel"><h2>پاک‌سازی کامل</h2><div class="bar"><button class="btn danger" data-act="resetall" data-confirm="همهٔ داده‌ها پاک شود؟">حذف همهٔ اطلاعات</button></div></div>`;
  return `<div class="panel"><h2>قواعد محاسبه</h2><div class="formgrid">
      <label class="f">موظفی هر روز کاری (ساعت:دقیقه)<input type="text" dir="ltr" data-set="dutyMin" value="${fmtHMlatin(S.dutyMin).replace(/^(\d):/, '0$1:')}"></label>
      <label class="f">ضریب تعطیلی — شرکتی<input type="number" step="0.05" min="1" data-set="f:company" value="${S.factors.company}"></label>
      <label class="f">ضریب تعطیلی — تبصره ۴<input type="number" step="0.05" min="1" data-set="f:t4" value="${S.factors.t4}"></label>
      <label class="f">ضریب تعطیلی — رسمی<input type="number" step="0.05" min="1" data-set="f:official" value="${S.factors.official}"></label>
      <label class="f">حداقل استراحت بین دو شیفت (ساعت)<input type="number" min="0" max="48" data-set="minRestH" value="${S.minRestH}"></label>
      <label class="f">سقف هشدار اضافه‌کار ماهانه (ساعت، ۰ = بدون هشدار)<input type="number" min="0" data-set="otCapH" value="${S.otCapH}"></label></div>
      <div class="note">مرخصی استحقاقی و استعلاجی در روزهای کاری معادل یک روز موظفی اعتبار می‌گیرند؛ در روزهای تعطیل اعتبار ندارند. مرخصی بدون حقوق، استراحت و غیبت اعتبار ندارند.</div></div>
    ${tail}`;
}

/* ---------- ورود، حساب من، کاربران (حالت سرور) ---------- */
function viewLogin(msg) {
  return `<div class="wrap" style="max-width:420px;margin-top:8vh">
    <div class="brand" style="justify-content:center"><h1>شیفت‌یار</h1></div>
    <form class="panel" id="f-login" autocomplete="on">
      <h2>ورود</h2>
      ${msg ? `<div class="msg">${esc(msg)}</div>` : ''}
      <label class="f">کد کاربری (کد پرسنلی)<input type="text" name="code" id="login-code" dir="ltr" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>
      <label class="f">گذرواژه<input type="password" name="password" id="login-pw" dir="ltr" autocomplete="current-password" required></label>
      <div class="bar"><button class="btn primary" type="submit" id="login-btn">ورود</button></div>
      <div class="note">اگر گذرواژه را فراموش کرده‌اید، از مدیر سیستم بخواهید آن را بازنشانی کند.</div>
    </form></div>`;
}
function viewForceChange(msg) {
  return `<div class="wrap" style="max-width:420px;margin-top:8vh">
    <div class="brand" style="justify-content:center"><h1>شیفت‌یار</h1></div>
    <form class="panel" id="f-pw" autocomplete="off" data-force="1">
      <h2>تعیین گذرواژهٔ جدید</h2>
      <div class="note">گذرواژهٔ شما موقت است. پیش از ادامه یک گذرواژهٔ تازه (حداقل ۸ نویسه) انتخاب کنید.</div>
      ${msg ? `<div class="msg">${esc(msg)}</div>` : ''}
      <label class="f">گذرواژهٔ فعلی (موقت)<input type="password" name="current" dir="ltr" autocomplete="current-password" required></label>
      <label class="f">گذرواژهٔ جدید<input type="password" name="next" dir="ltr" autocomplete="new-password" minlength="8" required></label>
      <label class="f">تکرار گذرواژهٔ جدید<input type="password" name="again" dir="ltr" autocomplete="new-password" minlength="8" required></label>
      <div class="bar"><button class="btn primary" type="submit">ذخیره و ورود</button><button class="btn" type="button" data-act="logout">خروج</button></div>
    </form></div>`;
}
function viewAcct() {
  const u = ME.user, p = u.personId ? person(u.personId) : null;
  return `<div class="split"><div class="panel"><h2>حساب من</h2>
      <div class="stats" style="grid-template-columns:1fr">
        <div class="stat"><small>نام</small><b>${esc(u.display || u.code)}</b></div>
        <div class="stat"><small>کد کاربری</small><b class="num">${esc(u.code)}</b></div>
        <div class="stat"><small>نقش</small><b>${ROLE_NAMES[u.role]}</b></div>
        ${p ? `<div class="stat"><small>قرارداد</small><b>${CONTRACTS[p.contract] || ''}</b></div>` : ''}
      </div>
      <div class="bar"><button class="btn" data-act="logout">خروج از حساب</button></div></div>
    <form class="panel" id="f-pw" autocomplete="off"><h2>تغییر گذرواژه</h2>
      <label class="f">گذرواژهٔ فعلی<input type="password" name="current" dir="ltr" autocomplete="current-password" required></label>
      <label class="f">گذرواژهٔ جدید (حداقل ۸ نویسه)<input type="password" name="next" dir="ltr" autocomplete="new-password" minlength="8" required></label>
      <label class="f">تکرار گذرواژهٔ جدید<input type="password" name="again" dir="ltr" autocomplete="new-password" minlength="8" required></label>
      <div class="bar"><button class="btn primary" type="submit">تغییر گذرواژه</button><span id="f-pw-msg"></span></div>
      <div class="note">پس از تغییر، نشست‌های دیگرِ این حساب بسته می‌شوند.</div></form></div>`;
}
const usersState = { list: [], edit: null, notice: '' };
async function loadUsers() {
  try { usersState.list = (await Store.api('GET', '/api/users')).users; } catch (e) { usersState.list = []; usersState.notice = e.message; }
}
function viewUsers() {
  const e = usersState.edit;
  const taken = new Set(usersState.list.map((u) => u.personId).filter(Boolean));
  const free = sortedPeople().filter((p) => !taken.has(p.id) || (e && e.personId === p.id));
  const roleSel = (cur) => ['staff', 'manager', 'admin'].map((r) => `<option value="${r}"${(cur || 'staff') === r ? ' selected' : ''}>${ROLE_NAMES[r]}</option>`).join('');
  const curRole = e ? e.role : 'staff';
  const form = `<form class="panel" id="f-user" autocomplete="off">
    <h2>${e ? 'ویرایش حساب ' + esc(e.code) : 'حساب جدید'}</h2>
    <div class="formgrid">
      <label class="f">کد کاربری<input type="text" name="code" dir="ltr" required value="${esc(e ? e.code : '')}"></label>
      <label class="f">نقش<select name="role" id="u-role">${roleSel(curRole)}</select></label>
      <label class="f">فرد در فهرست پرسنل<select name="personId" id="u-person"><option value="">— ندارد (فقط برای مدیر سیستم) —</option>${free.map((p) => `<option value="${esc(p.id)}"${e && e.personId === p.id ? ' selected' : ''}>${esc(pname(p))}${p.code ? ' (' + esc(p.code) + ')' : ''}</option>`).join('')}</select></label>
      ${e ? '' : '<label class="f">گذرواژه (خالی = موقت خودکار)<input type="text" name="password" dir="ltr" autocomplete="off"></label>'}
    </div>
    <fieldset id="u-depts" style="border:1px solid var(--line);border-radius:6px;padding:8px 12px;${curRole === 'manager' ? '' : 'display:none'}">
      <legend class="note">بخش‌هایی که مدیر بخش می‌تواند برنامه‌شان را ویرایش کند</legend>
      <div class="rows">${DB.cfg.depts.map((d) => `<label class="chk"><input type="checkbox" name="dept" value="${esc(d.id)}"${e && e.deptIds.includes(d.id) ? ' checked' : ''}><span class="dot" style="--dc:${esc(d.color)}"></span>${esc(d.name)}</label>`).join('') || '<span class="note">هنوز بخشی تعریف نشده است.</span>'}</div>
    </fieldset>
    <div class="bar"><button class="btn primary" type="submit">${e ? 'ذخیرهٔ تغییرات' : 'ساخت حساب'}</button>${e ? '<button class="btn" type="button" data-act="canceluser">انصراف</button>' : ''}<span id="f-user-msg"></span></div>
    ${e ? '' : '<div class="note">گذرواژهٔ موقت فقط یک بار نمایش داده می‌شود و فرد در اولین ورود مجبور به تعویض آن است.</div>'}
  </form>`;
  const rows = usersState.list.map((u) => `<tr>
      <td class="num">${esc(u.code)}</td><td>${esc(u.display || u.personName)}</td><td><span class="pill">${ROLE_NAMES[u.role]}</span></td>
      <td>${u.role === 'manager' ? (u.deptIds.map((id) => (dept(id) || {}).name).filter(Boolean).map(esc).join('، ') || '—') : '—'}</td>
      <td>${u.active ? (u.mustChange ? '<span class="pill">گذرواژهٔ موقت</span>' : 'فعال') : '<span class="pill" style="color:var(--hol-ink)">غیرفعال</span>'}</td>
      <td><button class="btn sm" data-act="edituser" data-id="${u.id}">ویرایش</button>
        <button class="btn sm" data-act="resetuser" data-id="${u.id}" data-confirm="گذرواژهٔ جدید ساخته و نشست‌ها بسته شود؟">بازنشانی گذرواژه</button>
        ${u.id === ME.user.id ? '' : `<button class="btn sm" data-act="toggleuser" data-id="${u.id}">${u.active ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button>
        <button class="btn sm danger" data-act="deluser" data-id="${u.id}" data-confirm="حساب حذف شود؟">حذف</button>`}</td></tr>`).join('');
  const noAcct = DB.cfg.people.filter((p) => p.code && !taken.has(p.id)).length;
  return `${usersState.notice ? `<div class="panel" id="u-notice" style="border-color:var(--accent)"><div>${usersState.notice}</div><div class="bar"><button class="btn sm" data-act="dismissnotice">بستن</button></div></div>` : ''}
    <div class="panel"><h2>ساخت گروهی حساب پرسنل</h2>
      <div class="note">برای هر فرد دارای کد پرسنلی که هنوز حساب ندارد، یک حساب «پرسنل» با کد پرسنلی او و گذرواژهٔ موقت ساخته می‌شود. فهرست گذرواژه‌ها فقط همین یک بار نمایش داده می‌شود. ${N(fa(noAcct))} نفر حساب ندارند.</div>
      <div class="bar"><button class="btn" data-act="provision"${noAcct ? '' : ' disabled'}>ساخت حساب برای ${N(fa(noAcct))} نفر</button></div></div>
    <div class="split">${form}<div style="min-width:0;display:flex;flex-direction:column;gap:10px"><h2>${N(fa(usersState.list.length))} حساب</h2>
      <div class="tw"><table class="t"><thead><tr><th>کد</th><th>نام</th><th>نقش</th><th>بخش‌ها</th><th>وضعیت</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div></div>`;
}

/* ---------- رندر اصلی ---------- */
const TABS = [['sched', 'برنامه شیفت'], ['pcal', 'تقویم فرد'], ['people', 'پرسنل'], ['depts', 'بخش‌ها'], ['shifts', 'شیفت‌ها'], ['hol', 'تعطیلات'], ['rep', 'گزارش‌ها'], ['set', 'تنظیمات و پشتیبان']];
/* ---------- درخواست‌ها: مرخصی و جابه‌جایی ---------- */
const reqState = { list: [], peers: [], todo: 0, rev: null, msg: '' };
const REQ_STATUS = { pending: 'در انتظار تأیید مدیر', peer: 'در انتظار پذیرش همکار', manager: 'در انتظار تأیید مدیر', approved: 'تأیید شد', rejected: 'رد شد', declined: 'همکار نپذیرفت', cancelled: 'لغو شد' };
const REQ_ACT = { cancel: 'لغو درخواست', accept: 'می‌پذیرم', decline: 'نمی‌پذیرم', approve: 'تأیید', reject: 'رد' };
async function loadReqs() {
  try {
    const r = await Store.api('GET', '/api/requests');
    reqState.list = r.requests; reqState.rev = r.reqRev;
    reqState.todo = r.requests.filter((x) => x.actions.some((a) => a !== 'cancel')).length;
    reqState.peers = ME.user.personId ? (await Store.api('GET', '/api/peers')).peers : [];
  } catch (e) { reqState.msg = e.message; }
}
function reqRow(r) {
  const what = r.kind === 'leave'
    ? `${esc(SPECIAL[r.code].name)}: ${N(fmtDate(r.d1))}${r.d2 !== r.d1 ? ` تا ${N(fmtDate(r.d2))}` : ''}`
    : `جابه‌جایی: شیفت ${esc(r.personName)} در ${N(fmtDate(r.d1))} ⇄ شیفت ${esc(r.peerName)} در ${N(fmtDate(r.d2))}`;
  const btns = r.actions.map((a) => `<button class="btn sm${a === 'approve' || a === 'accept' ? ' primary' : ''}" data-act="reqact" data-id="${r.id}" data-a="${a}">${REQ_ACT[a]}</button>`).join('');
  const needReply = r.actions.some((a) => a === 'approve' || a === 'reject' || a === 'decline');
  return `<div class="panel req-item" data-status="${r.status}">
    <div><b>${esc(r.personName)}</b> — ${what}</div>
    <div class="note">${REQ_STATUS[r.status]}${r.decidedBy ? ` · ${esc(r.decidedBy)}` : ''}${r.note ? ` · توضیح: ${esc(r.note)}` : ''}${r.reply ? ` · پاسخ: ${esc(r.reply)}` : ''}</div>
    ${btns ? `<div class="bar">${needReply ? `<input class="req-reply" id="rp-${r.id}" placeholder="پاسخ (اختیاری)" maxlength="300">` : ''}${btns}</div>` : ''}</div>`;
}
function viewReq() {
  const me = ME.user, mine = !!me.personId;
  const todo = reqState.list.filter((r) => r.actions.some((a) => a !== 'cancel'));
  const rest = reqState.list.filter((r) => !todo.includes(r));
  const forms = !mine ? `<div class="panel"><div class="note">این حساب به فردی در فهرست پرسنل وصل نیست و نمی‌تواند درخواست ثبت کند.</div></div>` : `
    <form class="panel" id="f-leave" autocomplete="off"><h2>درخواست مرخصی</h2>
      <label class="f">نوع<select name="code">${['LV', 'LU', 'SK'].map((c) => `<option value="${c}">${SPECIAL[c].name}</option>`).join('')}</select></label>
      <label class="f">از تاریخ (مثلاً ۱۴۰۵/۰۷/۱۲)<input name="from" data-dp dir="ltr" required placeholder="۱۴۰۵/۰۷/۱۲"></label>
      <label class="f">تا تاریخ<input name="to" data-dp dir="ltr" required placeholder="۱۴۰۵/۰۷/۱۲"></label>
      <label class="f">توضیح<input name="note" maxlength="300"></label>
      <div class="bar"><button class="btn primary" type="submit">ثبت درخواست</button><span id="f-leave-msg"></span></div></form>
    <form class="panel" id="f-swap" autocomplete="off"><h2>جابه‌جایی شیفت با همکار</h2>
      <label class="f">همکار<select name="peerId">${reqState.peers.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
      <label class="f">روز شیفت شما<input name="d1" data-dp dir="ltr" required placeholder="۱۴۰۵/۰۷/۱۲"></label>
      <label class="f">روز شیفت همکار (اگر همان روز است، همان تاریخ را بنویسید)<input name="d2" data-dp dir="ltr" required placeholder="۱۴۰۵/۰۷/۱۲"></label>
      <label class="f">توضیح<input name="note" maxlength="300"></label>
      <div class="bar"><button class="btn primary" type="submit">ارسال برای همکار</button><span id="f-swap-msg"></span></div>
      <div class="note">ابتدا همکار می‌پذیرد، سپس مدیر تأیید می‌کند و برنامه خودکار تغییر می‌کند.</div></form>`;
  return `${reqState.msg ? `<div class="msg">${esc(reqState.msg)}</div>` : ''}
    <div class="split"><div style="display:flex;flex-direction:column;gap:12px">${forms}</div>
    <div style="min-width:0;display:flex;flex-direction:column;gap:10px">
      <h2>نیازمند اقدام شما (${N(fa(todo.length))})</h2>${todo.map(reqRow).join('') || '<div class="note">موردی نیست.</div>'}
      <h2>سایر درخواست‌ها</h2>${rest.map(reqRow).join('') || '<div class="note">درخواستی ثبت نشده است.</div>'}</div></div>`;
}
/* ---------- ترجیحات و درخواست روز (برای پیشنهاد خودکار) ---------- */
const prefsState = { prefs: {}, wishes: [], pid: null, msg: '' };
const PREF_LABELS = { '-2': 'اصلاً نمی‌خواهم', '-1': 'ترجیح می‌دهم کمتر', '0': 'بی‌تفاوت', '1': 'ترجیح می‌دهم بیشتر', '2': 'خیلی می‌خواهم' };
const OT_LABELS = { none: 'اضافه‌کار نمی‌خواهم', normal: 'عادی', more: 'اضافه‌کار بیشتر می‌خواهم' };
const WISH_KIND = { off: 'آف می‌خواهم', want: 'این شیفت را می‌خواهم', avoid: 'این شیفت را نمی‌خواهم' };
async function loadPrefs() {
  try { const r = await Store.api('GET', '/api/prefs'); prefsState.prefs = r.prefs; prefsState.wishes = r.wishes; prefsState.msg = ''; }
  catch (e) { prefsState.msg = e.message; }
}
function prefsPeople() {
  const me = ME.user;
  if (me.role === 'staff') return DB.cfg.people.filter((p) => p.id === me.personId);
  return sortedPeople();
}
function viewPrefs() {
  const ps = prefsPeople();
  if (!ps.length) return `<div class="panel empty"><b>این حساب به فردی وصل نیست</b><span>از مدیر سیستم بخواهید حساب شما را به یکی از پرسنل وصل کند.</span></div>`;
  if (!ps.some((p) => p.id === prefsState.pid)) prefsState.pid = (ps.find((p) => p.id === ME.user.personId) || ps[0]).id;
  const pid = prefsState.pid, pf = prefsState.prefs[pid] || { shift: {}, ot: 'normal' };
  const mineWishes = prefsState.wishes.filter((w) => w.pid === pid).sort((x, y) => x.j - y.j);
  const picker = ps.length > 1 ? `<label class="f">فرد<select id="pf-person">${ps.map((p) => `<option value="${esc(p.id)}"${p.id === pid ? ' selected' : ''}>${esc(pname(p))}</option>`).join('')}</select></label>` : '';
  const sh = simpleShifts();
  return `${prefsState.msg ? `<div class="msg">${esc(prefsState.msg)}</div>` : ''}
    <div class="note">این موارد فقط در «پیشنهاد خودکار برنامه» لحاظ می‌شود. «آف» و «اضافه‌کار نمی‌خواهم» قید جدی‌اند؛ بقیه ترجیح‌اند و اگر برای پوشش شیفت‌ها ناچار باشیم ممکن است رعایت نشوند.</div>
    <div class="split"><div style="display:flex;flex-direction:column;gap:12px">
    ${picker ? `<div class="panel">${picker}</div>` : ''}
    <form class="panel" id="f-prefs" autocomplete="off"><h2>ترجیحات من برای شیفت‌ها</h2>
      <label class="f">اضافه‌کار<select name="ot">${Object.keys(OT_LABELS).map((k) => `<option value="${k}"${pf.ot === k ? ' selected' : ''}>${OT_LABELS[k]}</option>`).join('')}</select></label>
      ${sh.map((s) => `<label class="f">${esc(s.code)} — ${esc(s.name)}<select name="sh:${esc(s.code)}">${Object.keys(PREF_LABELS).map((k) => `<option value="${k}"${(pf.shift[s.code] || 0) === +k ? ' selected' : ''}>${PREF_LABELS[k]}</option>`).join('')}</select></label>`).join('')}
      <div class="bar"><button class="btn primary" type="submit">ذخیرهٔ ترجیحات</button><span id="f-prefs-msg"></span></div></form></div>
    <div style="display:flex;flex-direction:column;gap:12px">
    <form class="panel" id="f-wish" autocomplete="off"><h2>درخواست برای یک روز مشخص</h2>
      <label class="f">تاریخ<input name="day" data-dp dir="ltr" required placeholder="۱۴۰۵/۰۷/۱۲"></label>
      <label class="f">درخواست<select name="kind">${Object.keys(WISH_KIND).map((k) => `<option value="${k}">${WISH_KIND[k]}</option>`).join('')}</select></label>
      <label class="f">شیفت (برای «آف» لازم نیست)<select name="code"><option value="">—</option>${sh.map((s) => `<option value="${esc(s.code)}">${esc(s.code)} — ${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f">توضیح<input name="note" maxlength="200"></label>
      <div class="bar"><button class="btn primary" type="submit">ثبت درخواست</button><span id="f-wish-msg"></span></div></form>
    <h2>درخواست‌های ثبت‌شده (${N(fa(mineWishes.length))})</h2>
    ${mineWishes.map((w) => `<div class="panel req-item"><div>${N(fmtDate(w.j))} — ${WISH_KIND[w.kind]}${w.code ? ` (${esc(w.code)})` : ''}${w.note ? ` · ${esc(w.note)}` : ''}</div><div class="bar"><button class="btn sm danger" data-act="delwish" data-id="${w.id}">حذف</button></div></div>`).join('') || '<div class="note">درخواستی ثبت نشده است.</div>'}
    </div></div>`;
}
function tabsFor() {
  if (!isServer()) return TABS;
  const r = role(), acct = ['acct', 'حساب من'];
  const rq = ['req', 'درخواست‌ها'], pf = ['prefs', 'ترجیحات'];
  if (r === 'admin') return TABS.slice(0, 7).concat([rq, pf, ['users', 'کاربران'], ['set', 'تنظیمات'], acct]);
  if (r === 'manager') return [['sched', 'برنامه شیفت'], ['pcal', 'تقویم فرد'], ['rep', 'گزارش‌ها'], rq, pf, acct];
  return [['pcal', 'برنامه من'], ['rep', 'گزارش من'], rq, pf, acct];
}
let loginMsg = '';
function sessionLost() {
  if (!ME.user) return;
  ME.user = null;
  clearInterval(Store.pollTimer);
  Store.pending = new Map(); Store.loaded = new Set(); DB.assign = {}; DB.assignDept = {}; DB.cfg = defaultCfg();
  loginMsg = 'نشست شما تمام شد. دوباره وارد شوید.';
  render();
}
let renderTok = 0;
async function render() {
  dpClose();
  const app = $('#app');
  if (!DB.cfg) { app.innerHTML = '<div class="panel empty"><b>در حال بارگذاری…</b></div>'; return; }
  if (isServer() && !ME.user) {
    app.innerHTML = viewLogin(loginMsg); loginMsg = '';
    const c = $('#login-code'); if (c) c.focus();
    return;
  }
  if (isServer() && ME.user.mustChange) { app.innerHTML = viewForceChange(loginMsg); loginMsg = ''; return; }
  const tok = ++renderTok;
  const tabs = tabsFor();
  if (!tabs.some((t) => t[0] === ui.tab)) ui.tab = tabs[0][0];
  const { a, b } = monthInfo();
  if (ui.tab === 'sched' || ui.tab === 'pcal') await Store.ensureRange(a, b);
  if (ui.tab === 'rep') { const r = repRange(); await Store.ensureRange(r.from, r.to); }
  if (ui.tab === 'users') await loadUsers();
  if (ui.tab === 'req') await loadReqs();
  if (ui.tab === 'prefs') await loadPrefs();
  if (ui.tab === 'set' && isServer()) { try { DB.log = (await Store.api('GET', '/api/log?limit=100')).items; } catch (e) { DB.log = []; } }
  if (tok !== renderTok || (isServer() && !ME.user)) return;
  const views = { sched: viewSched, pcal: viewPcal, people: viewPeople, depts: viewDepts, shifts: viewShifts, hol: viewHol, rep: viewRep, set: viewSet, acct: viewAcct, users: viewUsers, req: viewReq, prefs: viewPrefs };
  const who = isServer() ? `<span class="note who">${esc(ME.user.display || ME.user.code)} · ${ROLE_NAMES[ME.user.role]}</span>` : '';
  app.innerHTML = `<div class="wrap">
    <div class="top"><div class="brand"><h1>شیفت‌یار</h1><small>برنامه‌ریز شیفت پرسنل</small></div>
      <div class="rows">${who}<span id="savestate" class="save ${Store.status}"><i></i><span>${esc(Store.statusText())}</span></span></div></div>
    <nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${ui.tab === k}" data-tab="${k}">${l}${k === 'req' && reqState.todo ? ` <span class="badge">${N(fa(reqState.todo))}</span>` : ''}</button>`).join('')}</nav>
    <div id="flash" aria-live="polite"></div>
    <main id="main" style="display:flex;flex-direction:column;gap:12px">${views[ui.tab]()}</main></div>`;
  if (ui.tab === 'shifts') shiftDraftPreview();
}
function flash(msg, ok, where) {
  const el = $(where || '#flash'); if (!el) return;
  el.innerHTML = `<div class="msg${ok ? ' ok' : ''}">${esc(msg)}</div>`;
  clearTimeout(flash.t); flash.t = setTimeout(() => { if (el) el.innerHTML = ''; }, 5000);
}
function showText(title, text) {
  const main = $('#main'); if (!main) return;
  const old = $('#textbox'); if (old) old.remove();
  const d = document.createElement('div');
  d.className = 'panel'; d.id = 'textbox';
  d.innerHTML = `<h2>${esc(title)}</h2><textarea readonly id="textbox-area"></textarea><div class="note">متن را انتخاب و کپی کنید.</div>`;
  main.appendChild(d);
  const ta = $('#textbox-area'); ta.value = text; ta.focus(); ta.select();
}
async function saveFile(filename, data, label) {
  const binary = typeof data !== 'string';
  const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  if (Store.dl) {
    try { await Store.dl.save({ filename, data }); return true; }
    catch (e) { if (e && e.code === 'declined') return false; }
  } else if (!window.claude) {
    // صفحهٔ معمولی (سرور یا فایل محلی): دانلود مستقیم مرورگر
    try {
      const url = URL.createObjectURL(new Blob([data], { type: binary ? (MIME[filename.split('.').pop()] || 'application/octet-stream') : 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      return true;
    } catch (e) { /* ادامه با نمایش متن */ }
  }
  showText(label || filename, typeof data === 'string' ? data : '');
  return false;
}

/* ---------- رنگ‌آمیزی با ماوس/لمس ---------- */
let painting = false, stroke = null, strokeFirst = true;
function applyBrush(td) {
  const pid = td.dataset.pid, j = +td.dataset.j;
  const p = person(pid); if (!p) return;
  const old = (DB.assign[pid] || {})[j];
  // خانهٔ قفل (بخش دیگر در نمای یک بخش) نقاشی نمی‌شود
  if (ui.tab === 'sched' && ui.dept !== 'all' && ui.dept !== 'none' && old && cellDept(pid, j) !== ui.dept) return;
  let nw = ui.brush === 'ERASE' ? undefined : ui.brush;
  if (strokeFirst && old === nw) nw = undefined; // کلیک دوباره = پاک کردن
  strokeFirst = false;
  if (setAssign(pid, j, nw, stroke, nw ? paintDeptFor(p) : null)) { if (ui.tab === 'pcal') refreshPcal(); else refreshRow(pid); }
}
document.addEventListener('pointerdown', (e) => {
  if (e.button > 0 || !canEdit() || !ui.editMode) return;
  const td = e.target.closest('.cell[data-pid]');
  if (!td || !(ui.tab === 'sched' || ui.tab === 'pcal')) return;
  painting = true; stroke = []; strokeFirst = true;
  applyBrush(td);
  e.preventDefault();
});
document.addEventListener('pointerover', (e) => {
  if (!painting || !ui.editMode) return;
  const td = e.target.closest('.cell[data-pid]');
  if (td) applyBrush(td);
});
function endStroke() { if (!painting) return; painting = false; finishStroke(stroke, ui.brush === 'ERASE' ? 'پاک‌کردن' : codeLabel(ui.brush)); stroke = null; }
document.addEventListener('pointerup', endStroke);
document.addEventListener('pointercancel', endStroke);
document.addEventListener('keydown', (e) => {
  const td = e.target.closest && e.target.closest('.cell[data-pid]');
  if (!td || !canEdit() || !ui.editMode) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault(); stroke = []; strokeFirst = true; const pid = td.dataset.pid, j = td.dataset.j;
    applyBrush(td); finishStroke(stroke, codeLabel(ui.brush)); stroke = null;
    const again = $(`.cell[data-pid="${pid}"][data-j="${j}"]`); if (again) again.focus();
    return;
  }
  const dir = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!dir) return;
  e.preventDefault();
  const pid = td.dataset.pid, j = +td.dataset.j;
  let next = null;
  if (ui.tab === 'pcal') next = $(`.cell[data-j="${j + dir[0] + dir[1] * 7}"]`);
  else if (dir[0]) next = $(`.cell[data-pid="${pid}"][data-j="${j + dir[0]}"]`);
  else { const tr = td.closest('tr'); let r = tr; do { r = dir[1] > 0 ? r.nextElementSibling : r.previousElementSibling; } while (r && r.classList.contains('grp')); if (r) next = $(`.cell[data-pid="${r.dataset.pid}"][data-j="${j}"]`); }
  if (next) { $$('.cell[tabindex="0"]').forEach((c) => c.setAttribute('tabindex', '-1')); next.setAttribute('tabindex', '0'); next.focus(); }
});

/* ---------- کلیک‌ها ---------- */
async function copyPattern(src) {
  const { a, b } = monthInfo();
  const ps = visiblePeople();
  if (src === 'pm') {
    const pm = ui.jm === 1 ? { jy: ui.jy - 1, jm: 12 } : { jy: ui.jy, jm: ui.jm - 1 };
    await Store.ensureMonth(pm.jy, pm.jm);
  } else await Store.ensureRange(a - +src, a);
  const st = [];
  for (const p of ps) {
    for (let j = a; j <= b; j++) {
      let from;
      if (src === 'pm') { const d = d2j(j); const dd = d.jd; from = dd <= monthLen(ui.jm === 1 ? ui.jy - 1 : ui.jy, ui.jm === 1 ? 12 : ui.jm - 1) ? j2d(ui.jm === 1 ? ui.jy - 1 : ui.jy, ui.jm === 1 ? 12 : ui.jm - 1, dd) : null; }
      else from = j - +src;
      if (from == null) continue;
      const code = (DB.assign[p.id] || {})[from];
      if (code) setAssign(p.id, j, code, st, cellDept(p.id, from));
    }
  }
  finishStroke(st, 'کپی الگو');
  if (!st.length) flash('چیزی برای کپی پیدا نشد؛ مبدأ خالی است یا تغییری لازم نبود.', false);
}
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act],[data-tab],[data-brush]');
  if (!t) return;
  if (t.dataset.brush) {
    ui.brush = t.dataset.brush;
    $$('[data-brush]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.brush === ui.brush)));
    return;
  }
  if (t.dataset.tab) { ui.tab = t.dataset.tab; ui.shiftDraft = null; await render(); window.scrollTo(0, 0); return; }
  if (t.dataset.confirm && !t.classList.contains('arm')) {
    t.classList.add('arm'); t.dataset.orig = t.textContent; t.textContent = t.dataset.confirm;
    setTimeout(() => { if (t.isConnected && t.classList.contains('arm')) { t.classList.remove('arm'); t.textContent = t.dataset.orig; } }, 4500);
    return;
  }
  const act = t.dataset.act, id = t.dataset.id;
  const cfg = DB.cfg;
  switch (act) {
    case 'toggleedit': {
      ui.editMode = !ui.editMode;
      if (ui.editMode) flash('حالت ویرایش فعال شد. اکنون می‌توانید شیفت‌ها را تغییر دهید.', true);
      else flash('تقویم قفل شد (حالت فقط مشاهده).', true);
      return render();
    }
    case 'mprev': ui.jm--; if (ui.jm < 1) { ui.jm = 12; ui.jy--; } ui.rep.from = null; ui.undo = []; return render();
    case 'mnext': ui.jm++; if (ui.jm > 12) { ui.jm = 1; ui.jy++; } ui.rep.from = null; ui.undo = []; return render();
    case 'mtoday': { const d = d2j(todayJdn()); ui.jy = d.jy; ui.jm = d.jm; ui.rep.from = null; ui.undo = []; return render(); }
    case 'undo': {
      const st = ui.undo.pop(); if (!st) return;
      const pids = new Set();
      for (let i = st.length - 1; i >= 0; i--) { setAssign(st[i].pid, st[i].j, st[i].old, null, st[i].oldDept || null); pids.add(st[i].pid); }
      logEv(`بازگردانی ${fa(st.length)} خانه`);
      return render();
    }
    case 'copypat': { await copyPattern($('#copy-src').value); return render(); }
    case 'clearmonth': {
      const { a, b } = monthInfo(); const st = [];
      // در نمای یک بخش فقط خانه‌های همان بخش پاک می‌شوند؛ خانه‌های قفلِ بخش‌های
      // دیگر دست نمی‌خورند (setAssign فقط برای خانه‌های برگشتی صدا می‌شود، پس
      // بازگردانی هم فقط همان خانه‌ها را برمی‌گرداند)
      const viewDept = (ui.dept !== 'all' && ui.dept !== 'none') ? ui.dept : null;
      for (const [pid, j] of Core.clearMonthCells(dbv(), visiblePeople().map((p) => p.id), a, b, viewDept)) setAssign(pid, j, undefined, st);
      finishStroke(st, 'پاک‌کردن ماه'); return render();
    }
    case 'clearsample': {
      await Store.replaceAll(Object.assign(normalizeCfg(cfg), { people: [], depts: [], sample: false }), {}, {}, []);
      ui.undo = []; return render();
    }
    /* پرسنل */
    case 'editperson': ui.editPerson = id; return render();
    case 'cancelperson': ui.editPerson = null; return render();
    case 'delperson': {
      const mine = DB.assign[id] || {}; const p = person(id);
      cfg.people = cfg.people.filter((x) => x.id !== id);
      Object.keys(mine).forEach((j) => Store.touchMonth(+j));
      delete DB.assign[id]; delete DB.assignDept[id];
      Store.touchCfg(); logEv(`حذف پرسنل: ${p ? pname(p) : ''}`); return render();
    }
    /* بخش‌ها */
    case 'deldept': {
      const d = dept(id); cfg.depts = cfg.depts.filter((x) => x.id !== id);
      cfg.people.forEach((p) => {
        if (p.deptId === id) p.deptId = '';
        p.extraDeptIds = (p.extraDeptIds || []).filter((x) => x !== id);
      });
      // خانه‌های این بخش به بخش اصلی نفر برمی‌گردند (حذف ورودی صریح = بخش اصلی)
      for (const pid in DB.assignDept) for (const j in DB.assignDept[pid]) if (DB.assignDept[pid][j] === id) delete DB.assignDept[pid][j];
      if (ui.dept === id) ui.dept = 'all';
      if (ui.paintDept === id) ui.paintDept = '';
      Store.touchCfg(); logEv(`حذف بخش: ${d ? d.name : ''}`); return render();
    }
    /* الگوهای شیفت اداری و زیرتب‌ها */
    case 'shifttab': ui.shiftTab = t.dataset.sub; ui.shiftDraft = null; ui.editOfficePattern = null; return render();
    case 'newoffpat': {
      ui.editOfficePattern = {
        origId: null,
        name: '',
        days: {
          0: { active: true, s: '07:30', e: '14:15' },
          1: { active: true, s: '07:30', e: '14:15' },
          2: { active: true, s: '07:30', e: '14:15' },
          3: { active: true, s: '07:30', e: '14:15' },
          4: { active: true, s: '07:30', e: '14:15' },
          5: { active: true, s: '07:30', e: '13:20' },
          6: { active: false, s: '07:30', e: '14:15' },
        },
      };
      return render();
    }
    case 'editoffpat': {
      const patterns = (cfg.settings && cfg.settings.officePatterns) || defaultOfficePatterns();
      const p = patterns.find((x) => x.id === id);
      if (p) ui.editOfficePattern = JSON.parse(JSON.stringify(Object.assign({}, p, { origId: p.id })));
      return render();
    }
    case 'canceloffpat': ui.editOfficePattern = null; return render();
    case 'deloffpat': {
      const patterns = (cfg.settings && cfg.settings.officePatterns) || defaultOfficePatterns();
      if (patterns.length <= 1) return flash('حداقل یک الگوی اداری باید در سیستم باقی بماند.', false);
      const inUse = cfg.people.filter((p) => p.workType === 'office' && p.officePatternId === id);
      if (inUse.length) return flash(`این الگو برای ${fa(inUse.length)} نفر از پرسنل اداری تنظیم شده و ابتدا باید الگوی آن‌ها را تغییر دهید.`, false);
      cfg.settings.officePatterns = patterns.filter((x) => x.id !== id);
      Store.touchCfg(); logEv(`حذف الگوی اداری`); return render();
    }
    case 'applyquickall': {
      const d = ui.editOfficePattern;
      if (!d || !d.days) return;
      const sVal = toLatin($('#quick-off-s').value).trim() || '07:00';
      const eVal = toLatin($('#quick-off-e').value).trim() || '13:00';
      const nameIn = $('#offpat-name'); if (nameIn && nameIn.value) d.name = nameIn.value;
      for (let wd = 0; wd <= 5; wd++) {
        d.days[wd] = { active: true, s: sVal, e: eVal };
      }
      d.days[6] = { active: false, s: sVal, e: eVal }; // جمعه
      return render();
    }
    case 'applyquick5d': {
      const d = ui.editOfficePattern;
      if (!d || !d.days) return;
      const sVal = toLatin($('#quick-off-s').value).trim() || '07:30';
      const eVal = toLatin($('#quick-off-e').value).trim() || '14:15';
      const nameIn = $('#offpat-name'); if (nameIn && nameIn.value) d.name = nameIn.value;
      for (let wd = 0; wd <= 4; wd++) {
        d.days[wd] = { active: true, s: sVal, e: eVal };
      }
      d.days[5] = { active: false, s: sVal, e: eVal }; // پنجشنبه تعطیل
      d.days[6] = { active: false, s: sVal, e: eVal }; // جمعه تعطیل
      return render();
    }
    case 'autoassignoffice': {
      const m = monthInfo();
      // محدود به نمای فعلی: بخشِ انتخابی (با تگِ همان بخش) یا «بدون بخش»؛ «همه» مثل قبل همهٔ پرسنل اداری (#21)
      const dept = (ui.dept !== 'all' && ui.dept !== 'none') ? ui.dept : undefined;
      const changes = Core.autoAssignOffice(dbv(), { a: m.a, b: m.b, dept, noDept: ui.dept === 'none' });
      if (!changes.length) return flash('خانه‌ای برای پر شدن اداری وجود ندارد (یا قبلاً پر شده‌اند یا پرسنل اداری تعریف نشده است).', false);
      const st = [];
      for (const ch of changes) setAssign(ch.pid, ch.j, ch.code, st, ch.deptId);
      finishStroke(st, 'تکمیل خودکار اداری');
      flash(`${fa(st.length)} خانه اداری برای پرسنل اداری تکمیل شد.`, true);
      return render();
    }
    /* شیفت‌ها */
    case 'newshift': ui.shiftDraft = { orig: null, code: '', name: '', kind: 'simple', segs: [{ o: 0, s: '08:00', e: '14:00' }], refs: [] }; return render();
    case 'editshift': { const s = shiftOf(id); ui.shiftDraft = JSON.parse(JSON.stringify(Object.assign({ segs: [], refs: [] }, s, { orig: s.code }))); if (!ui.shiftDraft.segs.length && s.kind !== 'combo') ui.shiftDraft.segs.push({ o: 0, s: '08:00', e: '14:00' }); return render(); }
    case 'cancelshift': ui.shiftDraft = null; return render();
    case 'addseg': ui.shiftDraft.segs.push({ o: 0, s: '08:00', e: '14:00' }); return render();
    case 'rmseg': ui.shiftDraft.segs.splice(+t.dataset.i, 1); return render();
    case 'addref': { const first = cfg.shifts.find((s) => s.kind !== 'combo' && s.code !== ui.shiftDraft.orig); ui.shiftDraft.refs.push({ code: first ? first.code : '', o: 0 }); return render(); }
    case 'rmref': ui.shiftDraft.refs.splice(+t.dataset.i, 1); return render();
    case 'delshift': {
      let used = 0; for (const pid in DB.assign) for (const j in DB.assign[pid]) if (DB.assign[pid][j] === id) used++;
      const inCombo = cfg.shifts.some((s) => s.kind === 'combo' && (s.refs || []).some((r) => r.code === id));
      if (used || inCombo) { flash(used ? `این شیفت ${fa(used)} بار در برنامه‌ها استفاده شده و حذف نمی‌شود.` : 'این شیفت در یک شیفت ترکیبی استفاده شده است.', false); return; }
      cfg.shifts = cfg.shifts.filter((s) => s.code !== id); if (ui.brush === id) ui.brush = 'ERASE';
      Store.touchCfg(); logEv(`حذف شیفت ${id}`); return render();
    }
    /* تعطیلات */
    case 'delhol': cfg.holidays = cfg.holidays.filter((h) => h.id !== id); Store.touchCfg(); logEv('حذف یک تعطیلی'); return render();
    /* گزارش */
    case 'repgo': {
      const f = parseDate($('#rep-from').value), to = parseDate($('#rep-to').value);
      if (f == null || to == null) return flash('تاریخ را به شکل ۱۴۰۵/۰۷/۲۵ بنویسید.', false, '#rep-msg');
      if (to < f) return flash('تاریخ پایان باید بعد از شروع باشد.', false, '#rep-msg');
      if (to - f > 400) return flash('بازه حداکثر ۴۰۰ روز می‌تواند باشد.', false, '#rep-msg');
      ui.rep.from = f; ui.rep.to = to; ui.rep.dept = repDept(); return render();
    }
    case 'repmonth': { const m = monthInfo(); ui.rep.from = m.a; ui.rep.to = m.b; ui.rep.dept = repDept(); return render(); }
    case 'repweek': { const T = todayJdn(), s = T - weekdayOf(T); ui.rep.from = s; ui.rep.to = s + 6; ui.rep.dept = repDept(); return render(); }
    case 'reptoday': { const T = todayJdn(); ui.rep.from = T; ui.rep.to = T; ui.rep.dept = repDept(); return render(); }
    case 'repxlsx': { ui.rep.dept = repDept(); const x = xlsxReport(); const ok = await saveFile(x.name, x.data, 'Excel'); if (ok) flash('فایل ذخیره شد.', true, '#rep-msg'); return; }
    case 'schedxlsx': { const x = xlsxRoster(); const ok = await saveFile(x.name, x.data, 'Excel'); if (ok) flash('فایل ذخیره شد.', true); return; }
    case 'repprint': { const R = buildReport(); printView('گزارش کارکرد پرسنل', `${N(fmtDate(R.from))} تا ${N(fmtDate(R.to))}`, $$('#main .tw')); return; }
    case 'schedprint': {
      const d = ui.dept === 'all' ? 'همهٔ بخش‌ها' : ui.dept === 'none' ? 'بدون بخش' : (dept(ui.dept) || {}).name || '';
      printView(`برنامهٔ شیفت ${MONTHS[ui.jm - 1]} ${fa(ui.jy)}`, esc(d), $$('#main .rwrap, #main .legend'), true); return;
    }
    case 'autoopen': autoState.open = true; autoState.result = null; autoState.msg = ''; return render();
    case 'autoclose': autoState.open = false; autoState.result = null; return render();
    case 'autorun': await autoRun(); return render();
    case 'autoapply': {
      const R = autoState.result; if (!R || !R.changes.length) return;
      const st = []; for (const c of R.changes) setAssign(c.pid, c.j, c.code, st, c.deptId);
      finishStroke(st, 'پیشنهاد خودکار'); autoState.result = null; autoState.msg = `${fa(st.length)} خانه به برنامه اضافه شد.`;
      return render();
    }
    case 'repcsv': { ui.rep.dept = repDept(); const c = csvText(); const ok = await saveFile(c.name, c.text, 'متن CSV'); if (ok) flash('فایل ذخیره شد.', true, '#rep-msg'); return; }
    /* حساب و کاربران (حالت سرور) */
    case 'logout': {
      try { await Store.api('POST', '/api/logout'); } catch (e) { /* حتی با خطا از برنامه خارج می‌شویم */ }
      ME.user = null; clearInterval(Store.pollTimer);
      Store.pending = new Map(); Store.loaded = new Set(); DB.assign = {}; DB.assignDept = {}; DB.cfg = defaultCfg();
      ui.undo = []; usersState.list = []; usersState.edit = null; usersState.notice = ''; loginMsg = '';
      return render();
    }
    case 'delwish': {
      try { await Store.api('DELETE', '/api/wishes/' + id); prefsState.msg = ''; } catch (err) { prefsState.msg = err.message; }
      return render();
    }
    case 'reqact': {
      const a = t.dataset.a, rp = $('#rp-' + id);
      try { await Store.api('POST', `/api/requests/${id}/respond`, { action: a, reply: rp ? rp.value : '' }); reqState.msg = ''; if (a === 'approve') Store.loaded = new Set(); }
      catch (err) { reqState.msg = err.message; }
      return render();
    }
    case 'dismissnotice': usersState.notice = ''; return render();
    case 'edituser': usersState.edit = usersState.list.find((u) => u.id === +id) || null; return render();
    case 'canceluser': usersState.edit = null; return render();
    case 'toggleuser': {
      const u = usersState.list.find((x) => x.id === +id);
      try { await Store.api('PATCH', '/api/users/' + id, { active: !u.active }); await render(); } catch (err) { await render(); flash(err.message, false); }
      return;
    }
    case 'deluser': {
      try { await Store.api('DELETE', '/api/users/' + id); await render(); } catch (err) { await render(); flash(err.message, false); }
      return;
    }
    case 'resetuser': {
      const u = usersState.list.find((x) => x.id === +id);
      try {
        const r = await Store.api('POST', `/api/users/${id}/reset`);
        usersState.notice = `گذرواژهٔ موقت <b>${esc(u ? u.code : '')}</b>: <span class="num">${esc(r.tempPassword)}</span> — فقط همین یک بار نمایش داده می‌شود.`;
        await render();
      } catch (err) { await render(); flash(err.message, false); }
      return;
    }
    case 'provision': {
      try {
        const r = await Store.api('POST', '/api/users/provision');
        usersState.notice = `${N(fa(r.created.length))} حساب ساخته شد. فهرست گذرواژه‌های موقت را پایین صفحه ببینید؛ فقط همین یک بار نمایش داده می‌شود.`;
        await render();
        const lines = ['کد کاربری\tنام\tگذرواژهٔ موقت'].concat(r.created.map((x) => `${x.code}\t${x.name}\t${x.tempPassword}`));
        showText('گذرواژه‌های موقت', lines.join('\n'));
      } catch (err) { await render(); flash(err.message, false); }
      return;
    }
    /* تنظیمات */
    case 'backup': {
      await Store.loadAll();
      const data = JSON.stringify({ app: 'shiftyar', v: 1, cfg: DB.cfg, assign: DB.assign, assignDept: DB.assignDept, log: DB.log });
      const ok = await saveFile('shiftyar-backup-' + fmtDateLatin(todayJdn()).replace(/\//g, '') + '.json', data, 'متن پشتیبان');
      if (ok) flash('فایل پشتیبان ذخیره شد.', true, '#set-msg'); return;
    }
    case 'resetall': {
      await Store.replaceAll(defaultCfg(), {}, {}, []); ui.undo = []; ui.editPerson = null; ui.dept = 'all'; return render();
    }
  }
});

/* ---------- فرم‌ها ---------- */
document.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target, fd = new FormData(f), cfg = DB.cfg;
  if (f.id === 'f-person') {
    const mainDept = fd.get('deptId') || '';
    const rec = {
      first: (fd.get('first') || '').trim(),
      last: (fd.get('last') || '').trim(),
      code: toLatin((fd.get('code') || '').trim()),
      phone: toLatin((fd.get('phone') || '').trim()),
      contract: fd.get('contract'),
      deptId: mainDept,
      extraDeptIds: fd.getAll('extraDept').filter((d) => d && d !== mainDept),
      workType: fd.get('workType') || 'rotating',
      officePatternId: fd.get('officePatternId') || '',
    };
    if (!rec.first && !rec.last) return flash('نام را بنویسید.', false, '#f-person-msg');
    if (rec.code && cfg.people.some((p) => p.code === rec.code && p.id !== ui.editPerson)) return flash('این کد پرسنلی قبلاً ثبت شده است.', false, '#f-person-msg');
    if (ui.editPerson) {
      const pid = ui.editPerson, oldP = person(pid);
      // بخش‌هایی که از عضویت نفر می‌روند: خانه‌هایشان به بخش اصلی برمی‌گردند
      // (ورودیِ تنکِ assignDept حذف می‌شود). setAssign تغییرِ بخش را هم در حالت
      // سرور (صفِ خانه) و هم در حالت محلی (ماهِ کثیف) ماندگار می‌کند.
      const removed = personDepts(oldP).filter((d) => !personDepts(rec).includes(d));
      Object.assign(oldP, rec); logEv('ویرایش پرسنل: ' + pname(rec));
      if (removed.length) for (const j in (DB.assignDept[pid] || {})) {
        if (removed.includes(DB.assignDept[pid][j]) && (DB.assign[pid] || {})[j]) setAssign(pid, +j, DB.assign[pid][j], null, null);
      }
    }
    else { cfg.people.push(Object.assign({ id: uid('p') }, rec)); logEv('افزودن پرسنل: ' + pname(rec)); }
    ui.editPerson = null; Store.touchCfg(); render();
  } else if (f.id === 'f-offpat') {
    const d = ui.editOfficePattern;
    const name = (fd.get('name') || '').trim();
    if (!name) return flash('نام الگو را بنویسید.', false, '#f-offpat-msg');
    if (!cfg.settings.officePatterns) cfg.settings.officePatterns = defaultOfficePatterns();
    const patId = d.origId || uid('pat');
    const rec = { id: patId, name, days: JSON.parse(JSON.stringify(d.days)) };
    if (d.origId) {
      const idx = cfg.settings.officePatterns.findIndex((x) => x.id === d.origId);
      if (idx !== -1) cfg.settings.officePatterns[idx] = rec;
      else cfg.settings.officePatterns.push(rec);
    } else {
      cfg.settings.officePatterns.push(rec);
    }
    ui.editOfficePattern = null; Store.touchCfg(); logEv('ذخیرهٔ الگوی اداری: ' + name); render();
  } else if (f.id === 'f-dept') {
    const name = (fd.get('name') || '').trim(); if (!name) return;
    cfg.depts.push({ id: uid('d'), name, color: fd.get('color') }); Store.touchCfg(); logEv('افزودن بخش: ' + name); render();
  } else if (f.id === 'f-hol') {
    const jm = +fd.get('jm'), jd = +fd.get('jd'), name = (fd.get('name') || '').trim(), every = fd.get('every') === 'on', jy = +fd.get('jy');
    if (!name || !(jd >= 1 && jd <= 31)) return flash('روز و نام مناسبت را بنویسید.', false, '#f-hol-msg');
    if (!every && !(jy >= 1300)) return flash('سال را بنویسید.', false, '#f-hol-msg');
    cfg.holidays.push({ id: uid('h'), jy: every ? null : jy, jm, jd, name }); Store.touchCfg(); logEv(`افزودن تعطیلی: ${fa(jd)} ${MONTHS[jm - 1]} ${name}`); render();
  } else if (f.id === 'f-shift') {
    const d = ui.shiftDraft; d.code = d.code.trim();
    const err = validateShift(d, cfg.shifts, !d.orig);
    if (err) return flash(err, false, '#f-shift-msg');
    const rec = d.kind === 'combo' ? { code: d.code, name: d.name.trim(), kind: 'combo', refs: d.refs.map((r) => ({ code: r.code, o: +r.o || 0 })) }
      : { code: d.code, name: d.name.trim(), kind: 'simple', segs: d.segs.map((g) => ({ o: +g.o || 0, s: toLatin(g.s).padStart(5, '0'), e: toLatin(g.e).padStart(5, '0') })) };
    if (d.orig) cfg.shifts[cfg.shifts.findIndex((s) => s.code === d.orig)] = rec; else cfg.shifts.push(rec);
    ui.shiftDraft = null; Store.touchCfg(); logEv('ذخیرهٔ شیفت ' + rec.code); render();
  }
});

/* ---------- تغییر فیلدها ---------- */
document.addEventListener('change', async (e) => {
  const t = e.target, cfg = DB.cfg;
  if (t.id === 'f-dept') { ui.dept = t.value; ui.paintDept = (t.value !== 'all' && t.value !== 'none') ? t.value : ''; return render(); }
  if (t.id === 'paint-dept' || t.id === 'paint-dept-pcal') { ui.paintDept = t.value; return; }
  if (t.id === 'p-work-type') {
    const patWrap = $('#f-off-pat');
    if (patWrap) patWrap.style.display = t.value === 'office' ? '' : 'none';
    return;
  }
  if (t.id === 'pf-person') { prefsState.pid = t.value; return render(); }
  if (t.id === 'pcal-person') { ui.pcalPerson = t.value; return refreshPcal(); }
  if (t.dataset.opd) {
    const [wd, field] = t.dataset.opd.split(':');
    const d = ui.editOfficePattern;
    if (d && d.days) {
      if (!d.days[wd]) d.days[wd] = { active: true, s: '07:30', e: '14:15' };
      if (field === 'active') {
        d.days[wd].active = t.checked;
        const row = $(`tr[data-wd="${wd}"]`);
        if (row) {
          const sIn = row.querySelector(`[data-opd="${wd}:s"]`);
          const eIn = row.querySelector(`[data-opd="${wd}:e"]`);
          if (sIn) sIn.disabled = !t.checked;
          if (eIn) eIn.disabled = !t.checked;
        }
      } else {
        d.days[wd][field] = toLatin(t.value).trim();
      }
    }
    return;
  }
  if (t.dataset.dcolor) { const d = dept(t.dataset.dcolor); if (d) { d.color = t.value; Store.touchCfg(); } return; }
  if (t.dataset.dname) { const d = dept(t.dataset.dname); if (d && t.value.trim()) { d.name = t.value.trim(); Store.touchCfg(); } return; }
  if (t.dataset.set) {
    const S = cfg.settings, k = t.dataset.set;
    if (k === 'fridayHoliday') S.fridayHoliday = t.checked;
    else if (k === 'dutyMin') { const v = toMin(t.value); if (v > 0 && v <= 1440) S.dutyMin = v; }
    else if (k.startsWith('f:')) S.factors[k.slice(2)] = Math.max(1, parseFloat(toLatin(t.value)) || 1);
    else S[k] = Math.max(0, parseFloat(toLatin(t.value)) || 0);
    Store.touchCfg(); logEv('تغییر تنظیمات: ' + k);
    if (ui.tab === 'hol') render();
    return;
  }
  if (t.dataset.sd) {
    const d = ui.shiftDraft; d[t.dataset.sd] = t.value;
    if (t.dataset.sd === 'kind') { if (d.kind === 'combo' && !d.refs.length) { const first = cfg.shifts.find((s) => s.kind !== 'combo' && s.code !== d.orig); d.refs.push({ code: first ? first.code : '', o: 0 }); } if (d.kind === 'simple' && !d.segs.length) d.segs.push({ o: 0, s: '08:00', e: '14:00' }); return render(); }
    return shiftDraftPreview();
  }
  if (t.dataset.sg) { const [i, k] = t.dataset.sg.split(':'); ui.shiftDraft.segs[+i][k] = k === 'o' ? +t.value : t.value; return shiftDraftPreview(); }
  if (t.dataset.rf) { const [i, k] = t.dataset.rf.split(':'); ui.shiftDraft.refs[+i][k] = k === 'o' ? +t.value : t.value; return shiftDraftPreview(); }
  if (t.id === 'restore-file' && t.files && t.files[0]) {
    try {
      const o = JSON.parse(await t.files[0].text());
      if (!o || o.app !== 'shiftyar' || !o.cfg) throw new Error('فایل پشتیبان شیفت‌یار نیست.');
      await Store.replaceAll(normalizeCfg(o.cfg), o.assign || {}, o.assignDept || {}, o.log || []);
      ui.undo = []; ui.editPerson = null; await render(); flash('اطلاعات بازیابی شد.', true);
    } catch (err) { flash('بازیابی نشد: ' + err.message, false, '#set-msg'); }
  }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.sd === 'code' || t.dataset.sd === 'name') { ui.shiftDraft[t.dataset.sd] = t.value; }
});

/* ---------- فرم‌های ورود، گذرواژه و کاربران (حالت سرور) ---------- */
document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (!['f-login', 'f-pw', 'f-user', 'f-leave', 'f-swap', 'f-prefs', 'f-wish'].includes(f.id)) return;
  e.preventDefault();
  const fd = new FormData(f);
  const btn = f.querySelector('button[type=submit]');
  if (btn) btn.disabled = true;
  try {
    if (f.id === 'f-login') {
      try {
        const r = await Store.api('POST', '/api/login', { code: toLatin(String(fd.get('code') || '').trim()), password: String(fd.get('password') || '') });
        ME.user = r.user; loginMsg = '';
        if (!ME.user.mustChange) await Store.enterApp();
        ui.tab = tabsFor()[0][0];
      } catch (err) { ME.user = null; loginMsg = err.message; }
      await render();
    } else if (f.id === 'f-pw') {
      const force = f.dataset.force === '1';
      const cur = String(fd.get('current') || ''), nx = String(fd.get('next') || ''), again = String(fd.get('again') || '');
      const fail = async (m) => { if (force) { loginMsg = m; await render(); } else flash(m, false, '#f-pw-msg'); };
      if (nx !== again) return fail('تکرار گذرواژه با گذرواژهٔ جدید یکی نیست.');
      try {
        await Store.api('POST', '/api/password', { current: cur, next: nx });
        if (force) { ME.user.mustChange = false; await Store.enterApp(); ui.tab = tabsFor()[0][0]; loginMsg = ''; await render(); flash('گذرواژهٔ جدید ذخیره شد.', true); }
        else { f.reset(); flash('گذرواژه تغییر کرد.', true, '#f-pw-msg'); }
      } catch (err) { await fail(err.message); }
    } else if (f.id === 'f-prefs') {
      const shift = {}; for (const [k, v] of fd.entries()) if (k.startsWith('sh:')) shift[k.slice(3)] = +v;
      try { const r = await Store.api('PUT', '/api/prefs/' + prefsState.pid, { ot: fd.get('ot'), shift }); prefsState.prefs[prefsState.pid] = r.prefs; flash('ترجیحات ذخیره شد.', true, '#f-prefs-msg'); }
      catch (err) { flash(err.message, false, '#f-prefs-msg'); }
    } else if (f.id === 'f-wish') {
      const day = parseDate(String(fd.get('day') || ''));
      if (day == null) return flash('تاریخ را به شکل ۱۴۰۵/۰۷/۱۲ وارد کنید.', false, '#f-wish-msg');
      try { await Store.api('POST', '/api/wishes', { pid: prefsState.pid, day, kind: fd.get('kind'), code: fd.get('code') || '', note: String(fd.get('note') || '') }); await render(); flash('درخواست ثبت شد.', true, '#f-wish-msg'); }
      catch (err) { flash(err.message, false, '#f-wish-msg'); }
    } else if (f.id === 'f-leave' || f.id === 'f-swap') {
      const msg = '#' + f.id + '-msg', dt = (k) => parseDate(String(fd.get(k) || ''));
      const body = f.id === 'f-leave'
        ? { kind: 'leave', code: fd.get('code'), from: dt('from'), to: dt('to'), note: String(fd.get('note') || '') }
        : { kind: 'swap', peerId: fd.get('peerId'), d1: dt('d1'), d2: dt('d2'), note: String(fd.get('note') || '') };
      if (Object.values(body).some((v) => v === null)) return flash('تاریخ را به شکل ۱۴۰۵/۰۷/۱۲ وارد کنید.', false, msg);
      try { await Store.api('POST', '/api/requests', body); reqState.msg = ''; await render(); flash('درخواست ثبت شد.', true, msg); }
      catch (err) { flash(err.message, false, msg); }
    } else if (f.id === 'f-user') {
      const role_ = fd.get('role');
      const body = {
        code: String(fd.get('code') || '').trim(), role: role_, personId: fd.get('personId') || null,
        deptIds: role_ === 'manager' ? fd.getAll('dept') : [],
      };
      const editing = usersState.edit;
      if (!editing && fd.get('password')) body.password = String(fd.get('password'));
      try {
        if (editing) { await Store.api('PATCH', '/api/users/' + editing.id, body); usersState.edit = null; }
        else {
          const r = await Store.api('POST', '/api/users', body);
          usersState.notice = r.tempPassword
            ? `گذرواژهٔ موقت <b>${esc(r.user.code)}</b>: <span class="num">${esc(r.tempPassword)}</span> — فقط همین یک بار نمایش داده می‌شود.`
            : `حساب <b>${esc(r.user.code)}</b> ساخته شد.`;
        }
        await render();
      } catch (err) { flash(err.message, false, '#f-user-msg'); }
    }
  } finally {
    const again = f.isConnected ? f.querySelector('button[type=submit]') : null;
    if (again) again.disabled = false;
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'u-role') { const fs = $('#u-depts'); if (fs) fs.style.display = e.target.value === 'manager' ? '' : 'none'; }
});

/* ---------- شروع ---------- */
(async function start() {
  const d = d2j(todayJdn()); ui.jy = d.jy; ui.jm = d.jm;
  await render();
  await Store.init();
  await render();
})();
