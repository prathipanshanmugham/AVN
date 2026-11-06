#!/usr/bin/env node
/* Adds sample leads, projects, events and checklists so the workspace can be demoed.
 * Safe to run once on a fresh install: it refuses if leads already exist.  npm run seed:demo
 */
const { db, createProjectTasks } = require('../server/db');

if (db.prepare('SELECT COUNT(*) c FROM leads').get().c > 0) {
  console.log('Leads already exist — demo data not added.');
  process.exit(0);
}
const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
const owner = admin ? admin.id : null;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const leads = [
  ['Karthik R', '9876543210', 'Erode', 'Home', '5 kWp', 3.1, 0, 'Call back', day(0), 'Website'],
  ['Thendral Public School', '9876500011', 'Gobichettipalayam', 'Business', '40 kWp', 19.5, 0, 'Send intro deck', day(2), 'Referral'],
  ['Meena S', '9876500022', 'Coimbatore', 'Home', '3 kWp', 1.9, 1, 'Site survey', day(1), 'WhatsApp'],
  ['Velan Spinning Mills', '9876500033', 'Tiruppur', 'Industry', '250 kWp', 98, 1, 'Review 12-month load data', day(-1), 'Referral'],
  ['Arul Farms', '9876500044', 'Bhavani', 'Farm', '7.5 HP pump', 3.4, 2, 'Follow up on quote', day(3), 'Website'],
  ['Annai Clinic', '9876500055', 'Perundurai', 'Business', '15 kWp', 8.2, 2, 'Revise quote', day(0), 'Google Ads'],
  ['Suresh Kumar', '9876500066', 'Salem', 'Home', '3 kWp', 1.8, 3, 'Share finance options', day(4), 'Website'],
];
const insLead = db.prepare('INSERT INTO leads (name, phone, place, type, size, value_lakh, stage, next_action, due_date, source, owner_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
leads.forEach((l) => insLead.run(...l, owner));

const projects = [
  ['Velan Spinning Mills — Phase 1', 'Tiruppur', '120 kWp', 'Industrial rooftop', 46, 3, day(23)],
  ['Karthikeyan Residence', 'Erode', '5 kWp', 'Home rooftop', 3.1, 4, day(7)],
  ['Green Valley Farms', 'Sathyamangalam', '10 HP pump', 'Solar pump', 4.2, 2, day(-1)],
];
const insProj = db.prepare('INSERT INTO projects (name, place, kwp, type, value_lakh, stage, target_date, pm_id) VALUES (?,?,?,?,?,?,?,?)');
const projectIds = projects.map((p) => {
  const id = insProj.run(...p, owner).lastInsertRowid;
  createProjectTasks(id);
  db.prepare('UPDATE project_tasks SET done = 1 WHERE project_id = ? AND stage < ?').run(id, p[5]);
  return id;
});

// A filled-in project record and serial register on the home project (sample values).
const home = projectIds[1];
db.prepare('UPDATE projects SET drive_link = ?, details = ? WHERE id = ?').run(
  'https://drive.google.com/drive/folders/sample-folder',
  JSON.stringify({ eb_number: '04-123-456-789', eb_name: 'Karthikeyan P', phase: 'Single phase', sanctioned_load: '4', roof_type: 'RCC roof',
    psg_app_no: 'SAMPLE-2026-000123', psg_reg_date: day(-30), feasibility_date: day(-21), module_make: 'Sample Solar', module_model: 'SS-540M',
    module_wp: '540', module_count: '10', inverter_make: 'Sample Inverters', inverter_model: 'SI-5K', inverter_kw: '5', order_value: '310000', received: '155000' }),
  home);
const insAsset = db.prepare('INSERT INTO project_assets (project_id, kind, make, model, serial, created_by) VALUES (?,?,?,?,?,?)');
for (let i = 1; i <= 10; i++) insAsset.run(home, 'Module', 'Sample Solar', 'SS-540M', 'SSM2026' + String(4400 + i), owner);
insAsset.run(home, 'Inverter', 'Sample Inverters', 'SI-5K', 'SI5K26A0091', owner);

const insEv = db.prepare('INSERT INTO events (title, type, date, time, who) VALUES (?,?,?,?,?)');
[
  ['Karthik R — roof survey', 'visit', day(0), '11:00', 'Survey team'],
  ['Weekly project review', 'meeting', day(0), '17:00', 'All staff'],
  ['Meena S — Coimbatore', 'visit', day(1), '10:30', 'Survey team'],
  ['Send deck — Thendral School', 'deadline', day(2), null, 'Sales'],
  ['EB inspection — Karthikeyan', 'eb', day(5), '11:00', 'Project team'],
  ['Velan Mills — panels', 'install', day(11), null, 'Crew A'],
  ['Velan Mills Phase 1 target', 'deadline', day(23), null, 'Project team'],
].forEach((e) => insEv.run(...e));

const insNote = db.prepare('INSERT INTO checklists (title, color, due_date) VALUES (?,?,?)');
const insItem = db.prepare('INSERT INTO checklist_items (checklist_id, label, done, position) VALUES (?,?,?,?)');
[
  ['Site visit kit', 'yellow', null, [['Measuring tape', 1], ['Sun-path app ready', 1], ['Drone battery charged', 0], ['Copies of EB bill', 0]]],
  ['Subsidy filings', 'green', day(7), [['Karthikeyan — portal upload', 1], ['Documents for next home', 0]]],
].forEach(([t, c, d, items]) => {
  const id = insNote.run(t, c, d).lastInsertRowid;
  items.forEach(([label, done], i) => insItem.run(id, label, done, i));
});

console.log('Demo data added: ' + leads.length + ' leads, ' + projects.length + ' projects, events and checklists.');
