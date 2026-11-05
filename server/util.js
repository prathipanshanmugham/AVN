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

module.exports = { generatePassword, hashPassword, checkPassword, str, optStr, num, int, date, time, bool, phone, HttpError, bad, notFound, forbidden, h };
