#!/usr/bin/env node
/* End-to-end API smoke test against a throwaway database.  npm test */
const { spawn } = require('child_process');
const fs = require('fs');
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

async function main() {
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

    console.log('Calendar');
    r = await staff.req('POST', '/api/events', { title: 'Site visit', type: 'visit', date: '2026-11-10', time: '11:00' });
    ok(r.status === 201, 'event added');
    r = await staff.req('POST', '/api/checklists', { title: 'Kit', items: ['Tape', 'Drone'] });
    ok(r.status === 201 && r.data.items.length === 2, 'checklist with items added');
  } finally {
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (failures) { console.log('\n' + failures + ' check(s) failed\n' + log.slice(-2000)); process.exit(1); }
  console.log('\nAll checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
