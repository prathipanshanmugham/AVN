const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Readable random password like "Kq7m-x2Pa-9vRt" (≈70 bits). */
function generatePassword(groups = 3, size = 4) {
  const bytes = crypto.randomBytes(groups * size);
  const parts = [];
  for (let g = 0; g < groups; g++) {
    let p = '';
    for (let i = 0; i < size; i++) p += ALPHABET[bytes[g * size + i] % ALPHABET.length];
    parts.push(p);
  }
  return parts.join('-');
}

const hashPassword = (pw) => bcrypt.hashSync(pw, 12);
const checkPassword = (pw, hash) => !!hash && bcrypt.compareSync(String(pw || ''), hash);

function str(v, max = 200) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}
function optStr(v, max = 200) {
  const s = str(v, max);
  return s === '' ? null : s;
}
function num(v, fallback = null) {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function int(v, fallback = null) {
  const n = num(v, null);
  return n === null ? fallback : Math.trunc(n);
}
function date(v) {
  const s = str(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function time(v) {
  const s = str(v, 5);
  return /^\d{2}:\d{2}$/.test(s) ? s : null;
}
function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
}
function phone(v) {
  const digits = String(v || '').replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

const EMAIL_RE = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]{2,}$/;
function email(v) {
  const s = str(v, 160);
  return EMAIL_RE.test(s) ? s : null;
}
/** http(s) links only (Drive folders, maps). Returns null for anything else. */
function url(v, max = 500) {
  const s = str(v, max);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch (e) { return null; }
}
/** One line of text: no CR/LF (used for anything that may end up in an email header). */
const line = (v, max = 200) => str(v, max).replace(/[\r\n]+/g, ' ');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (msg = 'Not found') => new HttpError(404, msg);
const forbidden = (msg = 'You do not have access to this') => new HttpError(403, msg);

/** Wrap async/sync route handlers so thrown errors reach the error middleware. */
const h = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (e) {
    next(e);
  }
};

/** https://avnsolar.in for links in messages (from the request, behind nginx). */
function baseUrl(req) {
  const host = String(req.get('host') || '');
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? req.protocol + '://' + host : '';
}

module.exports = {
  baseUrl, generatePassword, hashPassword, checkPassword, str, optStr, num, int, date, time, bool, phone, email, url, line, EMAIL_RE, HttpError, bad, notFound, forbidden, h };
