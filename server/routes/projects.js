const express = require('express');
const { db, STAGES_PROJECT, createProjectTasks } = require('../db');
const { requirePerm } = require('../auth');
const { docUpload, removeFile, DOCS_DIR } = require('../uploads');
const { str, optStr, num, int, date, bool, bad, notFound } = require('../util');

const router = express.Router();
router.use(['/projects', '/tasks', '/docs'], requirePerm('projects'));

const SELECT = `SELECT p.*, u.name AS pm_name, c.name AS client_name, c.customer_id AS client_code
  FROM projects p LEFT JOIN users u ON u.id = p.pm_id LEFT JOIN clients c ON c.id = p.client_id`;

const projectOut = (p) => ({
  id: p.id, name: p.name, place: p.place || '', kwp: p.kwp || '', type: p.type || '', value: p.value_lakh,
  stage: p.stage, pmId: p.pm_id, pmName: p.pm_name || '', targetDate: p.target_date || '', notes: p.notes || '',
  clientId: p.client_id, clientName: p.client_name || '', clientCode: p.client_code || '', leadId: p.lead_id,
  createdAt: p.created_at, updatedAt: p.updated_at,
});

function fields(body, existing = {}) {
  const pick = (k, fn, col) => (body[k] !== undefined ? fn(body[k]) : existing[col || k]);
  const out = {
    name: pick('name', (v) => str(v, 140)),
    place: pick('place', (v) => optStr(v, 80)),
    kwp: pick('kwp', (v) => optStr(v, 40)),
    type: pick('type', (v) => optStr(v, 60)),
    value_lakh: pick('value', (v) => num(v, null), 'value_lakh'),
    pm_id: pick('pmId', (v) => int(v, null), 'pm_id'),
    target_date: pick('targetDate', (v) => date(v), 'target_date'),
    client_id: pick('clientId', (v) => int(v, null), 'client_id'),
    notes: pick('notes', (v) => optStr(v, 2000)),
  };
  if (!out.name) throw bad('Enter a project name');
  if (out.client_id && !db.prepare('SELECT 1 FROM clients WHERE id = ?').get(out.client_id)) throw bad('Unknown client');
  return out;
}

function progress(projectId) {
  return db.prepare('SELECT stage, COUNT(*) total, SUM(done) done FROM project_tasks WHERE project_id = ? GROUP BY stage').all(projectId);
}

router.get('/projects', (req, res) => {
  res.json({ stages: STAGES_PROJECT, projects: db.prepare(SELECT + ' ORDER BY p.stage >= 6, p.target_date IS NULL, p.target_date').all().map(projectOut) });
});

router.get('/projects/:id', (req, res) => {
  const p = db.prepare(SELECT + ' WHERE p.id = ?').get(req.params.id);
  if (!p) throw notFound();
  const tasks = db.prepare('SELECT id, stage, label, done FROM project_tasks WHERE project_id = ? ORDER BY stage, position, id').all(p.id)
    .map((t) => ({ id: t.id, stage: t.stage, label: t.label, done: !!t.done }));
  const docs = db.prepare(`SELECT d.id, d.title, d.file_name AS fileName, d.size, d.client_visible AS clientVisible, d.created_at AS createdAt, u.name AS uploadedBy
    FROM project_docs d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.project_id = ? ORDER BY d.id DESC`).all(p.id)
    .map((d) => Object.assign(d, { clientVisible: !!d.clientVisible }));
  const requests = db.prepare(`SELECT r.id, r.message, r.status, r.created_at AS createdAt, c.name AS clientName
    FROM service_requests r JOIN clients c ON c.id = r.client_id WHERE r.project_id = ? ORDER BY r.id DESC`).all(p.id);
  res.json({ project: projectOut(p), tasks, docs, requests, progress: progress(p.id) });
});

router.post('/projects', (req, res) => {
  const f = fields(req.body);
  let id;
  db.transaction(() => {
    id = db.prepare('INSERT INTO projects (name, place, kwp, type, value_lakh, pm_id, target_date, client_id, notes) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(f.name, f.place, f.kwp, f.type, f.value_lakh, f.pm_id || req.user.id, f.target_date, f.client_id, f.notes).lastInsertRowid;
    createProjectTasks(id);
  })();
  res.status(201).json(projectOut(db.prepare(SELECT + ' WHERE p.id = ?').get(id)));
});

router.patch('/projects/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) throw notFound();
  const f = fields(req.body, p);
  let stage = p.stage;
  if (req.body.stage !== undefined) {
    stage = int(req.body.stage, p.stage);
    if (stage < 0 || stage > STAGES_PROJECT.length) throw bad('Unknown stage');
  }
  db.prepare(`UPDATE projects SET name=?, place=?, kwp=?, type=?, value_lakh=?, pm_id=?, target_date=?, client_id=?, notes=?, stage=?, updated_at=datetime('now') WHERE id=?`)
    .run(f.name, f.place, f.kwp, f.type, f.value_lakh, f.pm_id, f.target_date, f.client_id, f.notes, stage, p.id);
  res.json(projectOut(db.prepare(SELECT + ' WHERE p.id = ?').get(p.id)));
});

router.delete('/projects/:id', (req, res) => {
  const docs = db.prepare('SELECT stored_name FROM project_docs WHERE project_id = ?').all(req.params.id);
  const info = db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  if (!info.changes) throw notFound();
  docs.forEach((d) => removeFile(DOCS_DIR, d.stored_name));
  db.prepare('UPDATE leads SET project_id = NULL WHERE project_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Checklist tasks
router.post('/projects/:id/tasks', (req, res) => {
  const p = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!p) throw notFound();
  const label = str(req.body.label, 160);
  const stage = int(req.body.stage, 0);
  if (!label) throw bad('Write the task first');
  if (stage < 0 || stage >= STAGES_PROJECT.length) throw bad('Unknown stage');
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM project_tasks WHERE project_id = ? AND stage = ?').get(p.id, stage).p;
  const info = db.prepare('INSERT INTO project_tasks (project_id, stage, label, position) VALUES (?,?,?,?)').run(p.id, stage, label, pos);
  res.status(201).json({ id: info.lastInsertRowid, stage, label, done: false });
});

router.patch('/tasks/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM project_tasks WHERE id = ?').get(req.params.id);
  if (!t) throw notFound();
  const done = req.body.done !== undefined ? (bool(req.body.done) ? 1 : 0) : t.done;
  const label = req.body.label !== undefined ? str(req.body.label, 160) || t.label : t.label;
  db.prepare('UPDATE project_tasks SET done = ?, label = ? WHERE id = ?').run(done, label, t.id);
  db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(t.project_id);
  res.json({ id: t.id, stage: t.stage, label, done: !!done });
});

router.delete('/tasks/:id', (req, res) => {
  const info = db.prepare('DELETE FROM project_tasks WHERE id = ?').run(req.params.id);
  if (!info.changes) throw notFound();
  res.json({ ok: true });
});

// Documents (private; clients only see those marked visible, through the portal)
router.post('/projects/:id/docs', docUpload.single('file'), (req, res) => {
  const p = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!p) { if (req.file) removeFile(DOCS_DIR, req.file.filename); throw notFound(); }
  if (!req.file) throw bad('Choose a file to upload');
  const title = str(req.body.title, 120) || req.file.originalname.slice(0, 120);
  const visible = req.body.clientVisible === undefined ? 1 : (bool(req.body.clientVisible) ? 1 : 0);
  const info = db.prepare('INSERT INTO project_docs (project_id, title, file_name, stored_name, mime, size, client_visible, uploaded_by) VALUES (?,?,?,?,?,?,?,?)')
    .run(p.id, title, req.file.originalname.slice(0, 160), req.file.filename, req.file.mimetype, req.file.size, visible, req.user.id);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/docs/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM project_docs WHERE id = ?').get(req.params.id);
  if (!d) throw notFound();
  const visible = req.body.clientVisible !== undefined ? (bool(req.body.clientVisible) ? 1 : 0) : d.client_visible;
  const title = req.body.title !== undefined ? str(req.body.title, 120) || d.title : d.title;
  db.prepare('UPDATE project_docs SET client_visible = ?, title = ? WHERE id = ?').run(visible, title, d.id);
  res.json({ ok: true });
});

router.delete('/docs/:id', (req, res) => {
  const d = db.prepare('SELECT * FROM project_docs WHERE id = ?').get(req.params.id);
  if (!d) throw notFound();
  db.prepare('DELETE FROM project_docs WHERE id = ?').run(d.id);
  removeFile(DOCS_DIR, d.stored_name);
  res.json({ ok: true });
});

module.exports = router;
