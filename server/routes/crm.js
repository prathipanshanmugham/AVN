const express = require('express');
const { db, STAGES_LEAD, createProjectTasks, parseKw } = require('../db');
const { requirePerm, can } = require('../auth');
const { h, str, optStr, num, int, date, bad, notFound, forbidden, phone } = require('../util');

const router = express.Router();
router.use('/leads', requirePerm('crm'));

const TYPES = ['Home', 'Business', 'Industry', 'Farm'];

const leadOut = (l) => ({
  id: l.id, name: l.name, phone: l.phone || '', email: l.email || '', place: l.place || '', type: l.type,
  size: l.size || '', value: l.value_lakh, stage: l.stage, nextAction: l.next_action || '', dueDate: l.due_date || '',
  ownerId: l.owner_id, ownerName: l.owner_name || '', source: l.source, message: l.message || '',
  projectId: l.project_id, createdAt: l.created_at, updatedAt: l.updated_at,
});

const SELECT = 'SELECT l.*, u.name AS owner_name FROM leads l LEFT JOIN users u ON u.id = l.owner_id';

function fields(body, existing = {}) {
  const pick = (k, fn) => (body[k] !== undefined ? fn(body[k]) : existing[k]);
  const out = {
    name: pick('name', (v) => str(v, 120)),
    phone: pick('phone', (v) => (str(v) ? phone(v) || str(v, 20) : null)),
    email: pick('email', (v) => optStr(v, 120)),
    place: pick('place', (v) => optStr(v, 80)),
    type: pick('type', (v) => (TYPES.includes(v) ? v : 'Home')),
    size: pick('size', (v) => optStr(v, 40)),
    value_lakh: pick('value', (v) => num(v, null)),
    next_action: pick('nextAction', (v) => optStr(v, 160)),
    due_date: pick('dueDate', (v) => date(v)),
    owner_id: pick('ownerId', (v) => int(v, null)),
    source: pick('source', (v) => str(v, 40) || 'Website'),
    message: pick('message', (v) => optStr(v, 1000)),
  };
  if (!out.name) throw bad('Enter the customer or company name');
  return out;
}

router.get('/leads', (req, res) => {
  res.json({ stages: STAGES_LEAD, leads: db.prepare(SELECT + ' ORDER BY l.updated_at DESC').all().map(leadOut) });
});

router.get('/leads/:id', (req, res) => {
  const l = db.prepare(SELECT + ' WHERE l.id = ?').get(req.params.id);
  if (!l) throw notFound();
  const activity = db.prepare(`SELECT a.id, a.text, a.created_at AS createdAt, u.name AS userName
    FROM lead_activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.lead_id = ? ORDER BY a.id DESC LIMIT 50`).all(l.id);
  const quotes = db.prepare('SELECT id, number, status, total FROM quotes WHERE lead_id = ? ORDER BY id DESC').all(l.id);
  res.json({ lead: leadOut(l), activity, quotes });
});

router.post('/leads', (req, res) => {
  const f = fields(req.body, { type: 'Home', source: 'Phone' });
  const info = db.prepare(`INSERT INTO leads (name, phone, email, place, type, size, value_lakh, next_action, due_date, owner_id, source, message)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(f.name, f.phone, f.email, f.place, f.type, f.size, f.value_lakh, f.next_action, f.due_date, f.owner_id || req.user.id, f.source, f.message);
  db.prepare('INSERT INTO lead_activity (lead_id, user_id, text) VALUES (?,?,?)').run(info.lastInsertRowid, req.user.id, 'Lead created by ' + req.user.name);
  res.status(201).json(leadOut(db.prepare(SELECT + ' WHERE l.id = ?').get(info.lastInsertRowid)));
});

router.patch('/leads/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!l) throw notFound();
  const f = fields(req.body, l);
  let stage = l.stage;
  if (req.body.stage !== undefined) {
    stage = int(req.body.stage, l.stage);
    if (stage < 0 || stage >= STAGES_LEAD.length) throw bad('Unknown stage');
  }
  db.prepare(`UPDATE leads SET name=?, phone=?, email=?, place=?, type=?, size=?, value_lakh=?, next_action=?, due_date=?, owner_id=?, source=?, message=?, stage=?, updated_at=datetime('now') WHERE id=?`)
    .run(f.name, f.phone, f.email, f.place, f.type, f.size, f.value_lakh, f.next_action, f.due_date, f.owner_id, f.source, f.message, stage, l.id);
  if (stage !== l.stage) {
    db.prepare('INSERT INTO lead_activity (lead_id, user_id, text) VALUES (?,?,?)').run(l.id, req.user.id, 'Moved to ' + STAGES_LEAD[stage]);
  }
  res.json(leadOut(db.prepare(SELECT + ' WHERE l.id = ?').get(l.id)));
});

router.delete('/leads/:id', (req, res) => {
  const info = db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  if (!info.changes) throw notFound();
  res.json({ ok: true });
});

router.post('/leads/:id/activity', (req, res) => {
  const text = str(req.body.text, 1000);
  if (!text) throw bad('Write a note first');
  const l = db.prepare('SELECT id FROM leads WHERE id = ?').get(req.params.id);
  if (!l) throw notFound();
  db.prepare('INSERT INTO lead_activity (lead_id, user_id, text) VALUES (?,?,?)').run(l.id, req.user.id, text);
  db.prepare("UPDATE leads SET updated_at = datetime('now') WHERE id = ?").run(l.id);
  res.status(201).json({ ok: true });
});

// Turn a won lead into a project with the standard six-stage checklist.
router.post('/leads/:id/convert', h((req, res) => {
  if (!can(req.user, 'projects')) throw forbidden('You need access to Projects to create one');
  const l = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!l) throw notFound();
  if (l.project_id && db.prepare('SELECT 1 FROM projects WHERE id = ?').get(l.project_id)) throw bad('This lead already has a project');
  const typeMap = { Home: 'Home rooftop', Business: 'Commercial rooftop', Industry: 'Industrial rooftop', Farm: 'Solar pump' };
  // Size and system type come from the accepted (or latest) quotation when there is one.
  const quote = db.prepare("SELECT kwp, system_type, total FROM quotes WHERE lead_id = ? ORDER BY status = 'Accepted' DESC, id DESC LIMIT 1").get(l.id);
  const capacity = quote && quote.kwp ? quote.kwp : parseKw(l.size);
  const system = quote ? quote.system_type : (l.type === 'Farm' ? 'Off-grid' : 'On-grid');
  const size = l.size || (capacity ? capacity + ' kWp' : null);
  let projectId;
  db.transaction(() => {
    const info = db.prepare('INSERT INTO projects (name, lead_id, place, kwp, type, value_lakh, pm_id, capacity_kw, system_type) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(l.name, l.id, l.place, size, typeMap[l.type] || l.type, l.value_lakh, l.owner_id || req.user.id, capacity, system);
    projectId = info.lastInsertRowid;
    createProjectTasks(projectId);
    db.prepare("UPDATE leads SET stage = 4, project_id = ?, updated_at = datetime('now') WHERE id = ?").run(projectId, l.id);
    db.prepare('UPDATE quotes SET project_id = ? WHERE lead_id = ? AND project_id IS NULL').run(projectId, l.id);
    db.prepare('INSERT INTO lead_activity (lead_id, user_id, text) VALUES (?,?,?)').run(l.id, req.user.id, 'Won — project created');
  })();
  res.status(201).json({ projectId });
}));

module.exports = router;
