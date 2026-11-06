const express = require('express');
const { db, STAGES_PROJECT, PROJECT_FIELDS, ASSET_KINDS, createProjectTasks } = require('../db');
const { requirePerm } = require('../auth');
const { docUpload, removeFile, DOCS_DIR } = require('../uploads');
const { str, optStr, num, int, date, bool, url, bad, notFound } = require('../util');

const router = express.Router();
router.use(['/projects', '/tasks', '/docs', '/assets'], requirePerm('projects'));

const parse = (s, fallback) => { try { return JSON.parse(s) || fallback; } catch (e) { return fallback; } };

const SELECT = `SELECT p.*, u.name AS pm_name, c.name AS client_name, c.customer_id AS client_code
  FROM projects p LEFT JOIN users u ON u.id = p.pm_id LEFT JOIN clients c ON c.id = p.client_id`;

const projectOut = (p) => ({
  id: p.id, name: p.name, place: p.place || '', kwp: p.kwp || '', type: p.type || '', value: p.value_lakh,
  stage: p.stage, pmId: p.pm_id, pmName: p.pm_name || '', targetDate: p.target_date || '', notes: p.notes || '',
  clientId: p.client_id, clientName: p.client_name || '', clientCode: p.client_code || '', leadId: p.lead_id,
  driveLink: p.drive_link || '', details: parse(p.details, {}),
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
    drive_link: pick('driveLink', (v) => {
      if (!str(v)) return null;
      const u = url(v);
      if (!u) throw bad('Paste the full Drive folder link, starting with https://');
      return u;
    }, 'drive_link'),
  };
  if (!out.name) throw bad('Enter a project name');
  if (out.client_id && !db.prepare('SELECT 1 FROM clients WHERE id = ?').get(out.client_id)) throw bad('Unknown client');
  return out;
}

function progress(projectId) {
  return db.prepare('SELECT stage, COUNT(*) total, SUM(done) done FROM project_tasks WHERE project_id = ? GROUP BY stage').all(projectId);
}

router.get('/projects', (req, res) => {
  res.json({
    stages: STAGES_PROJECT, fields: PROJECT_FIELDS, assetKinds: ASSET_KINDS,
    projects: db.prepare(SELECT + ' ORDER BY p.stage >= 6, p.target_date IS NULL, p.target_date').all().map(projectOut),
  });
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
  const assets = db.prepare(`SELECT a.id, a.kind, a.make, a.model, a.serial, a.notes, a.created_at AS createdAt, u.name AS addedBy
    FROM project_assets a LEFT JOIN users u ON u.id = a.created_by WHERE a.project_id = ? ORDER BY a.kind, a.id`).all(p.id);
  const quotes = db.prepare('SELECT id, number, status, total FROM quotes WHERE project_id = ? OR (lead_id IS NOT NULL AND lead_id = ?) ORDER BY id DESC').all(p.id, p.lead_id);
  res.json({ project: projectOut(p), tasks, docs, requests, assets, quotes, progress: progress(p.id) });
});

router.post('/projects', (req, res) => {
  const f = fields(req.body);
  let id;
  db.transaction(() => {
    id = db.prepare('INSERT INTO projects (name, place, kwp, type, value_lakh, pm_id, target_date, client_id, notes, drive_link) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(f.name, f.place, f.kwp, f.type, f.value_lakh, f.pm_id || req.user.id, f.target_date, f.client_id, f.notes, f.drive_link).lastInsertRowid;
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
  db.prepare(`UPDATE projects SET name=?, place=?, kwp=?, type=?, value_lakh=?, pm_id=?, target_date=?, client_id=?, notes=?, drive_link=?, stage=?, updated_at=datetime('now') WHERE id=?`)
    .run(f.name, f.place, f.kwp, f.type, f.value_lakh, f.pm_id, f.target_date, f.client_id, f.notes, f.drive_link, stage, p.id);
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

// Project record (EB, MNRE / PM Surya Ghar, system, warranty, finance). Only known fields are stored.
const FIELD_INDEX = {};
PROJECT_FIELDS.forEach((g) => g.fields.forEach(([key, label, type]) => { FIELD_INDEX[key] = { label, type: type || 'text' }; }));

router.put('/projects/:id/details', (req, res) => {
  const p = db.prepare('SELECT id, details FROM projects WHERE id = ?').get(req.params.id);
  if (!p) throw notFound();
  const details = parse(p.details, {});
  Object.keys(req.body || {}).forEach((key) => {
    const f = FIELD_INDEX[key];
    if (!f) return;
    const raw = req.body[key];
    let v = str(raw, f.type === 'area' ? 1000 : 200);
    if (v && f.type === 'date') { v = date(v); if (!v) throw bad(f.label + ': pick a date'); }
    if (v && f.type === 'number') { const n = Number(v.replace(/,/g, '')); if (!Number.isFinite(n) || n < 0) throw bad(f.label + ': enter a number'); v = String(n); }
    if (v && f.type === 'url') { v = url(v); if (!v) throw bad(f.label + ': paste a full https:// link'); }
    if (v) details[key] = v; else delete details[key];
  });
  db.prepare("UPDATE projects SET details = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(details), p.id);
  res.json({ details });
});

// Serial number register: modules, inverters, meters… unique per kind across all projects.
const assetOut = (a) => ({ id: a.id, kind: a.kind, make: a.make || '', model: a.model || '', serial: a.serial, notes: a.notes || '', createdAt: a.created_at });

router.post('/projects/:id/assets', (req, res) => {
  const p = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!p) throw notFound();
  const kind = ASSET_KINDS.includes(req.body.kind) ? req.body.kind : 'Module';
  const make = optStr(req.body.make, 60);
  const model = optStr(req.body.model, 80);
  const notes = optStr(req.body.notes, 200);
  const raw = Array.isArray(req.body.serials) ? req.body.serials.join('\n') : String(req.body.serials || '');
  const serials = [...new Set(raw.split(/[\r\n,;\t]+/).map((x) => x.trim().replace(/\s+/g, '')).filter(Boolean))];
  if (!serials.length) throw bad('Paste or scan at least one serial number');
  if (serials.length > 500) throw bad('Add up to 500 serial numbers at a time');
  const tooLong = serials.find((x) => x.length > 60);
  if (tooLong) throw bad('"' + tooLong.slice(0, 20) + '…" is too long for a serial number');
  const find = db.prepare(`SELECT a.project_id, pr.name FROM project_assets a JOIN projects pr ON pr.id = a.project_id
    WHERE a.kind = ? AND a.serial = ? COLLATE NOCASE`);
  const ins = db.prepare('INSERT INTO project_assets (project_id, kind, make, model, serial, notes, created_by) VALUES (?,?,?,?,?,?,?)');
  const added = [];
  const skipped = [];
  db.transaction(() => {
    serials.forEach((serial) => {
      const dup = find.get(kind, serial);
      if (dup) { skipped.push({ serial, projectId: dup.project_id, projectName: dup.name }); return; }
      added.push(ins.run(p.id, kind, make, model, serial, notes, req.user.id).lastInsertRowid);
    });
    if (added.length) db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(p.id);
  })();
  res.status(201).json({ added: added.length, skipped });
});

router.patch('/assets/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM project_assets WHERE id = ?').get(req.params.id);
  if (!a) throw notFound();
  const make = req.body.make !== undefined ? optStr(req.body.make, 60) : a.make;
  const model = req.body.model !== undefined ? optStr(req.body.model, 80) : a.model;
  const notes = req.body.notes !== undefined ? optStr(req.body.notes, 200) : a.notes;
  db.prepare('UPDATE project_assets SET make = ?, model = ?, notes = ? WHERE id = ?').run(make, model, notes, a.id);
  res.json(assetOut(db.prepare('SELECT * FROM project_assets WHERE id = ?').get(a.id)));
});

router.delete('/assets/:id', (req, res) => {
  const info = db.prepare('DELETE FROM project_assets WHERE id = ?').run(req.params.id);
  if (!info.changes) throw notFound();
  res.json({ ok: true });
});

// Which project is this serial on? (warranty claims, service calls)
router.get('/assets/search', (req, res) => {
  const q = str(req.query.q, 60).replace(/\s+/g, '');
  if (q.length < 3) return res.json([]);
  const like = '%' + q.replace(/[%_\\]/g, (c) => '\\' + c) + '%';
  res.json(db.prepare(`SELECT a.id, a.kind, a.make, a.model, a.serial, a.project_id AS projectId, p.name AS projectName, p.place
    FROM project_assets a JOIN projects p ON p.id = a.project_id WHERE a.serial LIKE ? ESCAPE '\\' ORDER BY a.serial = ? COLLATE NOCASE DESC, a.id DESC LIMIT 20`).all(like, q));
});

router.get('/projects/:id/assets.csv', (req, res) => {
  const p = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(req.params.id);
  if (!p) throw notFound();
  const rows = db.prepare('SELECT kind, make, model, serial, notes, created_at FROM project_assets WHERE project_id = ? ORDER BY kind, id').all(p.id);
  const cell = (v) => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // keep spreadsheets from treating it as a formula
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = [['Type', 'Make', 'Model', 'Serial number', 'Notes', 'Added'].map(cell).join(',')]
    .concat(rows.map((r) => [r.kind, r.make, r.model, r.serial, r.notes, r.created_at].map(cell).join(','))).join('\r\n');
  const fname = (p.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project') + '-serial-numbers.csv';
  res.set('Content-Disposition', 'attachment; filename="' + fname + '"');
  res.type('text/csv').send('\uFEFF' + csv);
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
