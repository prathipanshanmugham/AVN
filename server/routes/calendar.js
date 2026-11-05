const express = require('express');
const { db } = require('../db');
const { requirePerm } = require('../auth');
const { str, optStr, int, date, time, bool, bad, notFound } = require('../util');

const router = express.Router();
router.use(['/events', '/deadlines', '/checklists', '/checklist-items'], requirePerm('calendar'));

const TYPES = ['visit', 'install', 'eb', 'deadline', 'meeting'];
const COLORS = ['yellow', 'blue', 'green', 'pink', 'white'];

const eventOut = (e) => ({ id: e.id, title: e.title, type: e.type, date: e.date, time: e.time || '', who: e.who || '', projectId: e.project_id, projectName: e.project_name || '', done: !!e.done });

router.get('/events', (req, res) => {
  const from = date(req.query.from) || '0000-01-01';
  const to = date(req.query.to) || '9999-12-31';
  const rows = db.prepare(`SELECT e.*, p.name AS project_name FROM events e LEFT JOIN projects p ON p.id = e.project_id
    WHERE e.date BETWEEN ? AND ? ORDER BY e.date, e.time IS NULL, e.time`).all(from, to);
  res.json(rows.map(eventOut));
});

router.get('/deadlines', (req, res) => {
  const rows = db.prepare(`SELECT e.*, p.name AS project_name FROM events e LEFT JOIN projects p ON p.id = e.project_id
    WHERE e.type = 'deadline' AND e.done = 0 AND e.date >= date('now', '-30 days') ORDER BY e.date LIMIT 20`).all();
  res.json(rows.map(eventOut));
});

function eventFields(body, ex = {}) {
  const pick = (k, fn, col) => (body[k] !== undefined ? fn(body[k]) : ex[col || k]);
  const f = {
    title: pick('title', (v) => str(v, 140)),
    type: pick('type', (v) => (TYPES.includes(v) ? v : 'visit')),
    date: pick('date', (v) => date(v)),
    time: pick('time', (v) => time(v)),
    who: pick('who', (v) => optStr(v, 80)),
    project_id: pick('projectId', (v) => int(v, null), 'project_id'),
    done: pick('done', (v) => (bool(v) ? 1 : 0)),
  };
  if (!f.title) throw bad('Give the event a title');
  if (!f.date) throw bad('Pick a date');
  return f;
}

router.post('/events', (req, res) => {
  const f = eventFields(req.body, { type: 'visit', done: 0 });
  const info = db.prepare('INSERT INTO events (title, type, date, time, who, project_id, done, created_by) VALUES (?,?,?,?,?,?,?,?)')
    .run(f.title, f.type, f.date, f.time, f.who, f.project_id, f.done, req.user.id);
  res.status(201).json(eventOut(db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid)));
});

router.patch('/events/:id', (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!e) throw notFound();
  const f = eventFields(req.body, e);
  db.prepare('UPDATE events SET title=?, type=?, date=?, time=?, who=?, project_id=?, done=? WHERE id=?')
    .run(f.title, f.type, f.date, f.time, f.who, f.project_id, f.done, e.id);
  res.json(eventOut(db.prepare('SELECT * FROM events WHERE id = ?').get(e.id)));
});

router.delete('/events/:id', (req, res) => {
  const info = db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  if (!info.changes) throw notFound();
  res.json({ ok: true });
});

// Keep-style checklists
function checklistOut(c) {
  const items = db.prepare('SELECT id, label, done FROM checklist_items WHERE checklist_id = ? ORDER BY position, id').all(c.id)
    .map((i) => ({ id: i.id, label: i.label, done: !!i.done }));
  return { id: c.id, title: c.title, color: c.color, dueDate: c.due_date || '', items };
}

router.get('/checklists', (req, res) => {
  res.json(db.prepare('SELECT * FROM checklists ORDER BY position, id DESC').all().map(checklistOut));
});

router.post('/checklists', (req, res) => {
  const title = str(req.body.title, 100);
  if (!title) throw bad('Give the checklist a title');
  const color = COLORS.includes(req.body.color) ? req.body.color : 'yellow';
  const info = db.prepare('INSERT INTO checklists (title, color, due_date, created_by) VALUES (?,?,?,?)').run(title, color, date(req.body.dueDate), req.user.id);
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : [];
  items.forEach((label, i) => { const l = str(label, 160); if (l) db.prepare('INSERT INTO checklist_items (checklist_id, label, position) VALUES (?,?,?)').run(info.lastInsertRowid, l, i); });
  res.status(201).json(checklistOut(db.prepare('SELECT * FROM checklists WHERE id = ?').get(info.lastInsertRowid)));
});

router.patch('/checklists/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM checklists WHERE id = ?').get(req.params.id);
  if (!c) throw notFound();
  const title = req.body.title !== undefined ? str(req.body.title, 100) || c.title : c.title;
  const color = req.body.color !== undefined && COLORS.includes(req.body.color) ? req.body.color : c.color;
  const due = req.body.dueDate !== undefined ? date(req.body.dueDate) : c.due_date;
  db.prepare('UPDATE checklists SET title = ?, color = ?, due_date = ? WHERE id = ?').run(title, color, due, c.id);
  res.json(checklistOut(db.prepare('SELECT * FROM checklists WHERE id = ?').get(c.id)));
});

router.delete('/checklists/:id', (req, res) => {
  const info = db.prepare('DELETE FROM checklists WHERE id = ?').run(req.params.id);
  if (!info.changes) throw notFound();
  res.json({ ok: true });
});

router.post('/checklists/:id/items', (req, res) => {
  const c = db.prepare('SELECT id FROM checklists WHERE id = ?').get(req.params.id);
  if (!c) throw notFound();
  const label = str(req.body.label, 160);
  if (!label) throw bad('Write the item first');
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM checklist_items WHERE checklist_id = ?').get(c.id).p;
  const info = db.prepare('INSERT INTO checklist_items (checklist_id, label, position) VALUES (?,?,?)').run(c.id, label, pos);
  res.status(201).json({ id: info.lastInsertRowid, label, done: false });
});

router.patch('/checklist-items/:id', (req, res) => {
  const i = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(req.params.id);
  if (!i) throw notFound();
  const done = req.body.done !== undefined ? (bool(req.body.done) ? 1 : 0) : i.done;
  const label = req.body.label !== undefined ? str(req.body.label, 160) || i.label : i.label;
  db.prepare('UPDATE checklist_items SET done = ?, label = ? WHERE id = ?').run(done, label, i.id);
  res.json({ id: i.id, label, done: !!done });
});

router.delete('/checklist-items/:id', (req, res) => {
  const info = db.prepare('DELETE FROM checklist_items WHERE id = ?').run(req.params.id);
  if (!info.changes) throw notFound();
  res.json({ ok: true });
});

module.exports = router;
