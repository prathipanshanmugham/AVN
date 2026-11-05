#!/usr/bin/env node
/* Reset (or create) an admin account from the server shell.
 *   npm run admin:reset            -> resets "admin" (or ADMIN_USERNAME)
 *   npm run admin:reset -- meera   -> resets user "meera" and makes them admin
 */
const config = require('../server/config');
const { db } = require('../server/db');
const { generatePassword, hashPassword } = require('../server/util');

const username = (process.argv[2] || config.adminUsername).toLowerCase();
const pw = generatePassword();
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (existing) {
  db.prepare("UPDATE users SET password_hash = ?, must_change = 1, active = 1, role = 'admin' WHERE id = ?").run(hashPassword(pw), existing.id);
} else {
  db.prepare("INSERT INTO users (name, username, password_hash, role, must_change) VALUES (?, ?, ?, 'admin', 1)").run('Administrator', username, hashPassword(pw));
}
console.log('\nAdmin login');
console.log('  Username: ' + username);
console.log('  Temporary password: ' + pw);
console.log('  Sign in at /admin and choose a new password.\n');
