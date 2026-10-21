// آزمون سرتاسری در مرورگر واقعی (اختیاری): npm i --no-save playwright-core && CHROMIUM_PATH=/مسیر/chromium node test/e2e.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const OUT = process.env.SHOTS_DIR || path.join(require('os').tmpdir(), 'shiftyar-shots'); fs.mkdirSync(OUT, { recursive: true });
const DBF = path.join(require('os').tmpdir(), 'shiftyar-e2e.db'); for (const x of ['', '-wal', '-shm']) try { fs.unlinkSync(DBF + x); } catch (e) {}
const PORT = 3111, URL = `http://127.0.0.1:${PORT}`;
const log = [];
const ok = (c, m) => { log.push((c ? 'OK   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const srv = spawn('node', [path.join(__dirname, '..', 'server', 'index.js')], { env: Object.assign({}, process.env, { PORT, HOST: '127.0.0.1', DB_PATH: DBF, ADMIN_PASSWORD: 'Admin#pass1' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let ready = false; srv.stdout.on('data', (d) => { if (/اجرا شد/.test(String(d))) ready = true; });
  srv.stderr.on('data', () => {});
  for (let i = 0; i < 50 && !ready; i++) await sleep(100);
  ok(ready, 'سرور بالا آمد');

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const errors = [];
  const newCtx = async (opts) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1360, height: 900 }, locale: 'fa-IR' }, opts));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure() || {}).errorText));
    return page;
  };
  const text = async (p, sel) => (await p.locator(sel).first().innerText()).replace(/\s+/g, ' ');
  const login = async (p, code, pw) => {
    await p.fill('#login-code', code); await p.fill('#login-pw', pw); await p.click('#login-btn'); await sleep(500);
  };
  const forceChange = async (p, cur, nw) => {
    await p.fill('#f-pw [name=current]', cur); await p.fill('#f-pw [name=next]', nw); await p.fill('#f-pw [name=again]', nw);
    await p.click('#f-pw button[type=submit]'); await sleep(700);
  };

  /* ---- ادمین ---- */
  const admin = await newCtx();
  await admin.goto(URL); await admin.waitForSelector('#f-login');
  ok(true, 'صفحهٔ ورود نمایش داده شد');
  await admin.screenshot({ path: path.join(OUT, '1-login.png') });
  await login(admin, 'admin', 'wrong-password');
  ok(/درست نیست/.test(await text(admin, '#f-login')), 'گذرواژهٔ غلط پیام می‌دهد');
  await login(admin, 'admin', 'Admin#pass1');
  ok(await admin.locator('#f-pw[data-force="1"]').count() === 1, 'اجبار به تعویض گذرواژهٔ موقت');
  await forceChange(admin, 'Admin#pass1', 'Admin#pass2');
  ok(await admin.locator('nav.tabs').count() === 1, 'ادمین وارد برنامه شد');
  const tabsAdmin = await admin.locator('nav.tabs button').allInnerTexts();
  ok(tabsAdmin.includes('کاربران') && tabsAdmin.includes('پرسنل'), 'تب‌های ادمین: ' + tabsAdmin.join('، '));
  const fontsOk = await admin.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px Vazirmatn') && document.fonts.check('16px Lalezar'); });
  ok(fontsOk, 'فونت‌های خودمیزبان بارگذاری شدند');

  // بخش‌ها
  await admin.click('[data-tab="depts"]');
  for (const [n, c] of [['اورژانس', '#e0573f'], ['داخلی', '#2f7dd1']]) {
    await admin.fill('#f-dept [name=name]', n);
    await admin.locator('#f-dept [name=color]').evaluate((el, v) => { el.value = v; }, c);
    await admin.click('#f-dept button[type=submit]'); await sleep(150);
  }
  // پرسنل
  await admin.click('[data-tab="people"]');
  const people = [['علی', 'رضایی', '1001', 'company', 1], ['مریم', 'کریمی', '1002', 't4', 1], ['زهرا', 'موسوی', '2001', 'official', 2], ['رضا', 'محمدی', '2002', 'company', 2]];
  for (const [f, l, c, k, d] of people) {
    await admin.fill('#f-person [name=first]', f); await admin.fill('#f-person [name=last]', l); await admin.fill('#f-person [name=code]', c);
    await admin.selectOption('#f-person [name=contract]', k); await admin.locator('#f-person [name=deptId]').selectOption({ index: d });
    await admin.click('#f-person button[type=submit]'); await sleep(150);
  }
  // کد تکراری
  await admin.fill('#f-person [name=first]', 'تکراری'); await admin.fill('#f-person [name=last]', 'تست'); await admin.fill('#f-person [name=code]', '1001');
  await admin.click('#f-person button[type=submit]'); await sleep(200);
  ok(/قبلاً ثبت/.test(await text(admin, '#f-person-msg')), 'کد پرسنلی تکراری رد شد');
  await sleep(900);
  ok(/ذخیره شد/.test(await text(admin, '#savestate')), 'پیکربندی روی سرور ذخیره شد');

  // کاربران: ساخت گروهی
  await admin.click('[data-tab="users"]'); await sleep(300);
  await admin.click('[data-act="provision"]'); await sleep(600);
  const prov = await admin.locator('#textbox-area').inputValue();
  const temps = {}; prov.split('\n').slice(1).forEach((l) => { const [c, , p] = l.split('\t'); temps[c] = p; });
  ok(Object.keys(temps).length === 4, 'چهار حساب پرسنل ساخته شد: ' + Object.keys(temps).join(','));
  await admin.screenshot({ path: path.join(OUT, '2-users.png'), fullPage: true });
  // مدیر بخش: ویرایش حساب 2001 (زهرا) به مدیر داخلی
  const row = admin.locator('tr', { hasText: '2001' });
  await row.locator('[data-act="edituser"]').click(); await sleep(300);
  await admin.selectOption('#u-role', 'manager');
  await admin.locator('#u-depts input[type=checkbox]').nth(1).check();
  await admin.click('#f-user button[type=submit]'); await sleep(600);
  ok(/مدیر بخش/.test(await text(admin, 'tr:has-text("2001")')), 'نقش مدیر بخش تنظیم شد');

  // برنامه: رنگ‌آمیزی با ماوس
  await admin.click('[data-tab="sched"]'); await sleep(500);
  await admin.click('[data-brush="N"]');
  const cells = admin.locator('tr[data-pid]').first().locator('td.cell');
  const b0 = await cells.nth(2).boundingBox(), b1 = await cells.nth(4).boundingBox();
  await admin.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2); await admin.mouse.down();
  await admin.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2, { steps: 6 }); await admin.mouse.up();
  await sleep(300);
  ok(await admin.locator('tr[data-pid]').first().locator('.c').count() === 3, 'سه خانه با کشیدن ماوس رنگ شد');
  await admin.click('[data-brush="M"]');
  const b3 = await cells.nth(5).boundingBox(); await admin.mouse.click(b3.x + b3.width / 2, b3.y + b3.height / 2); await sleep(200);
  ok(await admin.locator('td.cell.warn').count() >= 1, 'هشدار فاصلهٔ شیفت نمایش داده شد');
  // یک نفر از بخش داخلی
  await admin.click('[data-brush="A"]');
  const rows = admin.locator('tr[data-pid]');
  const rb = await rows.nth(2).locator('td.cell').nth(0).boundingBox(); await admin.mouse.click(rb.x + 10, rb.y + 10); await sleep(200);
  await sleep(900);
  ok(/ذخیره شد/.test(await text(admin, '#savestate')), 'برنامه روی سرور ذخیره شد');
  await admin.screenshot({ path: path.join(OUT, '3-admin-sched.png') });
  // بازخوانی صفحه: داده باید از سرور بیاید
  await admin.reload(); await admin.waitForSelector('nav.tabs'); await sleep(600);
  ok(await admin.locator('tr[data-pid]').first().locator('.c').count() === 4, 'پس از رفرش، برنامه از سرور برگشت');

  // خروج
  await admin.click('[data-tab="acct"]'); await admin.click('[data-act="logout"]'); await admin.waitForSelector('#f-login');
  ok(true, 'خروج کار می‌کند');
  const after = await admin.evaluate(async () => (await fetch('/api/config')).status);
  ok(after === 401, 'پس از خروج API بسته است');

  /* ---- پرسنل (staff) ---- */
  const staff = await newCtx({ viewport: { width: 400, height: 860 } });
  await staff.goto(URL); await staff.waitForSelector('#f-login');
  await login(staff, '1001', temps['1001']);
  await forceChange(staff, temps['1001'], 'Staff#pass1');
  const tabsStaff = await staff.locator('nav.tabs button').allInnerTexts();
  ok(JSON.stringify(tabsStaff) === JSON.stringify(['برنامه من', 'گزارش من', 'درخواست‌ها', 'حساب من']), 'تب‌های پرسنل: ' + tabsStaff.join('، '));
  ok(await staff.locator('[data-brush]').count() === 0, 'پرسنل قلم ویرایش ندارد');
  ok(await staff.locator('.pc-day.cell .c').count() === 4, 'پرسنل شیفت‌های خودش را می‌بیند');
  const before = await staff.locator('.pc-day .c').count();
  const d3 = staff.locator('.pc-day.cell').nth(10); await d3.click(); await sleep(400);
  ok(await staff.locator('.pc-day .c').count() === before, 'کلیک روی روز چیزی را عوض نمی‌کند');
  const hs = await staff.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok(hs, 'در عرض موبایل اسکرول افقی صفحه نیست');
  await staff.screenshot({ path: path.join(OUT, '4-staff-phone.png'), fullPage: true });
  const api = await staff.evaluate(async () => {
    const h = { 'X-Requested-With': 'shiftyar', 'Content-Type': 'application/json' };
    const a = await fetch('/api/users', { headers: h }); const b = await fetch('/api/assign', { method: 'POST', headers: h, body: JSON.stringify({ changes: [{ pid: 'x', j: 2460000, code: 'M' }] }) });
    return [a.status, b.status];
  });
  ok(api[0] === 403 && api[1] === 403, 'API برای پرسنل بسته است: ' + api.join(','));

  /* ---- مدیر بخش ---- */
  const mgr = await newCtx();
  await mgr.goto(URL); await mgr.waitForSelector('#f-login');
  await login(mgr, '2001', temps['2001']);
  await forceChange(mgr, temps['2001'], 'Mgr#pass123');
  const tabsM = await mgr.locator('nav.tabs button').allInnerTexts();
  ok(!tabsM.includes('پرسنل') && tabsM.includes('برنامه شیفت'), 'تب‌های مدیر بخش: ' + tabsM.join('، '));
  const names = await mgr.locator('tr[data-pid] th.nm b').allInnerTexts();
  ok(names.length === 2 && names.every((n) => /موسوی|محمدی/.test(n)), 'مدیر فقط پرسنل بخش خودش را می‌بیند: ' + names.join('، '));
  await mgr.click('[data-brush="A"]');
  const mc = mgr.locator('tr[data-pid]').nth(1).locator('td.cell').nth(8); const mb = await mc.boundingBox();
  await mgr.mouse.click(mb.x + 10, mb.y + 10); await sleep(1000);
  ok(/ذخیره شد/.test(await text(mgr, '#savestate')), 'مدیر بخش توانست برنامه را ثبت کند');
  await mgr.screenshot({ path: path.join(OUT, '5-manager.png') });

  // همگام‌سازی: ادمین دوباره وارد شود و تغییر مدیر را ببیند
  const admin2 = await newCtx();
  await admin2.goto(URL); await login(admin2, 'admin', 'Admin#pass2'); await sleep(600);
  const cnt = await admin2.locator('td.cell .c').count();
  ok(cnt === 4 + 1 + 1, 'ادمین تغییر مدیر بخش را هم می‌بیند (' + cnt + ' خانه)');
  await admin2.click('[data-tab="set"]'); await sleep(500);
  const logTxt = await text(admin2, 'table.t');
  ok(/مدیر سیستم|رضایی|موسوی|محمدی/.test(logTxt) && /خانه|←/.test(logTxt), 'گزارش تغییرات با نام کاربر');
  await admin2.screenshot({ path: path.join(OUT, '6-admin-settings.png') });
  await admin2.click('[data-tab="rep"]'); await sleep(500);
  await admin2.screenshot({ path: path.join(OUT, '7-report.png'), fullPage: true });


  // درخواست مرخصی: پرسنل ثبت می‌کند، مدیر سیستم تأیید می‌کند، برنامه تغییر می‌کند
  const Core = require('../web/core.js');
  const dA = Core.fmtDateLatin(Core.todayJdn() + 5), dB = Core.fmtDateLatin(Core.todayJdn() + 6);
  await staff.click('[data-tab="req"]'); await sleep(500);
  ok(await staff.locator('#f-leave').count() === 1 && await staff.locator('#f-swap').count() === 1, 'فرم‌های مرخصی و جابه‌جایی نمایش داده می‌شود');
  // انتخابگر تاریخ
  await staff.click('#f-leave [name=to]'); await sleep(200);
  ok(await staff.locator('#dp').count() === 1, 'انتخابگر تاریخ باز شد');
  await staff.screenshot({ path: path.join(OUT, '9a-datepicker.png') });
  const h1 = await text(staff, '#dp .dph b');
  await staff.click('#dp [data-dpm="1"]'); const h2 = await text(staff, '#dp .dph b');
  ok(h1 !== h2, 'ماه بعد در انتخابگر: ' + h1 + ' ← ' + h2);
  await staff.click('#dp [data-dpm="-1"]'); await staff.click('#dp .dpd.today'); await sleep(150);
  ok(await staff.inputValue('#f-leave [name=to]') === Core.fmtDateLatin(Core.todayJdn()) && await staff.locator('#dp').count() === 0, 'انتخاب روز مقدار را می‌نویسد و انتخابگر بسته می‌شود');
  await staff.fill('#f-leave [name=from]', 'خراب'); await staff.fill('#f-leave [name=to]', dB); await staff.click('#f-leave button[type=submit]'); await sleep(300);
  ok(/تاریخ را به شکل/.test(await text(staff, '#f-leave-msg')), 'تاریخ نامعتبر پیام می‌دهد');
  await staff.fill('#f-leave [name=from]', dA); await staff.fill('#f-leave [name=note]', 'سفر'); await staff.click('#f-leave button[type=submit]'); await sleep(800);
  ok(await staff.locator('.req-item').count() === 1 && /در انتظار تأیید مدیر/.test(await text(staff, '.req-item')), 'درخواست ثبت و در فهرست پرسنل دیده می‌شود');
  await admin2.reload(); await sleep(700);
  const badge = await text(admin2, 'nav.tabs [data-tab="req"]');
  ok(/۱/.test(badge), 'نشان درخواست‌ها برای مدیر: ' + badge);
  await admin2.click('[data-tab="req"]'); await sleep(500);
  await admin2.fill('.req-reply', 'موافقم');
  await admin2.click('[data-act="reqact"][data-a="approve"]'); await sleep(800);
  ok(/تأیید شد/.test(await text(admin2, '.req-item')), 'مدیر درخواست را تأیید کرد');
  await staff.click('[data-tab="req"]'); await sleep(600);
  ok(/تأیید شد/.test(await text(staff, '.req-item')) && /موافقم/.test(await text(staff, '.req-item')), 'پرسنل نتیجه و پاسخ را می‌بیند');
  await staff.click('[data-tab="pcal"]'); await sleep(600);
  const jd = Core.todayJdn() + 5;
  const got = await staff.evaluate(async (j) => (await (await fetch(`/api/assign?from=${j}&to=${j}`)).json()).assign, jd);
  ok(Object.values(got).some((m) => m[jd] === 'LV'), 'مرخصی روی برنامهٔ فرد اعمال شد');
  await staff.screenshot({ path: path.join(OUT, '9-staff-requests.png'), fullPage: true });


  // پیشنهاد خودکار، Excel و PDF (ادمین)
  await admin2.click('[data-tab="sched"]'); await sleep(600);
  const deptVals = await admin2.locator('#f-dept option').evaluateAll((os) => os.map((o) => o.value));
  await admin2.selectOption('#f-dept', deptVals[1]); await sleep(400);
  await admin2.click('[data-act="autoopen"]'); await sleep(300);
  await admin2.fill('[data-need="M"]', '1'); await admin2.fill('[data-need="A"]', '1'); await admin2.fill('[data-need="N"]', '0');
  await admin2.click('[data-act="autorun"]'); await sleep(500);
  const autoTxt = await text(admin2, '#autopanel');
  ok(/خانه پیشنهاد شد/.test(autoTxt), 'پیشنهاد خودکار محاسبه شد: ' + autoTxt.slice(autoTxt.indexOf('خانه') - 6, autoTxt.indexOf('خانه') + 40));
  const beforeCells = await admin2.locator('td.cell .c').count();
  await admin2.click('[data-act="autoapply"]'); await sleep(900);
  const afterCells = await admin2.locator('td.cell .c').count();
  ok(afterCells > beforeCells + 10, `پیشنهاد روی برنامه اعمال شد (${beforeCells} ← ${afterCells})`);
  ok(/ذخیره شد/.test(await text(admin2, '#savestate')), 'پیشنهاد اعمال‌شده روی سرور ذخیره شد');
  await admin2.click('[data-act="undo"]'); await sleep(600);
  ok(await admin2.locator('td.cell .c').count() === beforeCells, 'بازگردانی پیشنهاد کار می‌کند');
  await admin2.screenshot({ path: path.join(OUT, '10-autoplan.png') });
  const [dl] = await Promise.all([admin2.waitForEvent('download'), admin2.click('[data-act="schedxlsx"]')]);
  const xp = path.join(OUT, 'roster.xlsx'); await dl.saveAs(xp);
  ok(/\.xlsx$/.test(dl.suggestedFilename()) && fs.statSync(xp).size > 1000 && fs.readFileSync(xp).slice(0, 2).toString() === 'PK', 'خروجی Excel برنامه دانلود شد: ' + dl.suggestedFilename());
  await admin2.click('[data-tab="rep"]'); await sleep(500);
  const [dl2] = await Promise.all([admin2.waitForEvent('download'), admin2.click('[data-act="repxlsx"]')]);
  await dl2.saveAs(path.join(OUT, 'report.xlsx'));
  ok(/^report-.*\.xlsx$/.test(dl2.suggestedFilename()), 'خروجی Excel گزارش دانلود شد');
  await admin2.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await admin2.click('[data-act="repprint"]'); await sleep(300);
  ok(await admin2.evaluate(() => window.__printed === true && !!document.querySelector('#printarea table')), 'نمای چاپ ساخته و چاپ فراخوانی شد');
  await admin2.emulateMedia({ media: 'print' });
  await admin2.pdf({ path: path.join(OUT, 'report.pdf'), landscape: true, format: 'A4', printBackground: true });
  await admin2.emulateMedia({ media: 'screen' });
  ok(fs.statSync(path.join(OUT, 'report.pdf')).size > 5000, 'PDF گزارش تولید شد');

  // تم تاریک
  const dark = await newCtx({ colorScheme: 'dark' });
  await dark.goto(URL); await login(dark, 'admin', 'Admin#pass2'); await sleep(700);
  await dark.screenshot({ path: path.join(OUT, '8-dark.png') });

  console.log(log.join('\n'));
  console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'NO BROWSER ERRORS');
  await browser.close(); srv.kill();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.log(log.join('\n')); console.error('E2E CRASH', e); process.exit(1); });
