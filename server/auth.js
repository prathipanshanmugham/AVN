const crypto = require('crypto');
const session = require('express-session');
const config = require('./config');
const { db, getPermissions } = require('./db');
const { HttpError } = require('./util');

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
  expiry(sess) {
    const ms = sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
    return ms;
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
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.httpsOnly ? true : 'auto',
    maxAge: 12 * 60 * 60 * 1000,
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

function currentUser(req) {
  if (!req.session || !req.session.userId) return null;
  const u = loadUser.get(req.session.userId);
  return u && u.active ? u : null;
}
function currentClient(req) {
  if (!req.session || !req.session.clientId) return null;
  const c = loadClient.get(req.session.clientId);
  return c && c.active ? c : null;
}

function can(user, module) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return !!getPermissions()[module];
}

/** Staff (admin or staff) must be signed in. Blocks everything but password change until a temp password is replaced. */
function requireStaff(req, res, next) {
  const u = currentUser(req);
  if (!u) return next(new HttpError(401, 'Please sign in'));
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
  if (!c) return next(new HttpError(401, 'Please sign in'));
  req.client = c;
  if (c.must_change && !req.allowMustChange) {
    return res.status(403).json({ error: 'Please set a new password first', mustChange: true });
  }
  next();
}

/** Regenerate the session on sign-in to prevent fixation, keeping the other identity if present. */
function signIn(req, patch) {
  return new Promise((resolve, reject) => {
    const keep = { userId: req.session.userId, clientId: req.session.clientId };
    req.session.regenerate((err) => {
      if (err) return reject(err);
      Object.assign(req.session, keep, patch);
      req.session.csrf = crypto.randomBytes(24).toString('hex');
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}

module.exports = { sessionMiddleware, ensureCsrf, csrfGuard, currentUser, currentClient, can, requireStaff, allowMustChange, requireAdmin, requirePerm, requireClient, signIn };
