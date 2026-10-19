'use strict';
// پشتیبان‌گیری سازگار (VACUUM INTO) و نگه‌داشتن ۳۰ نسخهٔ آخر
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const [src, outDir] = [process.argv[2] || 'data/shiftyar.db', process.argv[3] || 'data/backups'];
if (!fs.existsSync(src)) { console.error('فایل پایگاه‌داده پیدا نشد: ' + src); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = path.join(outDir, `shiftyar-${stamp}.db`);
const db = new DatabaseSync(src);
db.exec('PRAGMA busy_timeout = 5000');
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();
const keep = fs.readdirSync(outDir).filter((f) => /^shiftyar-.*\.db$/.test(f)).sort();
for (const f of keep.slice(0, Math.max(0, keep.length - 30))) fs.unlinkSync(path.join(outDir, f));
console.log('پشتیبان ساخته شد: ' + dest);
