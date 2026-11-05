document.addEventListener('alpine:init', () => {
  const FIELDS = {
    company: [
      { k: 'company_name', label: 'Registered name' },
      { k: 'brand_name', label: 'Brand name' },
      { k: 'gstin', label: 'GSTIN', ph: '33XXXXX0000X1ZX' },
      { k: 'phone', label: 'Sales phone', hint: '10-digit mobile', ph: '98765 43210' },
      { k: 'whatsapp', label: 'WhatsApp number', hint: 'blank = same as phone' },
      { k: 'email', label: 'Sales email', type: 'email' },
      { k: 'hours', label: 'Working hours' },
      { k: 'address', label: 'Office address', area: true, wide: true },
    ],
    site: [
      { k: 'site_title', label: 'Site title', hint: 'shown in Google results', wide: true },
      { k: 'site_description', label: 'Site description', hint: 'about 150 characters', area: true, wide: true },
      { k: 'ga_id', label: 'Google Analytics ID', ph: 'G-XXXXXXXXXX' },
      { k: 'stat1_value', label: 'Homepage number 1', hint: 'e.g. 12 MW — blank hides it', ph: '12 MW' },
      { k: 'stat1_label', label: 'Number 1 label' },
      { k: 'stat2_value', label: 'Homepage number 2', ph: '450+' },
      { k: 'stat2_label', label: 'Number 2 label' },
      { k: 'stat3_value', label: 'Homepage number 3', ph: '18' },
      { k: 'stat3_label', label: 'Number 3 label' },
      { k: 'calc_yield', label: 'Units per kWp per day', type: 'number' },
      { k: 'calc_roof', label: 'Roof area per kWp (sq ft)', type: 'number' },
      { k: 'calc_tariff_home', label: 'Home tariff (₹ / unit)', type: 'number' },
      { k: 'calc_tariff_biz', label: 'Business tariff (₹ / unit)', type: 'number' },
    ],
  };

  Alpine.data('settings', () => ({
    sections: [
      { id: 'users', name: 'Users', admin: true },
      { id: 'permissions', name: 'Permissions', admin: true },
      { id: 'company', name: 'Company & contact', admin: true },
      { id: 'site', name: 'Website & calculator', admin: true },
      { id: 'account', name: 'My account', admin: false },
    ],
    modules: [
      { id: 'crm', name: 'CRM', desc: 'Leads, pipeline, website enquiries' },
      { id: 'projects', name: 'Projects', desc: 'Stages, checklists, documents' },
      { id: 'calendar', name: 'Calendar', desc: 'Events, deadlines, checklists' },
      { id: 'clients', name: 'Clients', desc: 'Create client portal logins, service requests' },
      { id: 'website', name: 'Website editor', desc: 'Hero video, gallery, brand ribbons' },
    ],
    sec: 'users', isAdmin: false, users: [], perms: {}, cfg: {},
    modal: null, uform: {}, error: '', secret: {},

    async init() {
      await AVN.ready;
      this.isAdmin = Alpine.store('app').user.role === 'admin';
      if (!this.isAdmin) { this.sec = 'account'; return; }
      const [users, perms, cfg] = await Promise.all([AVN.get('/users'), AVN.get('/permissions'), AVN.get('/settings')]);
      this.users = users; this.perms = perms; this.cfg = cfg;
    },
    get visibleSections() { return this.sections.filter((s) => this.isAdmin || !s.admin); },
    fieldsFor(sec) { return FIELDS[sec] || []; },
    async togglePerm(id) {
      try {
        this.perms = await AVN.put('/permissions', { [id]: !this.perms[id] });
        AVN.toast('Permissions updated');
      } catch (e) { AVN.toast(e.message, true); }
    },
    async saveSettings() {
      try { this.cfg = await AVN.put('/settings', this.cfg); AVN.toast('Settings saved'); } catch (e) { AVN.toast(e.message, true); }
    },
    openUser(u) {
      this.error = '';
      this.uform = u ? { id: u.id, name: u.name, username: u.username, email: u.email, role: u.role, active: u.active ? '1' : '0' }
        : { name: '', username: '', email: '', role: 'staff', password: '' };
      this.modal = 'user';
    },
    async saveUser() {
      this.error = '';
      try {
        if (this.uform.id) {
          await AVN.patch('/users/' + this.uform.id, { name: this.uform.name, email: this.uform.email, role: this.uform.role, active: this.uform.active === '1' });
          this.modal = null;
          AVN.toast('User saved');
        } else {
          const r = await AVN.post('/users', this.uform);
          this.secret = { name: r.user.name, username: r.user.username, password: r.tempPassword };
          this.modal = 'secret';
        }
        this.users = await AVN.get('/users');
      } catch (e) { this.error = e.message; }
    },
    async resetUser(u) {
      if (!confirm('Create a new temporary password for ' + u.name + '?')) return;
      try {
        const r = await AVN.post('/users/' + u.id + '/reset-password');
        this.secret = { name: u.name, username: u.username, password: r.tempPassword };
        this.modal = 'secret';
        this.users = await AVN.get('/users');
      } catch (e) { AVN.toast(e.message, true); }
    },
  }));
});
