const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');
const { generatePassword, hashPassword } = require('./util');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.uploadDir, 'media'), { recursive: true });
fs.mkdirSync(path.join(config.uploadDir, 'docs'), { recursive: true });

const db = new Database(path.join(config.dataDir, 'avn.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Order matters: the first module a user can open is their landing page (admins land on the dashboard).
const MODULES = ['dashboard', 'crm', 'quotes', 'projects', 'calendar', 'website', 'clients'];
const ADMIN_ONLY_BY_DEFAULT = ['website', 'dashboard'];
const SYSTEM_TYPES = ['On-grid', 'Hybrid', 'Off-grid'];
const STAGES_LEAD = ['New lead', 'Site survey', 'Quotation sent', 'Negotiation', 'Won', 'Lost'];
const STAGES_PROJECT = ['Survey', 'Design', 'Procurement', 'Installation', 'Approvals', 'Switch-on'];
const PROJECT_CHECKLISTS = [
  ['Roof measured and photographed', 'Shadow analysis done', 'EB bills collected', 'Connected load recorded'],
  ['Panel layout drawn', 'Inverter and string sizing', 'Structure design approved', 'Quotation signed by customer'],
  ['Modules ordered', 'Inverter ordered', 'Structure and cables ready', 'Material inspected at store'],
  ['Structure mounted', 'Panels fixed and aligned', 'DC and AC wiring complete', 'Earthing and lightning arrester'],
  ['Net-meter application filed', 'EB inspection done', 'Net meter installed', 'Subsidy claim filed'],
  ['System commissioned', 'Monitoring app set up', 'Customer handover done', 'Warranty cards shared'],
];

const SITE_TITLE = 'AVN Solar | Rooftop Solar & Solar EPC Company in Tamil Nadu';
const SITE_DESCRIPTION = 'Rooftop solar for homes, businesses, industry and farms across Tamil Nadu — PM Surya Ghar subsidy help, net-metering and service from one local team.';
const OLD_SITE_TITLE = 'AVN Solar — Solar EPC in Tamil Nadu';
const OLD_SITE_DESCRIPTION = 'Rooftop and ground-mount solar for homes, businesses, industry and farms across Tamil Nadu — designed, installed and net-metered by one team.';

/*
 * Component lines for new quotations. The ₹ per kWp rate is shared across them by `share`
 * (weights, re-balanced over the components a system has — the battery only for hybrid / off-grid).
 * HSN/SAC and GST are starting points; confirm them with your CA. Editable in Settings → Quotations.
 */
const QUOTE_COMPONENTS = [
  { key: 'modules', group: 'Solar PV modules', desc: 'Solar PV modules', hsn: '8541 43 00', gst: 5, share: 48 },
  { key: 'inverter', group: 'Inverter & storage', desc: 'Solar inverter', hsn: '8504 40', gst: 5, share: 14 },
  { key: 'battery', group: 'Inverter & storage', desc: 'Battery bank', hsn: '8507', gst: 18, share: 25 },
  { key: 'structure', group: 'Mounting & balance of system', desc: 'Module mounting structure — hot-dip galvanised steel', hsn: '7308', gst: 18, share: 12 },
  { key: 'cables', group: 'Mounting & balance of system', desc: 'DC & AC cables, conduits and accessories', hsn: '8544', gst: 18, share: 6 },
  { key: 'acdb', group: 'Mounting & balance of system', desc: 'ACDB / DCDB with surge protection and MCBs', hsn: '8537', gst: 18, share: 4 },
  { key: 'earthing', group: 'Mounting & balance of system', desc: 'Earthing kit and lightning arrester', hsn: '8535', gst: 18, share: 3 },
  { key: 'install', group: 'Installation & commissioning', desc: 'Installation, testing & commissioning', hsn: '995461', gst: 18, share: 13 },
];

const SETTING_DEFAULTS = {
  company_name: 'AVN Solar Solutions',
  brand_name: 'AVN Solar',
  gstin: '',
  phone: '',
  whatsapp: '',
  email: '',
  address: '',
  hours: 'Mon–Sat, 9:30 AM – 6:30 PM',
  site_title: SITE_TITLE,
  site_description: SITE_DESCRIPTION,
  ga_id: '',
  // Search & social (SEO)
  site_url: 'https://avnsolar.in',
  service_areas: 'Tamil Nadu',
  addr_city: '', addr_pincode: '',
  google_verification: '', bing_verification: '',
  social_facebook: '', social_instagram: '', social_youtube: '', social_linkedin: '',
  calc_yield: '4',
  calc_roof: '90',
  calc_tariff_home: '6',
  calc_tariff_biz: '9',
  video_fast_only: '1',
  stat1_value: '', stat1_label: 'capacity commissioned',
  stat2_value: '', stat2_label: 'rooftops and plants delivered',
  stat3_value: '', stat3_label: 'districts served',
  // Lead capture
  whatsapp_message: 'Hi AVN Solar, I would like a free solar site survey.',
  popup_enabled: '1',
  popup_delay: '25',
  popup_title: 'Free rooftop survey + subsidy check',
  // Lead emails
  lead_emails: '',
  smtp_host: '', smtp_port: '587', smtp_secure: '0', smtp_user: '', smtp_pass: '', smtp_from: '',
  mail_status: '',
  // Quotations
  quote_prefix: 'AVN-Q',
  quote_validity: '15',
  quote_tax_mode: 'composite',
  quote_format: 'itemwise',
  quote_tax_summary: '1',
  quote_hsn_system: '8541 43 00',
  quote_sac_install: '995461',
  quote_components: JSON.stringify(QUOTE_COMPONENTS),
  rate_ongrid: '0', rate_hybrid: '0', rate_offgrid: '0',
  quote_module_wp: '540', quote_module_make: '', quote_inverter_make: '',
  quote_terms: [
    'Payment: 50% advance with order, 40% on delivery of material, 10% after commissioning.',
    'EB / net-meter fees, civil work and elevated structures are extra unless listed in this quotation.',
    'PM Surya Ghar subsidy (eligible homes) is credited by the government to the customer’s bank account after commissioning and inspection. It is not deducted from this quotation.',
    'Installation within 3–4 weeks of advance, subject to site readiness and material availability.',
    'Panels and inverter carry the manufacturers’ warranties. Workmanship is covered by AVN as agreed.',
  ].join('\n'),
  bank_name: '', bank_account: '', bank_ifsc: '', bank_branch: '', upi_id: '',
};

/** Project record fields, grouped. [key, label, type?, options?] — type: text (default), date, number, url, area, select */
const PROJECT_FIELDS = [
  { id: 'site', name: 'Site & EB', fields: [
    ['eb_number', 'EB service connection no.'], ['eb_name', 'Name on EB bill'], ['eb_section', 'EB section / office'],
    ['tariff', 'Tariff category'], ['phase', 'Supply', 'select', ['Single phase', 'Three phase']],
    ['sanctioned_load', 'Sanctioned load (kW)', 'number'],
    ['roof_type', 'Roof / site', 'select', ['RCC roof', 'Metal sheet roof', 'Tile roof', 'Ground', 'Other']],
    ['roof_area', 'Usable area (sq ft)', 'number'], ['map_link', 'Map location link', 'url'], ['site_address', 'Site address', 'area'],
  ] },
  { id: 'approvals', name: 'MNRE · PM Surya Ghar · EB', fields: [
    ['psg_app_no', 'PM Surya Ghar application no.'], ['psg_reg_date', 'Registered on national portal', 'date'],
    ['feasibility_date', 'EB feasibility approved', 'date'], ['vendor_selected', 'Vendor selected on portal', 'date'],
    ['dcr_cert', 'DCR / ALMM certificate no.'], ['install_uploaded', 'Installation details uploaded', 'date'],
    ['inspection_date', 'EB inspection done', 'date'], ['net_meter_no', 'Net meter no.'], ['net_meter_date', 'Net meter installed', 'date'],
    ['commissioning_cert', 'Commissioning certificate no.'], ['subsidy_amount', 'Subsidy amount (₹)', 'number'],
    ['subsidy_claimed', 'Subsidy claimed', 'date'], ['subsidy_received', 'Subsidy received', 'date'],
  ] },
  { id: 'system', name: 'System installed', fields: [
    ['module_make', 'Module make'], ['module_model', 'Module model'], ['module_wp', 'Module rating (Wp)', 'number'], ['module_count', 'No. of modules', 'number'],
    ['inverter_make', 'Inverter make'], ['inverter_model', 'Inverter model'], ['inverter_kw', 'Inverter capacity (kW)', 'number'],
    ['structure', 'Structure type'], ['battery', 'Battery (make · kWh)'], ['monitoring', 'Monitoring app & login ID'],
  ] },
  { id: 'handover', name: 'Commissioning & warranty', fields: [
    ['commissioned_on', 'Commissioned on', 'date'], ['handover_on', 'Handed over on', 'date'],
    ['module_warranty', 'Module warranty till', 'date'], ['inverter_warranty', 'Inverter warranty till', 'date'], ['amc_till', 'AMC valid till', 'date'],
  ] },
  { id: 'finance', name: 'Finance', fields: [
    ['order_value', 'Order value (₹)', 'number'], ['received', 'Total received (₹)', 'number'],
    ['invoice_no', 'Invoice no.'], ['invoice_date', 'Invoice date', 'date'], ['loan_bank', 'Loan bank (if any)'], ['finance_notes', 'Payment notes', 'area'],
  ] },
];
const ASSET_KINDS = ['Module', 'Inverter', 'Battery', 'Net meter', 'Solar meter', 'Optimiser', 'Other'];

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','staff')),
  active INTEGER NOT NULL DEFAULT 1,
  must_change INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS permissions (
  module TEXT PRIMARY KEY,
  staff_allowed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  expires INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  customer_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  email TEXT,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  must_change INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  place TEXT,
  type TEXT NOT NULL DEFAULT 'Home',
  size TEXT,
  value_lakh REAL,
  stage INTEGER NOT NULL DEFAULT 0,
  next_action TEXT,
  due_date TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'Website',
  message TEXT,
  project_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lead_activity (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  place TEXT,
  kwp TEXT,
  type TEXT,
  value_lakh REAL,
  stage INTEGER NOT NULL DEFAULT 0,
  pm_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS project_tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL,
  label TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS project_docs (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  client_visible INTEGER NOT NULL DEFAULT 1,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS service_requests (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'visit',
  date TEXT NOT NULL,
  time TEXT,
  who TEXT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS checklists (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'yellow',
  due_date TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY,
  checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY,
  section TEXT NOT NULL CHECK (section IN ('hero','gallery','solutions')),
  kind TEXT NOT NULL CHECK (kind IN ('image','video')),
  title TEXT NOT NULL,
  alt TEXT,
  stored_name TEXT NOT NULL,
  poster_name TEXT,
  mime TEXT,
  size INTEGER,
  original_size INTEGER,
  visible INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY,
  grp TEXT NOT NULL CHECK (grp IN ('modules','inverters')),
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON project_tasks(project_id, stage);
CREATE INDEX IF NOT EXISTS idx_media_section ON media(section, position);
`);

/*
 * Schema upgrades. Each step runs once, in a transaction, and bumps PRAGMA user_version.
 * Existing installs (user_version 0) and fresh databases go through the same steps.
 */
const MIGRATIONS = [
  // 1 — Drive link + project record, serial register, brand logos, website photo band, quotations
  () => {
    const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    if (!cols('projects').includes('drive_link')) db.exec('ALTER TABLE projects ADD COLUMN drive_link TEXT');
    if (!cols('projects').includes('details')) db.exec("ALTER TABLE projects ADD COLUMN details TEXT NOT NULL DEFAULT '{}'");
    if (!cols('brands').includes('logo_name')) db.exec('ALTER TABLE brands ADD COLUMN logo_name TEXT');
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_assets (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        make TEXT,
        model TEXT,
        serial TEXT NOT NULL,
        notes TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_serial ON project_assets(kind, serial COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_assets_project ON project_assets(project_id);

      -- SQLite cannot change a CHECK constraint, so rebuild media to allow the new 'banner' section.
      CREATE TABLE media_new (
        id INTEGER PRIMARY KEY,
        section TEXT NOT NULL CHECK (section IN ('hero','gallery','solutions','banner')),
        kind TEXT NOT NULL CHECK (kind IN ('image','video')),
        title TEXT NOT NULL,
        alt TEXT,
        stored_name TEXT NOT NULL,
        poster_name TEXT,
        mime TEXT,
        size INTEGER,
        original_size INTEGER,
        visible INTEGER NOT NULL DEFAULT 1,
        position INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ready',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO media_new (id, section, kind, title, alt, stored_name, poster_name, mime, size, original_size, visible, position, status, created_at)
        SELECT id, section, kind, title, alt, stored_name, poster_name, mime, size, original_size, visible, position, status, created_at FROM media;
      DROP TABLE media;
      ALTER TABLE media_new RENAME TO media;
      CREATE INDEX IF NOT EXISTS idx_media_section ON media(section, position);

      CREATE TABLE IF NOT EXISTS quotes (
        id INTEGER PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'Draft',
        quote_date TEXT NOT NULL,
        valid_until TEXT,
        customer_name TEXT NOT NULL,
        customer_phone TEXT,
        customer_email TEXT,
        customer_address TEXT,
        customer_gstin TEXT,
        site_place TEXT,
        segment TEXT NOT NULL DEFAULT 'Home',
        system_type TEXT NOT NULL DEFAULT 'On-grid',
        kwp REAL,
        items TEXT NOT NULL DEFAULT '[]',
        bom TEXT NOT NULL DEFAULT '[]',
        tax_mode TEXT NOT NULL DEFAULT 'composite',
        interstate INTEGER NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        subsidy REAL NOT NULL DEFAULT 0,
        subtotal REAL NOT NULL DEFAULT 0,
        gst REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        notes TEXT,
        terms TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_quotes_lead ON quotes(lead_id);
    `);
  },
  // 2 — CEO dashboard: numeric capacity, system type and completion date on projects
  () => {
    const cols = db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name);
    if (!cols.includes('capacity_kw')) db.exec('ALTER TABLE projects ADD COLUMN capacity_kw REAL');
    if (!cols.includes('system_type')) db.exec("ALTER TABLE projects ADD COLUMN system_type TEXT NOT NULL DEFAULT 'On-grid'");
    if (!cols.includes('completed_at')) db.exec('ALTER TABLE projects ADD COLUMN completed_at TEXT');
    const up = db.prepare('UPDATE projects SET capacity_kw = ?, system_type = ?, completed_at = ? WHERE id = ?');
    db.prepare('SELECT id, kwp, type, stage, updated_at FROM projects').all().forEach((p) => {
      up.run(parseKw(p.kwp), guessSystem(p.type), p.stage >= 6 ? String(p.updated_at).slice(0, 10) : null, p.id);
    });
    db.exec('CREATE INDEX IF NOT EXISTS idx_projects_completed ON projects(completed_at)');
  },
  // 3: quotation format (item-wise / grouped) and place of supply; new site title and description.
  () => {
    const cols = db.prepare('PRAGMA table_info(quotes)').all().map((c) => c.name);
    if (!cols.includes('format')) db.exec("ALTER TABLE quotes ADD COLUMN format TEXT NOT NULL DEFAULT 'itemwise'");
    if (!cols.includes('place_of_supply')) db.exec('ALTER TABLE quotes ADD COLUMN place_of_supply TEXT');
    db.exec("UPDATE quotes SET place_of_supply = '33' WHERE place_of_supply IS NULL AND interstate = 0");
    // Only replace the title and description if they were never changed.
    db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?').run(SITE_TITLE, 'site_title', OLD_SITE_TITLE);
    db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?').run(SITE_DESCRIPTION, 'site_description', OLD_SITE_DESCRIPTION);
  },
  // 4: the HSN/SAC tax summary can be left off a printed quotation.
  () => {
    const cols = db.prepare('PRAGMA table_info(quotes)').all().map((c) => c.name);
    if (!cols.includes('tax_summary')) db.exec('ALTER TABLE quotes ADD COLUMN tax_summary INTEGER NOT NULL DEFAULT 1');
  },
];

/** "5 kWp", "120kW", "3.3" → number of kW. Pump ratings in HP are left for staff to fill in. */
function parseKw(text) {
  const s = String(text || '').trim();
  const m = s.match(/([\d.]+)\s*(mwp|mw|kwp|kw)?/i);
  if (!m || /hp/i.test(s)) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return /mw/i.test(m[2] || '') ? n * 1000 : n;
}
function guessSystem(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('hybrid')) return 'Hybrid';
  if (t.includes('off-grid') || t.includes('pump')) return 'Off-grid';
  return 'On-grid';
}

function migrate() {
  let version = db.pragma('user_version', { simple: true });
  while (version < MIGRATIONS.length) {
    const step = version;
    db.transaction(() => {
      MIGRATIONS[step]();
      db.pragma('user_version = ' + (step + 1));
    })();
    version = step + 1;
    console.log('Database upgraded to version ' + version);
  }
}
migrate();

function seed() {
  const tx = db.transaction(() => {
    for (const m of MODULES) {
      const allowed = ADMIN_ONLY_BY_DEFAULT.includes(m) ? 0 : 1; // new modules are added for existing installs too
      db.prepare('INSERT OR IGNORE INTO permissions (module, staff_allowed) VALUES (?, ?)').run(m, allowed);
    }
    for (const [k, v] of Object.entries(SETTING_DEFAULTS)) {
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, v);
    }
    if (db.prepare('SELECT COUNT(*) c FROM brands').get().c === 0) {
      const mods = ['Waaree', 'Adani Solar', 'Vikram Solar', 'Tata Power Solar', 'Premier Energies', 'Goldi Solar', 'Rayzon Solar', 'Saatvik'];
      const invs = ['Sungrow', 'Growatt', 'Solis', 'Huawei', 'Fronius', 'SMA', 'Deye', 'Polycab'];
      mods.forEach((n, i) => db.prepare('INSERT INTO brands (grp, name, position) VALUES (?,?,?)').run('modules', n, i));
      invs.forEach((n, i) => db.prepare('INSERT INTO brands (grp, name, position) VALUES (?,?,?)').run('inverters', n, i));
    }
  });
  tx();

  // Default hero video (bundled), copied into uploads so it can be replaced from the editor.
  if (db.prepare("SELECT COUNT(*) c FROM media WHERE section = 'hero'").get().c === 0) {
    const assets = path.join(config.root, 'public', 'assets');
    const video = 'hero-default.mp4';
    const poster = 'hero-default-poster.webp';
    try {
      fs.copyFileSync(path.join(assets, 'hero.mp4'), path.join(config.uploadDir, 'media', video));
      fs.copyFileSync(path.join(assets, 'hero-poster.webp'), path.join(config.uploadDir, 'media', poster));
      const size = fs.statSync(path.join(config.uploadDir, 'media', video)).size;
      db.prepare(`INSERT INTO media (section, kind, title, alt, stored_name, poster_name, mime, size, original_size, position)
        VALUES ('hero','video','Hero loop — solar farm','Rows of solar panels at sunrise',?,?,'video/mp4',?,?,0)`).run(video, poster, size, size);
    } catch (e) {
      console.warn('Could not seed hero video:', e.message);
    }
  }

  // First admin account.
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
    const pw = config.adminPassword || generatePassword();
    db.prepare(`INSERT INTO users (name, username, password_hash, role, must_change) VALUES (?, ?, ?, 'admin', 1)`)
      .run(config.adminName, config.adminUsername, hashPassword(pw));
    console.log('\n================ AVN Workspace ================');
    console.log(' First admin account created');
    console.log('   Username: ' + config.adminUsername);
    console.log('   Password: ' + (config.adminPassword ? '(the ADMIN_PASSWORD from your .env)' : pw));
    console.log(' You will be asked to change it after signing in.');
    console.log('===============================================\n');
  }
}

seed();

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = Object.assign({}, SETTING_DEFAULTS);
  rows.forEach((r) => { out[r.key] = r.value; });
  return out;
}

function getPermissions() {
  const out = {};
  MODULES.forEach((m) => { out[m] = false; });
  db.prepare('SELECT module, staff_allowed FROM permissions').all().forEach((r) => { out[r.module] = !!r.staff_allowed; });
  return out;
}

function createProjectTasks(projectId) {
  const ins = db.prepare('INSERT INTO project_tasks (project_id, stage, label, position) VALUES (?, ?, ?, ?)');
  PROJECT_CHECKLISTS.forEach((list, stage) => list.forEach((label, i) => ins.run(projectId, stage, label, i)));
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

module.exports = {
  db, MODULES, STAGES_LEAD, STAGES_PROJECT, SETTING_DEFAULTS, QUOTE_COMPONENTS, PROJECT_FIELDS, ASSET_KINDS, SYSTEM_TYPES, parseKw, guessSystem,
  getSettings, setSetting, getPermissions, createProjectTasks,
};
