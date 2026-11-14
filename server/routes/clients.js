const express = require('express');
const { db } = require('../db');
const { requirePerm } = require('../auth');
const crypto = require('crypto');
const { getSettings } = require('../db');
const { str, optStr, int, bool, bad, notFound, phone, generatePassword, hashPassword, baseUrl, EMAIL_RE } = require('../util');
const links = require('../links');
const { sendLink, configured: mailReady } = require('../mailer');

/** A one-time portal sign-in link, shared on WhatsApp (and emailed if asked and possible). */
function makeClientLink(req, c, purpose, email) {
  const l = links.create('client', c.id, purpose, req.user.id);
  const url = baseUrl(req) + l.path;
  const willEmail = !!(email && c.email && mailReady(getSettings()));
  if (willEmail) setImmediate(() => sendLink({ to: c.email, name: c.name, url, kind: 'client', purpose, expiresAt: l.expiresAt }).catch(() => {}));
  return { url, expiresAt: l.expiresAt, purpose, emailed: willEmail };
}

const router = express.Router();
router.use(['/clients', '/requests'], requirePerm('clients'));

const clientOut = (c) => ({
  id: c.id, customerId: c.customer_id, name: c.name, phone: c.phone || '', email: c.email || '',
  active: !!c.active, mustChange: !!c.must_change, createdBy: c.created_by_name || '', createdAt: c.created_at, lastLogin: c.last_login || null,
  projects: db.prepare('SELECT id, name, stage FROM projects WHERE client_id = ? ORDER BY id').all(c.id),
});

const SELECT = 'SELECT c.*, u.name AS created_by_name FROM clients c LEFT JOIN users u ON u.id = c.created_by';

function nextCustomerId() {
  const year = new Date().getFullYear();
  const prefix = 'AVN-' + year + '-';
  const row = db.prepare("SELECT customer_id FROM clients WHERE customer_id LIKE ? ORDER BY customer_id DESC LIMIT 1").get(prefix + '%');
  const n = row ? parseInt(row.customer_id.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(4, '0');
}

router.get('/clients', (req, res) => {
  res.json(db.prepare(SELECT + ' ORDER BY c.id DESC').all().map(clientOut));
});

// Staff create the client's portal login. The temporary password is shown once; the client sets their own on first sign-in.
router.post('/clients', (req, res) => {
  const name = str(req.body.name, 120);
  const ph = phone(req.body.phone);
  const email = optStr(req.body.email, 120);
  const projectId = int(req.body.projectId, null);
  if (!name) throw bad('Enter the client’s name');
  if (!ph) throw bad('Enter a valid 10-digit Indian mobile number');
  if (db.prepare('SELECT 1 FROM clients WHERE phone = ?').get(ph)) throw bad('A client with this mobile number already exists');
  if (projectId && !db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) throw bad('Unknown project');
  if (email && !EMAIL_RE.test(email)) throw bad('Check the email address');
  // With a password typed by staff: shared as before. Without: a one-tap sign-in link to send on WhatsApp.
  const provided = String(req.body.password || '');
  if (provided && provided.length < 8) throw bad('Password must be at least 8 characters');
  const hashed = provided ? hashPassword(provided) : hashPassword(crypto.randomBytes(32).toString('hex'));
  let id;
  db.transaction(() => {
    id = db.prepare('INSERT INTO clients (customer_id, name, phone, email, password_hash, must_change, created_by) VALUES (?,?,?,?,?,1,?)')
      .run(nextCustomerId(), name, ph, email, hashed, req.user.id).lastInsertRowid;
    if (projectId) db.prepare('UPDATE projects SET client_id = ? WHERE id = ?').run(id, projectId);
  })();
  const c = db.prepare(SELECT + ' WHERE c.id = ?').get(id);
  if (provided) return res.status(201).json({ client: clientOut(c), tempPassword: provided });
  res.status(201).json({ client: clientOut(c), link: makeClientLink(req, c, 'welcome', bool(req.body.sendEmail)) });
});

router.post('/clients/:id/link', (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!c) throw notFound();
  if (!c.active) throw bad('Turn this client’s login on first');
  res.json(makeClientLink(req, c, c.last_login ? 'reset' : 'welcome', bool(req.body.sendEmail)));
});

router.patch('/clients/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!c) throw notFound();
  const name = req.body.name !== undefined ? str(req.body.name, 120) : c.name;
  const email = req.body.email !== undefined ? optStr(req.body.email, 120) : c.email;
  let ph = c.phone;
  if (req.body.phone !== undefined) {
    ph = phone(req.body.phone);
    if (!ph) throw bad('Enter a valid 10-digit Indian mobile number');
    if (db.prepare('SELECT 1 FROM clients WHERE phone = ? AND id != ?').get(ph, c.id)) throw bad('Another client uses this number');
  }
  const active = req.body.active !== undefined ? (bool(req.body.active) ? 1 : 0) : c.active;
  if (!name) throw bad('Enter the client’s name');
  db.prepare('UPDATE clients SET name = ?, email = ?, phone = ?, active = ? WHERE id = ?').run(name, email, ph, active, c.id);
  if (req.body.projectId !== undefined) {
    const pid = int(req.body.projectId, null);
    if (pid) {
      if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(pid)) throw bad('Unknown project');
      db.prepare('UPDATE projects SET client_id = ? WHERE id = ?').run(c.id, pid);
    }
  }
  res.json(clientOut(db.prepare(SELECT + ' WHERE c.id = ?').get(c.id)));
});

router.post('/clients/:id/reset-password', (req, res) => {
  const c = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
  if (!c) throw notFound();
  const temp = generatePassword();
  db.prepare('UPDATE clients SET password_hash = ?, must_change = 1 WHERE id = ?').run(hashPassword(temp), c.id);
  res.json({ tempPassword: temp });
});

router.get('/requests', (req, res) => {
  res.json(db.prepare(`SELECT r.id, r.message, r.status, r.created_at AS createdAt, c.name AS clientName, c.customer_id AS customerId, c.phone,
      p.id AS projectId, p.name AS projectName
    FROM service_requests r JOIN clients c ON c.id = r.client_id LEFT JOIN projects p ON p.id = r.project_id ORDER BY r.status = 'closed', r.id DESC LIMIT 200`).all());
});

router.patch('/requests/:id', (req, res) => {
  const status = ['open', 'in_progress', 'closed'].includes(req.body.status) ? req.body.status : null;
  if (!status) throw bad('Unknown status');
  const info = db.prepare('UPDATE service_requests SET status = ? WHERE id = ?').run(status, req.params.id);
  if (!info.changes) throw notFound();
  res.json({ ok: true });
});

module.exports = router;
