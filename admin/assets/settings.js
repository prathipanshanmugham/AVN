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
      { k: 'address', label: 'Office address', type: 'area', wide: true },
    ],
    seo: [
      { k: 'site_title', label: 'Site title', hint: 'the blue link in Google — about 50–60 characters', wide: true },
      { k: 'site_description', label: 'Site description', hint: 'the grey text in Google — about 150 characters', type: 'area', rows: 3, wide: true },
      { k: 'site_url', label: 'Website address', hint: 'used for links in Google, the sitemap and sharing', ph: 'https://avnsolar.in' },
      { k: 'service_areas', label: 'Areas you serve', hint: 'comma separated — e.g. Tamil Nadu, Tiruppur, Erode', ph: 'Tamil Nadu, Tiruppur, Erode, Coimbatore' },
      { k: 'addr_city', label: 'Office town / city', hint: 'for Google’s business details', ph: 'Tiruppur' },
      { k: 'addr_pincode', label: 'Office PIN code', ph: '641601' },
      { k: 'google_verification', label: 'Google Search Console code', hint: 'paste the HTML tag or just the code' },
      { k: 'bing_verification', label: 'Bing Webmaster code', hint: 'paste the meta tag or just the code' },
      { k: 'ga_id', label: 'Google Analytics 4 ID', hint: 'visits and form leads are tracked once set', ph: 'G-XXXXXXXXXX' },
      { k: 'social_facebook', label: 'Facebook page', ph: 'https://facebook.com/…' },
      { k: 'social_instagram', label: 'Instagram', ph: 'https://instagram.com/…' },
      { k: 'social_youtube', label: 'YouTube channel', ph: 'https://youtube.com/@…' },
      { k: 'social_linkedin', label: 'LinkedIn page', ph: 'https://linkedin.com/company/…' },
    ],
    site: [
      { k: 'whatsapp_message', label: 'WhatsApp button message', hint: 'pre-filled when a visitor taps WhatsApp', type: 'area', rows: 2, wide: true },
      { k: 'popup_enabled', label: 'Offer popup', hint: 'Shown once a week per visitor, after a delay or when they move to leave', type: 'switch', wide: true },
      { k: 'popup_title', label: 'Popup headline' },
      { k: 'popup_delay', label: 'Show popup after (seconds)', type: 'number' },
      { k: 'video_fast_only', label: 'Play hero video only on fast connections', hint: 'Visitors on data-saver or 2G see the still image instead', type: 'switch', wide: true },
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
    leads: [
      { k: 'lead_emails', label: 'Send new leads to', hint: 'one or more emails, separated by commas', type: 'text', ph: 'sales@avnsolar.in, owner@gmail.com', wide: true },
      { k: 'smtp_host', label: 'SMTP server', ph: 'smtp.gmail.com' },
      { k: 'smtp_port', label: 'Port', type: 'number', ph: '465' },
      { k: 'smtp_user', label: 'SMTP username', hint: 'usually the full email address', ph: 'leads@avnsolar.in' },
      { k: 'smtp_pass', label: 'SMTP password', type: 'password' },
      { k: 'smtp_from', label: 'Send as', hint: 'blank = SMTP username', ph: 'AVN Solar <leads@avnsolar.in>' },
      { k: 'smtp_secure', label: 'Use SSL / TLS', hint: 'On for port 465. Off for 587 (STARTTLS is used automatically).', type: 'switch' },
    ],
    quotes: [
      { k: 'rate_ongrid', label: 'On-grid rate (₹ per kWp)', hint: 'before GST', type: 'number', ph: '55000' },
      { k: 'rate_hybrid', label: 'Hybrid rate (₹ per kWp)', hint: 'before GST', type: 'number' },
      { k: 'rate_offgrid', label: 'Off-grid rate (₹ per kWp)', hint: 'before GST', type: 'number' },
      { k: 'quote_tax_mode', label: 'GST on new quotations', type: 'select', options: [['composite', 'Solar EPC: 70% @ 5% + 30% @ 18% (≈ 8.9%)'], ['itemised', 'GST rate on each line']] },
      { k: 'quote_format', label: 'Format of new quotations', hint: 'can be switched on each quotation', type: 'select', options: [['itemwise', 'Item-wise — every line priced'], ['grouped', 'Grouped — one price per group']] },
      { k: 'quote_tax_summary', label: 'Print the HSN/SAC tax summary', hint: 'default for new quotations — can be switched on each one', type: 'switch' },
      { k: 'quote_hsn_system', label: 'HSN for the 70% supply', hint: 'composite GST summary', ph: '8541 43 00' },
      { k: 'quote_sac_install', label: 'SAC for the 30% services', hint: 'composite GST summary', ph: '995461' },
      { k: 'quote_components', label: 'Component lines', type: 'components', wide: true },
      { k: 'quote_prefix', label: 'Number prefix', hint: 'gives AVN-Q/26-27/0001' },
      { k: 'quote_validity', label: 'Valid for (days)', type: 'number' },
      { k: 'quote_module_wp', label: 'Module rating (Wp)', hint: 'used to count panels', type: 'number' },
      { k: 'quote_module_make', label: 'Module make', ph: 'e.g. your usual brand' },
      { k: 'quote_inverter_make', label: 'Inverter make' },
      { k: 'quote_terms', label: 'Terms & conditions', hint: 'one per line — printed on every quotation', type: 'area', rows: 6, wide: true },
      { k: 'bank_name', label: 'Bank name' },
      { k: 'bank_account', label: 'Account number' },
      { k: 'bank_ifsc', label: 'IFSC' },
      { k: 'bank_branch', label: 'Branch' },
      { k: 'upi_id', label: 'UPI ID', ph: 'avnsolar@bank' },
    ],
  };
  const FORM_SECTIONS = ['company', 'seo', 'site', 'leads', 'quotes'];

  Alpine.data('settings', () => ({
    sections: [
      { id: 'users', name: 'Users', admin: true },
      { id: 'permissions', name: 'Permissions', admin: true },
      { id: 'company', name: 'Company & contact', admin: true, desc: 'Shown on the website footer, contact buttons, quotations and the client portal.' },
      { id: 'seo', name: 'Search (SEO) & social', admin: true, desc: 'How the website appears on Google and when shared on WhatsApp, plus Search Console, Analytics and social links.' },
      { id: 'site', name: 'Website & lead capture', admin: true, desc: 'WhatsApp button, offer popup, homepage numbers, video loading and the savings calculator.' },
      { id: 'leads', name: 'Lead emails', admin: true, desc: 'Get every website enquiry in your inbox the moment it arrives.' },
      { id: 'quotes', name: 'Quotations & bank', admin: true, desc: 'Rates, GST, terms and bank details used by the quotation generator.' },
      { id: 'account', name: 'My account', admin: false },
    ],
    FORM_SECTIONS, testing: false,
    modules: [
      { id: 'dashboard', name: 'CEO dashboard & reports', desc: 'Health score, kW installed, PDF reports — off for staff by default' },
      { id: 'crm', name: 'CRM', desc: 'Leads, pipeline, website enquiries' },
      { id: 'projects', name: 'Projects', desc: 'Stages, checklists, documents' },
      { id: 'calendar', name: 'Calendar', desc: 'Events, deadlines, checklists' },
      { id: 'clients', name: 'Clients', desc: 'Create client portal logins, service requests' },
      { id: 'quotes', name: 'Quotations', desc: 'Create, print and share quotations' },
      { id: 'website', name: 'Website editor', desc: 'Hero video and photos, gallery, brand logos' },
    ],
    sec: 'users', isAdmin: false, users: [], perms: {}, cfg: {}, comps: [],
    modal: null, uform: {}, error: '', secret: {},

    async init() {
      await AVN.ready;
      this.isAdmin = Alpine.store('app').user.role === 'admin';
      if (!this.isAdmin) { this.sec = 'account'; return; }
      const [users, perms, cfg] = await Promise.all([AVN.get('/users'), AVN.get('/permissions'), AVN.get('/settings')]);
      this.users = users; this.perms = perms; this.cfg = cfg;
      this.readComps();
      const want = new URLSearchParams(location.search).get('sec');
      if (want && this.sections.some((s) => s.id === want)) this.sec = want;
    },
    get visibleSections() { return this.sections.filter((s) => this.isAdmin || !s.admin); },
    get current() { return this.sections.find((s) => s.id === this.sec) || {}; },
    get hasRates() { return ['rate_ongrid', 'rate_hybrid', 'rate_offgrid'].some((k) => Number(this.cfg[k]) > 0); },
    fieldsFor(sec) { return FIELDS[sec] || []; },
    readComps() {
      try { this.comps = JSON.parse(this.cfg.quote_components || '[]'); } catch (e) { this.comps = []; }
    },
    get compShare() { return this.comps.filter((c) => c.key !== 'battery').reduce((a, c) => a + (Number(c.share) || 0), 0); },
    async togglePerm(id) {
      try {
        this.perms = await AVN.put('/permissions', { [id]: !this.perms[id] });
        AVN.toast('Permissions updated');
      } catch (e) { AVN.toast(e.message, true); }
    },
    async saveSettings() {
      const keys = (FIELDS[this.sec] || []).map((f) => f.k);
      const body = {};
      keys.forEach((k) => { body[k] = k === 'quote_components' ? JSON.stringify(this.comps) : this.cfg[k]; });
      try { this.cfg = await AVN.put('/settings', body); this.readComps(); AVN.toast('Settings saved'); } catch (e) { AVN.toast(e.message, true); }
    },
    async testEmail() {
      this.testing = true;
      try {
        await this.saveSettings();
        const r = await AVN.post('/settings/test-email');
        this.cfg.mail_status = r.status;
        AVN.toast('Test email sent to ' + r.to.join(', '));
      } catch (e) {
        AVN.toast(e.message, true);
        try { this.cfg = await AVN.get('/settings'); } catch (err) { /* ignore */ }
      }
      this.testing = false;
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
