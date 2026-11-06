document.addEventListener('alpine:init', () => {
  const COLORS = ['#2BA6E4', '#1D50B5', '#F7931E', '#8E6BD8', '#1E8E5A', '#8A93B5'];
  Alpine.data('crm', () => ({
    stages: [], leads: [], team: [], q: '', type: 'All', showLost: false,
    types: ['All', 'Home', 'Business', 'Industry', 'Farm'],
    sources: ['Website', 'Phone', 'WhatsApp', 'Referral', 'Walk-in', 'Google Ads', 'Meta ads'],
    sel: null, activity: [], quotes: [], note: '', creating: false, form: {}, error: '',

    async init() {
      await AVN.ready;
      await this.load();
      this.team = await AVN.get('/team');
    },
    async load() {
      const r = await AVN.get('/leads');
      this.stages = r.stages;
      this.leads = r.leads;
    },
    get visible() {
      const q = this.q.trim().toLowerCase();
      return this.leads.filter((l) => (this.type === 'All' || l.type === this.type) &&
        (!q || (l.name + ' ' + l.place + ' ' + l.phone).toLowerCase().includes(q)));
    },
    get lostCount() { return this.leads.filter((l) => l.stage === 5).length; },
    get columns() {
      const n = this.showLost ? 6 : 5;
      return this.stages.slice(0, n).map((name, stage) => {
        const items = this.visible.filter((l) => l.stage === stage);
        return { name, stage, color: COLORS[stage], items, total: items.reduce((a, l) => a + (Number(l.value) || 0), 0) };
      });
    },
    get kpi() {
      const open = this.leads.filter((l) => l.stage < 4);
      const month = AVN.today().slice(0, 7);
      return {
        open: open.length,
        pipe: open.reduce((a, l) => a + (Number(l.value) || 0), 0),
        due: open.filter((l) => l.dueDate && AVN.daysFromToday(l.dueDate) <= 0).length,
        won: this.leads.filter((l) => l.stage === 4 && (l.updatedAt || '').slice(0, 7) === month).reduce((a, l) => a + (Number(l.value) || 0), 0),
      };
    },
    dueLabel(l) {
      if (l.stage === 4) return 'Won';
      if (l.stage === 5) return 'Lost';
      const d = AVN.daysFromToday(l.dueDate);
      if (d === null) return '';
      if (d < 0) return 'Late · ' + AVN.date(l.dueDate);
      if (d === 0) return 'Today';
      return AVN.date(l.dueDate);
    },
    dueClass(l) {
      if (l.stage === 4) return 'green';
      const d = AVN.daysFromToday(l.dueDate);
      if (l.stage < 4 && d !== null && d < 0) return 'red';
      if (l.stage < 4 && d === 0) return 'amber';
      return '';
    },
    async open(l) {
      this.sel = Object.assign({}, l);
      this.activity = [];
      this.quotes = [];
      const r = await AVN.get('/leads/' + l.id);
      this.activity = r.activity;
      this.quotes = r.quotes || [];
    },
    // A quotation pre-filled from this lead (name, mobile, place, size, type).
    async quote() {
      const size = parseFloat(String(this.sel.size || '').replace(/[^\d.]/g, ''));
      let kwp = size > 0 ? size : null;
      if (!kwp) {
        const answer = prompt('System size for the quotation (kWp)?', '3');
        if (answer === null) return;
        kwp = parseFloat(answer);
      }
      try {
        await AVN.patch('/leads/' + this.sel.id, this.payload(this.sel));
        const q = await AVN.post('/quotes', { leadId: this.sel.id, kwp });
        location.href = '/admin/quotes?id=' + q.id;
      } catch (e) { AVN.toast(e.message, true); }
    },
    close() { this.sel = null; },
    payload(o) {
      return { name: o.name, phone: o.phone, email: o.email, place: o.place, type: o.type, size: o.size, value: o.value,
        ownerId: o.ownerId || null, source: o.source, nextAction: o.nextAction, dueDate: o.dueDate, message: o.message };
    },
    replace(updated) {
      this.leads = this.leads.map((x) => (x.id === updated.id ? updated : x));
      if (this.sel && this.sel.id === updated.id) this.sel = Object.assign({}, updated);
    },
    async save() {
      try {
        this.replace(await AVN.patch('/leads/' + this.sel.id, this.payload(this.sel)));
        AVN.toast('Lead saved');
      } catch (e) { AVN.toast(e.message, true); }
    },
    async setStage(stage) {
      try {
        this.replace(await AVN.patch('/leads/' + this.sel.id, Object.assign(this.payload(this.sel), { stage })));
        this.activity = (await AVN.get('/leads/' + this.sel.id)).activity;
      } catch (e) { AVN.toast(e.message, true); }
    },
    async addNote() {
      if (!this.note.trim()) return;
      try {
        await AVN.post('/leads/' + this.sel.id + '/activity', { text: this.note });
        this.note = '';
        this.activity = (await AVN.get('/leads/' + this.sel.id)).activity;
      } catch (e) { AVN.toast(e.message, true); }
    },
    async convert() {
      try {
        await AVN.post('/leads/' + this.sel.id + '/convert');
        AVN.toast('Project created');
        await this.load();
        this.sel = Object.assign({}, this.leads.find((l) => l.id === this.sel.id));
      } catch (e) { AVN.toast(e.message, true); }
    },
    async remove() {
      if (!confirm('Delete this lead and its history?')) return;
      try {
        await AVN.del('/leads/' + this.sel.id);
        this.leads = this.leads.filter((l) => l.id !== this.sel.id);
        this.sel = null;
        AVN.toast('Lead deleted');
      } catch (e) { AVN.toast(e.message, true); }
    },
    openNew() {
      this.error = '';
      this.form = { name: '', phone: '', place: '', type: 'Home', size: '', value: '', source: 'Phone', dueDate: AVN.today() };
      this.creating = true;
    },
    async create() {
      this.error = '';
      try {
        const l = await AVN.post('/leads', Object.assign({}, this.form, { nextAction: 'Call back' }));
        this.leads.unshift(l);
        this.creating = false;
        AVN.toast('Lead added');
      } catch (e) { this.error = e.message; }
    },
  }));
});
