const express = require('express');
const rateLimit = require('express-rate-limit');
const { db, MODULES, SETTING_DEFAULTS, QUOTE_COMPONENTS, getSettings, setSetting, getPermissions } = require('../db');
const { ensureCsrf, csrfGuard, currentUser, can, requireStaff, allowMustChange, requireAdmin, signIn } = require('../auth');
const { h, str, optStr, bool, email, url, bad, notFound, HttpError, generatePassword, hashPassword, checkPassword, baseUrl, EMAIL_RE } = require('../util');
const QuoteCalc = require('../../admin/assets/quote-calc');
const { sendTest, sendLink, configured: mailReady } = require('../mailer');
const links = require('../links');
const crypto = require('crypto');

const KEEP_SIGNED_IN = 30 * 86400000;
/** May set a new password without retyping the current one: first sign-in (just typed it) or arrived by sign-in link. */
const freshStart = (req, u) => !!u.must_change && (req.session.viaLink || (req.session.pwAt && Date.now() - req.session.pwAt < 30 * 60000));
const unusablePassword = () => hashPassword(crypto.randomBytes(32).toString('hex'));

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Wait 15 minutes, or use “Forgot password?” to get a sign-in link.' },
});
const linkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many tries. Wait 15 minutes.' } });
const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Wait 15 minutes.' } });

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
  const username = str(req.body.username, 120).trim();
  const password = String(req.body.password || '');
  const u = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR (email IS NOT NULL AND email = ? COLLATE NOCASE) ORDER BY active DESC LIMIT 1').get(username, username);
  if (!u || !checkPassword(password, u.password_hash)) {
    throw new HttpError(401, 'That email / username and password don’t match. Check for typos, or tap “Forgot password?”.');
  }
  if (!u.active) throw new HttpError(403, 'This account is switched off. Ask an admin to turn it back on.');
  await signIn(req, { userId: u.id, pwAt: Date.now() }, { maxAge: bool(req.body.remember) ? KEEP_SIGNED_IN : 0 });
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(u.id);
  res.json({ user: userOut(u), csrf: req.session.csrf });
}));

// "Forgot password?" — emails a 30-minute sign-in link. Same answer whether or not the email has an account.
router.post('/auth/forgot', forgotLimiter, (req, res) => {
  const s = getSettings();
  const ready = mailReady(s);
  const address = String(req.body.email || '').trim().toLowerCase();
  if (ready && EMAIL_RE.test(address)) {
    const u = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND active = 1').get(address);
    if (u) {
      const l = links.create('staff', u.id, 'forgot');
      const base = baseUrl(req);
      setImmediate(() => sendLink({ to: u.email, name: u.name, url: base + l.path, kind: 'staff', purpose: 'forgot', expiresAt: l.expiresAt }).catch(() => {}));
    }
  }
  res.json({ ok: true, email: ready });
});

// Sign-in link: GET shows who it is for (does not use it); POST uses it, signs in, and asks for a new password.
router.get('/auth/link/:token', linkLimiter, (req, res) => {
  const p = links.peek('staff', req.params.token);
  const u = p.row && db.prepare('SELECT name, active FROM users WHERE id = ?').get(p.row.subject_id);
  if (p.error || !u || !u.active) return res.status(410).json({ error: links.MESSAGES[p.error] || 'This account is switched off.' });
  res.json({ name: u.name, purpose: p.row.purpose });
});
router.post('/auth/link', linkLimiter, h(async (req, res) => {
  const p = links.consume('staff', req.body.token);
  const u = p.row && db.prepare('SELECT * FROM users WHERE id = ?').get(p.row.subject_id);
  if (p.error || !u || !u.active) throw new HttpError(410, links.MESSAGES[p.error] || 'This account is switched off.');
  db.prepare("UPDATE users SET must_change = 1, last_login = datetime('now') WHERE id = ?").run(u.id);
  await signIn(req, { userId: u.id, viaLink: true }, { maxAge: bool(req.body.remember) ? KEEP_SIGNED_IN : 0 });
  res.json({ ok: true, csrf: req.session.csrf });
}));

router.post('/auth/logout', (req, res) => {
  delete req.session.userId;
  req.session.save(() => res.json({ ok: true }));
});

router.get('/auth/me', allowMustChange, requireStaff, (req, res) => {
  const perms = {};
  MODULES.forEach((m) => { perms[m] = can(req.user, m); });
  perms.settings = req.user.role === 'admin';
  const user = Object.assign(userOut(req.user), { needsCurrent: !freshStart(req, req.user) });
  res.json({ user, permissions: perms, csrf: ensureCsrf(req) });
});

router.post('/auth/password', allowMustChange, requireStaff, (req, res) => {
  const full = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  const fresh = freshStart(req, req.user);
  const current = String(req.body.current || '');
  if (!fresh && !checkPassword(current, full.password_hash)) throw bad('Your current password is not right. Forgot it? Sign out and tap “Forgot password?”.');
  const next = String(req.body.next || '');
  if (next.length < 8) throw bad('The new password needs at least 8 characters');
  if (next.length > 200) throw bad('The new password is too long');
  if (checkPassword(next, full.password_hash)) throw bad('Choose a new password that is different from the current one');
  db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(hashPassword(next), req.user.id);
  // Other devices signed in with the old password are signed out.
  try {
    db.prepare('SELECT sid, data FROM sessions').all().forEach((r) => {
      try { if (r.sid !== req.sessionID && JSON.parse(r.data).userId === req.user.id) db.prepare('DELETE FROM sessions WHERE sid = ?').run(r.sid); } catch (e) { /* skip */ }
    });
  } catch (e) { /* ignore */ }
  delete req.session.viaLink;
  delete req.session.pwAt;
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
  if (email && !EMAIL_RE.test(email)) throw bad('Check the email address');
  if (email && db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(email)) throw bad('Another user already has that email');
  // With a password typed by the admin: they sign in with it and choose their own. Without: a sign-in link.
  const provided = String(req.body.password || '');
  if (provided && provided.length < 8) throw bad('Password must be at least 8 characters');
  const info = db.prepare('INSERT INTO users (name, username, email, password_hash, role, must_change) VALUES (?,?,?,?,?,1)')
    .run(name, username, email, provided ? hashPassword(provided) : unusablePassword(), role);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  if (provided) return res.status(201).json({ user: userOut(u), tempPassword: provided });
  res.status(201).json({ user: userOut(u), link: makeStaffLink(req, u, 'welcome', bool(req.body.sendEmail)) });
});

function makeStaffLink(req, u, purpose, email) {
  const l = links.create('staff', u.id, purpose, req.user.id);
  const url = baseUrl(req) + l.path;
  const willEmail = !!(email && u.email && mailReady(getSettings()));
  if (willEmail) setImmediate(() => sendLink({ to: u.email, name: u.name, url, kind: 'staff', purpose, expiresAt: l.expiresAt }).catch(() => {}));
  return { url, expiresAt: l.expiresAt, purpose, emailed: willEmail };
}

// A fresh one-time sign-in link for someone who is new or has forgotten their password.
router.post('/users/:id/link', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw notFound();
  if (u.id === req.user.id) throw bad('To change your own password, use My account → Change password');
  if (!u.active) throw bad('Turn this account on first (Edit → Status: Active)');
  res.json(makeStaffLink(req, u, u.last_login ? 'reset' : 'welcome', bool(req.body.sendEmail)));
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
  // Resetting your own account here would lock you into a temporary password; use My account instead.
  if (u.id === req.user.id) throw bad('To change your own password, use My account → Change password');
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
const SWITCHES = ['video_fast_only', 'popup_enabled', 'smtp_secure', 'quote_tax_summary'];
const LONG = { site_description: 400, address: 400, quote_terms: 3000, whatsapp_message: 300, quote_components: 4000, service_areas: 400 };
const HSN_RE = /^[0-9][0-9 ]{3,11}$/;
const SOCIAL = ['social_facebook', 'social_instagram', 'social_youtube', 'social_linkedin'];

/** Settings → Quotations component table: fixed rows, each with group, description, HSN/SAC, GST and price share. */
function cleanComponents(raw) {
  let list;
  try { list = JSON.parse(raw); } catch (e) { throw bad('Component lines could not be read'); }
  if (!Array.isArray(list)) throw bad('Component lines could not be read');
  const byKey = {};
  list.forEach((c) => { if (c && typeof c.key === 'string') byKey[c.key] = c; });
  return JSON.stringify(QUOTE_COMPONENTS.map((d) => {
    const c = byKey[d.key] || d;
    const hsn = str(c.hsn, 12);
    if (hsn && !HSN_RE.test(hsn)) throw bad('HSN/SAC for "' + d.desc + '" should be 4 to 8 digits');
    const share = Number(c.share);
    if (!Number.isFinite(share) || share < 0 || share > 100) throw bad('Price share for "' + d.desc + '" should be 0 to 100');
    return {
      key: d.key, group: str(c.group, 80) || d.group, desc: str(c.desc, 160) || d.desc, hsn,
      gst: QuoteCalc.GST_RATES.includes(Number(c.gst)) ? Number(c.gst) : d.gst, share,
    };
  }));
}
/** Accepts the token, or the whole <meta …content="token"> tag Google / Bing give you. */
function verificationToken(v, label) {
  const m = String(v).match(/content=["']([^"']+)["']/i);
  const token = (m ? m[1] : String(v)).trim();
  if (token && !/^[A-Za-z0-9_-]{8,120}$/.test(token)) throw bad(label + ' verification: paste the code or the whole meta tag');
  return token;
}
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
    if (k === 'quote_format' && !QuoteCalc.FORMATS.some((f) => f[0] === v)) throw bad('Unknown quotation format');
    if ((k === 'quote_hsn_system' || k === 'quote_sac_install') && v && !HSN_RE.test(v)) throw bad('HSN / SAC codes are 4 to 8 digits');
    if (k === 'quote_components') v = cleanComponents(v);
    if (k === 'site_url') {
      const u = url(v);
      if (!u || !/^https?:\/\/[^/]+\/?$/.test(u)) throw bad('Website address looks like https://avnsolar.in');
      v = u.replace(/\/$/, '');
    }
    if (k === 'service_areas') v = v.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean).slice(0, 30).join(', ');
    if (k === 'addr_pincode' && v && !/^\d{6}$/.test(v)) throw bad('PIN code is 6 digits');
    if (k === 'google_verification') v = verificationToken(v, 'Google');
    if (k === 'bing_verification') v = verificationToken(v, 'Bing');
    if (SOCIAL.includes(k) && v) {
      const u = url(v);
      if (!u) throw bad('Social links should start with https://');
      v = u;
    }
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
