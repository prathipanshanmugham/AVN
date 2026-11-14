const crypto = require('crypto');
const session = require('express-session');
const config = require('./config');
const { db, getPermissions } = require('./db');
const { HttpError } = require('./util');

/** Every sign-in lasts 24 hours from the moment of signing in — activity does not extend it. */
const SIGN_IN_MS = 24 * 60 * 60 * 1000;
/** The cookie and stored session outlive the sign-in by a few days only so the sign-in page can say "24 hours are up". */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/** express-session store backed by the app's SQLite database. */
class SqliteStore extends session.Store {
  constructor() {
    super();
    this.getStmt = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?');
    this.setStmt = db.prepare('INSERT INTO sessions (sid, expires, data) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET expires = excluded.expires, data = excluded.data');
    this.delStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.touchStmt = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
    this.timer = setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()), 60 * 60 * 1000);
    this.timer.unref();
  }
  /** Stored until a few days after the latest sign-in (the 24-hour limit itself is checked in currentUser / currentClient). */
  expiry(sess) {
    const at = Math.max((sess && sess.userAt) || 0, (sess && sess.clientAt) || 0);
    if (at) return at + KEEP_MS;
    return sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + KEEP_MS;
  }
  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.data));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try { this.setStmt.run(sid, this.expiry(sess), JSON.stringify(sess)); cb && cb(null); } catch (e) { cb && cb(e); }
  }
  destroy(sid, cb) {
    try { this.delStmt.run(sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }
  touch(sid, sess, cb) {
    try { this.touchStmt.run(this.expiry(sess), sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }
}

const sessionMiddleware = session({
  name: 'avn.sid',
  secret: config.sessionSecret,
  store: new SqliteStore(),
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.httpsOnly ? true : 'auto',
    maxAge: KEEP_MS,
  },
});

function ensureCsrf(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}

/** Unsafe API requests must carry the session's CSRF token in X-CSRF-Token. */
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.get('x-csrf-token');
  if (!token || !req.session || !req.session.csrf || token.length !== req.session.csrf.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrf))) {
    return next(new HttpError(403, 'Your session expired. Refresh the page and try again.'));
  }
  next();
}

const loadUser = db.prepare('SELECT id, name, username, email, role, active, must_change FROM users WHERE id = ?');
const loadClient = db.prepare('SELECT id, customer_id, name, phone, email, active, must_change FROM clients WHERE id = ?');

const fresh = (at) => !!at && Date.now() - at < SIGN_IN_MS;

function currentUser(req) {
  if (!req.session || !req.session.userId || !fresh(req.session.userAt)) return null;
  const u = loadUser.get(req.session.userId);
  return u && u.active ? u : null;
}
function currentClient(req) {
  if (!req.session || !req.session.clientId || !fresh(req.session.clientAt)) return null;
  const c = loadClient.get(req.session.clientId);
  return c && c.active ? c : null;
}

/** True when this browser was signed in (as staff 'user' or portal 'client') and the 24 hours are up. */
function signInEnded(req, kind) {
  const s = req.session;
  return !!(s && s[kind + 'Id'] && !fresh(s[kind + 'At']));
}
/** 401 — with a clear "time's up" message when the 24 hours have passed. */
function signedOut(ended) {
  const e = new HttpError(401, ended ? 'For safety, sign-ins last 24 hours. Please sign in again.' : 'Please sign in');
  if (ended) e.expired = true;
  return e;
}

function can(user, module) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return !!getPermissions()[module];
}

/** Staff (admin or staff) must be signed in. Blocks everything but password change until a temp password is replaced. */
function requireStaff(req, res, next) {
  const u = currentUser(req);
  if (!u) return next(signedOut(signInEnded(req, 'user')));
  req.user = u;
  if (u.must_change && !req.allowMustChange) {
    return res.status(403).json({ error: 'Please set a new password first', mustChange: true });
  }
  next();
}
const allowMustChange = (req, res, next) => { req.allowMustChange = true; next(); };

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return next(new HttpError(403, 'Only admins can do this'));
  next();
}
const requirePerm = (module) => (req, res, next) => {
  if (!can(req.user, module)) return next(new HttpError(403, 'Your role does not have access to ' + module));
  next();
};

function requireClient(req, res, next) {
  const c = currentClient(req);
  if (!c) return next(signedOut(signInEnded(req, 'client')));
  req.client = c;
  if (c.must_change && !req.allowMustChange) {
    return res.status(403).json({ error: 'Please set a new password first', mustChange: true });
  }
  next();
}

/**
 * New session id on every sign-in (prevents fixation), keeping the other identity if present.
 * The sign-in time is stored per identity: staff and portal sign-ins each end 24 hours after they began.
 */
function signIn(req, patch) {
  return new Promise((resolve, reject) => {
    const s = req.session;
    const keep = { userId: s.userId, userAt: s.userAt, clientId: s.clientId, clientAt: s.clientAt };
    const now = Date.now();
    req.session.regenerate((err) => {
      if (err) return reject(err);
      Object.assign(req.session, keep, patch);
      if (patch.userId) req.session.userAt = now;
      if (patch.clientId) req.session.clientAt = now;
      req.session.csrf = crypto.randomBytes(24).toString('hex');
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}

/** Ends every stored sign-in of one person — field 'userId' or 'clientId' — except the session keepSid. */
function signOutEverywhere(field, id, keepSid) {
  try {
    db.prepare('SELECT sid, data FROM sessions').all().forEach((r) => {
      try { if (r.sid !== keepSid && JSON.parse(r.data)[field] === id) db.prepare('DELETE FROM sessions WHERE sid = ?').run(r.sid); } catch (e) { /* skip */ }
    });
  } catch (e) { /* ignore */ }
}

module.exports = { SIGN_IN_MS, signOutEverywhere, signInEnded, sessionMiddleware, ensureCsrf, csrfGuard, currentUser, currentClient, can, requireStaff, allowMustChange, requireAdmin, requirePerm, requireClient, signIn };
