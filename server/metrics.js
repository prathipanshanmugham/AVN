/* Numbers for the CEO dashboard and the PDF reports. Dates are India time (IST). */
const { db, STAGES_LEAD, STAGES_PROJECT, SYSTEM_TYPES } = require('./db');

const DONE = STAGES_PROJECT.length; // stage index meaning "handed over"
const parse = (s) => { try { return JSON.parse(s) || {}; } catch (e) { return {}; } };
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

function istDate(offsetDays = 0) {
  return new Date(Date.now() + 330 * 60000 + offsetDays * 86400000).toISOString().slice(0, 10);
}
const ymd = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

const PERIODS = [
  ['this_month', 'This month'], ['last_month', 'Last month'], ['this_quarter', 'This quarter'],
  ['this_fy', 'This financial year'], ['last_12', 'Last 12 months'], ['all', 'All time'],
];

function periodRange(key) {
  const today = istDate();
  const [y, m] = today.split('-').map(Number); // m is 1-12
  const label = (PERIODS.find((p) => p[0] === key) || PERIODS[5])[1];
  let from = null;
  let to = today;
  if (key === 'this_month') from = ymd(y, m - 1, 1);
  else if (key === 'last_month') { from = ymd(y, m - 2, 1); to = ymd(y, m - 1, 0); }
  else if (key === 'this_quarter') from = ymd(y, Math.floor((m - 1) / 3) * 3, 1);
  else if (key === 'this_fy') from = ymd(m >= 4 ? y : y - 1, 3, 1);
  else if (key === 'last_12') from = istDate(-365);
  else key = 'all';
  return { key, label, from, to };
}
const inRange = (d, r) => !!d && (!r.from || d >= r.from) && (!r.to || d <= r.to);

/** "erode ", "ERODE" → "Erode" so locations group together. */
function placeLabel(place) {
  const s = String(place || '').trim().replace(/\s+/g, ' ');
  if (!s) return 'Location not set';
  return s.split(' ').map((w) => (/^[a-z]+$/i.test(w) ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ');
}

function projects() {
  return db.prepare(`SELECT p.*, u.name AS pm_name FROM projects p LEFT JOIN users u ON u.id = p.pm_id ORDER BY p.id`).all()
    .map((p) => Object.assign(p, { d: parse(p.details), place_label: placeLabel(p.place), kw: Number(p.capacity_kw) || 0 }));
}

/* ---------- Company health score ---------- */
// Each part scores 0–100 against a stated target. Parts without enough data are left out of the average.
function healthParts(all) {
  const today = istDate();
  const parts = [];

  const closed = db.prepare("SELECT stage FROM leads WHERE stage IN (4, 5) AND updated_at >= datetime('now', '-180 days')").all();
  const won = closed.filter((l) => l.stage === 4).length;
  const rate = closed.length ? won / closed.length : 0;
  parts.push({
    key: 'conversion', label: 'Lead win rate', weight: 20, target: '30% of closed leads won',
    value: closed.length >= 3 ? Math.round(rate * 100) + '%' : null,
    detail: closed.length ? won + ' won of ' + closed.length + ' closed in the last 6 months' : 'No leads closed in the last 6 months',
    score: closed.length >= 3 ? Math.min(100, Math.round((rate / 0.3) * 100)) : null,
  });

  const open = db.prepare('SELECT due_date FROM leads WHERE stage < 4 AND due_date IS NOT NULL').all();
  const onTime = open.filter((l) => l.due_date >= today).length;
  parts.push({
    key: 'followups', label: 'Follow-ups on time', weight: 15, target: 'every open lead followed up by its date',
    value: open.length ? Math.round((onTime / open.length) * 100) + '%' : null,
    detail: open.length ? (open.length - onTime) + ' of ' + open.length + ' open leads are past their follow-up date' : 'No open leads with a follow-up date',
    score: open.length ? Math.round((onTime / open.length) * 100) : null,
  });

  const active = all.filter((p) => p.stage < DONE && p.target_date);
  const onSchedule = active.filter((p) => p.target_date >= today).length;
  parts.push({
    key: 'delivery', label: 'Projects on schedule', weight: 25, target: 'every active project before its target date',
    value: active.length ? Math.round((onSchedule / active.length) * 100) + '%' : null,
    detail: active.length ? (active.length - onSchedule) + ' of ' + active.length + ' active projects are past their target date' : 'No active projects with a target date',
    score: active.length ? Math.round((onSchedule / active.length) * 100) : null,
  });

  const billed = all.filter((p) => Number(p.d.order_value) > 0);
  const orderValue = billed.reduce((a, p) => a + Number(p.d.order_value), 0);
  const received = billed.reduce((a, p) => a + Math.min(Number(p.d.received) || 0, Number(p.d.order_value)), 0);
  parts.push({
    key: 'collections', label: 'Money collected', weight: 20, target: 'full order value collected',
    value: billed.length ? Math.round((received / orderValue) * 100) + '%' : null,
    detail: billed.length ? 'Collected ' + inr(received) + ' of ' + inr(orderValue) + ' across ' + billed.length + ' projects' : 'Add order value and amount received in each project’s Finance record',
    score: billed.length ? Math.round((received / orderValue) * 100) : null,
  });

  const reqs = db.prepare("SELECT status, created_at FROM service_requests WHERE created_at >= datetime('now', '-90 days')").all();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const handled = reqs.filter((r) => r.status === 'closed' || r.created_at >= weekAgo).length;
  parts.push({
    key: 'service', label: 'Service requests handled', weight: 10, target: 'closed within 7 days',
    value: reqs.length ? Math.round((handled / reqs.length) * 100) + '%' : null,
    detail: reqs.length ? (reqs.length - handled) + ' of ' + reqs.length + ' requests in 90 days are open for more than a week' : 'No service requests in the last 90 days',
    score: reqs.length ? Math.round((handled / reqs.length) * 100) : null,
  });

  const d90 = istDate(-90);
  const d180 = istDate(-180);
  const cur = all.filter((p) => p.stage >= DONE && p.completed_at > d90).reduce((a, p) => a + p.kw, 0);
  const prev = all.filter((p) => p.stage >= DONE && p.completed_at > d180 && p.completed_at <= d90).reduce((a, p) => a + p.kw, 0);
  let growth = null;
  if (prev > 0) growth = Math.max(0, Math.min(100, Math.round(75 + (cur / prev - 1) * 125)));
  else if (cur > 0) growth = 100;
  parts.push({
    key: 'growth', label: 'Installations growth', weight: 10, target: '20% more kW than the previous 90 days',
    value: growth === null ? null : r1(cur) + ' kW',
    detail: cur || prev ? r1(cur) + ' kW handed over in the last 90 days vs ' + r1(prev) + ' kW in the 90 days before' : 'No projects handed over in the last 6 months',
    score: growth,
  });
  return parts;
}

function grade(score) {
  if (score === null) return { label: 'Not enough data yet', tone: 'none' };
  if (score >= 80) return { label: 'Strong', tone: 'good' };
  if (score >= 60) return { label: 'Steady', tone: 'warning' };
  if (score >= 40) return { label: 'Needs attention', tone: 'serious' };
  return { label: 'At risk', tone: 'critical' };
}

function health(all) {
  const parts = healthParts(all);
  const scored = parts.filter((p) => p.score !== null);
  const w = scored.reduce((a, p) => a + p.weight, 0);
  const score = w ? Math.round(scored.reduce((a, p) => a + p.score * p.weight, 0) / w) : null;
  return Object.assign({ score, parts }, grade(score));
}

function inr(n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }

/* ---------- Dashboard ---------- */
function dashboard(periodKey) {
  const range = periodRange(periodKey);
  const all = projects();
  const done = all.filter((p) => p.stage >= DONE);
  const doneInPeriod = done.filter((p) => inRange(p.completed_at, range));
  const active = all.filter((p) => p.stage < DONE);
  const sum = (list) => r1(list.reduce((a, p) => a + p.kw, 0));

  const bySystem = SYSTEM_TYPES.map((t) => ({
    system: t,
    installedKw: sum(doneInPeriod.filter((p) => p.system_type === t)),
    installedCount: doneInPeriod.filter((p) => p.system_type === t).length,
    inProgressKw: sum(active.filter((p) => p.system_type === t)),
  }));

  const places = {};
  all.forEach((p) => {
    const row = places[p.place_label] || (places[p.place_label] = { place: p.place_label, installed: { 'On-grid': 0, Hybrid: 0, 'Off-grid': 0 }, total: 0, projects: 0, inProgressKw: 0 });
    if (p.stage >= DONE && inRange(p.completed_at, range)) {
      row.installed[p.system_type] = r1((row.installed[p.system_type] || 0) + p.kw);
      row.total = r1(row.total + p.kw);
      row.projects += 1;
    }
    if (p.stage < DONE) row.inProgressKw = r1(row.inProgressKw + p.kw);
  });
  const byLocation = Object.values(places).filter((r) => r.total || r.inProgressKw).sort((a, b) => b.total - a.total || b.inProgressKw - a.inProgressKw);

  // Last 12 months of handovers, split by system type.
  const today = istDate();
  const [y, m] = today.split('-').map(Number);
  const monthly = [];
  for (let i = 11; i >= 0; i--) {
    const start = ymd(y, m - 1 - i, 1);
    const end = ymd(y, m - i, 0);
    const list = done.filter((p) => p.completed_at >= start && p.completed_at <= end);
    const row = { month: start.slice(0, 7), kw: sum(list), projects: list.length };
    SYSTEM_TYPES.forEach((t) => { row[t] = sum(list.filter((p) => p.system_type === t)); });
    monthly.push(row);
  }

  const openLeads = db.prepare('SELECT COUNT(*) c, COALESCE(SUM(value_lakh), 0) v FROM leads WHERE stage < 4').get();
  const leadsIn = db.prepare('SELECT created_at, source, stage, updated_at FROM leads').all();
  const newLeads = leadsIn.filter((l) => inRange(String(l.created_at).slice(0, 10), range));
  const sources = {};
  newLeads.forEach((l) => { sources[l.source] = (sources[l.source] || 0) + 1; });
  const quotes = db.prepare('SELECT status, total, quote_date, updated_at FROM quotes').all();
  const quotesIn = quotes.filter((q) => inRange(q.quote_date, range));
  const accepted = quotes.filter((q) => q.status === 'Accepted' && inRange(String(q.updated_at).slice(0, 10), range));
  const billed = all.filter((p) => Number(p.d.order_value) > 0);
  const orderValue = billed.reduce((a, p) => a + Number(p.d.order_value), 0);
  const received = billed.reduce((a, p) => a + (Number(p.d.received) || 0), 0);

  return {
    period: range,
    periods: PERIODS.map(([key, label]) => ({ key, label })),
    health: health(all),
    kpis: {
      installedKwAll: sum(done),
      installedKw: sum(doneInPeriod),
      handedOver: doneInPeriod.length,
      inProgressKw: sum(active),
      activeProjects: active.length,
      missingCapacity: all.filter((p) => !p.capacity_kw).length,
      openLeads: openLeads.c,
      pipelineLakh: r1(openLeads.v),
      newLeads: newLeads.length,
      quotesSent: quotesIn.filter((q) => q.status !== 'Draft').length,
      quotesCreated: quotesIn.length,
      acceptedValue: Math.round(accepted.reduce((a, q) => a + q.total, 0)),
      acceptedCount: accepted.length,
      orderValue: Math.round(orderValue),
      received: Math.round(received),
      balance: Math.max(0, Math.round(orderValue - received)),
      openService: db.prepare("SELECT COUNT(*) c FROM service_requests WHERE status != 'closed'").get().c,
    },
    bySystem,
    byLocation,
    monthly,
    leadSources: Object.entries(sources).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    leadStages: STAGES_LEAD.map((name, stage) => ({ name, count: db.prepare('SELECT COUNT(*) c FROM leads WHERE stage = ?').get(stage).c })),
  };
}

/* ---------- Report rows ---------- */
function installations(periodKey) {
  const range = periodRange(periodKey);
  const all = projects();
  return {
    range,
    handedOver: all.filter((p) => p.stage >= DONE && inRange(p.completed_at, range)).sort((a, b) => String(a.completed_at).localeCompare(String(b.completed_at))),
    inProgress: all.filter((p) => p.stage < DONE).sort((a, b) => String(a.target_date || '9999').localeCompare(String(b.target_date || '9999'))),
  };
}

function sales(periodKey) {
  const range = periodRange(periodKey);
  const leads = db.prepare('SELECT l.*, u.name AS owner_name FROM leads l LEFT JOIN users u ON u.id = l.owner_id ORDER BY l.created_at').all()
    .filter((l) => inRange(String(l.created_at).slice(0, 10), range));
  const quotes = db.prepare('SELECT * FROM quotes ORDER BY quote_date, id').all().filter((q) => inRange(q.quote_date, range));
  return { range, leads, quotes };
}

function collections() {
  return projects().filter((p) => Number(p.d.order_value) > 0)
    .map((p) => ({ p, order: Number(p.d.order_value), received: Number(p.d.received) || 0 }))
    .map((x) => Object.assign(x, { balance: Math.max(0, x.order - x.received) }))
    .sort((a, b) => b.balance - a.balance);
}

module.exports = { dashboard, health, installations, sales, collections, periodRange, PERIODS, inr, placeLabel, DONE };
