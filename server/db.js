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

const MODULES = ['crm', 'projects', 'calendar', 'website', 'clients'];
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

const SETTING_DEFAULTS = {
  company_name: 'AVN Solar Solutions',
  brand_name: 'AVN Solar',
  gstin: '',
  phone: '',
  whatsapp: '',
  email: '',
  address: '',
  hours: 'Mon–Sat, 9:30 AM – 6:30 PM',
  site_title: 'AVN Solar — Solar EPC in Tamil Nadu',
  site_description: 'Rooftop and ground-mount solar for homes, businesses, industry and farms across Tamil Nadu — designed, installed and net-metered by one team.',
  ga_id: '',
  calc_yield: '4',
  calc_roof: '90',
  calc_tariff_home: '6',
  calc_tariff_biz: '9',
  video_fast_only: '1',
  stat1_value: '', stat1_label: 'capacity commissioned',
  stat2_value: '', stat2_label: 'rooftops and plants delivered',
  stat3_value: '', stat3_label: 'districts served',
};

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

function seed() {
  const tx = db.transaction(() => {
    for (const m of MODULES) {
      const allowed = m === 'website' ? 0 : 1;
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

module.exports = { db, MODULES, STAGES_LEAD, STAGES_PROJECT, SETTING_DEFAULTS, getSettings, getPermissions, createProjectTasks };
