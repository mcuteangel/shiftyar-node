'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const E = require('../web/export.js');

test('xlsx: ساختار zip درست است و CRC هر فایل می‌خورد', () => {
  const b = E.xlsx([{ name: 'الف', rows: [['نام', { v: 1.5, s: 2 }], ['a<b&c', 2]] }, { name: 'ب', rows: [['x']] }]);
  assert.equal(b[0], 0x50); assert.equal(b[1], 0x4b);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const eocd = b.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  const n = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
  assert.equal(n, 7, '۷ فایل: content-types، rels، workbook، rels، styles، ۲ برگه');
  let p = cdOff; const names = [];
  for (let i = 0; i < n; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
    names.push(Buffer.from(b.subarray(p + 46, p + 46 + nl)).toString());
    const lnl = dv.getUint16(off + 26, true), start = off + 30 + lnl;
    assert.equal(E.crc32(b.subarray(start, start + size)), crc, names[i]);
    p += 46 + nl;
  }
  assert.ok(names.includes('xl/worksheets/sheet2.xml'));
  const sheet1 = Buffer.from(b.subarray(0, cdOff)).toString();
  assert.ok(sheet1.includes('a&lt;b&amp;c'), 'متن escape می‌شود');
  assert.ok(sheet1.includes('rightToLeft="1"'));
  void zlib;
});
