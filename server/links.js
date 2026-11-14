/*
 * One-time sign-in links for staff and customers.
 *  - welcome: a new account (valid 7 days)
 *  - reset:   sent by an admin / staff member (valid 2 days)
 *  - forgot:  requested from the sign-in page (valid 30 minutes)
 * Only a SHA-256 hash of the token is stored. Making a new link cancels older unused ones for that person.
 * Opening the link shows a "Continue" page; the link is used up only when the person taps Continue,
 * so WhatsApp / email link previews cannot spend it.
 */
const crypto = require('crypto');
const { db } = require('./db');

const TTL = { welcome: 7 * 86400000, reset: 2 * 86400000, forgot: 30 * 60000 };
const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const PATH = { staff: '/admin/link/', client: '/portal/link/' };

function create(kind, subjectId, purpose, createdBy) {
  const token = crypto.randomBytes(24).toString('base64url');
  const expires = Date.now() + (TTL[purpose] || TTL.reset);
  db.transaction(() => {
    db.prepare('UPDATE login_links SET used_at = ? WHERE kind = ? AND subject_id = ? AND used_at IS NULL').run(Date.now(), kind, subjectId);
    db.prepare('INSERT INTO login_links (token_hash, kind, subject_id, purpose, expires_at, created_by) VALUES (?,?,?,?,?,?)')
      .run(hash(token), kind, subjectId, purpose, expires, createdBy || null);
  })();
  db.prepare('DELETE FROM login_links WHERE expires_at < ?').run(Date.now() - 30 * 86400000);
  return { token, path: PATH[kind] + token, expiresAt: new Date(expires).toISOString(), purpose };
}

/** Look at a link without using it. */
function peek(kind, token) {
  if (!TOKEN_RE.test(String(token || ''))) return { error: 'invalid' };
  const row = db.prepare('SELECT * FROM login_links WHERE token_hash = ? AND kind = ?').get(hash(token), kind);
  if (!row) return { error: 'invalid' };
  if (row.used_at) return { error: 'used' };
  if (row.expires_at < Date.now()) return { error: 'expired' };
  return { row };
}

/** Use a link (once). */
function consume(kind, token) {
  const p = peek(kind, token);
  if (p.error) return p;
  const r = db.prepare('UPDATE login_links SET used_at = ? WHERE id = ? AND used_at IS NULL').run(Date.now(), p.row.id);
  return r.changes ? p : { error: 'used' };
}

const MESSAGES = {
  invalid: 'This sign-in link is not valid. Ask for a new one.',
  used: 'This sign-in link has already been used. Ask for a new one, or sign in with your password.',
  expired: 'This sign-in link has expired. Ask for a new one.',
};

module.exports = { create, peek, consume, MESSAGES, TTL };
