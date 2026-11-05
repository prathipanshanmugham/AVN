const express = require('express');
const rateLimit = require('express-rate-limit');
const { db, getSettings, STAGES_PROJECT } = require('../db');
const { csrfGuard, ensureCsrf, allowMustChange, requireClient, signIn } = require('../auth');
const { h, str, bad, HttpError, phone, checkPassword, hashPassword } = require('../util');

const router = express.Router();

// --- Website data (no auth) ---
router.get('/public/site', (req, res) => {
  const s = getSettings();
  const brands = { modules: [], inverters: [] };
  db.prepare('SELECT grp, name FROM brands ORDER BY grp, position, id').all().forEach((b) => brands[b.grp].push(b.name));
  const media = db.prepare("SELECT * FROM media WHERE visible = 1 AND status = 'ready' ORDER BY section, position, id").all();
  const pub = (m) => ({ kind: m.kind, title: m.title, alt: m.alt || m.title, src: '/media/' + m.stored_name, poster: m.poster_name ? '/media/' + m.poster_name : null });
  const heroVideo = media.find((m) => m.section === 'hero' && m.kind === 'video');
  const heroImage = media.find((m) => m.section === 'hero' && m.kind === 'image');
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    company: { name: s.company_name, brand: s.brand_name, phone: s.phone, whatsapp: s.whatsapp || s.phone, email: s.email, address: s.address, hours: s.hours, gstin: s.gstin },
    calc: { yield: Number(s.calc_yield), roof: Number(s.calc_roof), tariffHome: Number(s.calc_tariff_home), tariffBiz: Number(s.calc_tariff_biz) },
    videoFastOnly: s.video_fast_only === '1',
    stats: [1, 2, 3].map((i) => ({ value: s['stat' + i + '_value'], label: s['stat' + i + '_label'] })).filter((x) => x.value),
    brands,
    hero: heroVideo ? { video: '/media/' + heroVideo.stored_name, poster: heroVideo.poster_name ? '/media/' + heroVideo.poster_name : (heroImage ? '/media/' + heroImage.stored_name : null) }
      : (heroImage ? { video: null, poster: '/media/' + heroImage.stored_name } : null),
    gallery: media.filter((m) => m.section === 'gallery').map(pub),
    solutions: media.filter((m) => m.section === 'solutions').map(pub),
  });
});

// Website enquiry form → CRM lead
const leadLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Please call us instead.' } });

router.post('/public/leads', leadLimiter, (req, res) => {
  if (str(req.body.website)) return res.status(201).json({ ok: true }); // honeypot
  const name = str(req.body.name, 120);
  const ph = phone(req.body.phone);
  const district = str(req.body.district, 80);
  const type = ['Home', 'Business', 'Industry', 'Farm'].includes(req.body.type) ? req.body.type : 'Home';
  if (!name) throw bad('Please enter your name');
  if (!ph) throw bad('Please enter a valid 10-digit mobile number');
  const units = str(req.body.units, 20);
  const msg = units ? 'From website. Units on last EB bill: ' + units : 'From website enquiry form';
  const info = db.prepare(`INSERT INTO leads (name, phone, place, type, source, next_action, due_date, message) VALUES (?,?,?,?, 'Website', 'Call back', date('now'), ?)`)
    .run(name, ph, district || null, type, msg);
  db.prepare('INSERT INTO lead_activity (lead_id, text) VALUES (?, ?)').run(info.lastInsertRowid, 'Enquiry received from the website');
  res.status(201).json({ ok: true });
});

// --- Client portal ---
const portalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' } });

const portal = express.Router();
portal.use(csrfGuard);

portal.post('/login', portalLimiter, h(async (req, res) => {
  const login = str(req.body.login, 40);
  const ph = phone(login);
  const c = ph ? db.prepare('SELECT * FROM clients WHERE phone = ?').get(ph) : db.prepare('SELECT * FROM clients WHERE customer_id = ?').get(login);
  if (!c || !c.active || !checkPassword(req.body.password, c.password_hash)) throw new HttpError(401, 'Wrong Customer ID / mobile or password');
  await signIn(req, { clientId: c.id });
  db.prepare("UPDATE clients SET last_login = datetime('now') WHERE id = ?").run(c.id);
  res.json({ mustChange: !!c.must_change, csrf: req.session.csrf });
}));

portal.post('/logout', (req, res) => {
  delete req.session.clientId;
  req.session.save(() => res.json({ ok: true }));
});

portal.post('/password', allowMustChange, requireClient, (req, res) => {
  const full = db.prepare('SELECT password_hash FROM clients WHERE id = ?').get(req.client.id);
  if (!checkPassword(req.body.current, full.password_hash)) throw bad('Your current password is not right');
  const next = String(req.body.next || '');
  if (next.length < 8) throw bad('Use at least 8 characters');
  if (next === String(req.body.current)) throw bad('Choose a password different from the current one');
  db.prepare('UPDATE clients SET password_hash = ?, must_change = 0 WHERE id = ?').run(hashPassword(next), req.client.id);
  res.json({ ok: true });
});

portal.get('/me', allowMustChange, requireClient, (req, res) => {
  const c = req.client;
  const projects = db.prepare('SELECT p.*, u.name AS pm_name FROM projects p LEFT JOIN users u ON u.id = p.pm_id WHERE p.client_id = ? ORDER BY p.id DESC').all(c.id)
    .map((p) => ({
      id: p.id, name: p.name, place: p.place || '', kwp: p.kwp || '', type: p.type || '', stage: p.stage,
      stageName: p.stage >= STAGES_PROJECT.length ? 'Handed over' : STAGES_PROJECT[p.stage], targetDate: p.target_date || '', pmName: p.pm_name || '',
      docs: db.prepare('SELECT id, title, size, created_at AS createdAt FROM project_docs WHERE project_id = ? AND client_visible = 1 ORDER BY id DESC').all(p.id),
    }));
  const requests = db.prepare(`SELECT r.id, r.message, r.status, r.created_at AS createdAt, p.name AS projectName
    FROM service_requests r LEFT JOIN projects p ON p.id = r.project_id WHERE r.client_id = ? ORDER BY r.id DESC LIMIT 20`).all(c.id);
  const s = getSettings();
  res.json({
    client: { name: c.name, customerId: c.customer_id, phone: c.phone, mustChange: !!c.must_change },
    stages: STAGES_PROJECT, projects, requests,
    contact: { phone: s.phone, whatsapp: s.whatsapp || s.phone, email: s.email },
    csrf: ensureCsrf(req),
  });
});

portal.post('/requests', requireClient, (req, res) => {
  const message = str(req.body.message, 1000);
  if (message.length < 5) throw bad('Tell us a little more about the problem');
  let projectId = parseInt(req.body.projectId, 10) || null;
  if (projectId && !db.prepare('SELECT 1 FROM projects WHERE id = ? AND client_id = ?').get(projectId, req.client.id)) projectId = null;
  const open = db.prepare("SELECT COUNT(*) c FROM service_requests WHERE client_id = ? AND status != 'closed'").get(req.client.id).c;
  if (open >= 5) throw bad('You already have 5 open requests. We’ll get back to you soon.');
  db.prepare('INSERT INTO service_requests (client_id, project_id, message) VALUES (?,?,?)').run(req.client.id, projectId, message);
  res.status(201).json({ ok: true });
});

router.use('/portal', portal);

module.exports = router;
