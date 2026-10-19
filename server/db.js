'use strict';
/* پایگاه‌داده: SQLite داخلی Node (بدون وابستگی بیرونی) */
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../web/core.js');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS depts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY, first TEXT NOT NULL DEFAULT '', last TEXT NOT NULL DEFAULT '', code TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '', contract TEXT NOT NULL, dept_id TEXT REFERENCES depts(id) ON DELETE SET NULL,
  pos INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS people_code ON people(code) WHERE code <> '';
CREATE INDEX IF NOT EXISTS people_dept ON people(dept_id);
CREATE TABLE IF NOT EXISTS shifts (code TEXT PRIMARY KEY, body TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS holidays (id TEXT PRIMARY KEY, jy INTEGER, jm INTEGER NOT NULL, jd INTEGER NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assign (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE, day INTEGER NOT NULL, code TEXT NOT NULL,
  PRIMARY KEY (person_id, day)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS assign_day ON assign(day);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE COLLATE NOCASE, pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','staff')),
  person_id TEXT REFERENCES people(id) ON DELETE CASCADE, display TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS users_person ON users(person_id) WHERE person_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS user_depts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dept_id TEXT NOT NULL REFERENCES depts(id) ON DELETE CASCADE, PRIMARY KEY (user_id, dept_id));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, user_id INTEGER, who TEXT NOT NULL DEFAULT '', text TEXT NOT NULL);
`;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  }
}

const getMeta = (db, key, dflt) => {
  const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return r ? JSON.parse(r.value) : dflt;
};
const setMeta = (db, key, val) =>
  db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(val));
const bumpMeta = (db, key) => { const n = getMeta(db, key, 0) + 1; setMeta(db, key, n); return n; };

/** مقادیر پیش‌فرض (شیفت‌ها، تعطیلات ثابت، تنظیمات) فقط یک‌بار در پایگاه‌دادهٔ خالی نوشته می‌شوند */
function seed(db) {
  if (getMeta(db, 'seeded', false)) return;
  tx(db, () => {
    const sh = db.prepare('INSERT INTO shifts(code, body, pos) VALUES(?, ?, ?)');
    Core.defaultShifts().forEach((s, i) => sh.run(s.code, JSON.stringify(s), i));
    const hl = db.prepare('INSERT INTO holidays(id, jy, jm, jd, name) VALUES(?, ?, ?, ?, ?)');
    Core.defaultHolidays().forEach((h) => hl.run(h.id, h.jy, h.jm, h.jd, h.name));
    setMeta(db, 'settings', Core.defaultSettings());
    setMeta(db, 'cfg_version', 1);
    setMeta(db, 'assign_rev', 1);
    setMeta(db, 'seeded', true);
  });
}

module.exports = { open, tx, getMeta, setMeta, bumpMeta };
