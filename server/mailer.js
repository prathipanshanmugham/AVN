/* Lead notification emails over the SMTP server configured in Settings → Lead emails. */
const nodemailer = require('nodemailer');
const { getSettings, setSetting } = require('./db');
const { EMAIL_RE } = require('./util');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const oneLine = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();

function recipients(s) {
  return String(s.lead_emails || '').split(/[\s,;]+/).map((x) => x.trim()).filter((x) => EMAIL_RE.test(x)).slice(0, 10);
}

function configured(s) {
  return !!(s.smtp_host && (s.smtp_from || s.smtp_user));
}

function makeTransport(s) {
  const port = parseInt(s.smtp_port, 10) || 587;
  return nodemailer.createTransport({
    host: s.smtp_host,
    port,
    secure: s.smtp_secure === '1' || port === 465,
    auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

function fromHeader(s) {
  const from = oneLine(s.smtp_from);
  if (from.includes('<')) return from;
  return { name: oneLine(s.brand_name) || 'AVN Solar', address: from || oneLine(s.smtp_user) };
}

async function send(s, { to, subject, text, html, replyTo }) {
  if (!configured(s)) throw new Error('Add your SMTP server and sender address first');
  await makeTransport(s).sendMail({ from: fromHeader(s), to, subject: oneLine(subject), text, html, replyTo });
}

function remember(ok, message) {
  setSetting('mail_status', JSON.stringify({ ok, at: new Date().toISOString(), message: String(message || '').slice(0, 300) }));
}

/** Email the new website lead to everyone in Settings → Lead emails. Never throws. */
async function notifyLead(lead, opts = {}) {
  const s = getSettings();
  const to = recipients(s);
  if (!to.length || !configured(s)) return { skipped: true };
  const crm = opts.baseUrl ? opts.baseUrl + '/admin/crm' : '';
  const wa = lead.phone ? 'https://wa.me/91' + lead.phone : '';
  const rows = [
    ['Name', lead.name],
    ['Mobile', lead.phone],
    ['Email', lead.email],
    ['District / town', lead.place],
    ['For', lead.type],
    ['Estimated size', lead.size],
    ...(lead.details || []),
  ].filter((r) => r[1]);
  const title = (opts.repeat ? 'Repeat enquiry' : 'New lead') + ': ' + oneLine(lead.name) + (lead.place ? ' · ' + oneLine(lead.place) : '');
  const text = [title, '', ...rows.map((r) => r[0] + ': ' + r[1]), '', wa ? 'WhatsApp: ' + wa : '', crm ? 'Open the CRM: ' + crm : ''].filter((l) => l !== null).join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111847;max-width:560px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#A84F00;font-weight:bold">${esc(s.brand_name || 'AVN Solar')} website</p>
<h2 style="margin:0 0 16px;font-size:20px">${esc(title)}</h2>
<table cellpadding="8" style="border-collapse:collapse;width:100%">${rows.map((r) => `<tr><td style="border-bottom:1px solid #E3E8F2;color:#5B6285;width:38%">${esc(r[0])}</td><td style="border-bottom:1px solid #E3E8F2;font-weight:bold">${esc(r[1])}</td></tr>`).join('')}</table>
<p style="margin:20px 0 0">${lead.phone ? `<a href="tel:+91${esc(lead.phone)}" style="display:inline-block;background:#111847;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold;margin:0 8px 8px 0">Call</a><a href="${esc(wa)}" style="display:inline-block;background:#1E8E5A;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold;margin:0 8px 8px 0">WhatsApp</a>` : ''}${crm ? `<a href="${esc(crm)}" style="display:inline-block;background:#FFC12E;color:#111847;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold;margin:0 8px 8px 0">Open CRM</a>` : ''}</p>
</div>`;
  try {
    await send(s, { to, subject: title, text, html, replyTo: lead.email || undefined });
    remember(true, 'Lead email sent to ' + to.join(', '));
    return { sent: true };
  } catch (e) {
    remember(false, e.message);
    console.error('Lead email failed:', e.message);
    return { error: e.message };
  }
}

/** Settings → "Send test email". Throws with the SMTP server's reason so the admin can fix it. */
async function sendTest(to) {
  const s = getSettings();
  const list = to ? [to] : recipients(s);
  if (!list.length) throw new Error('Add at least one email address to send leads to');
  try {
    await send(s, {
      to: list,
      subject: (s.brand_name || 'AVN Solar') + ' — test email',
      text: 'Lead emails are working. New website enquiries will arrive here.',
      html: '<p style="font-family:Arial,sans-serif">Lead emails are working. New website enquiries will arrive here.</p>',
    });
  } catch (e) {
    remember(false, e.message);
    throw e;
  }
  remember(true, 'Test email sent to ' + list.join(', '));
  return list;
}

/**
 * A one-time sign-in link (staff workspace or customer portal). Returns { sent } or { error }; never throws.
 * opts: { to, name, url, kind: 'staff'|'client', purpose: 'welcome'|'reset'|'forgot', expiresAt }
 */
async function sendLink(opts) {
  const s = getSettings();
  if (!configured(s) || !EMAIL_RE.test(String(opts.to || ''))) return { skipped: true };
  const brand = s.brand_name || 'AVN Solar';
  const place = opts.kind === 'staff' ? 'AVN Workspace' : brand + ' customer portal';
  const until = new Date(opts.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const lead = opts.purpose === 'welcome' ? 'Your ' + place + ' account is ready.' : 'Here is your link to sign in to ' + place + ' and set a new password.';
  const subject = opts.purpose === 'welcome' ? 'Welcome to ' + place : 'Your ' + place + ' sign-in link';
  const text = ['Hello ' + oneLine(opts.name) + ',', '', lead, '', 'Tap to sign in: ' + opts.url, '',
    'The link works once, until ' + until + '. You will choose your own password after tapping it.',
    'If you did not ask for this, ignore this email — nothing changes.'].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111847;max-width:520px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#A84F00;font-weight:bold">${esc(place)}</p>
<h2 style="margin:0 0 12px;font-size:20px">Hello ${esc(opts.name)},</h2>
<p style="margin:0 0 20px">${esc(lead)}</p>
<p style="margin:0 0 20px"><a href="${esc(opts.url)}" style="display:inline-block;background:#111847;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Sign in</a></p>
<p style="margin:0 0 8px;color:#5B6285;font-size:13px">The button works once, until ${esc(until)}. You will choose your own password after tapping it.</p>
<p style="margin:0;color:#5B6285;font-size:13px">If you did not ask for this, ignore this email — nothing changes.</p>
</div>`;
  try {
    await send(s, { to: opts.to, subject, text, html });
    return { sent: true };
  } catch (e) {
    console.error('Sign-in link email failed:', e.message);
    return { error: e.message };
  }
}

module.exports = { notifyLead, sendTest, sendLink, recipients, configured };
