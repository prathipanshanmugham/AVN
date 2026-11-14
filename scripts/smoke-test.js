#!/usr/bin/env node
/* End-to-end API smoke test against a throwaway database.  npm test */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avn-test-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = 'http://127.0.0.1:' + PORT;
const ADMIN_PW = 'Initial-Pass-123';

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failures++; };

class Client {
  constructor() { this.cookie = ''; this.csrf = null; }
  async req(method, url, body, isForm) {
    const headers = { Accept: 'application/json' };
    if (this.cookie) headers.Cookie = this.cookie;
    if (method !== 'GET' && this.csrf) headers['X-CSRF-Token'] = this.csrf;
    let payload;
    if (isForm) payload = body; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    set.forEach((c) => { if (c.startsWith('avn.sid=')) this.cookie = c.split(';')[0]; });
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, data, headers: res.headers };
  }
  async csrfToken() { const r = await this.req('GET', '/api/csrf'); this.csrf = r.data.csrf; }
}

/** A tiny SMTP server that keeps every message, to check lead emails end to end. */
function fakeSmtp() {
  const mails = [];
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    let buf = '';
    let inData = false;
    let cur = '';
    sock.write('220 test ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; mails.push(cur); cur = ''; sock.write('250 OK queued\r\n'); } else cur += line + '\n';
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') sock.write('250-test\r\n250 AUTH PLAIN\r\n');
        else if (cmd === 'AUTH') sock.write('235 Authenticated\r\n');
        else if (cmd === 'DATA') { inData = true; sock.write('354 Go ahead\r\n'); }
        else if (cmd === 'QUIT') { sock.write('221 Bye\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, mails, port: server.address().port })));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { for (let t = 0; t < ms; t += 100) { if (fn()) return true; await wait(100); } return fn(); }

async function main() {
  const smtp = await fakeSmtp();
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: path.join(tmp, 'data'), UPLOAD_DIR: path.join(tmp, 'uploads'), ADMIN_PASSWORD: ADMIN_PW, NODE_ENV: 'test' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 50 && !log.includes('AVN running'); i++) await new Promise((r) => setTimeout(r, 100));

  try {
    console.log('Public website');
    const anon = new Client();
    let r = await anon.req('GET', '/');
    ok(r.status === 200 && r.data.includes('<title>AVN Solar') && r.data.includes('/media/hero-default.mp4'), 'homepage renders with title and hero video');
    ok(/\/assets\/site\.js\?v=[0-9a-f]{10}"/.test(r.data) && /\/assets\/site\.css\?v=/.test(r.data), 'scripts and styles carry a version so updates reach every browser');
    r = await anon.req('GET', '/admin/login');
    ok(r.status === 200 && /\/admin\/assets\/app\.js\?v=/.test(r.data), 'staff pages are versioned too');
    r = await anon.req('GET', '/no-such-page');
    ok(r.status === 404 && String(r.data).includes('site.css?v='), 'friendly 404 page');
    r = await anon.req('GET', '/api/public/site');
    ok(r.status === 200 && r.data.brands.modules.length === 8, 'site data has brands');
    r = await anon.req('POST', '/api/public/leads', { name: 'Web Visitor', phone: '98765 43210', district: 'Erode', type: 'Home', units: '600' });
    ok(r.status === 201, 'website enquiry accepted');
    r = await anon.req('POST', '/api/public/leads', { name: 'X', phone: '123' });
    ok(r.status === 400, 'bad phone rejected');
    r = await anon.req('GET', '/admin/crm');
    ok(r.status === 302 && r.headers.get('location') === '/admin/login', 'admin pages redirect to login');

    console.log('Admin sign-in');
    const admin = new Client();
    r = await admin.req('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PW });
    ok(r.status === 403, 'login without CSRF token is refused');
    await admin.csrfToken();
    r = await admin.req('POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
    ok(r.status === 401, 'wrong password refused');
    r = await admin.req('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PW });
    ok(r.status === 200 && r.data.user.mustChange === true, 'admin signs in, must change password');
    admin.csrf = r.data.csrf;
    r = await admin.req('GET', '/api/leads');
    ok(r.status === 403 && r.data.mustChange, 'blocked until password changed');
    r = await admin.req('POST', '/api/auth/password', { current: ADMIN_PW, next: 'short' });
    ok(r.status === 400 && /8 characters/.test(r.data.error), 'short password rejected with a clear message');
    r = await admin.req('POST', '/api/auth/password', { current: 'not-it', next: 'Whatever-2026' });
    ok(r.status === 400 && /current password is not right/.test(r.data.error), 'wrong current password explained');
    r = await admin.req('POST', '/api/auth/password', { current: ADMIN_PW, next: 'Admin-New-Pass-2026' });
    ok(r.status === 200, 'admin password changed');
    r = await admin.req('POST', '/api/users/' + (await admin.req('GET', '/api/auth/me')).data.user.id + '/reset-password');
    ok(r.status === 400 && /My account/.test(r.data.error), 'an admin cannot reset their own password from Users (use My account)');
    r = await admin.req('GET', '/api/leads');
    ok(r.status === 200 && r.data.leads.some((l) => l.name === 'Web Visitor' && l.source === 'Website'), 'website enquiry is in the CRM');

    console.log('Users & permissions');
    r = await admin.req('POST', '/api/users', { name: 'Meera S', username: 'meera', role: 'staff' });
    ok(r.status === 201 && r.data.tempPassword, 'admin creates staff user');
    const staffPw = r.data.tempPassword;
    r = await admin.req('PUT', '/api/permissions', { website: false, clients: true, crm: true, projects: true, calendar: true });
    ok(r.status === 200 && r.data.website === false, 'staff permissions saved');
    r = await admin.req('PATCH', '/api/users/1', { role: 'staff' });
    ok(r.status === 400, 'cannot remove the last admin');

    const staff = new Client();
    await staff.csrfToken();
    r = await staff.req('POST', '/api/auth/login', { username: 'meera', password: staffPw });
    staff.csrf = r.data.csrf;
    await staff.req('POST', '/api/auth/password', { current: staffPw, next: 'Meera-Pass-2026!' });
    r = await staff.req('GET', '/api/auth/me');
    ok(r.data.permissions.crm && !r.data.permissions.website && !r.data.permissions.settings, 'staff permissions reflected in /me');
    r = await staff.req('GET', '/api/media');
    ok(r.status === 403, 'staff blocked from website editor');
    r = await staff.req('GET', '/api/users');
    ok(r.status === 403, 'staff blocked from users');
    r = await staff.req('PUT', '/api/settings', { phone: '9999999999' });
    ok(r.status === 403, 'staff cannot change settings');
    r = await staff.req('GET', '/admin/website');
    ok(r.status === 302, 'staff redirected away from website page');

    console.log('Projects & client logins (as staff)');
    r = await staff.req('POST', '/api/projects', { name: 'Test Residence', place: 'Erode', kwp: '5 kWp', type: 'Home rooftop', value: 3 });
    ok(r.status === 201, 'staff creates project');
    const projectId = r.data.id;
    r = await staff.req('GET', '/api/projects/' + projectId);
    ok(r.data.tasks.length === 24, 'project gets the 6-stage checklist');
    r = await staff.req('POST', '/api/clients', { name: 'Test Customer', phone: '9123456780', projectId });
    ok(r.status === 201 && /^AVN-\d{4}-0001$/.test(r.data.client.customerId) && r.data.tempPassword, 'staff creates client login');
    const clientPw = r.data.tempPassword;
    const customerId = r.data.client.customerId;
    const fd = new FormData();
    fd.append('title', 'Quotation');
    fd.append('clientVisible', '1');
    fd.append('file', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'quote.pdf');
    r = await staff.req('POST', '/api/projects/' + projectId + '/docs', fd, true);
    ok(r.status === 201, 'document uploaded');
    const docId = r.data.id;
    r = await staff.req('PATCH', '/api/projects/' + projectId, { stage: 1 });
    ok(r.status === 200 && r.data.stage === 1, 'stage advanced');

    console.log('Customer portal');
    const cust = new Client();
    await cust.csrfToken();
    r = await cust.req('POST', '/api/portal/login', { login: customerId, password: 'nope' });
    ok(r.status === 401, 'wrong client password refused');
    r = await cust.req('POST', '/api/portal/login', { login: '91234 56780', password: clientPw });
    ok(r.status === 200 && r.data.mustChange, 'client signs in with mobile number');
    cust.csrf = r.data.csrf;
    r = await cust.req('GET', '/files/docs/' + docId);
    ok(r.status === 403, 'documents locked until client sets password');
    r = await cust.req('POST', '/api/portal/password', { current: clientPw, next: 'Customer-Pass-1' });
    ok(r.status === 200, 'client sets own password');
    r = await cust.req('GET', '/api/portal/me');
    ok(r.status === 200 && r.data.projects[0].name === 'Test Residence' && r.data.projects[0].docs.length === 1, 'client sees project and document');
    r = await cust.req('GET', '/files/docs/' + docId);
    ok(r.status === 200, 'client downloads their document');
    r = await cust.req('POST', '/api/portal/requests', { projectId, message: 'Inverter shows a red light' });
    ok(r.status === 201, 'client raises a service request');
    r = await cust.req('GET', '/api/leads');
    ok(r.status === 401 || r.status === 403, 'client cannot reach staff APIs');
    r = await anon.req('GET', '/files/docs/' + docId);
    ok(r.status === 403, 'anonymous cannot download documents');

    console.log('Website editor (admin)');
    const png = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#1D50B5' } }).png().toBuffer();
    const mf = new FormData();
    mf.append('section', 'gallery');
    mf.append('title', 'Test rooftop');
    mf.append('file', new Blob([png], { type: 'image/png' }), 'roof.png');
    r = await admin.req('POST', '/api/media', mf, true);
    ok(r.status === 201 && r.data.url.endsWith('.webp'), 'photo converted to WebP');
    r = await anon.req('GET', '/api/public/site');
    ok(r.data.gallery.length === 1, 'gallery photo appears on the public site');
    r = await admin.req('POST', '/api/brands', { grp: 'modules', name: 'TestBrand' });
    ok(r.status === 201, 'brand added');
    r = await admin.req('PUT', '/api/settings', { phone: '9876543210', stat1_value: '12 MW' });
    ok(r.status === 200, 'settings saved');
    r = await anon.req('GET', '/api/public/site');
    ok(r.data.company.phone === '9876543210' && r.data.stats.length === 1, 'settings show on the public site');

    console.log('Lead emails');
    r = await admin.req('PUT', '/api/settings', { lead_emails: 'sales@avnsolar.in, owner@example.com', smtp_host: '127.0.0.1', smtp_port: String(smtp.port), smtp_user: 'leads@avnsolar.in', smtp_pass: 'smtp-secret', smtp_secure: '0' });
    ok(r.status === 200 && r.data.smtp_pass === '' && r.data.smtp_pass_set === true, 'SMTP settings saved, password never sent back');
    r = await admin.req('PUT', '/api/settings', { lead_emails: 'not-an-email' });
    ok(r.status === 400, 'bad lead email address rejected');
    r = await staff.req('GET', '/api/settings');
    ok(r.status === 200 && r.data.smtp_pass === '', 'staff cannot read the SMTP password');
    r = await admin.req('POST', '/api/settings/test-email');
    ok(r.status === 200 && r.data.to.length === 2 && smtp.mails.length === 1, 'test email sent through SMTP');
    r = await anon.req('POST', '/api/public/leads', { form: 'wizard', name: 'Priya Natarajan', phone: '9445566778', district: 'Salem', type: 'Home', bill: '₹3,000 – 6,000', roof: 'RCC / concrete roof', kwp: 3, utm: { source: 'google', medium: 'cpc', gclid: 'abc' } });
    ok(r.status === 201, 'quote wizard lead accepted');
    ok(await until(() => smtp.mails.some((m) => m.includes('Priya Natarajan'))), 'lead email delivered with the lead details');
    const mail = smtp.mails.find((m) => m.includes('Priya Natarajan')) || '';
    ok(/To: sales@avnsolar\.in, owner@example\.com/i.test(mail) && mail.includes('wa.me/919445566778'), 'email goes to every recipient with a WhatsApp link');
    r = await anon.req('POST', '/api/public/leads', { form: 'popup', name: 'Priya N', phone: '94455 66778' });
    r = await admin.req('GET', '/api/leads');
    const priya = r.data.leads.filter((l) => l.phone === '9445566778');
    ok(priya.length === 1 && priya[0].source === 'Google Ads' && priya[0].size === '3 kWp', 'repeat enquiry merged; ad source and size recorded');

    console.log('Quotations');
    r = await admin.req('PUT', '/api/settings', { rate_ongrid: '60000', quote_module_wp: '550', quote_module_make: 'TestModules' });
    ok(r.status === 200, 'quotation rates saved');
    r = await admin.req('POST', '/api/quotes', { leadId: priya[0].id });
    ok(r.status === 201 && /^AVN-Q\/\d{2}-\d{2}\/0001$/.test(r.data.number), 'quotation numbered per financial year');
    const qt = r.data;
    const lineSum = (items) => items.reduce((a, it) => a + it.qty * it.rate, 0);
    ok(qt.customerName === 'Priya Natarajan' && qt.kwp === 3 && lineSum(qt.items) === 180000 && qt.subsidy === 78000, 'filled from the lead, rates and PM Surya Ghar subsidy');
    ok(qt.items.length === 7 && qt.items[0].hsn === '8541 43 00' && qt.items[0].qty === 6 && qt.items[0].group === 'Solar PV modules' &&
      qt.items.some((it) => it.hsn === '995461' && it.gst === 18) && !qt.items.some((it) => /battery/i.test(it.desc)), 'component lines with HSN/SAC and GST (no battery on-grid)');
    ok(qt.format === 'itemwise' && qt.placeOfSupply === '33', 'item-wise by default, place of supply Tamil Nadu');
    ok(qt.bom.some((b) => b.item === 'Solar PV modules' && b.qty === '6 Nos' && b.spec.includes('TestModules')), 'scope of supply counts the panels');
    ok(qt.total === Math.round(180000 * 1.089), 'composite GST: 70% @ 5% + 30% @ 18%');
    r = await admin.req('PATCH', '/api/quotes/' + qt.id, { taxMode: 'itemised', items: [{ group: 'Supply', desc: 'Modules', hsn: '8541 43 00', qty: 1, rate: 100000, gst: 5 }, { group: 'Services', desc: 'Installation', hsn: '995461', qty: 1, rate: 20000, gst: 18 }], discount: 0 });
    ok(r.status === 200 && r.data.total === 128600 && r.data.items[0].group === 'Supply', 'itemised GST totals; groups kept');
    r = await admin.req('PATCH', '/api/quotes/' + qt.id, { format: 'grouped', customerGstin: '29abcde1234f1z5', placeOfSupply: '29' });
    ok(r.status === 200 && r.data.format === 'grouped' && r.data.customerGstin === '29ABCDE1234F1Z5' && r.data.interstate === true, 'grouped format; other-state place of supply means IGST');
    r = await admin.req('PATCH', '/api/quotes/' + qt.id, { customerGstin: 'NOT-A-GSTIN' });
    ok(r.status === 400, 'bad GSTIN rejected');
    r = await admin.req('PATCH', '/api/quotes/' + qt.id, { customerGstin: '', placeOfSupply: '33' });
    ok(r.status === 200 && r.data.interstate === false, 'back to CGST + SGST in Tamil Nadu');
    ok(r.data.taxSummary === true, 'tax summary printed by default');
    r = await admin.req('PATCH', '/api/quotes/' + qt.id, { taxSummary: false });
    ok(r.status === 200 && r.data.taxSummary === false, 'tax summary can be switched off');
    {
      const QC = require('../admin/assets/quote-calc');
      const t = QC.totals({ taxMode: 'itemised', discount: 1000, items: [
        { group: 'Modules', desc: 'A', hsn: '8541', qty: 2, rate: 5000, gst: 5 }, { group: 'Modules', desc: 'B', hsn: '8541', qty: 1, rate: 3000, gst: 5 },
        { group: 'Services', desc: 'C', hsn: '995461', qty: 1, rate: 7000, gst: 18 }] });
      const taxableSum = t.items.reduce((a, it) => a + it.taxable, 0);
      const hsnTax = t.hsn.reduce((a, h) => a + h.amount, 0);
      ok(Math.abs(taxableSum - 19000) < 0.001 && t.groups.length === 2 && t.groups[0].items.length === 2 && t.hsn.length === 2 &&
        Math.abs(hsnTax - t.gst) < 0.001 && Math.abs(t.cgst + t.sgst - t.gst) < 0.001, 'discount shared across lines; groups and HSN summary add up');
      const c = QC.totals({ taxMode: 'composite', interstate: true, items: [{ desc: 'x', qty: 1, rate: 100000 }] }, { goodsHsn: '8541 43 00', servicesSac: '995461' });
      ok(c.igst === 8900 && c.cgst === 0 && c.hsn[0].hsn === '8541 43 00' && c.hsn[1].hsn === '995461' && c.effectiveRate === 8.9, 'composite summary: 70/30 legs with HSN/SAC, IGST');
      ok(QC.words(1234.5, true) === 'Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only', 'amount in words with paise');
    }
    r = await admin.req('PATCH', '/api/quotes/' + qt.id, { status: 'Sent' });
    let lead = (await admin.req('GET', '/api/leads/' + priya[0].id)).data;
    ok(lead.lead.stage === 2 && lead.quotes.length === 1, 'sending moves the lead to "Quotation sent"');
    r = await admin.req('POST', '/api/quotes/' + qt.id + '/duplicate');
    ok(r.status === 201 && r.data.number.endsWith('/0002') && r.data.status === 'Draft', 'revised copy gets the next number');
    r = await admin.req('POST', '/api/quotes/' + r.data.id + '/refill');
    ok(r.status === 200 && r.data.items.length === 7 && lineSum(r.data.items) === 180000, 'refill rebuilds lines from rates');
    r = await admin.req('PATCH', '/api/quotes/' + r.data.id, { systemType: 'Hybrid' });
    await admin.req('PUT', '/api/settings', { rate_hybrid: '90000' });
    r = await admin.req('POST', '/api/quotes/' + r.data.id + '/refill');
    ok(r.status === 200 && r.data.items.some((it) => it.hsn === '8507') && lineSum(r.data.items) === 270000, 'hybrid adds a battery line; total still exact');
    r = await admin.req('PUT', '/api/settings', { quote_components: JSON.stringify([{ key: 'modules', hsn: 'abc', gst: 5, share: 50 }]) });
    ok(r.status === 400, 'bad HSN in component settings rejected');
    r = await admin.req('PUT', '/api/settings', { quote_components: JSON.stringify([{ key: 'inverter', group: 'Inverter', desc: 'Solar inverter', hsn: '8504 40', gst: 18, share: 14 }]), quote_format: 'grouped' });
    r = await admin.req('PUT', '/api/settings', { quote_tax_summary: '0' });
    ok(r.status === 200 && r.data.quote_tax_summary === '0' && (await admin.req('POST', '/api/quotes', { customerName: 'No Summary', kwp: 2 })).data.taxSummary === false,
      'new quotations follow the tax summary default');
    await admin.req('PUT', '/api/settings', { quote_tax_summary: '1', quote_components: JSON.stringify([{ key: 'inverter', group: 'Inverter', desc: 'Solar inverter', hsn: '8504 40', gst: 18, share: 14 }]), quote_format: 'grouped' });
    r = await admin.req('GET', '/api/settings');
    ok(r.status === 200 && JSON.parse(r.data.quote_components).find((c) => c.key === 'inverter').gst === 18 && JSON.parse(r.data.quote_components).length === 8 && r.data.quote_format === 'grouped', 'component GST and default format saved');
    r = await admin.req('PATCH', '/api/quotes/' + qt.id, { status: 'Accepted' });
    lead = (await admin.req('GET', '/api/leads/' + priya[0].id)).data;
    ok(lead.lead.stage === 4 && lead.lead.value === 1.29, 'accepting marks the lead won with the order value');
    r = await admin.req('GET', '/admin/quote-print?id=' + qt.id);
    ok(r.status === 200 && String(r.data).includes('printQuote'), 'print view opens');
    r = await admin.req('PUT', '/api/permissions', { quotes: false });
    r = await staff.req('GET', '/api/quotes');
    ok(r.status === 403, 'staff blocked from quotations when not allowed');
    await admin.req('PUT', '/api/permissions', { quotes: true });

    console.log('Project records & serial numbers');
    r = await staff.req('PATCH', '/api/projects/' + projectId, { driveLink: 'javascript:alert(1)' });
    ok(r.status === 400, 'non-http Drive link rejected');
    r = await staff.req('PATCH', '/api/projects/' + projectId, { driveLink: 'https://drive.google.com/drive/folders/abc123' });
    ok(r.status === 200 && r.data.driveLink === 'https://drive.google.com/drive/folders/abc123', 'Drive folder link saved');
    r = await staff.req('PUT', '/api/projects/' + projectId + '/details', { psg_reg_date: 'yesterday' });
    ok(r.status === 400, 'bad date in the record rejected');
    r = await staff.req('PUT', '/api/projects/' + projectId + '/details', { psg_app_no: 'NP-TN-123', net_meter_no: 'NM-77', subsidy_amount: '78,000', unknown_field: 'x' });
    ok(r.status === 200 && r.data.details.psg_app_no === 'NP-TN-123' && r.data.details.subsidy_amount === '78000' && !r.data.details.unknown_field, 'MNRE / PM Surya Ghar details saved');
    r = await staff.req('POST', '/api/projects/' + projectId + '/assets', { kind: 'Module', make: 'TestModules', serials: 'TM0001\nTM0002\n TM0003 \nTM0002' });
    ok(r.status === 201 && r.data.added === 3, 'serial numbers added in bulk (duplicates in the paste ignored)');
    const p2 = (await staff.req('POST', '/api/projects', { name: 'Second Site' })).data.id;
    r = await staff.req('POST', '/api/projects/' + p2 + '/assets', { kind: 'Module', serials: ['tm0001', 'TM0009'] });
    ok(r.status === 201 && r.data.added === 1 && r.data.skipped[0].projectName === 'Test Residence', 'a serial already on another project is flagged');
    r = await staff.req('GET', '/api/assets/search?q=tm000');
    ok(r.status === 200 && r.data.length === 4, 'serial search across projects');
    r = await staff.req('GET', '/api/projects/' + projectId + '/assets.csv');
    ok(r.status === 200 && String(r.data).includes('TM0003') && /attachment/.test(r.headers.get('content-disposition')), 'serial numbers export as CSV');
    r = await staff.req('GET', '/api/projects/' + projectId);
    ok(r.data.assets.length === 3 && r.data.project.details.net_meter_no === 'NM-77', 'project shows record and serials');

    console.log('CEO dashboard & PDF reports');
    r = await staff.req('PATCH', '/api/projects/' + projectId, { capacityKw: 5, systemType: 'Hybrid', stage: 6 });
    ok(r.status === 200 && r.data.capacityKw === 5 && r.data.systemType === 'Hybrid' && /^\d{4}-\d{2}-\d{2}$/.test(r.data.completedAt), 'handover records capacity, system type and date');
    r = await staff.req('PUT', '/api/projects/' + projectId + '/details', { order_value: '300000', received: '150000' });
    r = await staff.req('GET', '/api/dashboard');
    ok(r.status === 403, 'staff cannot open the CEO dashboard by default');
    r = await admin.req('GET', '/api/dashboard?period=all');
    ok(r.status === 200 && r.data.kpis.installedKwAll === 5 && r.data.bySystem.find((x) => x.system === 'Hybrid').installedKw === 5, 'dashboard counts kW installed by system type');
    ok(r.data.byLocation.find((x) => x.place === 'Erode').total === 5 && typeof r.data.health.score === 'number' && r.data.health.parts.length === 6, 'kW per location and the health score');
    for (const t of ['company', 'installations', 'sales', 'collections']) {
      const res = await fetch(BASE + '/api/reports/' + t + '.pdf?period=this_fy', { headers: { Cookie: admin.cookie } });
      const buf = Buffer.from(await res.arrayBuffer());
      ok(res.status === 200 && res.headers.get('content-type') === 'application/pdf' && buf.slice(0, 5).toString() === '%PDF-' && buf.length > 5000, t + ' report downloads as PDF');
    }
    r = await admin.req('GET', '/admin');
    ok(r.status === 302 && r.headers.get('location') === '/admin/dashboard', 'admins land on the dashboard');
    r = await admin.req('GET', '/admin/dashboard');
    ok(r.status === 200 && String(r.data).includes('x-data="dash"'), 'dashboard page opens for admin');

    console.log('Website photos & brand logos');
    const wide = await sharp({ create: { width: 2400, height: 900, channels: 3, background: '#2BA6E4' } }).jpeg().toBuffer();
    const bf = new FormData();
    bf.append('section', 'banner');
    bf.append('file', new Blob([wide], { type: 'image/jpeg' }), 'band.jpg');
    r = await admin.req('POST', '/api/media', bf, true);
    ok(r.status === 201 && r.data.section === 'banner', 'photo band image uploaded');
    const vf = new FormData();
    vf.append('section', 'banner');
    vf.append('file', new Blob(['not really a video'], { type: 'video/mp4' }), 'clip.mp4');
    r = await admin.req('POST', '/api/media', vf, true);
    ok(r.status === 400, 'photo band refuses videos');
    const logo = await sharp({ create: { width: 600, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from('<svg width="400" height="100"><rect width="150" height="100" fill="#1D50B5"/><rect x="250" width="150" height="100" fill="#F7931E"/></svg>'), top: 100, left: 100 }]).png().toBuffer();
    const brands = (await admin.req('GET', '/api/brands')).data;
    const waaree = brands.find((b) => b.name === 'Waaree');
    const lf = new FormData();
    lf.append('file', new Blob([logo], { type: 'image/png' }), 'waaree.png');
    r = await admin.req('POST', '/api/brands/' + waaree.id + '/logo', lf, true);
    ok(r.status === 200 && /\.webp$/.test(r.data.logo), 'brand logo saved as WebP');
    const meta = await sharp(path.join(tmp, 'uploads', r.data.logo)).metadata();
    ok(meta.width === 400 && meta.height === 100 && meta.hasAlpha, 'logo trimmed to its edges, transparency kept');
    const sf = new FormData();
    sf.append('grp', 'inverters');
    sf.append('file', new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><script>alert(1)</script><rect width="120" height="40" fill="#F7931E"/></svg>'], { type: 'image/svg+xml' }), 'sungrow.svg');
    r = await admin.req('POST', '/api/brands/logo-file', sf, true);
    ok(r.status === 200 && r.data.name === 'Sungrow' && /\.webp$/.test(r.data.logo), 'logo file matched to its brand by name; SVG rasterised');
    r = await anon.req('GET', '/api/public/site');
    ok(r.data.brands.modules.find((b) => b.name === 'Waaree').logo && r.data.banner.length === 1 && r.data.company.whatsappMessage, 'logos, photo band and WhatsApp text on the public site');

    console.log('Search engines (SEO)');
    r = await anon.req('GET', '/robots.txt');
    ok(r.status === 200 && /Sitemap: https:\/\/avnsolar\.in\/sitemap\.xml/.test(r.data) && /Disallow: \/admin/.test(r.data), 'robots.txt points to the sitemap, hides the back end');
    r = await anon.req('GET', '/sitemap.xml');
    ok(r.status === 200 && (String(r.data).match(/<loc>/g) || []).length === 6 && String(r.data).includes('https://avnsolar.in/rooftop-solar-for-homes') && String(r.data).includes('<loc>https://avnsolar.in/blog</loc>'),
      'sitemap lists the homepage, service pages and blog');
    r = await anon.req('GET', '/');
    const home = String(r.data);
    const ldOf = (html) => { const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/); return m ? JSON.parse(m[1]) : null; };
    const homeLd = ldOf(home);
    const types = homeLd ? homeLd['@graph'].map((n) => n['@type']) : [];
    ok(home.includes('<link rel="canonical" href="https://avnsolar.in/">') && home.includes('og:image" content="https://avnsolar.in/assets/og-image.jpg"') && home.includes('lang="en-IN"'),
      'homepage: canonical, absolute share image, language');
    ok(types.includes('HomeAndConstructionBusiness') && types.includes('WebSite') && types.includes('FAQPage'), 'homepage structured data: business, website, FAQ');
    ok((home.match(/<details class="faq-item"/g) || []).length >= 8 && !home.includes('__FAQ_HTML__') && !home.includes('__FOOTER__') && home.includes('href="/solar-water-pumps"'),
      'FAQ and footer links rendered on the server');
    ok(!home.includes('googletagmanager.com/gtag') && /script-src[^;]*googletagmanager/.test(r.headers.get('content-security-policy')), 'no analytics until an ID is set; CSP ready for it');
    r = await anon.req('GET', '/rooftop-solar-for-homes');
    const svc = String(r.data);
    const svcTypes = (ldOf(svc) || { '@graph': [] })['@graph'].map((n) => n['@type']);
    ok(r.status === 200 && /<h1>Rooftop solar for your home/.test(svc) && svc.includes('₹78,000') && svc.includes('rel="canonical" href="https://avnsolar.in/rooftop-solar-for-homes"') &&
      svcTypes.includes('Service') && svcTypes.includes('BreadcrumbList'), 'service page: content, canonical, Service + breadcrumb data');
    for (const slug of ['commercial-industrial-solar', 'solar-water-pumps', 'solar-maintenance-amc']) {
      r = await anon.req('GET', '/' + slug);
      ok(r.status === 200 && String(r.data).includes('id="quote"') && !/__[A-Z_]+__/.test(String(r.data)), '/' + slug + ' renders with a quote form');
    }
    r = await anon.req('POST', '/api/public/leads', { form: 'contact', type: 'Farm', name: 'Murugan K', phone: '9003311223', district: 'Gobi', note: 'Borewell 400 ft', page: '/solar-water-pumps' });
    ok(r.status === 201, 'service page quote form creates a lead');
    r = await anon.req('GET', '/favicon.ico');
    ok(r.status === 200 && /icon/.test(r.headers.get('content-type')), 'favicon.ico served');
    r = await anon.req('GET', '/site.webmanifest');
    ok(r.status === 200 && r.data.icons.length === 3 && r.data.short_name === 'AVN Solar', 'web app manifest with icons');
    r = await anon.req('GET', '/icons/apple-touch-icon.png');
    ok(r.status === 200, 'apple touch icon served');
    const www = await new Promise((resolve) => {
      require('http').get({ host: '127.0.0.1', port: PORT, path: '/solar-water-pumps?x=1', headers: { Host: 'www.avnsolar.in' } }, (res) => { res.resume(); resolve(res); });
    });
    ok(www.statusCode === 301 && www.headers.location === 'https://avnsolar.in/solar-water-pumps?x=1', 'www redirects to the main address');
    r = await anon.req('GET', '/about/');
    let r2 = await anon.req('GET', '/contact');
    let r3 = await anon.req('GET', '/sitemap_index.xml');
    let r4 = await anon.req('GET', '/hello-world/');
    ok(r.status === 301 && r.headers.get('location') === '/#why' && r2.headers.get('location') === '/#contact' && r3.headers.get('location') === '/sitemap.xml' && r4.status === 410,
      'old WordPress addresses redirect (filler pages gone)');
    r = await admin.req('PUT', '/api/settings', { site_url: 'avnsolar' });
    ok(r.status === 400, 'bad website address rejected');
    r = await admin.req('PUT', '/api/settings', { google_verification: '<meta name="google-site-verification" content="abcDEF123_-xyz789" />', ga_id: 'G-TEST1234', service_areas: 'Tamil Nadu,  Tiruppur ,Erode', social_instagram: 'javascript:alert(1)' });
    ok(r.status === 400, 'non-web social link rejected');
    r = await admin.req('PUT', '/api/settings', { google_verification: '<meta name="google-site-verification" content="abcDEF123_-xyz789" />', ga_id: 'G-TEST1234', service_areas: 'Tamil Nadu,  Tiruppur ,Erode' });
    ok(r.status === 200 && r.data.google_verification === 'abcDEF123_-xyz789' && r.data.service_areas === 'Tamil Nadu, Tiruppur, Erode', 'verification code taken from the pasted tag; areas tidied');
    r = await anon.req('GET', '/');
    ok(String(r.data).includes('<meta name="google-site-verification" content="abcDEF123_-xyz789">') && String(r.data).includes('gtag/js?id=G-TEST1234') &&
      ldOf(String(r.data))['@graph'][0].areaServed.length === 3, 'verification, Analytics and service areas on the homepage');
    r = await anon.req('GET', '/assets/ga.js');
    ok(r.status === 200, 'Analytics loader served from a file (no inline script)');

    console.log('Blog');
    r = await anon.req('GET', '/blog');
    ok(r.status === 200 && String(r.data).includes('first articles are on the way') && !String((await anon.req('GET', '/')).data).includes('From the blog'),
      'blog page works before anything is published; homepage section hidden');
    r = await admin.req('GET', '/api/blog');
    ok(r.status === 200 && r.data.length === 3 && r.data.every((p) => p.state === 'Draft'), 'three starter articles waiting as drafts');
    const starter = r.data.find((p) => p.slug === 'pm-surya-ghar-subsidy-tamil-nadu');
    r = await anon.req('GET', '/blog/' + starter.slug);
    ok(r.status === 404, 'drafts are not public');
    r = await admin.req('GET', '/blog/' + starter.slug);
    ok(r.status === 200 && String(r.data).includes('noindex') && String(r.data).includes('Only signed-in staff'), 'staff can preview a draft (not indexed)');
    r = await staff.req('GET', '/api/blog');
    ok(r.status === 403, 'staff need the Blog permission');
    r = await admin.req('POST', '/api/blog', { title: 'Net metering in Tamil Nadu, explained' });
    const post = r.data;
    ok(r.status === 201 && post.slug === 'net-metering-in-tamil-nadu-explained' && post.state === 'Draft', 'new post gets a web address from its title');
    r = await admin.req('PATCH', '/api/blog/' + post.id, { status: 'published' });
    ok(r.status === 400, 'an empty post cannot be published');
    r = await admin.req('PATCH', '/api/blog/' + post.id, { slug: starter.slug });
    ok(r.status === 400, 'two posts cannot share a web address');
    r = await admin.req('PATCH', '/api/blog/' + post.id, { slug: 'Bad Address!' });
    ok(r.status === 400, 'web address must be small letters, numbers and hyphens');
    const body = '# Big heading\n\nA two-way meter **records** both directions. <script>alert(1)</script>\n\n[bad](javascript:alert(1)) and [good](/rooftop-solar-for-homes) and [out](https://mnre.gov.in)';
    r = await admin.req('PATCH', '/api/blog/' + post.id, { body, tags: 'Net metering, Homes', excerpt: 'How the two-way meter works.', status: 'published' });
    ok(r.status === 200 && r.data.state === 'Published' && r.data.publishedAt, 'published');
    const cf = new FormData();
    cf.append('file', new Blob([await sharp({ create: { width: 2000, height: 1300, channels: 3, background: '#F7931E' } }).jpeg().toBuffer()], { type: 'image/jpeg' }), 'cover.jpg');
    r = await admin.req('POST', '/api/blog/' + post.id + '/cover', cf, true);
    ok(r.status === 200 && /\.webp$/.test(r.data.cover), 'cover photo saved as WebP');
    r = await anon.req('GET', '/blog/' + post.slug);
    const art = String(r.data);
    const ogFile = (art.match(/og:image" content="https:\/\/avnsolar\.in\/media\/([a-f0-9]+\.jpg)"/) || [])[1];
    const ogMeta = ogFile ? await sharp(path.join(tmp, 'uploads', 'media', ogFile)).metadata() : {};
    ok(ogMeta.width === 1200 && ogMeta.height === 630 && ogMeta.format === 'jpeg', 'a 1200×630 share image is made from the cover');
    const artLd = ldOf(art);
    ok(r.status === 200 && art.includes('<h1>Net metering in Tamil Nadu, explained</h1>') && art.includes('<h2 id="big-heading">Big heading</h2>') &&
      art.includes('&lt;script&gt;') && !art.includes('<script>alert') && !art.includes('href="javascript') && art.includes('href="https://mnre.gov.in" target="_blank" rel="noopener"'),
      'article renders safely: one h1, raw HTML shown as text, unsafe links dropped');
    ok(artLd['@graph'].some((n) => n['@type'] === 'BlogPosting' && n.headline && n.datePublished) && art.includes('og:type" content="article"') && art.includes('/media/' + ogFile),
      'article structured data and share image');
    r = await anon.req('GET', '/blog');
    ok(String(r.data).includes('/blog/' + post.slug) && String((await anon.req('GET', '/')).data).includes('From the blog'), 'listed on /blog and the homepage');
    r = await anon.req('GET', '/blog?tag=net-metering');
    ok(r.status === 200 && String(r.data).includes(post.title), 'topic filter');
    r = await anon.req('GET', '/blog?tag=nothing-here');
    ok(r.status === 301, 'unknown topic goes back to the blog');
    r = await anon.req('GET', '/sitemap.xml');
    ok(String(r.data).includes('/blog/' + post.slug) && String(r.data).includes('<loc>https://avnsolar.in/blog</loc>'), 'sitemap lists the blog and the post');
    r = await anon.req('GET', '/blog/feed.xml');
    ok(r.status === 200 && String(r.data).includes('<rss') && String(r.data).includes('/blog/' + post.slug), 'RSS feed');
    r = await admin.req('PATCH', '/api/blog/' + starter.id, { status: 'published', publishedAt: new Date(Date.now() + 86400000).toISOString() });
    ok(r.status === 200 && r.data.state === 'Scheduled' && (await anon.req('GET', '/blog/' + starter.slug)).status === 404, 'scheduled post stays hidden until its time');
    r = await admin.req('PATCH', '/api/blog/' + starter.id, { publishedAt: new Date(Date.now() - 60000).toISOString() });
    ok(r.data.state === 'Published' && (await anon.req('GET', '/blog/' + starter.slug)).status === 200, 'goes live once the time has passed');
    r = await admin.req('POST', '/api/blog/preview', { body: '## Hi\n\n<b>x</b>' });
    ok(r.data.html.includes('<h2 id="hi">Hi</h2>') && r.data.html.includes('&lt;b&gt;'), 'editor preview');
    r = await admin.req('DELETE', '/api/blog/' + post.id);
    ok(r.status === 200 && (await anon.req('GET', '/blog/' + post.slug)).status === 404 && !fs.existsSync(path.join(tmp, 'uploads', 'media', ogFile)), 'delete removes the post and its photos');

    console.log('Admin sign-in from the server shell');
    const env = Object.assign({}, process.env, { DATA_DIR: path.join(tmp, 'data'), UPLOAD_DIR: path.join(tmp, 'uploads'), NODE_ENV: 'test' });
    execFileSync(process.execPath, ['scripts/set-admin.js', 'admin@avnsolar.in', 'Shell-Set-Pass-9'], { cwd: path.join(__dirname, '..'), env, stdio: 'ignore' });
    const shell = new Client();
    await shell.csrfToken();
    r = await shell.req('POST', '/api/auth/login', { username: 'ADMIN@avnsolar.in', password: 'Shell-Set-Pass-9' });
    ok(r.status === 200 && r.data.user.role === 'admin' && r.data.user.mustChange === false, 'admin signs in with the email set by admin:set');
    const printed = execFileSync(process.execPath, ['scripts/set-admin.js', 'admin@avnsolar.in'], { cwd: path.join(__dirname, '..'), env }).toString();
    const madePw = (printed.match(/New password:\s+(\S+)/) || [])[1];
    r = await shell.req('GET', '/api/auth/me');
    ok(r.status === 401 && /Signed out \d+ old session/.test(printed), 'a server reset signs the admin out everywhere');
    const fresh = new Client();
    await fresh.csrfToken();
    r = await fresh.req('POST', '/api/auth/login', { username: 'admin@avnsolar.in', password: madePw });
    const other = new Client();
    await other.csrfToken();
    const oldPw = await other.req('POST', '/api/auth/login', { username: 'admin@avnsolar.in', password: 'Shell-Set-Pass-9' });
    ok(madePw && madePw.length >= 16 && r.status === 200 && oldPw.status === 401,
      'admin:set with no password makes a strong one that works (old one no longer does)');

    console.log('Calendar');
    r = await staff.req('POST', '/api/events', { title: 'Site visit', type: 'visit', date: '2026-11-10', time: '11:00' });
    ok(r.status === 201, 'event added');
    r = await staff.req('POST', '/api/checklists', { title: 'Kit', items: ['Tape', 'Drone'] });
    ok(r.status === 201 && r.data.items.length === 2, 'checklist with items added');
  } finally {
    server.kill();
    smtp.server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (failures) { console.log('\n' + failures + ' check(s) failed\n' + log.slice(-2000)); process.exit(1); }
  console.log('\nAll checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
