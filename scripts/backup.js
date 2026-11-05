#!/usr/bin/env node
/* Daily backup: consistent copy of the database + uploads archive, keeps the last 14 days.  node scripts/backup.js */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('../server/config');
const { db } = require('../server/db');

const dir = path.join(config.dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);

db.backup(path.join(dir, `avn-${stamp}.db`)).then(() => {
  try {
    execFileSync('tar', ['-czf', path.join(dir, `uploads-${stamp}.tar.gz`), '-C', path.dirname(config.uploadDir), path.basename(config.uploadDir)]);
  } catch (e) {
    console.error('Uploads archive failed:', e.message);
  }
  const files = fs.readdirSync(dir).filter((f) => /^(avn|uploads)-\d{4}-\d{2}-\d{2}/.test(f)).sort();
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  files.filter((f) => f.match(/\d{4}-\d{2}-\d{2}/)[0] < cutoff).forEach((f) => fs.unlinkSync(path.join(dir, f)));
  console.log(new Date().toISOString(), 'backup ok', stamp);
}).catch((e) => { console.error('Backup failed', e); process.exit(1); });
