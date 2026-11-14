document.addEventListener('alpine:init', () => {
  Alpine.data('clients', () => ({
    list: [], requests: [], projects: [], tab: 'logins', q: '',
    modal: null, form: {}, error: '', creds: {},
    portalUrl: location.origin + '/portal',

    async init() {
      await AVN.ready;
      await Promise.all([this.load(), this.loadRequests()]);
      if (Alpine.store('app').perms.projects) this.projects = (await AVN.get('/projects')).projects;
    },
    async load() { this.list = await AVN.get('/clients'); },
    async loadRequests() { this.requests = await AVN.get('/requests'); },
    get filtered() {
      const q = this.q.trim().toLowerCase();
      return this.list.filter((c) => !q || (c.name + ' ' + c.customerId + ' ' + c.phone).toLowerCase().includes(q));
    },
    get openRequests() { return this.requests.filter((r) => r.status !== 'closed').length; },
    get message() {
      return 'Hello ' + String(this.creds.name || '').split(' ')[0] + ', here are your AVN Solar customer portal sign-in details.\n' +
        'Sign in: ' + this.portalUrl + '\nMobile number: ' + this.creds.phone + ' (or Customer ID ' + this.creds.customerId + ')\n' +
        'Password: ' + this.creds.password + '\nYou will choose your own password after signing in.';
    },
    openNew() {
      this.error = '';
      this.form = { name: '', phone: '', email: '', projectId: '', password: '' };
      this.modal = 'form';
    },
    openEdit(c) {
      this.error = '';
      this.form = { id: c.id, name: c.name, phone: c.phone, email: c.email, projectId: c.projects[0] ? c.projects[0].id : '' };
      this.modal = 'form';
    },
    async submit() {
      this.error = '';
      try {
        if (this.form.id) {
          await AVN.patch('/clients/' + this.form.id, { name: this.form.name, phone: this.form.phone, email: this.form.email, projectId: this.form.projectId || null });
          this.modal = null;
          AVN.toast('Client saved');
        } else {
          const r = await AVN.post('/clients', Object.assign({}, this.form, { projectId: this.form.projectId || null }));
          this.creds = { name: r.client.name, customerId: r.client.customerId, phone: r.client.phone, password: r.tempPassword };
          this.modal = 'creds';
        }
        await this.load();
      } catch (e) { this.error = e.message; }
    },
    async reset(c) {
      if (!confirm('Give ' + c.name + ' a new password? Their old one stops working and they are signed out.')) return;
      try {
        const r = await AVN.post('/clients/' + c.id + '/reset-password');
        this.creds = { name: c.name, customerId: c.customerId, phone: c.phone, password: r.tempPassword };
        this.modal = 'creds';
        await this.load();
      } catch (e) { AVN.toast(e.message, true); }
    },
    async toggleActive(c) {
      try { await AVN.patch('/clients/' + c.id, { active: !c.active }); await this.load(); } catch (e) { AVN.toast(e.message, true); }
    },
    async setStatus(r, status) {
      try { await AVN.patch('/requests/' + r.id, { status }); r.status = status; AVN.toast('Status updated'); } catch (e) { AVN.toast(e.message, true); }
    },
  }));
});
