/*
 * Blog: posts are written in Markdown and rendered to HTML on the server.
 * Raw HTML in a post is shown as text (never executed); links are limited to web, mail and phone links.
 * A post is live when its status is "published" and its publish time has passed (a later time = scheduled).
 */
const MarkdownIt = require('markdown-it');
const { db } = require('./db');

const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false });
const SAFE_LINK = /^(https?:|mailto:|tel:|\/(?!\/)|#)/i;
md.validateLink = (url) => SAFE_LINK.test(String(url).trim());

const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');

// The post title is the page's only <h1>: headings inside the body start at <h2>, and get ids for linking.
const usedIds = new WeakMap();
md.renderer.rules.heading_open = (tokens, i, opts, env, self) => {
  const t = tokens[i];
  const level = Math.min(6, Math.max(2, Number(t.tag.slice(1)) + (t.tag === 'h1' ? 1 : 0)));
  t.tag = 'h' + level;
  const text = tokens[i + 1] && tokens[i + 1].content;
  if (text && level <= 3) {
    const seen = usedIds.get(env) || new Set();
    usedIds.set(env, seen);
    let id = slugify(text) || 'section';
    for (let n = 2; seen.has(id); n++) id = slugify(text) + '-' + n;
    seen.add(id);
    t.attrSet('id', id);
  }
  return self.renderToken(tokens, i, opts);
};
md.renderer.rules.heading_close = (tokens, i, opts, env, self) => {
  for (let j = i - 1; j >= 0; j--) if (tokens[j].type === 'heading_open') { tokens[i].tag = tokens[j].tag; break; }
  return self.renderToken(tokens, i, opts);
};
// Links to other sites open in a new tab; images load lazily.
const defaultLink = md.renderer.rules.link_open || ((tokens, i, opts, env, self) => self.renderToken(tokens, i, opts));
md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
  const href = tokens[i].attrGet('href') || '';
  if (/^https?:/i.test(href) && !/^https?:\/\/(www\.)?avnsolar\.in(\/|$)/i.test(href)) {
    tokens[i].attrSet('target', '_blank');
    tokens[i].attrSet('rel', 'noopener');
  }
  return defaultLink(tokens, i, opts, env, self);
};
const defaultImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, i, opts, env, self) => {
  tokens[i].attrSet('loading', 'lazy');
  tokens[i].attrSet('decoding', 'async');
  return defaultImage(tokens, i, opts, env, self);
};
// Tables scroll sideways on phones instead of breaking the layout.
md.renderer.rules.table_open = () => '<div class="ptable"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';

const render = (body) => md.render(String(body || ''), {});

/** Plain text of a post (for descriptions, reading time and search). */
function plainText(body) {
  return String(body || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const readingMinutes = (body) => Math.max(1, Math.round(plainText(body).split(' ').filter(Boolean).length / 200));
function summary(post, max) {
  const t = (post.excerpt || '').trim() || plainText(post.body);
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

/** "YYYY-MM-DD HH:MM:SS" (UTC, SQLite style) for now. */
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const LIVE = "status = 'published' AND published_at IS NOT NULL AND published_at <= ?";

function livePosts({ limit = 12, offset = 0, tag = '' } = {}) {
  const now = nowSql();
  const rows = db.prepare(`SELECT * FROM posts WHERE ${LIVE} ORDER BY published_at DESC, id DESC`).all(now);
  const list = tag ? rows.filter((p) => tagsOf(p).some((t) => slugify(t) === tag)) : rows;
  return { total: list.length, posts: list.slice(offset, offset + limit) };
}
const livePost = (slug) => db.prepare(`SELECT * FROM posts WHERE slug = ? AND ${LIVE}`).get(slug, nowSql());
const anyPost = (slug) => db.prepare('SELECT * FROM posts WHERE slug = ?').get(slug);
const tagsOf = (p) => String(p.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
function allTags() {
  const seen = new Map();
  livePosts({ limit: 1000 }).posts.forEach((p) => tagsOf(p).forEach((t) => { if (!seen.has(slugify(t))) seen.set(slugify(t), t); }));
  return [...seen.entries()].map(([slug, name]) => ({ slug, name }));
}
function state(p) {
  if (p.status !== 'published' || !p.published_at) return 'Draft';
  return p.published_at > nowSql() ? 'Scheduled' : 'Published';
}

module.exports = { render, slugify, plainText, readingMinutes, summary, nowSql, livePosts, livePost, anyPost, tagsOf, allTags, state };
