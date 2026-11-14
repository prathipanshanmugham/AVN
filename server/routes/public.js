const express = require('express');
const rateLimit = require('express-rate-limit');
const { db, getSettings, STAGES_PROJECT } = require('../db');
const { csrfGuard, ensureCsrf, allowMustChange, requireClient, signIn, signOutEverywhere } = require('../auth');
const { h, str, num, line, email, bad, HttpError, phone, checkPassword, hashPassword } = require('../util');
const { notifyLead } = require('../mailer');

/** Right after signing in with a temporary password, the new one can be set without typing the temporary one again. */
const freshStart = (req, c) => !!c.must_change && !!req.session.pwAt && Date.now() - req.session.pwAt < 30 * 60000;

const router = express.Router();

// --- Website data (no auth) ---
router.get('/public/site', (req, res) => {
  const s = getSettings();
  const brands = { modules: [], inverters: [] };
  db.prepare('SELECT grp, name, logo_name FROM brands ORDER BY grp, position, id').all()
    .forEach((b) => brands[b.grp].push({ name: b.name, logo: b.logo_name ? '/media/' + b.logo_name : null }));
  const media = db.prepare("SELECT * FROM media WHERE visible = 1 AND status = 'ready' ORDER BY section, position, id").all();
  const pub = (m) => ({ kind: m.kind, title: m.title, alt: m.alt || m.title, src: '/media/' + m.stored_name, poster: m.poster_name ? '/media/' + m.poster_name : null });
  const heroVideo = media.find((m) => m.section === 'hero' && m.kind === 'video');
  const heroImages = media.filter((m) => m.section === 'hero' && m.kind === 'image').map(pub);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    company: {
      name: s.company_name, brand: s.brand_name, phone: s.phone, whatsapp: s.whatsapp || s.phone, whatsappMessage: s.whatsapp_message,
      email: s.email, address: s.address, hours: s.hours, gstin: s.gstin,
    },
    calc: { yield: Number(s.calc_yield), roof: Number(s.calc_roof), tariffHome: Number(s.calc_tariff_home), tariffBiz: Number(s.calc_tariff_biz) },
    popup: { enabled: s.popup_enabled === '1', delay: Number(s.popup_delay) || 25, title: s.popup_title },
    videoFastOnly: s.video_fast_only === '1',
    stats: [1, 2, 3].map((i) => ({ value: s['stat' + i + '_value'], label: s['stat' + i + '_label'] })).filter((x) => x.value),
    brands,
    hero: {
      video: heroVideo ? '/media/' + heroVideo.stored_name : null,
      poster: heroVideo && heroVideo.poster_name ? '/media/' + heroVideo.poster_name : (heroImages[0] ? heroImages[0].src : null),
      images: heroImages,
    },
    gallery: media.filter((m) => m.section === 'gallery').map(pub),
    solutions: media.filter((m) => m.section === 'solutions').map(pub),
    banner: media.filter((m) => m.section === 'banner' && m.kind === 'image').map(pub),
  });
});

// Website enquiry forms (quote wizard, popup, calculator, contact) → CRM lead + email
const leadLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 6, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Please call us instead.' } });

const FORMS = { wizard: 'Quote wizard', popup: 'Website popup', calculator: 'Savings calculator', contact: 'Contact form' };

function leadSource(utm) {
  const src = (utm.source + ' ' + utm.medium).toLowerCase();
  if (utm.gclid || (/google/.test(src) && /cpc|ppc|paid|ads/.test(src))) return 'Google Ads';
  if (utm.fbclid || /facebook|instagram|meta|\bfb\b|\big\b/.test(src)) return 'Meta ads';
  return 'Website';
}

const { baseUrl } = require('../util');

router.post('/public/leads', leadLimiter, (req, res) => {
  if (str(req.body.website)) return res.status(201).json({ ok: true }); // honeypot
  const name = line(req.body.name, 120);
  const ph = phone(req.body.phone);
  const district = line(req.body.district, 80);
  const type = ['Home', 'Business', 'Industry', 'Farm'].includes(req.body.type) ? req.body.type : 'Home';
  if (!name) throw bad('Please enter your name');
  if (!ph) throw bad('Please enter a valid 10-digit mobile number');
  const mail = req.body.email ? email(req.body.email) : null;
  if (req.body.email && !mail) throw bad('Please check your email address');

  const form = FORMS[req.body.form] ? req.body.form : 'contact';
  const kwpNum = num(req.body.kwp, null);
  const kwp = kwpNum && kwpNum > 0 && kwpNum < 100000 ? Math.round(kwpNum * 10) / 10 : null;
  const u = req.body.utm && typeof req.body.utm === 'object' ? req.body.utm : {};
  const utm = {};
  ['source', 'medium', 'campaign', 'term', 'content', 'gclid', 'fbclid'].forEach((k) => { utm[k] = line(u[k], 120); });
  const campaign = [utm.source, utm.medium, utm.campaign].filter(Boolean).join(' / ');
  const details = [
    ['Form', FORMS[form]],
    ['EB bill (2 months)', line(req.body.bill, 40)],
    ['Units on last EB bill', line(req.body.units, 20)],
    ['Roof / site', line(req.body.roof, 40)],
    ['Estimated savings', line(req.body.savings, 40)],
    ['Note', str(req.body.note, 500)],
    ['Campaign', campaign],
    ['Page', line(req.body.page, 160)],
  ].filter((d) => d[1]);
  const message = details.map((d) => d[0] + ': ' + d[1]).join('\n');
  const size = kwp ? kwp + ' kWp' : null;
  const source = leadSource(utm);

  // Same mobile within a day (e.g. popup, then the wizard): update that lead instead of creating a duplicate.
  const recent = db.prepare("SELECT * FROM leads WHERE phone = ? AND created_at >= datetime('now', '-1 day') ORDER BY id DESC LIMIT 1").get(ph);
  let leadId;
  if (recent) {
    leadId = recent.id;
    db.prepare(`UPDATE leads SET place = COALESCE(place, ?), email = COALESCE(email, ?), size = COALESCE(?, size), due_date = date('now'),
      message = substr(COALESCE(message || char(10) || char(10), '') || ?, 1, 2000), updated_at = datetime('now') WHERE id = ?`)
      .run(district || null, mail, size, message, leadId);
    db.prepare('INSERT INTO lead_activity (lead_id, text) VALUES (?, ?)').run(leadId, 'Enquired again on the website (' + FORMS[form] + ')');
  } else {
    leadId = db.prepare(`INSERT INTO leads (name, phone, email, place, type, size, source, next_action, due_date, message)
      VALUES (?,?,?,?,?,?,?, 'Call back', date('now'), ?)`).run(name, ph, mail, district || null, type, size, source, message).lastInsertRowid;
    db.prepare('INSERT INTO lead_activity (lead_id, text) VALUES (?, ?)').run(leadId, 'Enquiry received from the website (' + FORMS[form] + ')');
  }
  res.status(201).json({ ok: true });

  const lead = { name, phone: ph, email: mail, place: district, type, size, details };
  setImmediate(() => notifyLead(lead, { baseUrl: baseUrl(req), repeat: !!recent }).catch(() => {}));
});

// --- Client portal ---
const portalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' } });

const portal = express.Router();
portal.use(csrfGuard);

const findClient = (login) => {
  const ph = phone(login);
  return ph ? db.prepare('SELECT * FROM clients WHERE phone = ?').get(ph)
    : db.prepare('SELECT * FROM clients WHERE customer_id = ? COLLATE NOCASE OR (email IS NOT NULL AND email = ? COLLATE NOCASE)').get(login, login);
};

portal.post('/login', portalLimiter, h(async (req, res) => {
  const c = findClient(str(req.body.login, 120).trim());
  if (!c || !checkPassword(String(req.body.password || ''), c.password_hash)) {
    throw new HttpError(401, 'That mobile number / Customer ID and password don’t match. Check for typos — or WhatsApp us for a new password.');
  }
  if (!c.active) throw new HttpError(403, 'Your login is switched off. Please call or WhatsApp us.');
  await signIn(req, { clientId: c.id, pwAt: Date.now() });
  db.prepare("UPDATE clients SET last_login = datetime('now') WHERE id = ?").run(c.id);
  res.json({ mustChange: !!c.must_change, name: c.name, csrf: req.session.csrf });
}));

// For "Forgot password?": who to contact (AVN staff reset the password from Clients).
portal.get('/help', (req, res) => {
  const s = getSettings();
  res.json({ whatsapp: String(s.whatsapp || s.phone || '').replace(/\D/g, '').slice(-10), phone: s.phone || '' });
});

portal.post('/logout', (req, res) => {
  delete req.session.clientId;
  req.session.save(() => res.json({ ok: true }));
});

portal.post('/password', allowMustChange, requireClient, (req, res) => {
  const full = db.prepare('SELECT password_hash FROM clients WHERE id = ?').get(req.client.id);
  if (!freshStart(req, req.client) && !checkPassword(String(req.body.current || ''), full.password_hash)) throw bad('Your current password is not right. Forgot it? WhatsApp us for a new one.');
  const next = String(req.body.next || '');
  if (next.length < 8) throw bad('The new password needs at least 8 characters');
  if (next.length > 200) throw bad('The new password is too long');
  if (checkPassword(next, full.password_hash)) throw bad('Choose a password different from the current one');
  db.prepare('UPDATE clients SET password_hash = ?, must_change = 0 WHERE id = ?').run(hashPassword(next), req.client.id);
  signOutEverywhere('clientId', req.client.id, req.sessionID);
  delete req.session.pwAt;
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
    client: { name: c.name, customerId: c.customer_id, phone: c.phone, mustChange: !!c.must_change, needsCurrent: !freshStart(req, c) },
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
