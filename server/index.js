#!/usr/bin/env node
'use strict';
const { createApp } = require('./app.js');

(async () => {
  const app = createApp();
  await app.bootstrap();
  const port = parseInt(process.env.PORT, 10) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  app.server.listen(port, host, () => console.log(`شیفت‌یار روی http://${host}:${port} اجرا شد`));
  const stop = () => app.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch((e) => { console.error(e); process.exit(1); });
