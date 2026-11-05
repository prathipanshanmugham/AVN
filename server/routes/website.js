const fs = require('fs');
const express = require('express');
const { db } = require('../db');
const { requirePerm } = require('../auth');
const { mediaUpload, processImage, processVideo, removeFile, MEDIA_DIR, IMAGE_TYPES, hasFfmpeg } = require('../uploads');
const { h, str, optStr, int, bool, bad, notFound } = require('../util');

const router = express.Router();
router.use(['/media', '/brands'], requirePerm('website'));

const SECTIONS = ['hero', 'gallery', 'solutions'];

const mediaOut = (m) => ({
  id: m.id, section: m.section, kind: m.kind, title: m.title, alt: m.alt || '',
  url: '/media/' + m.stored_name, poster: m.poster_name ? '/media/' + m.poster_name : null,
  size: m.size, originalSize: m.original_size, visible: !!m.visible, position: m.position, status: m.status, createdAt: m.created_at,
});

router.get('/media', (req, res) => {
  res.json({ ffmpeg: hasFfmpeg(), items: db.prepare('SELECT * FROM media ORDER BY section, position, id').all().map(mediaOut) });
});

router.post('/media', mediaUpload.single('file'), h(async (req, res) => {
  if (!req.file) throw bad('Choose a photo or video');
  const section = SECTIONS.includes(req.body.section) ? req.body.section : 'gallery';
  const title = str(req.body.title, 120) || req.file.originalname.replace(/\.[^.]+$/, '').slice(0, 120);
  const alt = optStr(req.body.alt, 200);
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM media WHERE section = ?').get(section).p;
  const originalSize = req.file.size;

  if (IMAGE_TYPES.includes(req.file.mimetype)) {
    const out = await processImage(req.file.path);
    const info = db.prepare(`INSERT INTO media (section, kind, title, alt, stored_name, mime, size, original_size, position) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(section, 'image', title, alt, out.storedName, 'image/webp', out.size, originalSize, pos);
    return res.status(201).json(mediaOut(db.prepare('SELECT * FROM media WHERE id = ?').get(info.lastInsertRowid)));
  }

  // Video: insert a "processing" row, finish in the background.
  const info = db.prepare(`INSERT INTO media (section, kind, title, alt, stored_name, mime, size, original_size, position, status) VALUES (?,?,?,?,?,?,?,?,?,'processing')`)
    .run(section, 'video', title, alt, 'pending', 'video/mp4', originalSize, originalSize, pos);
  const id = info.lastInsertRowid;
  processVideo(req.file.path, req.file.originalname, (err, out) => {
    if (err) {
      console.error('Video processing failed', err.message);
      db.prepare("UPDATE media SET status = 'failed' WHERE id = ?").run(id);
      return;
    }
    db.prepare("UPDATE media SET stored_name = ?, poster_name = ?, size = ?, status = 'ready' WHERE id = ?").run(out.storedName, out.posterName, out.size, id);
  });
  res.status(201).json(mediaOut(db.prepare('SELECT * FROM media WHERE id = ?').get(id)));
}));

router.patch('/media/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!m) throw notFound();
  const title = req.body.title !== undefined ? str(req.body.title, 120) || m.title : m.title;
  const alt = req.body.alt !== undefined ? optStr(req.body.alt, 200) : m.alt;
  const visible = req.body.visible !== undefined ? (bool(req.body.visible) ? 1 : 0) : m.visible;
  const section = req.body.section !== undefined && SECTIONS.includes(req.body.section) ? req.body.section : m.section;
  db.prepare('UPDATE media SET title = ?, alt = ?, visible = ?, section = ? WHERE id = ?').run(title, alt, visible, section, m.id);
  res.json(mediaOut(db.prepare('SELECT * FROM media WHERE id = ?').get(m.id)));
});

router.post('/media/:id/move', (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!m) throw notFound();
  const dir = int(req.body.dir, 0) < 0 ? -1 : 1;
  const list = db.prepare('SELECT id FROM media WHERE section = ? ORDER BY position, id').all(m.section).map((r) => r.id);
  const i = list.indexOf(m.id);
  const j = i + dir;
  if (j >= 0 && j < list.length) {
    [list[i], list[j]] = [list[j], list[i]];
    const up = db.prepare('UPDATE media SET position = ? WHERE id = ?');
    db.transaction(() => list.forEach((id, pos) => up.run(pos, id)))();
  }
  res.json({ ok: true });
});

router.delete('/media/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!m) throw notFound();
  db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
  removeFile(MEDIA_DIR, m.stored_name);
  removeFile(MEDIA_DIR, m.poster_name);
  res.json({ ok: true });
});

// Brand ribbons
router.get('/brands', (req, res) => {
  res.json(db.prepare('SELECT id, grp, name FROM brands ORDER BY grp, position, id').all());
});

router.post('/brands', (req, res) => {
  const grp = req.body.grp === 'inverters' ? 'inverters' : 'modules';
  const name = str(req.body.name, 40);
  if (!name) throw bad('Type a brand name');
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM brands WHERE grp = ?').get(grp).p;
  const info = db.prepare('INSERT INTO brands (grp, name, position) VALUES (?,?,?)').run(grp, name, pos);
  res.status(201).json({ id: info.lastInsertRowid, grp, name });
});

router.delete('/brands/:id', (req, res) => {
  const info = db.prepare('DELETE FROM brands WHERE id = ?').run(req.params.id);
  if (!info.changes) throw notFound();
  res.json({ ok: true });
});

module.exports = router;
