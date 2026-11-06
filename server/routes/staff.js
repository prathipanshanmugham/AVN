const express = require('express');
const rateLimit = require('express-rate-limit');
const { db, MODULES, SETTING_DEFAULTS, getSettings, setSetting, getPermissions } = require('../db');
const { ensureCsrf, csrfGuard, currentUser, can, requireStaff, allowMustChange, requireAdmin, signIn } = require('../auth');
const { h, str, optStr, bool, email, bad, notFound, HttpError, generatePassword, hashPassword, checkPassword } = require('../util');
const { sendTest } = require('../mailer');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
});

const userOut = (u) => ({
  id: u.id, name: u.name, username: u.username, email: u.email || '', role: u.role,
  active: !!u.active, mustChange: !!u.must_change, lastLogin: u.last_login || null, createdAt: u.created_at,
});

// --- CSRF token for the admin and portal apps ---
router.get('/csrf', (req, res) => {
  res.json({ csrf: ensureCsrf(req) });
});

router.use(csrfGuard);

// --- Staff sign in ---
router.post('/auth/login', loginLimiter, h(async (req, res) => {
  const username = str(req.body.username, 80);
  const password = String(req.body.password || '');
  const u = db.prepare('SELECT * FROM users WHERE username = ? OR (email IS NOT NULL AND email = ? COLLATE NOCASE)').get(username, username);
  if (!u || !u.active || !checkPassword(password, u.password_hash)) {
    throw new HttpError(401, 'Wrong username or password');
  }
  await signIn(req, { userId: u.id });
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(u.id);
  res.json({ user: userOut(u), csrf: req.session.csrf });
}));

router.post('/auth/logout', (req, res) => {
  delete req.session.userId;
  req.session.save(() => res.json({ ok: true }));
});

router.get('/auth/me', allowMustChange, requireStaff, (req, res) => {
  const perms = {};
  MODULES.forEach((m) => { perms[m] = can(req.user, m); });
  perms.settings = req.user.role === 'admin';
  res.json({ user: userOut(req.user), permissions: perms, csrf: ensureCsrf(req) });
});

router.post('/auth/password', allowMustChange, requireStaff, (req, res) => {
  const full = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!checkPassword(req.body.current, full.password_hash)) throw bad('Your current password is not right');
  const next = String(req.body.next || '');
  if (next.length < 10) throw bad('Use at least 10 characters');
  if (next === String(req.body.current)) throw bad('Choose a password different from the current one');
  db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(hashPassword(next), req.user.id);
  res.json({ ok: true });
});

// Everything below needs a signed-in staff member.
router.use(requireStaff);

// Lightweight staff list for owner / PM dropdowns.
router.get('/team', (req, res) => {
  res.json(db.prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name').all());
});

// --- Users (admin only) ---
router.get('/users', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY role, name').all().map(userOut));
});

router.post('/users', requireAdmin, (req, res) => {
  const name = str(req.body.name, 80);
  const username = str(req.body.username, 40).toLowerCase();
  const email = optStr(req.body.email, 120);
  const role = req.body.role === 'admin' ? 'admin' : 'staff';
  if (!name) throw bad('Enter a name');
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad('Username: 3–40 letters, numbers, dot, dash or underscore');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw bad('That username is taken');
  const provided = String(req.body.password || '');
  if (provided && provided.length < 10) throw bad('Password must be at least 10 characters');
  const temp = provided || generatePassword();
  const info = db.prepare('INSERT INTO users (name, username, email, password_hash, role, must_change) VALUES (?,?,?,?,?,1)')
    .run(name, username, email, hashPassword(temp), role);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ user: userOut(u), tempPassword: temp });
});

function activeAdmins(exceptId) {
  return db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(exceptId).c;
}

router.patch('/users/:id', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw notFound();
  const name = req.body.name !== undefined ? str(req.body.name, 80) : u.name;
  const email = req.body.email !== undefined ? optStr(req.body.email, 120) : u.email;
  const role = req.body.role !== undefined ? (req.body.role === 'admin' ? 'admin' : 'staff') : u.role;
  const active = req.body.active !== undefined ? (bool(req.body.active) ? 1 : 0) : u.active;
  if (!name) throw bad('Enter a name');
  const losingAdmin = u.role === 'admin' && u.active && (role !== 'admin' || !active);
  if (losingAdmin && activeAdmins(u.id) === 0) throw bad('Keep at least one active admin');
  if (u.id === req.user.id && !active) throw bad('You cannot deactivate yourself');
  // Deactivated users are rejected on their next request (requireStaff checks `active` every time).
  db.prepare('UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?').run(name, email, role, active, u.id);
  res.json(userOut(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)));
});

router.post('/users/:id/reset-password', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw notFound();
  const temp = generatePassword();
  db.prepare('UPDATE users SET password_hash = ?, must_change = 1 WHERE id = ?').run(hashPassword(temp), u.id);
  res.json({ tempPassword: temp });
});

// --- Permissions: what the Staff role can open (admins can open everything) ---
router.get('/permissions', (req, res) => {
  res.json(getPermissions());
});

router.put('/permissions', requireAdmin, (req, res) => {
  const up = db.prepare('INSERT INTO permissions (module, staff_allowed) VALUES (?, ?) ON CONFLICT(module) DO UPDATE SET staff_allowed = excluded.staff_allowed');
  MODULES.forEach((m) => { if (req.body[m] !== undefined) up.run(m, bool(req.body[m]) ? 1 : 0); });
  res.json(getPermissions());
});

// --- Settings ---
// The SMTP password is never sent back to the browser.
function publicSettings() {
  const s = getSettings();
  const out = Object.assign({}, s, { smtp_pass: '', smtp_pass_set: !!s.smtp_pass });
  try { out.mail_status = s.mail_status ? JSON.parse(s.mail_status) : null; } catch (e) { out.mail_status = null; }
  return out;
}

router.get('/settings', (req, res) => {
  res.json(publicSettings());
});

const NUMERIC = {
  calc_yield: [0.1, 20], calc_roof: [1, 1000], calc_tariff_home: [0.1, 100], calc_tariff_biz: [0.1, 100],
  popup_delay: [3, 600], quote_validity: [1, 365], quote_module_wp: [50, 2000], smtp_port: [1, 65535],
  rate_ongrid: [0, 10000000], rate_hybrid: [0, 10000000], rate_offgrid: [0, 10000000],
};
const LABELS = {
  calc_yield: 'units per kWp', calc_roof: 'roof area', calc_tariff_home: 'home tariff', calc_tariff_biz: 'business tariff',
  popup_delay: 'popup delay', quote_validity: 'quotation validity', quote_module_wp: 'module rating', smtp_port: 'SMTP port',
  rate_ongrid: 'on-grid rate', rate_hybrid: 'hybrid rate', rate_offgrid: 'off-grid rate',
};
const SWITCHES = ['video_fast_only', 'popup_enabled', 'smtp_secure'];
const LONG = { site_description: 400, address: 400, quote_terms: 3000, whatsapp_message: 300 };
const READ_ONLY = ['mail_status'];

router.put('/settings', requireAdmin, (req, res) => {
  const updates = {};
  Object.keys(SETTING_DEFAULTS).forEach((k) => {
    if (req.body[k] === undefined || READ_ONLY.includes(k)) return;
    let v = LONG[k] ? str(req.body[k], LONG[k]) : str(req.body[k], 160).replace(/[\r\n]+/g, ' ');
    if (NUMERIC[k]) {
      const n = Number(v);
      const [min, max] = NUMERIC[k];
      if (v === '' || !Number.isFinite(n) || n < min || n > max) throw bad('Enter a valid number for ' + LABELS[k]);
      v = String(n);
    }
    if (SWITCHES.includes(k)) v = bool(req.body[k]) ? '1' : '0';
    if (k === 'ga_id' && v && !/^G-[A-Z0-9]{4,16}$/i.test(v)) throw bad('Google Analytics ID looks like G-XXXXXXXXXX');
    if (k === 'quote_tax_mode' && !['composite', 'itemised'].includes(v)) throw bad('Unknown GST mode');
    if (k === 'quote_prefix' && !/^[A-Za-z0-9-]{1,16}$/.test(v)) throw bad('Quotation prefix: up to 16 letters, numbers or dashes');
    if (k === 'lead_emails' && v) {
      const list = v.split(/[\s,;]+/).filter(Boolean);
      const badOne = list.find((x) => !email(x));
      if (badOne) throw bad('"' + badOne + '" is not a valid email address');
      if (list.length > 10) throw bad('Up to 10 email addresses');
      v = list.join(', ');
    }
    if (k === 'smtp_from' && v && !email(v) && !/^[^<>]{1,80}<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$/.test(v)) throw bad('Sender: an email address, or Name <email@domain>');
    if (k === 'smtp_host' && v && !/^[a-z0-9.-]+$/i.test(v)) throw bad('SMTP server looks like smtp.gmail.com');
    if (k === 'smtp_pass' && v === '') return; // blank = keep the saved password
    updates[k] = v;
  });
  if (bool(req.body.smtp_pass_clear)) updates.smtp_pass = '';
  db.transaction(() => Object.entries(updates).forEach(([k, v]) => setSetting(k, v)))();
  res.json(publicSettings());
});

router.post('/settings/test-email', requireAdmin, h(async (req, res) => {
  const to = req.body.to ? email(req.body.to) : null;
  if (req.body.to && !to) throw bad('Enter a valid email address');
  try {
    const list = await sendTest(to);
    res.json({ ok: true, to: list, status: publicSettings().mail_status });
  } catch (e) {
    throw bad('Could not send: ' + e.message);
  }
}));

module.exports = router;
module.exports.currentUser = currentUser;
