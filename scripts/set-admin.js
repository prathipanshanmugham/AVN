#!/usr/bin/env node
/* Set the admin's sign-in email and password exactly, from the server shell.
 *   npm run admin:set -- admin@avnsolar.in 'Your-Password'
 *   npm run admin:set -- admin@avnsolar.in 'Your-Password' meera   (another username)
 * The admin can then sign in at /admin with that email (or the username). No forced password change.
 * The password is only hashed into the database. Keep it out of git and chat logs.
 */
const { db } = require('../server/db');
const { hashPassword, EMAIL_RE } = require('../server/util');

const [emailArg, password, usernameArg] = process.argv.slice(2);
const email = String(emailArg || '').trim().toLowerCase();
const username = String(usernameArg || 'admin').trim().toLowerCase();

if (!EMAIL_RE.test(email) || !password) {
  console.error("Usage: npm run admin:set -- admin@avnsolar.in 'Your-Password' [username]");
  process.exit(1);
}
if (password.length < 8) {
  console.error('Use a password of at least 8 characters.');
  process.exit(1);
}

let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  || (usernameArg ? null : db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get());

db.transaction(() => {
  const clash = db.prepare('SELECT id, username FROM users WHERE email = ? COLLATE NOCASE AND id != ?').get(email, user ? user.id : 0);
  if (clash) {
    db.prepare('UPDATE users SET email = NULL WHERE id = ?').run(clash.id);
    console.log('Removed ' + email + ' from user "' + clash.username + '" so it can sign in to this admin account.');
  }
  if (user) {
    db.prepare("UPDATE users SET email = ?, password_hash = ?, must_change = 0, active = 1, role = 'admin' WHERE id = ?")
      .run(email, hashPassword(password), user.id);
  } else {
    const id = db.prepare("INSERT INTO users (name, username, email, password_hash, role, must_change) VALUES ('Administrator', ?, ?, ?, 'admin', 0)")
      .run(username, email, hashPassword(password)).lastInsertRowid;
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }
})();

console.log('\nAdmin sign-in updated');
console.log('  Sign in at /admin/login with: ' + email + '  (or username "' + user.username + '")');
console.log('  Password: the one you just typed\n');
