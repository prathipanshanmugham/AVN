/* Downloadable PDF reports for the CEO dashboard (A4, DM Sans so ₹ prints correctly). */
const path = require('path');
const PDFDocument = require('pdfkit');
const config = require('./config');
const { getSettings, STAGES_PROJECT, SYSTEM_TYPES } = require('./db');
const M = require('./metrics');

const FONT_R = path.join(__dirname, 'fonts', 'DMSans_400Regular.ttf');
const FONT_B = path.join(__dirname, 'fonts', 'DMSans_700Bold.ttf');
const LOGO = path.join(config.root, 'public', 'assets', 'logo.png');

const C = {
  ink: '#111847', text2: '#3A4170', muted: '#5B6285', line: '#E3E8F2', soft: '#F4F7FC', accent: '#FFC12E', orange: '#F7931E',
  sys: { 'On-grid': '#1D50B5', Hybrid: '#F7931E', 'Off-grid': '#1BAF7A' },
  tone: { good: '#0CA30C', warning: '#FAB219', serious: '#EC835A', critical: '#D03B3B', none: '#8A93B5' },
};
const W = 595.28;
const H = 841.89;
const MX = 40;
const CW = W - MX * 2;
const BOTTOM = H - 56;

const inr = M.inr;
const kwOrDash = (n) => (Number(n) ? kw(n) : '—');
const kw = (n) => (Math.round((Number(n) || 0) * 10) / 10).toLocaleString('en-IN') + ' kW';
const fmtDate = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const monthLabel = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' });

const REPORTS = {
  company: { title: 'Company report', file: 'company-report' },
  installations: { title: 'Installations report', file: 'installations' },
  sales: { title: 'Leads & quotations report', file: 'leads-quotations' },
  collections: { title: 'Collections report', file: 'collections' },
};

function newDoc(title, s) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 40, left: MX, right: MX }, bufferPages: true,
    info: { Title: title, Author: s.company_name || 'AVN Solar', Creator: 'AVN Workspace' } });
  doc.registerFont('R', FONT_R);
  doc.registerFont('B', FONT_B);
  doc.font('R');
  return doc;
}

function header(doc, s, title, range) {
  try { doc.image(LOGO, MX, 36, { width: 46 }); } catch (e) { /* logo optional */ }
  doc.font('B').fontSize(15).fillColor(C.ink).text(s.company_name || 'AVN Solar Solutions', MX + 58, 40, { width: CW - 220 });
  doc.font('R').fontSize(8.5).fillColor(C.muted).text([s.address, s.gstin ? 'GSTIN ' + s.gstin : ''].filter(Boolean).join(' · ').replace(/\n/g, ', '), MX + 58, doc.y + 2, { width: CW - 220 });
  doc.font('B').fontSize(16).fillColor(C.ink).text(title, MX, 40, { width: CW, align: 'right' });
  const when = range ? (range.from ? fmtDate(range.from) + ' – ' + fmtDate(range.to) : 'All time, up to ' + fmtDate(range.to)) : 'As of ' + fmtDate(M.periodRange('all').to);
  doc.font('R').fontSize(9).fillColor(C.text2).text((range ? range.label + ' · ' : '') + when, MX, 62, { width: CW, align: 'right' });
  const grad = doc.linearGradient(MX, 96, MX + CW, 96);
  grad.stop(0, C.accent).stop(0.55, C.orange).stop(1, '#2BA6E4');
  doc.roundedRect(MX, 94, CW, 4, 2).fill(grad);
  doc.y = 112;
  doc.x = MX;
}

function footers(doc, s) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('R').fontSize(8).fillColor(C.muted)
      .text((s.brand_name || 'AVN Solar') + ' · generated ' + new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }), MX, H - 32, { width: CW / 2, lineBreak: false })
      .text('Page ' + (i + 1) + ' of ' + range.count, MX + CW / 2, H - 32, { width: CW / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = keep;
  }
}

function ensure(doc, h) {
  if (doc.y + h > BOTTOM) { doc.addPage(); doc.y = 48; }
}

function section(doc, title, note) {
  ensure(doc, 60);
  doc.moveDown(0.6);
  doc.font('B').fontSize(12).fillColor(C.ink).text(title, MX, doc.y, { width: CW });
  if (note) doc.font('R').fontSize(8.5).fillColor(C.muted).text(note, MX, doc.y + 1, { width: CW });
  doc.y += 6;
}

/** KPI tiles, 4 per row. items: [{label, value, sub}] */
function tiles(doc, items) {
  const gap = 8;
  const tw = (CW - gap * 3) / 4;
  const th = 58;
  for (let i = 0; i < items.length; i += 4) {
    ensure(doc, th + gap);
    const y = doc.y;
    items.slice(i, i + 4).forEach((t, j) => {
      const x = MX + j * (tw + gap);
      doc.roundedRect(x, y, tw, th, 8).fill(j === 0 && i === 0 ? C.ink : C.soft);
      const dark = j === 0 && i === 0;
      doc.font('R').fontSize(7.5).fillColor(dark ? '#C9D0EC' : C.muted).text(t.label, x + 10, y + 9, { width: tw - 20 });
      doc.font('B').fontSize(15).fillColor(dark ? C.accent : C.ink).text(t.value, x + 10, y + 22, { width: tw - 20, lineBreak: false });
      if (t.sub) doc.font('R').fontSize(7.5).fillColor(dark ? '#C9D0EC' : C.text2).text(t.sub, x + 10, y + 42, { width: tw - 20, lineBreak: false });
    });
    doc.y = y + th + gap;
  }
}

/** Simple table with a repeating header. cols: [{label, width, align}] widths are fractions of the content width. */
function table(doc, cols, rows, opts = {}) {
  const widths = cols.map((c) => c.width * CW);
  const pad = 5;
  const head = () => {
    const y = doc.y;
    doc.rect(MX, y, CW, 18).fill(C.ink);
    let x = MX;
    cols.forEach((c, i) => {
      doc.font('B').fontSize(7.5).fillColor('#fff').text(c.label, x + pad, y + 5, { width: widths[i] - pad * 2, align: c.align || 'left', lineBreak: false });
      x += widths[i];
    });
    doc.y = y + 18;
  };
  ensure(doc, 40);
  head();
  if (!rows.length) {
    doc.font('R').fontSize(8.5).fillColor(C.muted).text(opts.empty || 'Nothing in this period.', MX + pad, doc.y + 6, { width: CW });
    doc.y += 8;
    return;
  }
  rows.forEach((r, ri) => {
    doc.font(r.bold ? 'B' : 'R').fontSize(8.5);
    const h = Math.max(...r.cells.map((cell, i) => doc.heightOfString(String(cell == null ? '' : cell), { width: widths[i] - pad * 2 }))) + pad * 2;
    if (doc.y + h > BOTTOM) { doc.addPage(); doc.y = 48; head(); }
    const y = doc.y;
    if (r.bold) doc.rect(MX, y, CW, h).fill(C.soft);
    else if (ri % 2) doc.rect(MX, y, CW, h).fill('#FAFBFD');
    let x = MX;
    r.cells.forEach((cell, i) => {
      doc.font(r.bold ? 'B' : 'R').fontSize(8.5).fillColor(C.ink).text(String(cell == null ? '' : cell), x + pad, y + pad, { width: widths[i] - pad * 2, align: cols[i].align || 'left' });
      x += widths[i];
    });
    doc.moveTo(MX, y + h).lineTo(MX + CW, y + h).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.y = y + h;
  });
  doc.x = MX;
}

/** One whole split into parts (kW by system type), with a legend that carries the numbers. */
function segmented(doc, parts) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  ensure(doc, 60);
  const y = doc.y + 4;
  if (!total) {
    doc.roundedRect(MX, y, CW, 20, 4).fill(C.soft);
    doc.font('R').fontSize(8.5).fillColor(C.muted).text('No kW recorded yet', MX + 8, y + 6);
    doc.y = y + 30;
    return;
  }
  let x = MX;
  parts.filter((p) => p.value > 0).forEach((p) => {
    const w = (p.value / total) * CW - 2;
    doc.roundedRect(x, y, Math.max(w, 2), 22, 4).fill(p.color);
    const share = Math.round((p.value / total) * 100) + '%';
    doc.font('B').fontSize(8.5);
    if (doc.widthOfString(share) + 12 < w) doc.fillColor(p.color === C.sys.Hybrid ? C.ink : '#fff').text(share, x + 6, y + 6.5, { lineBreak: false });
    x += w + 2;
  });
  doc.y = y + 30;
  legend(doc, parts.map((p) => ({ color: p.color, label: p.label + '  ' + kw(p.value) })));
}

function legend(doc, items) {
  let lx = MX;
  const ly = doc.y;
  items.forEach((it) => {
    doc.roundedRect(lx, ly + 1, 8, 8, 2).fill(it.color);
    doc.font('R').fontSize(8.5).fillColor(C.ink).text(it.label, lx + 12, ly, { lineBreak: false });
    lx += 24 + doc.widthOfString(it.label);
  });
  doc.y = ly + 18;
}

/** Ranked horizontal bars, stacked by system type. rows: [{label, parts:{system:value}, total}] */
function hbars(doc, rows, limit = 12) {
  const list = rows.slice(0, limit);
  legend(doc, SYSTEM_TYPES.map((t) => ({ color: C.sys[t], label: t })));
  const max = Math.max(1, ...list.map((r) => r.total));
  const labelW = 120;
  const valueW = 60;
  const barW = CW - labelW - valueW;
  list.forEach((r) => {
    ensure(doc, 20);
    const y = doc.y;
    doc.font('R').fontSize(8.5).fillColor(C.ink).text(r.label, MX, y + 2, { width: labelW - 8, lineBreak: false, ellipsis: true });
    let x = MX + labelW;
    SYSTEM_TYPES.forEach((t) => {
      const v = r.parts[t] || 0;
      if (!v) return;
      const w = Math.max(2, (v / max) * barW - 2);
      doc.roundedRect(x, y + 2, w, 10, 2).fill(C.sys[t]);
      x += w + 2;
    });
    doc.font('B').fontSize(8.5).fillColor(C.ink).text(kw(r.total), x + 4, y + 2, { width: valueW + 20, lineBreak: false });
    doc.y = y + 18;
  });
}

/** 12 monthly columns of kW handed over. */
function columns(doc, months) {
  const h = 110;
  ensure(doc, h + 30);
  const top = doc.y + 6;
  const base = top + h;
  const max = Math.max(1, ...months.map((m) => m.kw));
  const slot = CW / months.length;
  const bw = Math.min(22, slot - 10);
  doc.moveTo(MX, base).lineTo(MX + CW, base).lineWidth(0.8).strokeColor('#C3CCE0').stroke();
  months.forEach((m, i) => {
    const x = MX + i * slot + (slot - bw) / 2;
    const bh = (m.kw / max) * (h - 16);
    if (m.kw > 0) {
      doc.roundedRect(x, base - bh, bw, bh, 3).fill(C.sys['On-grid']);
      doc.rect(x, base - Math.min(3, bh), bw, Math.min(3, bh)).fill(C.sys['On-grid']);
      doc.font('B').fontSize(7).fillColor(C.ink).text(String(Math.round(m.kw * 10) / 10), x - 8, base - bh - 10, { width: bw + 16, align: 'center', lineBreak: false });
    }
    doc.font('R').fontSize(7).fillColor(C.muted).text(monthLabel(m.month), x - 8, base + 4, { width: bw + 16, align: 'center', lineBreak: false });
  });
  doc.y = base + 18;
}

function healthBlock(doc, h) {
  ensure(doc, 120);
  const y = doc.y;
  doc.roundedRect(MX, y, CW, 70, 10).fill(C.soft);
  const big = h.score === null ? '—' : String(h.score);
  doc.font('B').fontSize(34);
  const bigW = doc.widthOfString(big);
  doc.fillColor(C.ink).text(big, MX + 16, y + 14, { width: 90, lineBreak: false });
  doc.font('R').fontSize(9).fillColor(C.muted).text('/ 100', MX + 16 + bigW + 6, y + 40, { lineBreak: false });
  doc.circle(MX + 150, y + 27, 5).fill(C.tone[h.tone]);
  doc.font('B').fontSize(13).fillColor(C.ink).text(h.label, MX + 160, y + 19, { lineBreak: false });
  doc.font('R').fontSize(8.5).fillColor(C.text2).text('Company health score — weighted from sales, delivery, collections, service and growth. Parts without enough data are left out.', MX + 140, y + 38, { width: CW - 160 });
  doc.y = y + 80;
  table(doc, [
    { label: 'Measure', width: 0.24 }, { label: 'Score', width: 0.1, align: 'right' }, { label: 'Now', width: 0.12, align: 'right' },
    { label: 'Target', width: 0.22 }, { label: 'Detail', width: 0.32 },
  ], h.parts.map((p) => ({ cells: [p.label + ' (' + p.weight + '%)', p.score === null ? '—' : p.score, p.value || '—', p.target, p.detail] })));
}

function companyReport(doc, s, periodKey) {
  const d = M.dashboard(periodKey);
  const k = d.kpis;
  header(doc, s, REPORTS.company.title, d.period);
  section(doc, 'Company health');
  healthBlock(doc, d.health);
  section(doc, 'At a glance', d.period.label);
  tiles(doc, [
    { label: 'Installed in period', value: kw(k.installedKw), sub: k.handedOver + ' project' + (k.handedOver === 1 ? '' : 's') + ' handed over' },
    { label: 'Installed, all time', value: kw(k.installedKwAll) },
    { label: 'In progress', value: kw(k.inProgressKw), sub: k.activeProjects + ' active projects' },
    { label: 'Open pipeline', value: '₹' + k.pipelineLakh + ' L', sub: k.openLeads + ' open leads' },
    { label: 'New leads', value: String(k.newLeads) },
    { label: 'Quotations sent', value: String(k.quotesSent), sub: k.quotesCreated + ' created' },
    { label: 'Orders accepted', value: inr(k.acceptedValue), sub: k.acceptedCount + ' quotation' + (k.acceptedCount === 1 ? '' : 's') },
    { label: 'To collect', value: inr(k.balance), sub: 'of ' + inr(k.orderValue) + ' order value' },
  ]);
  if (k.missingCapacity) {
    doc.font('R').fontSize(8).fillColor(C.muted).text(k.missingCapacity + ' project(s) have no kWp recorded and are not counted in kW figures.', MX, doc.y, { width: CW });
  }
  section(doc, 'kW installed by system type', d.period.label + ' · handed over');
  segmented(doc, d.bySystem.map((x) => ({ label: x.system, value: x.installedKw, color: C.sys[x.system] })));
  table(doc, [{ label: 'System', width: 0.4 }, { label: 'Installed (kW)', width: 0.2, align: 'right' }, { label: 'Projects', width: 0.2, align: 'right' }, { label: 'In progress (kW)', width: 0.2, align: 'right' }],
    d.bySystem.map((x) => ({ cells: [x.system, kw(x.installedKw), x.installedCount, kw(x.inProgressKw)] })));
  section(doc, 'kW installed per location', d.period.label + ' · handed over');
  const located = d.byLocation.filter((r) => r.total > 0);
  if (located.length) hbars(doc, located.map((r) => ({ label: r.place, parts: r.installed, total: r.total })));
  table(doc, [{ label: 'Location', width: 0.28 }, { label: 'On-grid', width: 0.14, align: 'right' }, { label: 'Hybrid', width: 0.14, align: 'right' },
    { label: 'Off-grid', width: 0.14, align: 'right' }, { label: 'Installed', width: 0.15, align: 'right' }, { label: 'In progress', width: 0.15, align: 'right' }],
  d.byLocation.map((r) => ({ cells: [r.place, kwOrDash(r.installed['On-grid']), kwOrDash(r.installed.Hybrid), kwOrDash(r.installed['Off-grid']), kwOrDash(r.total), kwOrDash(r.inProgressKw)] })),
  { empty: 'No projects with a location yet.' });
  section(doc, 'kW handed over per month', 'Last 12 months');
  columns(doc, d.monthly);
  section(doc, 'Sales pipeline');
  table(doc, [{ label: 'Stage', width: 0.7 }, { label: 'Leads', width: 0.3, align: 'right' }], d.leadStages.map((x) => ({ cells: [x.name, x.count] })));
  if (d.leadSources.length) {
    section(doc, 'Where new leads came from', d.period.label);
    table(doc, [{ label: 'Source', width: 0.7 }, { label: 'Leads', width: 0.3, align: 'right' }], d.leadSources.map((x) => ({ cells: [x.source, x.count] })));
  }
}

function installationsReport(doc, s, periodKey) {
  const r = M.installations(periodKey);
  header(doc, s, REPORTS.installations.title, r.range);
  const total = r.handedOver.reduce((a, p) => a + p.kw, 0);
  tiles(doc, [
    { label: 'Installed in period', value: kw(total), sub: r.handedOver.length + ' projects handed over' },
    ...SYSTEM_TYPES.map((t) => ({ label: t, value: kw(r.handedOver.filter((p) => p.system_type === t).reduce((a, p) => a + p.kw, 0)) })),
  ]);
  section(doc, 'Handed over', r.range.label);
  table(doc, [{ label: 'Project', width: 0.25 }, { label: 'Location', width: 0.16 }, { label: 'System', width: 0.1 }, { label: 'kWp', width: 0.07, align: 'right' },
    { label: 'Handed over', width: 0.13 }, { label: 'Value', width: 0.11, align: 'right' }, { label: 'Manager', width: 0.18 }],
  r.handedOver.map((p) => ({ cells: [p.name, p.place_label, p.system_type, p.capacity_kw || '—', fmtDate(p.completed_at), p.value_lakh != null ? '₹' + p.value_lakh + ' L' : '—', p.pm_name || '—'] }))
    .concat(r.handedOver.length ? [{ bold: true, cells: ['Total', '', '', Math.round(total * 10) / 10, '', '', ''] }] : []));
  section(doc, 'In progress', 'All active projects');
  table(doc, [{ label: 'Project', width: 0.25 }, { label: 'Location', width: 0.16 }, { label: 'System', width: 0.1 }, { label: 'kWp', width: 0.07, align: 'right' },
    { label: 'Stage', width: 0.12 }, { label: 'Target date', width: 0.12 }, { label: 'Manager', width: 0.18 }],
  r.inProgress.map((p) => ({ cells: [p.name, p.place_label, p.system_type, p.capacity_kw || '—', STAGES_PROJECT[p.stage] || '—', fmtDate(p.target_date), p.pm_name || '—'] })),
  { empty: 'No active projects.' });
}

function salesReport(doc, s, periodKey) {
  const r = M.sales(periodKey);
  header(doc, s, REPORTS.sales.title, r.range);
  const won = r.leads.filter((l) => l.stage === 4).length;
  const sent = r.quotes.filter((q) => q.status !== 'Draft');
  const accepted = r.quotes.filter((q) => q.status === 'Accepted');
  tiles(doc, [
    { label: 'New leads', value: String(r.leads.length), sub: won + ' already won' },
    { label: 'Quotations', value: String(r.quotes.length), sub: sent.length + ' sent' },
    { label: 'Quoted value', value: inr(sent.reduce((a, q) => a + q.total, 0)) },
    { label: 'Accepted', value: inr(accepted.reduce((a, q) => a + q.total, 0)), sub: accepted.length + ' quotations' },
  ]);
  const stages = ['New lead', 'Site survey', 'Quotation sent', 'Negotiation', 'Won', 'Lost'];
  section(doc, 'Leads received', r.range.label);
  table(doc, [{ label: 'Date', width: 0.12 }, { label: 'Name', width: 0.22 }, { label: 'Mobile', width: 0.13 }, { label: 'Place', width: 0.13 },
    { label: 'Type', width: 0.1 }, { label: 'Source', width: 0.12 }, { label: 'Stage', width: 0.12 }, { label: 'Value', width: 0.06, align: 'right' }],
  r.leads.map((l) => ({ cells: [fmtDate(String(l.created_at).slice(0, 10)), l.name, l.phone || '', l.place || '', l.type, l.source, stages[l.stage] || '', l.value_lakh != null ? l.value_lakh : ''] })));
  section(doc, 'Quotations', r.range.label);
  table(doc, [{ label: 'Number', width: 0.19 }, { label: 'Date', width: 0.12 }, { label: 'Customer', width: 0.23 }, { label: 'kWp', width: 0.08, align: 'right' },
    { label: 'System', width: 0.11 }, { label: 'Status', width: 0.11 }, { label: 'Total', width: 0.16, align: 'right' }],
  r.quotes.map((q) => ({ cells: [q.number, fmtDate(q.quote_date), q.customer_name, q.kwp || '', q.system_type, q.status, inr(q.total)] })));
}

function collectionsReport(doc, s) {
  const rows = M.collections();
  header(doc, s, REPORTS.collections.title, null);
  const order = rows.reduce((a, x) => a + x.order, 0);
  const got = rows.reduce((a, x) => a + x.received, 0);
  tiles(doc, [
    { label: 'Order value', value: inr(order), sub: rows.length + ' projects' },
    { label: 'Received', value: inr(got) },
    { label: 'To collect', value: inr(Math.max(0, order - got)) },
    { label: 'Collected', value: order ? Math.round((got / order) * 100) + '%' : '—' },
  ]);
  section(doc, 'Balance by project', 'Projects with an order value in their Finance record, largest balance first');
  table(doc, [{ label: 'Project', width: 0.28 }, { label: 'Location', width: 0.15 }, { label: 'Invoice', width: 0.13 },
    { label: 'Order value', width: 0.15, align: 'right' }, { label: 'Received', width: 0.14, align: 'right' }, { label: 'Balance', width: 0.15, align: 'right' }],
  rows.map((x) => ({ cells: [x.p.name, x.p.place_label, x.p.d.invoice_no || '—', inr(x.order), inr(x.received), inr(x.balance)] }))
    .concat(rows.length ? [{ bold: true, cells: ['Total', '', '', inr(order), inr(got), inr(Math.max(0, order - got))] }] : []),
  { empty: 'No order values yet. Add them under Projects → Project record → Finance.' });
}

/** Stream the PDF to the response. */
function send(res, type, periodKey) {
  const r = REPORTS[type];
  if (!r) return false;
  const s = getSettings();
  const doc = newDoc(r.title, s);
  const range = M.periodRange(periodKey);
  const file = 'AVN-' + r.file + (type === 'collections' ? '' : '-' + range.key.replace(/_/g, '-')) + '-' + range.to + '.pdf';
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', 'attachment; filename="' + file + '"');
  res.set('Cache-Control', 'no-store');
  doc.pipe(res);
  if (type === 'company') companyReport(doc, s, range.key);
  if (type === 'installations') installationsReport(doc, s, range.key);
  if (type === 'sales') salesReport(doc, s, range.key);
  if (type === 'collections') collectionsReport(doc, s);
  footers(doc, s);
  doc.end();
  return true;
}

module.exports = { send, REPORTS };
