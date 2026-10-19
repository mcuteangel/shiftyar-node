'use strict';
/* رمزنگاری گذرواژه، نشست‌ها و محدودیت تلاش ورود */
const crypto = require('node:crypto');

const SCRYPT_N = 16384;
const scrypt = (pw, salt, n) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(pw, salt, 32, { N: n, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, SCRYPT_N);
  return ['scrypt', SCRYPT_N, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifyPassword(pw, stored) {
  try {
    const [alg, n, s, h] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const want = Buffer.from(h, 'base64');
    const got = await scrypt(pw, Buffer.from(s, 'base64'), +n);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  } catch (_) { return false; }
}
/** برای یکسان‌سازی زمان پاسخ وقتی کاربر وجود ندارد */
let dummy = null;
async function dummyVerify(pw) {
  if (!dummy) dummy = await hashPassword('dummy-password-for-timing');
  await verifyPassword(pw, dummy);
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function tempPassword(len = 10) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

class Limiter {
  constructor(max, windowMs) { this.max = max; this.windowMs = windowMs; this.m = new Map(); }
  _get(key, now) {
    const e = this.m.get(key);
    if (e && now - e.first > this.windowMs) { this.m.delete(key); return null; }
    return e || null;
  }
  retryAfter(key, now = Date.now()) {
    const e = this._get(key, now);
    return e && e.n >= this.max ? Math.ceil((e.first + this.windowMs - now) / 1000) : 0;
  }
  fail(key, now = Date.now()) {
    const e = this._get(key, now);
    if (e) e.n++; else this.m.set(key, { n: 1, first: now });
  }
  reset(key) { this.m.delete(key); }
  sweep(now = Date.now()) { for (const [k, e] of this.m) if (now - e.first > this.windowMs) this.m.delete(k); }
}

module.exports = { hashPassword, verifyPassword, dummyVerify, tempPassword, newToken, hashToken, Limiter };
