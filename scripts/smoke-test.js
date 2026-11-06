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
    ok(r.status === 400, 'short password rejected');
    r = await admin.req('POST', '/api/auth/password', { current: ADMIN_PW, next: 'Admin-New-Pass-2026' });
    ok(r.status === 200, 'admin password changed');
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
    ok(qt.customerName === 'Priya Natarajan' && qt.kwp === 3 && qt.items[0].rate === 60000 && qt.subsidy === 78000, 'filled from the lead, rates and PM Surya Ghar subsidy');
    ok(qt.bom.some((b) => b.item === 'Solar PV modules' && b.qty === '6 Nos' && b.spec.includes('TestModules')), 'scope of supply counts the panels');
    ok(qt.total === Math.round(180000 * 1.089), 'composite GST: 70% @ 5% + 30% @ 18%');
    r = await admin.req('PATCH', '/api/quotes/' + qt.id, { taxMode: 'itemised', items: [{ desc: 'Modules', qty: 1, rate: 100000, gst: 5 }, { desc: 'Installation', qty: 1, rate: 20000, gst: 18 }], discount: 0 });
    ok(r.status === 200 && r.data.total === 128600, 'itemised GST totals');
    r = await admin.req('PATCH', '/api/quotes/' + qt.id, { status: 'Sent' });
    let lead = (await admin.req('GET', '/api/leads/' + priya[0].id)).data;
    ok(lead.lead.stage === 2 && lead.quotes.length === 1, 'sending moves the lead to "Quotation sent"');
    r = await admin.req('POST', '/api/quotes/' + qt.id + '/duplicate');
    ok(r.status === 201 && r.data.number.endsWith('/0002') && r.data.status === 'Draft', 'revised copy gets the next number');
    r = await admin.req('POST', '/api/quotes/' + r.data.id + '/refill');
    ok(r.status === 200 && r.data.items.length === 1 && r.data.items[0].rate === 60000, 'refill rebuilds lines from rates');
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

    console.log('Admin sign-in from the server shell');
    const env = Object.assign({}, process.env, { DATA_DIR: path.join(tmp, 'data'), UPLOAD_DIR: path.join(tmp, 'uploads'), NODE_ENV: 'test' });
    execFileSync(process.execPath, ['scripts/set-admin.js', 'admin@avnsolar.in', 'Shell-Set-Pass-9'], { cwd: path.join(__dirname, '..'), env, stdio: 'ignore' });
    const shell = new Client();
    await shell.csrfToken();
    r = await shell.req('POST', '/api/auth/login', { username: 'ADMIN@avnsolar.in', password: 'Shell-Set-Pass-9' });
    ok(r.status === 200 && r.data.user.role === 'admin' && r.data.user.mustChange === false, 'admin signs in with the email set by admin:set');

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
