/* Blog posts (staff with the Blog permission): write, schedule, publish, covers and inline images. */
const express = require('express');
const { db } = require('../db');
const { requirePerm } = require('../auth');
const { imageUpload, processImage, processCover, removeFile, MEDIA_DIR } = require('../uploads');
const { h, str, optStr, bad, notFound } = require('../util');
const blog = require('../blog');

const router = express.Router();
router.use('/blog', requirePerm('blog'));

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const out = (p, full) => {
  const o = {
    id: p.id, slug: p.slug, title: p.title, excerpt: p.excerpt || '', status: p.status, state: blog.state(p),
    publishedAt: p.published_at ? p.published_at.replace(' ', 'T') + 'Z' : null,
    cover: p.cover_name ? '/media/' + p.cover_name : null, coverAlt: p.cover_alt || '', tags: p.tags || '',
    readMinutes: blog.readingMinutes(p.body), updatedAt: p.updated_at.replace(' ', 'T') + 'Z', createdAt: p.created_at.replace(' ', 'T') + 'Z',
  };
  if (full) Object.assign(o, { body: p.body, metaTitle: p.meta_title || '', metaDescription: p.meta_description || '', authorName: p.author_name || '' });
  return o;
};
const getPost = (id) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!p) throw notFound('Post not found');
  return p;
};
function uniqueSlug(base, exceptId) {
  const root = blog.slugify(base) || 'post';
  for (let n = 1; n < 500; n++) {
    const slug = n === 1 ? root : root.slice(0, 76) + '-' + n;
    const row = db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug);
    if (!row || row.id === exceptId) return slug;
  }
  throw bad('Could not make a web address for this title');
}

router.get('/blog', (req, res) => {
  res.json(db.prepare('SELECT * FROM posts ORDER BY COALESCE(published_at, updated_at) DESC, id DESC').all().map((p) => out(p)));
});

router.get('/blog/:id(\\d+)', (req, res) => res.json(out(getPost(req.params.id), true)));

router.post('/blog', (req, res) => {
  const title = str(req.body.title, 160);
  if (!title) throw bad('Give the post a title');
  const id = db.prepare('INSERT INTO posts (slug, title, author_name, created_by) VALUES (?,?,?,?)')
    .run(uniqueSlug(title), title, 'AVN Solar team', req.user.id).lastInsertRowid;
  res.status(201).json(out(getPost(id), true));
});

router.patch('/blog/:id(\\d+)', (req, res) => {
  const p = getPost(req.params.id);
  const b = req.body || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const f = {
    title: has('title') ? str(b.title, 160) : p.title,
    slug: has('slug') ? str(b.slug, 90).toLowerCase() : p.slug,
    excerpt: has('excerpt') ? optStr(b.excerpt, 320) : p.excerpt,
    body: has('body') ? String(b.body == null ? '' : b.body).replace(/\r\n/g, '\n').slice(0, 100000) : p.body,
    cover_alt: has('coverAlt') ? optStr(b.coverAlt, 200) : p.cover_alt,
    tags: has('tags') ? String(b.tags || '').split(',').map((t) => str(t, 40)).filter(Boolean).slice(0, 8).join(', ') || null : p.tags,
    meta_title: has('metaTitle') ? optStr(b.metaTitle, 90) : p.meta_title,
    meta_description: has('metaDescription') ? optStr(b.metaDescription, 220) : p.meta_description,
    author_name: has('authorName') ? optStr(b.authorName, 80) : p.author_name,
    status: has('status') ? (b.status === 'published' ? 'published' : 'draft') : p.status,
    published_at: p.published_at,
  };
  if (!f.title) throw bad('Give the post a title');
  if (!f.slug) f.slug = uniqueSlug(f.title, p.id);
  if (!SLUG_RE.test(f.slug)) throw bad('Web address: small letters, numbers and hyphens only');
  const clash = db.prepare('SELECT id FROM posts WHERE slug = ? AND id != ?').get(f.slug, p.id);
  if (clash) throw bad('Another post already uses this web address');
  if (has('publishedAt')) {
    if (!b.publishedAt) f.published_at = null;
    else {
      const d = new Date(b.publishedAt);
      if (Number.isNaN(d.getTime())) throw bad('Check the publish date');
      f.published_at = d.toISOString().slice(0, 19).replace('T', ' ');
    }
  }
  // Publishing without a time means "now".
  if (f.status === 'published' && !f.published_at) f.published_at = blog.nowSql();
  if (f.status === 'published' && !blog.plainText(f.body)) throw bad('Write the post before publishing it');
  db.prepare(`UPDATE posts SET title=?, slug=?, excerpt=?, body=?, cover_alt=?, tags=?, meta_title=?, meta_description=?, author_name=?, status=?, published_at=?,
    updated_at=datetime('now') WHERE id=?`)
    .run(f.title, f.slug, f.excerpt, f.body, f.cover_alt, f.tags, f.meta_title, f.meta_description, f.author_name, f.status, f.published_at, p.id);
  res.json(out(getPost(p.id), true));
});

router.delete('/blog/:id(\\d+)', (req, res) => {
  const p = getPost(req.params.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(p.id);
  removeFile(MEDIA_DIR, p.cover_name);
  removeFile(MEDIA_DIR, p.cover_og);
  res.json({ ok: true });
});

router.post('/blog/:id(\\d+)/cover', imageUpload.single('file'), h(async (req, res) => {
  const p = getPost(req.params.id);
  if (!req.file) throw bad('Choose a photo');
  const c = await processCover(req.file.path);
  db.prepare("UPDATE posts SET cover_name = ?, cover_og = ?, updated_at = datetime('now') WHERE id = ?").run(c.storedName, c.ogName, p.id);
  removeFile(MEDIA_DIR, p.cover_name);
  removeFile(MEDIA_DIR, p.cover_og);
  res.json(out(getPost(p.id), true));
}));

router.delete('/blog/:id(\\d+)/cover', (req, res) => {
  const p = getPost(req.params.id);
  db.prepare("UPDATE posts SET cover_name = NULL, cover_og = NULL, updated_at = datetime('now') WHERE id = ?").run(p.id);
  removeFile(MEDIA_DIR, p.cover_name);
  removeFile(MEDIA_DIR, p.cover_og);
  res.json(out(getPost(p.id), true));
});

/** Photos inside a post: saved as WebP; the editor inserts the Markdown for them. */
router.post('/blog/images', imageUpload.single('file'), h(async (req, res) => {
  if (!req.file) throw bad('Choose a photo');
  const r = await processImage(req.file.path);
  res.status(201).json({ url: '/media/' + r.storedName });
}));

router.post('/blog/preview', (req, res) => {
  res.json({ html: blog.render(String((req.body || {}).body || '').slice(0, 100000)) });
});

module.exports = router;
