const express = require('express');
const { db, getSettings, STAGES_LEAD, QUOTE_COMPONENTS } = require('../db');
const { requirePerm } = require('../auth');
const { str, optStr, num, int, date, bool, email, bad, notFound } = require('../util');
const Q = require('../../admin/assets/quote-calc');

const router = express.Router();
router.use('/quotes', requirePerm('quotes'));

const SEGMENTS = ['Home', 'Business', 'Industry', 'Farm'];
const SYSTEMS = ['On-grid', 'Hybrid', 'Off-grid'];
const STATUSES = ['Draft', 'Sent', 'Accepted', 'Rejected'];
const FORMATS = Q.FORMATS.map((f) => f[0]);
const RATE_KEY = { 'On-grid': 'rate_ongrid', Hybrid: 'rate_hybrid', 'Off-grid': 'rate_offgrid' };

const parse = (s) => { try { return JSON.parse(s) || []; } catch (e) { return []; } };

// Dates in India time.
function istDate(offsetDays = 0) {
  const d = new Date(Date.now() + 330 * 60000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}
function financialYear() {
  const [y, m] = istDate().split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return String(start % 100).padStart(2, '0') + '-' + String((start + 1) % 100).padStart(2, '0');
}
/** AVN-Q/26-27/0001 — numbered per financial year. */
function nextNumber(prefix) {
  const base = prefix + '/' + financialYear() + '/';
  const rows = db.prepare('SELECT number FROM quotes WHERE number LIKE ?').all(base + '%');
  const max = rows.reduce((m, r) => Math.max(m, parseInt(r.number.slice(base.length), 10) || 0), 0);
  return base + String(max + 1).padStart(4, '0');
}

const kwLabel = (k) => (Number(k) % 1 ? Number(k).toFixed(2).replace(/0$/, '') : String(Number(k)));

/** Component settings (Settings → Quotations), merged over the built-in defaults. */
function componentsFrom(s) {
  let list = null;
  try { list = JSON.parse(s.quote_components); } catch (e) { /* use defaults */ }
  const byKey = {};
  (Array.isArray(list) ? list : []).forEach((c) => { if (c && c.key) byKey[c.key] = c; });
  return QUOTE_COMPONENTS.map((d) => Object.assign({}, d, byKey[d.key] || {}, { key: d.key }));
}

/**
 * Priced component lines + scope of supply for a system. The ₹ per kWp rate (Settings) gives the
 * pre-GST value, shared across the components by their weights; each line carries its HSN/SAC and GST.
 */
function defaultsFor(s, { kwp, system, segment }) {
  const k = Number(kwp) || 0;
  const value = Math.round(k * (Number(s[RATE_KEY[system]]) || 0));
  const wp = Number(s.quote_module_wp) || 540;
  const modules = k > 0 ? Math.ceil((k * 1000) / wp) : 0;
  const home = segment === 'Home';
  const invType = system === 'On-grid' ? 'grid-tie' : (system === 'Hybrid' ? 'hybrid' : 'off-grid / PCU');
  const comps = componentsFrom(s).filter((c) => c.key !== 'battery' || system !== 'On-grid');
  const weight = comps.reduce((a, c) => a + Math.max(0, Number(c.share) || 0), 0);
  const join = (...parts) => parts.filter(Boolean).join(' ');
  const shape = {
    modules: (c) => ({ desc: c.desc + ' — ' + join(s.quote_module_make, wp + ' Wp,', home ? 'DCR (eligible for subsidy)' : 'Mono PERC / TOPCon'), qty: modules, unit: 'Nos' }),
    inverter: (c) => ({ desc: c.desc + ' (' + invType + ') — ' + join(s.quote_inverter_make, kwLabel(k) + ' kW'), qty: 1, unit: 'No' }),
    battery: (c) => ({ desc: c.desc + ' — capacity as per design', qty: 1, unit: 'Set' }),
    install: (c) => ({ desc: c.desc + (system !== 'Off-grid' ? ', incl. net-meter documentation & EB liaison' : ''), qty: 1, unit: 'Lot' }),
  };
  const items = comps.map((c) => {
    const amount = weight ? Math.round((value * Math.max(0, Number(c.share) || 0)) / weight) : 0;
    const line = (shape[c.key] || ((x) => ({ desc: x.desc, qty: 1, unit: c.key === 'cables' ? 'Lot' : 'Set' })))(c);
    const group = c.key === 'inverter' && system === 'On-grid' && c.group === 'Inverter & storage' ? 'Inverter' : c.group;
    return { group, desc: line.desc, hsn: c.hsn, qty: line.qty, unit: line.unit, rate: line.qty ? Math.round(amount / line.qty) : 0, gst: Number(c.gst) };
  }).filter((it) => it.qty > 0);
  // Per-panel rates are rounded to the rupee; settle the difference on a single-quantity line so the total is exact.
  const diff = value - items.reduce((a, it) => a + it.qty * it.rate, 0);
  const settle = items.slice().reverse().find((it) => it.qty === 1);
  if (diff && settle && settle.rate + diff >= 0) settle.rate += diff;

  const bom = [
    { item: 'Solar PV modules', spec: [s.quote_module_make, wp + ' Wp', home ? 'DCR (eligible for subsidy)' : 'Mono PERC / TOPCon'].filter(Boolean).join(' · '), qty: modules + ' Nos' },
    { item: system === 'On-grid' ? 'Grid-tie inverter' : (system === 'Hybrid' ? 'Hybrid inverter' : 'Off-grid inverter / PCU'), spec: [s.quote_inverter_make, kwLabel(k) + ' kW'].filter(Boolean).join(' · '), qty: '1 No' },
    system !== 'On-grid' ? { item: 'Battery bank', spec: 'Capacity as per design', qty: '1 Set' } : null,
    { item: 'Module mounting structure', spec: 'Hot-dip galvanised steel, designed for local wind load', qty: '1 Set' },
    { item: 'DC & AC cables', spec: 'Solar DC cable, copper AC cable, conduits and accessories', qty: 'As required' },
    { item: 'ACDB / DCDB', spec: 'With surge protection, MCB / fuses', qty: '1 Set' },
    { item: 'Earthing & lightning arrester', spec: 'Earthing pits with chemical earthing and one lightning arrester', qty: '1 Set' },
    system !== 'Off-grid' ? { item: 'Net-meter application & EB liaison', spec: 'Documentation and follow-up till net-meter installation', qty: '1 Lot' } : null,
    { item: 'Installation, testing & commissioning', spec: 'By AVN engineers, including monitoring app set-up', qty: '1 Lot' },
  ].filter(Boolean);
  const subsidy = home && system !== 'Off-grid' ? Q.subsidyFor(k) : 0;
  return { items, bom, subsidy };
}

const SELECT = `SELECT q.*, u.name AS created_by_name, l.name AS lead_name, p.name AS project_name
  FROM quotes q LEFT JOIN users u ON u.id = q.created_by LEFT JOIN leads l ON l.id = q.lead_id LEFT JOIN projects p ON p.id = q.project_id`;

function quoteOut(q, full) {
  const out = {
    id: q.id, number: q.number, status: q.status, date: q.quote_date, validUntil: q.valid_until || '',
    customerName: q.customer_name, customerPhone: q.customer_phone || '', place: q.site_place || '',
    segment: q.segment, systemType: q.system_type, kwp: q.kwp, total: q.total,
    leadId: q.lead_id, leadName: q.lead_name || '', projectId: q.project_id, projectName: q.project_name || '',
    createdBy: q.created_by_name || '', createdAt: q.created_at, updatedAt: q.updated_at,
  };
  if (!full) return out;
  return Object.assign(out, {
    customerEmail: q.customer_email || '', customerAddress: q.customer_address || '', customerGstin: q.customer_gstin || '',
    items: parse(q.items), bom: parse(q.bom), taxMode: q.tax_mode, interstate: !!q.interstate,
    format: FORMATS.includes(q.format) ? q.format : 'itemwise', placeOfSupply: q.place_of_supply || '',
    discount: q.discount, subsidy: q.subsidy, subtotal: q.subtotal, gst: q.gst, notes: q.notes || '', terms: q.terms || '',
  });
}

function load(id) {
  const q = db.prepare(SELECT + ' WHERE q.id = ?').get(id);
  if (!q) throw notFound();
  return q;
}

function cleanItems(list) {
  if (!Array.isArray(list)) throw bad('Price lines are missing');
  if (list.length > 40) throw bad('Up to 40 price lines');
  return list.map((it) => ({
    group: str(it && it.group, 80),
    desc: str(it && it.desc, 400),
    hsn: str(it && it.hsn, 12),
    qty: Math.max(0, num(it && it.qty, 0)),
    unit: str(it && it.unit, 12),
    rate: Math.max(0, num(it && it.rate, 0)),
    gst: Q.GST_RATES.includes(Number(it && it.gst)) ? Number(it.gst) : 18,
  })).filter((it) => it.desc || it.rate);
}
function cleanBom(list) {
  if (!Array.isArray(list)) throw bad('Scope of supply is missing');
  if (list.length > 40) throw bad('Up to 40 scope lines');
  return list.map((b) => ({ item: str(b && b.item, 120), spec: str(b && b.spec, 300), qty: str(b && b.qty, 40) })).filter((b) => b.item || b.spec);
}

function saveTotals(id) {
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  const t = Q.totals({ items: parse(q.items), discount: q.discount, subsidy: q.subsidy, taxMode: q.tax_mode });
  db.prepare('UPDATE quotes SET subtotal = ?, gst = ?, total = ? WHERE id = ?').run(t.subtotal, t.gst, t.total, id);
}

function leadNote(leadId, userId, text) {
  if (leadId) db.prepare('INSERT INTO lead_activity (lead_id, user_id, text) VALUES (?,?,?)').run(leadId, userId, text);
}

// List
router.get('/quotes', (req, res) => {
  res.json({ statuses: STATUSES, quotes: db.prepare(SELECT + ' ORDER BY q.id DESC LIMIT 500').all().map((q) => quoteOut(q)) });
});

router.get('/quotes/:id', (req, res) => {
  res.json(quoteOut(load(req.params.id), true));
});

// New quotation (optionally from a CRM lead). Lines are filled from the kWp and Settings → Quotations.
router.post('/quotes', (req, res) => {
  const s = getSettings();
  let lead = null;
  const leadId = int(req.body.leadId, null);
  if (leadId) {
    lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
    if (!lead) throw bad('That lead no longer exists');
  }
  const pick = (k, fallback) => (req.body[k] !== undefined && req.body[k] !== '' ? req.body[k] : fallback);
  const name = str(pick('customerName', lead && lead.name), 120);
  if (!name) throw bad('Enter the customer name');
  const segment = SEGMENTS.includes(pick('segment', lead && lead.type)) ? pick('segment', lead && lead.type) : 'Home';
  const system = SYSTEMS.includes(req.body.systemType) ? req.body.systemType : 'On-grid';
  const kwpGuess = lead && lead.size ? parseFloat(String(lead.size).replace(/[^\d.]/g, '')) : null;
  const kwp = num(pick('kwp', kwpGuess), null);
  if (!kwp || kwp <= 0 || kwp > 100000) throw bad('Enter the system size in kWp');
  const d = defaultsFor(s, { kwp, system, segment });
  const validity = parseInt(s.quote_validity, 10) || 15;
  let id;
  db.transaction(() => {
    id = db.prepare(`INSERT INTO quotes (number, lead_id, project_id, quote_date, valid_until, customer_name, customer_phone, customer_email, customer_address,
      site_place, segment, system_type, kwp, items, bom, tax_mode, subsidy, terms, created_by, format, place_of_supply, interstate)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(
      nextNumber(s.quote_prefix || 'AVN-Q'), lead ? lead.id : null, lead && lead.project_id ? lead.project_id : null,
      istDate(), istDate(validity), name,
      optStr(pick('customerPhone', lead && lead.phone), 20), optStr(pick('customerEmail', lead && lead.email), 120),
      optStr(req.body.customerAddress, 400), optStr(pick('place', lead && lead.place), 80),
      segment, system, kwp, JSON.stringify(d.items), JSON.stringify(d.bom),
      s.quote_tax_mode === 'itemised' ? 'itemised' : 'composite', d.subsidy, s.quote_terms || '', req.user.id,
      FORMATS.includes(s.quote_format) ? s.quote_format : 'itemwise', Q.companyState(s),
    ).lastInsertRowid;
    saveTotals(id);
    if (lead) leadNote(lead.id, req.user.id, 'Quotation ' + db.prepare('SELECT number FROM quotes WHERE id = ?').get(id).number + ' created');
  })();
  res.status(201).json(quoteOut(load(id), true));
});

router.patch('/quotes/:id', (req, res) => {
  const q = load(req.params.id);
  const b = req.body;
  const has = (k) => b[k] !== undefined;
  const f = {
    customer_name: has('customerName') ? str(b.customerName, 120) : q.customer_name,
    customer_phone: has('customerPhone') ? optStr(b.customerPhone, 20) : q.customer_phone,
    customer_email: has('customerEmail') ? (str(b.customerEmail) ? email(b.customerEmail) : null) : q.customer_email,
    customer_address: has('customerAddress') ? optStr(b.customerAddress, 400) : q.customer_address,
    customer_gstin: has('customerGstin') ? optStr(String(b.customerGstin || '').replace(/\s+/g, '').toUpperCase(), 15) : q.customer_gstin,
    place_of_supply: has('placeOfSupply') ? (Q.stateName(String(b.placeOfSupply || '')) ? String(b.placeOfSupply) : null) : q.place_of_supply,
    format: has('format') ? (FORMATS.includes(b.format) ? b.format : 'itemwise') : q.format,
    site_place: has('place') ? optStr(b.place, 80) : q.site_place,
    segment: has('segment') && SEGMENTS.includes(b.segment) ? b.segment : q.segment,
    system_type: has('systemType') && SYSTEMS.includes(b.systemType) ? b.systemType : q.system_type,
    kwp: has('kwp') ? num(b.kwp, q.kwp) : q.kwp,
    quote_date: has('date') ? date(b.date) || q.quote_date : q.quote_date,
    valid_until: has('validUntil') ? date(b.validUntil) : q.valid_until,
    items: has('items') ? JSON.stringify(cleanItems(b.items)) : q.items,
    bom: has('bom') ? JSON.stringify(cleanBom(b.bom)) : q.bom,
    tax_mode: has('taxMode') ? (b.taxMode === 'itemised' ? 'itemised' : 'composite') : q.tax_mode,
    interstate: has('interstate') ? (bool(b.interstate) ? 1 : 0) : q.interstate,
    discount: has('discount') ? Math.max(0, num(b.discount, 0)) : q.discount,
    subsidy: has('subsidy') ? Math.max(0, num(b.subsidy, 0)) : q.subsidy,
    notes: has('notes') ? optStr(b.notes, 2000) : q.notes,
    terms: has('terms') ? optStr(b.terms, 4000) : q.terms,
    status: has('status') && STATUSES.includes(b.status) ? b.status : q.status,
  };
  if (!f.customer_name) throw bad('Enter the customer name');
  if (f.customer_gstin && !Q.GSTIN_RE.test(f.customer_gstin)) throw bad('Customer GSTIN should be 15 characters, like 33ABCDE1234F1Z5');
  // The place of supply decides CGST + SGST or IGST; without one, the old tick box still applies.
  if (f.place_of_supply) f.interstate = f.place_of_supply !== Q.companyState(getSettings()) ? 1 : 0;
  if (has('customerEmail') && str(b.customerEmail) && !f.customer_email) throw bad('Check the customer email');
  if (f.kwp !== null && (f.kwp <= 0 || f.kwp > 100000)) throw bad('Enter the system size in kWp');
  db.transaction(() => {
    db.prepare(`UPDATE quotes SET customer_name=?, customer_phone=?, customer_email=?, customer_address=?, customer_gstin=?, site_place=?, segment=?, system_type=?,
      kwp=?, quote_date=?, valid_until=?, items=?, bom=?, tax_mode=?, interstate=?, discount=?, subsidy=?, notes=?, terms=?, status=?, format=?, place_of_supply=?,
      updated_at=datetime('now') WHERE id=?`)
      .run(f.customer_name, f.customer_phone, f.customer_email, f.customer_address, f.customer_gstin, f.site_place, f.segment, f.system_type,
        f.kwp, f.quote_date, f.valid_until, f.items, f.bom, f.tax_mode, f.interstate, f.discount, f.subsidy, f.notes, f.terms, f.status,
        f.format, f.place_of_supply, q.id);
    saveTotals(q.id);
    if (f.status !== q.status && q.lead_id) {
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(q.lead_id);
      const total = db.prepare('SELECT total FROM quotes WHERE id = ?').get(q.id).total;
      if (lead) {
        leadNote(lead.id, req.user.id, 'Quotation ' + q.number + ' ' + f.status.toLowerCase() + ' · ' + Q.inr(total));
        // Keep the CRM pipeline in step: Sent → "Quotation sent", Accepted → "Won" with the order value.
        if (f.status === 'Sent' && lead.stage < 2) {
          db.prepare("UPDATE leads SET stage = 2, updated_at = datetime('now') WHERE id = ?").run(lead.id);
          leadNote(lead.id, req.user.id, 'Moved to ' + STAGES_LEAD[2]);
        }
        if (f.status === 'Accepted' && lead.stage !== 4) {
          db.prepare("UPDATE leads SET stage = 4, value_lakh = ?, updated_at = datetime('now') WHERE id = ?").run(Math.round(total / 1000) / 100, lead.id);
          leadNote(lead.id, req.user.id, 'Moved to ' + STAGES_LEAD[4]);
        }
      }
    }
  })();
  res.json(quoteOut(load(q.id), true));
});

// Rebuild the lines and scope from the current size, system type and Settings rates.
router.post('/quotes/:id/refill', (req, res) => {
  const q = load(req.params.id);
  const d = defaultsFor(getSettings(), { kwp: q.kwp, system: q.system_type, segment: q.segment });
  db.prepare("UPDATE quotes SET items = ?, bom = ?, subsidy = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(d.items), JSON.stringify(d.bom), d.subsidy, q.id);
  saveTotals(q.id);
  res.json(quoteOut(load(q.id), true));
});

// Copy as a new draft (a revised offer keeps the old one on record).
router.post('/quotes/:id/duplicate', (req, res) => {
  const q = load(req.params.id);
  const s = getSettings();
  const id = db.prepare(`INSERT INTO quotes (number, lead_id, project_id, quote_date, valid_until, customer_name, customer_phone, customer_email, customer_address, customer_gstin,
    site_place, segment, system_type, kwp, items, bom, tax_mode, interstate, discount, subsidy, notes, terms, created_by, format, place_of_supply)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    nextNumber(s.quote_prefix || 'AVN-Q'), q.lead_id, q.project_id, istDate(), istDate(parseInt(s.quote_validity, 10) || 15),
    q.customer_name, q.customer_phone, q.customer_email, q.customer_address, q.customer_gstin, q.site_place, q.segment, q.system_type, q.kwp,
    q.items, q.bom, q.tax_mode, q.interstate, q.discount, q.subsidy, q.notes, q.terms, req.user.id, q.format, q.place_of_supply,
  ).lastInsertRowid;
  saveTotals(id);
  if (q.lead_id) leadNote(q.lead_id, req.user.id, 'Revised quotation created from ' + q.number);
  res.status(201).json(quoteOut(load(id), true));
});

router.delete('/quotes/:id', (req, res) => {
  const info = db.prepare('DELETE FROM quotes WHERE id = ?').run(req.params.id);
  if (!info.changes) throw notFound();
  res.json({ ok: true });
});

module.exports = router;
